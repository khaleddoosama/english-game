// The dictionary rules: names and finding a word, words that may not be options together, antonyms and opposites,
// stubs for missing words, renames, merging content, removed fields. Made-up content. Docs:
// docs/modules/content/dictionary-rules.md.
import { describe, expect, it } from "vitest";
import * as D from "../src/engine/dictionary";
import { V2 } from "../src/engine/v2";

const W = (word, extra = {}) => ({ word, type: "vocab", category: "Weather", meaning: `The meaning of ${word}.`, situation: `A ${word} today.`, gap: "A ______ today.", ...extra });
const words = (list) => list.map((w) => w.word);

describe("names and finding a word", () => {
  it("norm: trimmed, single spaces, lower case", () => {
    expect(D.norm("  Light   Rain ")).toBe("light rain");
    expect(D.norm(null)).toBe("");
  });
  it("bareWord drops a trailing bracket only", () => {
    expect(D.bareWord("Cast (to throw)")).toBe("Cast");
    expect(D.bareWord("(Not) a word")).toBe("(Not) a word");
  });
  it("findWord matches the whole name, ignoring case and spaces, not the headword", () => {
    const list = [W("Gust"), W("Cast (to throw)")];
    expect(D.findWord(list, "  gust ")).toBe(list[0]);
    expect(D.findWord(list, "cast (TO throw)")).toBe(list[1]);
    expect(D.findWord(list, "Cast")).toBeUndefined();
  });
});

describe("words that may not be options together", () => {
  it("excluded either way, or a synonym (by bare word) either way", () => {
    const drizzle = W("Drizzle", { excludeFromSameOptionsWith: ["Mist"] });
    expect(D.compatible(drizzle, W("Mist"))).toBe(false);
    expect(D.compatible(W("Mist"), drizzle)).toBe(false);
    expect(D.compatible(W("Gale", { synonyms: ["Storm (strong wind)"] }), W("Storm"))).toBe(false);
    expect(D.compatible(W("Storm"), W("Gale", { relations: { synonyms: ["storm"] } }))).toBe(false);
    expect(D.compatible(W("Gust"), W("Drizzle"))).toBe(true);
    expect(D.compatible(W("Gust"), null)).toBe(false);
  });
});

describe("antonyms and opposites", () => {
  it("antonymsOf keeps non-empty text, trimmed", () => {
    expect(D.antonymsOf(W("Hot", { antonyms: [" cold ", "", 3, null] }))).toEqual(["cold"]);
    expect(D.antonymsOf(W("Hot"))).toEqual([]);
  });
  it("linkAntonyms makes two words each other's opposite from either side, and keeps the antonyms", () => {
    const linked = D.linkAntonyms([W("Hot", { antonyms: ["Cold", "freezing"] }), W("Cold"), W("Warm")]);
    expect(linked.map((w) => w.opposite)).toEqual(["Cold", "Hot", undefined]);
    expect(linked[0].antonyms).toEqual(["Cold", "freezing"]);
    expect(linked[1]).not.toHaveProperty("antonyms");
  });
  it("an old opposite counts as an antonym; 'none' does not; an opposite to no word is dropped", () => {
    const linked = D.linkAntonyms([W("Wet", { opposite: "Dry" }), W("Dry"), W("Calm", { opposite: "none" }), W("Loud", { opposite: "Quiet" })]);
    expect(linked.map((w) => w.opposite)).toEqual(["Dry", "Wet", undefined, undefined]);
    expect(linked[0].antonyms).toEqual(["Dry"]);
    expect(linked[3].antonyms).toEqual(["Quiet"]);
  });
  it("by headword, the entry named just that headword wins over another sense, in either order", () => {
    for (const list of [[W("Tight (money)"), W("Tight")], [W("Tight"), W("Tight (money)")]]) {
      const linked = D.linkAntonyms([W("Loose", { antonyms: ["Tight (snug)"] }), ...list]);
      expect(linked[0].opposite).toBe("Tight");
      expect(linked.find((w) => w.word === "Tight (money)")).not.toHaveProperty("opposite");
    }
  });
  it("outsideAntonyms: not a word in the game, and not giving the word away", () => {
    const list = [W("Hot"), W("Cold")];
    expect(D.outsideAntonyms(W("Hot", { antonyms: ["Cold", "chilly", "not hot", "ho"] }), list)).toEqual(["chilly"]);
  });
  it("healOpposites: 'none' is removed; a missing opposite gets one stub that points back", () => {
    const healed = D.healOpposites([W("Calm", { opposite: "None" }), W("Hot", { opposite: "Icy" }), W("Warm", { opposite: "icy" }), W("Dry", { opposite: "Hot" })]);
    expect(healed[0]).not.toHaveProperty("opposite");
    expect(words(healed)).toEqual(["Calm", "Hot", "Warm", "Dry", "Icy"]);
    expect(healed[4]).toEqual({ word: "Icy", type: "vocab", category: "Weather", meaning: 'Opposite of "Hot".', opposite: "Hot", _autoStub: true });
  });
});

describe("links to missing words", () => {
  it("one stub per missing name from exclusions, combos and stories; known names are left alone", () => {
    const content = {
      words: [W("Gust", { excludeFromSameOptionsWith: ["Breeze", "gust"] })],
      combos: [{ id: "c1", category: "Sky", words: ["Gust", "Cloud"] }],
      stories: [{ id: "s1", category: "Sea", targetWords: ["breeze"], questions: [{ targetWord: "Tide" }, { targetWords: ["Wave", ""] }] }],
    };
    const healed = D.healMissingWordRefs(content);
    expect(words(healed)).toEqual(["Gust", "Breeze", "Cloud", "Tide", "Wave"]);
    expect(healed[1]).toEqual({ word: "Breeze", type: "vocab", category: "Weather", meaning: "Imported reference — needs a real definition.", _autoStub: true });
    expect(healed[2].category).toBe("Sky");
    expect(healed[3].category).toBe("Sea");
  });
  it("nothing missing: the same list", () => {
    const list = [W("Gust")];
    expect(D.healMissingWordRefs({ words: list })).toBe(list);
  });
});

