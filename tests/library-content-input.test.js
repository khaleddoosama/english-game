// What goes into a library: a pasted list of words, a word a player writes,
// words picked by search, and content files checked before they are imported.
// Missing, empty and oversized input should be refused or ignored, never crash.
import { beforeEach, describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";
import { MAX_LIBRARY, MAX_PER_CALL, senseFromCard } from "../src/features/library/libraryRules.js";
import { matchPasted, searchWords } from "../src/features/library/libraryTree.js";
import { dictionary, word } from "./libraryFixtures";

const dict = [
  { word: "Cast", meaning: "A group of actors" },
  { word: "Cast (to throw)", meaning: "To throw" },
  { word: "Shrink", meaning: "To become smaller" },
  { word: "Take off", meaning: "To leave the ground" },
  { word: "Reluctant", meaning: "Unwilling to do something" },
];

describe("a pasted list of words", () => {
  it("is split on new lines, commas and semicolons, whatever the mix, with Windows line ends too", () => {
    const r = matchPasted("Shrink\r\nReluctant;  take off ,\n\n  ,", dict);
    expect(r.matched).toEqual(["Shrink", "Reluctant", "Take off"]);
    expect(r.ambiguous).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("nothing, blanks, or something that is not text, gives nothing and does not fail", () => {
    const none = { matched: [], ambiguous: [], missing: [] };
    for (const v of ["", "   \n , ; ", null, undefined]) expect(matchPasted(v, dict), String(v)).toEqual(none);
    expect(matchPasted("Shrink", [])).toEqual({ matched: [], ambiguous: [], missing: ["Shrink"] });
    expect(matchPasted("Shrink", null).missing).toEqual(["Shrink"]);
  });

  it("matches without caring about case or extra spaces, and a typed meaning label picks that meaning", () => {
    expect(matchPasted("  SHRINK  ", dict).matched).toEqual(["Shrink"]);
    expect(matchPasted("take    OFF", dict).matched).toEqual(["Take off"]);
    expect(matchPasted("cast (TO throw)", dict).matched).toEqual(["Cast (to throw)"]);
  });

  it("a word with two meanings is never picked for the player", () => {
    const r = matchPasted("cast", dict);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toEqual([{ token: "cast", options: ["Cast", "Cast (to throw)"] }]);
  });

  it("a word that is not in the dictionary is listed as it was typed, a part of a word is not a match", () => {
    expect(matchPasted("Shrin\nShrinkage", dict).missing).toEqual(["Shrin", "Shrinkage"]);
  });
});

describe("finding a word by typing", () => {
  it("nothing typed finds nothing, and so does a word that is not there", () => {
    for (const q of ["", "   ", null, undefined]) expect(searchWords(dict, q)).toEqual([]);
    expect(searchWords(dict, "zebra")).toEqual([]);
    expect(searchWords(null, "cast")).toEqual([]);
  });

  it("stops at the limit, keeping the words that start with what was typed ahead of the others", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ word: `Run${i}`, meaning: "to go fast" })).concat([{ word: "Prune", meaning: "to cut" }]);
    const r = searchWords(many, "run", 5);
    expect(r).toHaveLength(5);
    expect(r.every((w) => w.word.startsWith("Run"))).toBe(true);
    expect(searchWords(many, "run", 100).at(-1).word).toBe("Prune");          // contains it, so it comes last
  });

  it("looks in the meaning too, and copes with a word that has none", () => {
    expect(searchWords([...dict, { word: "Blank" }], "actors").map((w) => w.word)).toEqual(["Cast"]);
    expect(searchWords([...dict, { word: "Blank" }], "blank").map((w) => w.word)).toEqual(["Blank"]);
  });
});

describe("a word the player writes", () => {
  it("is cleaned up and split into the columns of the database", () => {
    const c = senseFromCard({ word: "  Quokka  ", meaning: "  A small animal ", partsOfSpeech: ["noun"], hints: [], flag: false, count: 0, _tmp: "x", gone: undefined });
    expect(c).toMatchObject({ word: "Quokka", meaning: "A small animal", pos: ["noun"], source: "user" });
    expect(c.content).toEqual({ hints: [], flag: false, count: 0 });                    // empty text and null are dropped; false and 0 are real values
  });

  it("with parts of speech that are not a list, or a type left out, takes the defaults", () => {
    expect(senseFromCard({ word: "x", meaning: "m", partsOfSpeech: "noun" })).toMatchObject({ pos: [], type: "vocab" });
    expect(senseFromCard({ word: 42, meaning: null })).toMatchObject({ word: "42", meaning: "" });
    expect(senseFromCard(undefined)).toMatchObject({ word: "", meaning: "", content: {} });
  });
});

