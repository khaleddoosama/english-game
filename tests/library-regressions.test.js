// Mistakes found while testing the library and rounds from a view. Each test
// here failed before its fix.
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";
import { matchPasted } from "../src/features/library/libraryTree.js";
import { inspectImport } from "../src/features/data/transfer.js";
import { dictionary, introduced, scopeOf, seeded, word } from "./libraryFixtures";

describe("a pasted list that repeats a word in another case", () => {
  const dict = [{ word: "Cast", meaning: "A group of actors" }, { word: "Cast (to throw)", meaning: "To throw" }, { word: "Shrink", meaning: "To become smaller" }];

  it("lists a missing word once", () => {
    expect(matchPasted("zzz\nZZZ\n Zzz ", dict).missing).toEqual(["zzz"]);
  });

  it("lists a word with two meanings once, so the player is asked once", () => {
    expect(matchPasted("cast\nCast\nCAST", dict).ambiguous).toEqual([{ token: "cast", options: ["Cast", "Cast (to throw)"] }]);
  });

  it("keeps the order of first appearance", () => {
    const r = matchPasted("Nope\nShrink\nnope\nshrink\nOther", dict);
    expect(r.matched).toEqual(["Shrink"]);
    expect(r.missing).toEqual(["Nope", "Other"]);
  });
});

describe("a word of my own in local mode", () => {
  const make = () => { const m = new Map(); return createLocalLibraryApi({ storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }, me: () => "a" }); };

  it("is refused above 120 characters, as the database refuses it, and is not added", async () => {
    const api = make();
    await expect(api.createWord({ word: "x".repeat(121), meaning: "m" })).rejects.toThrow(/1 to 120/);
    expect((await api.libraryList()).words).toEqual([]);
  });

  it("is judged after trimming: 120 characters with spaces around it is fine, spaces alone are not", async () => {
    const api = make();
    await expect(api.createWord({ word: `  ${"x".repeat(120)}  `, meaning: "m" })).resolves.toMatchObject({ existing: false });
    await expect(api.createWord({ word: "    ", meaning: "m" })).rejects.toThrow(/1 to 120/);
  });
});

describe("a content file with an empty entry in a list", () => {
  it("is refused with a message naming the place, instead of crashing the check", () => {
    for (const field of ["words", "grammar", "combos", "stories", "challenges"]) {
      let issues;
      expect(() => { issues = V2.validateContent({ kind: "content", [field]: [null] }); }, field).not.toThrow();
      expect(issues, field).toContain(`${field}[0]: expected object`);
    }
  });

  it("the import check reports the problem the same way", () => {
    const file = JSON.stringify({ kind: "content", words: [word("Alpha1"), null] });
    let error;
    try { inspectImport(file, { words: [] }); } catch (e) { error = e; }
    expect(error?.issues).toEqual(["words[1]: expected object"]);
  });
});

describe("a typed question", () => {
  const leaky = word("Zorb", { meaning: "Zorb is a kind of thing", gap: "I ______ and Zorb." });
  const others = Array.from({ length: 6 }, (_, i) => word(`Other${i}`));
  const all = [leaky, ...others];
  const rng = seeded(5);

  it("does not show the answer in its prompt: the meaning of a word that names itself", () => {
    expect(V2.makeQuestion(leaky, "typing", all, rng)).toBeNull();
  });

  it("does not show the answer in its prompt: a sentence with the word in it", () => {
    expect(V2.makeQuestion({ ...leaky, meaning: "a kind of thing" }, "gapTyping", all, rng)).toBeNull();
  });

  it("does not mind the word being part of another word", () => {
    const sane = word("Sane", { meaning: 'Opposite of "Insane".', gap: "He is perfectly ______ today." });
    expect(V2.makeQuestion(sane, "typing", [sane, ...others], rng)).toMatchObject({ type: "typing", answers: ["Sane"] });
  });

  it("still asks the word when only the label of a meaning is in the prompt", () => {
    const cast = word("Cast (to throw)", { meaning: "To throw something, for example a net", gap: "He will ______ the net." });
    expect(V2.makeQuestion(cast, "typing", [cast, ...others], rng)).toMatchObject({ type: "typing" });
    const castActors = word("Cast (actors)", { meaning: "The cast of a film are its actors" });
    expect(V2.makeQuestion(castActors, "typing", [castActors, ...others], rng)).toBeNull();
  });

  it("a round from a view never shows an answer in a typed prompt", () => {
    const words = [...dictionary(8), leaky];
    const known = introduced(words.map((w) => w.word));
    const learned = Object.fromEntries(Object.entries(known).map(([k, v]) => [k, { ...v, correct: 3, total: 3, modes: { reverse: { correct: 2, total: 2 }, gap: { correct: 1, total: 1 } } }]));
    let typed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = V2.practice({ words }, learned, null, seeded(seed), null, { questionsPerRound: 12, scope: scopeOf(words.map((w) => w.word)) });
      for (const q of s.queue.filter((x) => x.type === "typing" && x.mode !== "transform")) {
        typed++;
        expect(V2.norm(q.prompt), q.id).not.toContain(V2.norm(V2.bareWord(q.answers[0])));
      }
    }
    expect(typed).toBeGreaterThan(10);
  });
});