describe("renames", () => {
  const content = {
    words: [W("Gust", { opposite: "Calm", excludeFromSameOptionsWith: ["Calm"], relations: { confusableWords: ["calm"] } }), W("Calm")],
    combos: [{ id: "c1", category: "Weather", words: ["Gust", "Calm"] }],
    stories: [{ id: "s1", category: "Weather", targetWords: ["Calm"], questions: [{ targetWord: "calm" }, { targetWords: ["Calm"] }] }],
    challenges: [{ id: "x1", category: "Weather", linkedWords: ["Calm"] }],
    grammar: [{ id: "g1", category: "Weather" }],
  };
  it("a renamed word is renamed everywhere it is named", () => {
    const out = D.applyRenames(content, { words: [{ from: "Calm", to: "Still" }], categories: [] });
    expect(words(out.words)).toEqual(["Gust", "Still"]);
    expect(out.words[0]).toMatchObject({ opposite: "Still", excludeFromSameOptionsWith: ["Still"], relations: { confusableWords: ["Still"] } });
    expect(out.combos[0].words).toEqual(["Gust", "Still"]);
    expect(out.stories[0].targetWords).toEqual(["Still"]);
    expect(out.stories[0].questions).toEqual([{ targetWord: "Still" }, { targetWords: ["Still"] }]);
    expect(out.challenges[0].linkedWords).toEqual(["Still"]);
  });
  it("a renamed category moves every kind of item; no renames: the same object", () => {
    const out = D.applyRenames(content, { words: [], categories: [{ from: "Weather", to: "Sky" }] });
    expect([...out.words, ...out.combos, ...out.stories, ...out.challenges, ...out.grammar].map((x) => x.category)).toEqual(Array(6).fill("Sky"));
    expect(D.applyRenames(content, { words: [], categories: [] })).toBe(content);
  });
});

describe("merging content", () => {
  it("new items at the end; a known key is merged (incoming fields win, the old spelling stays)", () => {
    const merged = D.mergeContent(
      { words: [W("Gust"), W("Drizzle")], grammar: [{ id: "G1", rule: "old" }] },
      { words: [W("drizzle", { meaning: "Very light rain." }), W("Mist")], grammar: [{ id: "g1", rule: "new" }, { id: "g2", rule: "two" }] },
    );
    expect(words(merged.words)).toEqual(["Gust", "Drizzle", "Mist"]);
    expect(merged.words[1].meaning).toBe("Very light rain.");
    expect(merged.grammar).toEqual([{ id: "G1", rule: "new" }, { id: "g2", rule: "two" }]);
    expect(merged.combos).toEqual([]);
  });
  it("links opposites and adds stubs after merging", () => {
    const merged = D.mergeContent({ words: [W("Hot")] }, { words: [W("Cold", { antonyms: ["Hot"], excludeFromSameOptionsWith: ["Chilly"] })] });
    expect(merged.words.map((w) => [w.word, w.opposite || null])).toEqual([["Hot", "Cold"], ["Cold", "Hot"], ["Chilly", null]]);
  });
  it("removed fields are dropped on both sides", () => {
    const merged = D.mergeContent({ puns: [1], words: [W("Gust", { sentenceBuild: "x" })] }, { words: [{ ...W("Mist"), situation: undefined, example: "Mist on the hill." }] });
    expect(merged).not.toHaveProperty("puns");
    expect(merged.words[0]).not.toHaveProperty("sentenceBuild");
    expect(merged.words[1]).toMatchObject({ situation: "Mist on the hill." });
    expect(merged.words[1]).not.toHaveProperty("example");
  });
});

describe("removed fields and the content part of a file", () => {
  it("withoutRemovedFields: an example becomes the situation only when there is none; build-sentence challenges go", () => {
    const out = D.withoutRemovedFields({ words: [{ word: "A", example: "e1" }, { word: "B", situation: "s", example: "e2" }, null], challenges: [{ type: "buildSentence" }, { mode: "build-sentence" }, { type: "fill" }] });
    expect(out.words).toEqual([{ word: "A", situation: "e1" }, { word: "B", situation: "s" }, null]);
    expect(out.challenges).toEqual([{ type: "fill" }]);
  });
  it("contentOnly: the five lists copied, a default note, no player data", () => {
    const data = { words: [W("Gust")], mastery: { Gust: {} }, score: 3 };
    const out = D.contentOnly(data);
    expect(Object.keys(out).sort()).toEqual(["challenges", "combos", "grammar", "kind", "note", "schemaVersion", "stories", "words"]);
    expect(out).toMatchObject({ schemaVersion: 2, kind: "content", note: "Content only. word and existing ids remain progress keys." });
    out.words[0].word = "Changed";
    expect(data.words[0].word).toBe("Gust");
  });
});

describe("V2 still offers the same rules", () => {
  it("each name on V2 is the dictionary's own function", () => {
    for (const name of ["norm", "fields", "withoutRemovedFields", "bareWord", "applyRenames", "mergeContent", "antonymsOf", "linkAntonyms", "outsideAntonyms", "contentOnly", "findWord", "headword", "sensesOf", "compatible"]) expect(V2[name], name).toBe(D[name]);
  });
});