describe("how many words a library holds", () => {
  let api;
  beforeEach(() => {
    const m = new Map();
    api = createLocalLibraryApi({ storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }, me: () => "a" });
  });
  const ids = (from, n) => Array.from({ length: n }, (_, i) => `w${from + i}`);

  it("200 at a time is allowed, 201 is refused and adds none of them", async () => {
    await expect(api.libraryAdd(ids(0, MAX_PER_CALL))).resolves.toHaveLength(MAX_PER_CALL);
    await expect(api.libraryAdd(ids(1000, MAX_PER_CALL + 1))).rejects.toThrow(/200 words at a time/);
    expect((await api.libraryList()).words).toHaveLength(MAX_PER_CALL);
  });

  it("5000 is the most; taking one out makes room", async () => {
    for (let from = 0; from < MAX_LIBRARY; from += MAX_PER_CALL) await api.libraryAdd(ids(from, MAX_PER_CALL));
    expect((await api.libraryList()).words).toHaveLength(MAX_LIBRARY);
    await expect(api.libraryAdd(["extra"])).rejects.toThrow(/up to 5000 words/);
    await api.libraryRemove("w0");
    await expect(api.libraryAdd(["extra"])).resolves.toEqual(["extra"]);
    await expect(api.libraryAdd(["extra2"])).rejects.toThrow(/up to 5000 words/);
  });
});

describe("a content file, checked before it is imported", () => {
  const good = () => ({ kind: "content", words: [word("Alpha1"), word("Beta2")] });
  const check = (patch) => V2.validateContent(patch);

  it("a complete file has no problems", () => {
    expect(check(good())).toEqual([]);
    expect(check({ kind: "content", words: dictionary(30) })).toEqual([]);
  });

  it("anything that is not a file of content is refused as a whole", () => {
    for (const v of [null, undefined, 5, "text", []]) expect(check(v), String(v)).not.toEqual([]);
    expect(check({})).toEqual(["$: no content arrays"]);
    expect(check({ kind: "content" })).toEqual(["$: no content arrays"]);
    expect(check({ kind: "content", words: {} })).toEqual(["words: expected array"]);
    const notWords = check({ kind: "content", words: ["text", 5] });
    expect(notWords.length).toBeGreaterThan(0);
    expect(notWords.every((m) => /^words\[[01]\]/.test(m))).toBe(true);                    // refused, with the place named
  });

  it("names the word and the field that is missing or empty", () => {
    for (const field of ["word", "type", "category", "meaning", "situation", "gap"]) {
      const f = good(); f.words[1][field] = "  ";
      expect(check(f), field).toContain(`words[1].${field}: expected non-empty string`);
      delete f.words[1][field];
      expect(check(f), field).toContain(`words[1].${field}: expected non-empty string`);
      expect(check(f).every((m) => m.startsWith(`words[1].${field}:`)), field).toBe(true);        // and nothing else is blamed
    }
  });

  it("a word that is not text, or a type the game does not know, is refused", () => {
    const f = good(); f.words[0].word = 12;
    expect(check(f)).toContain("words[0].word: expected non-empty string");
    const g = good(); g.words[0].type = "slang";
    expect(check(g)).toEqual(["words[0].type: unsupported type"]);
  });

  it("the same word twice is refused whatever its case or spacing", () => {
    const f = good(); f.words.push(word("  ALPHA1 "));
    expect(check(f)).toEqual(["words[2].word: duplicate key"]);
  });

  it("an opposite must be a word that exists, and a word to keep apart one that is in the file", () => {
    const f = good(); f.words[0].opposite = "Nobody";
    expect(check(f)).toEqual(expect.arrayContaining([expect.stringContaining("words[0].opposite")]));
    const g = good(); g.words[0].excludeFromSameOptionsWith = ["Beta2"];
    expect(check(g)).toEqual([]);
  });

  it("a quick stub needs only the four basic fields", () => {
    expect(check({ kind: "content", words: [{ word: "Stub", type: "vocab", category: "Lesson 1", meaning: "m", _autoStub: true }] })).toEqual([]);
    expect(check({ kind: "content", words: [{ word: "Stub", type: "vocab", category: "Lesson 1", meaning: "m" }] })).toHaveLength(2);
  });

  it("player data or an unknown part does not belong in a content file", () => {
    expect(check({ ...good(), mastery: {} })).toContain("mastery: player data is not allowed in content");
    expect(check({ ...good(), extras: [] })).toEqual(["extras: unrecognized content field; nothing was imported"]);
    expect(check({ ...good(), kind: "other" })).toContain("kind: unsupported kind");
    expect(check({ ...good(), schemaVersion: 99 })).toContain("schemaVersion: unsupported version");
  });

  it("a pair of words needs two different words", () => {
    const pair = (words) => ({ ...good(), combos: [{ id: "c", category: "Lesson 1", situation: "s", prompt: "p", explanation: "e", words }] });
    expect(check(pair(["Alpha1", "Beta2"]))).toEqual([]);
    expect(check(pair(["Alpha1"]))).not.toEqual([]);
    expect(check(pair(["Alpha1", "alpha1"])).join()).toMatch(/duplicate targets|must be different/);
  });
});
