// A word with several meanings is one entry per meaning ("Cast", "Cast (to throw)"):
// they share a headword, never share a question's options, and are listed as
// each other's other meanings. Importing numbered meanings in one entry warns.
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { senseWarnings } from "../src/features/data/transfer";

const W = (word, extra = {}) => ({ word, type: "vocab", category: "Movies", meaning: `meaning of ${word}`, situation: `A sentence with ${word}.`, ...extra });
const FILLER = ["Plot", "Script", "Scene", "Director", "Camera", "Studio", "Sequel", "Trailer", "Premiere", "Critic"].map((w) => W(w));
const seeded = (seed = 11) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("headword and other meanings", () => {
  it("shares the headword across meanings, ignoring case and the trailing qualifier", () => {
    expect(V2.headword("Cast (to throw)")).toBe(V2.headword("cast"));
    expect(V2.headword(W("Cast (actors)"))).toBe(V2.headword(W("CAST")));
    expect(V2.headword("Cast a spell")).not.toBe(V2.headword("Cast"));
  });

  it("lists the other meanings of a word, not the word itself", () => {
    const words = [W("Cast"), W("Cast (to throw)"), W("Cast (a mould)"), W("Plot"), W("Cast a spell")];
    expect(V2.sensesOf(words, words[0]).map((w) => w.word)).toEqual(["Cast (to throw)", "Cast (a mould)"]);
    expect(V2.sensesOf(words, words[3])).toEqual([]);
    expect(V2.sensesOf(words, words[4])).toEqual([]);
  });
});

describe("two meanings never share a question", () => {
  const cast = W("Cast"), throwing = W("Cast (to throw)");
  it("compatible() refuses them, and still allows unrelated words", () => {
    expect(V2.compatible(cast, throwing)).toBe(false);
    expect(V2.compatible(throwing, cast)).toBe(false);
    expect(V2.compatible(cast, cast)).toBe(false);
    expect(V2.compatible(cast, W("Plot"))).toBe(true);
  });

  it("the other meaning is never an option, for either target, over many shuffles", () => {
    const words = [cast, throwing, ...FILLER];
    for (let seed = 1; seed <= 60; seed++) {
      const a = V2.optionWords([cast], words, 4, seeded(seed)).map((w) => w.word);
      const b = V2.optionWords([throwing], words, 4, seeded(seed)).map((w) => w.word);
      expect(a).toContain("Cast");
      expect(a).not.toContain("Cast (to throw)");
      expect(b).toContain("Cast (to throw)");
      expect(b).not.toContain("Cast");
      expect(a).toHaveLength(4);
    }
  });
});

describe("importing several meanings in one entry", () => {
  it("warns about numbered meanings and leaves normal entries alone", () => {
    const warnings = senseWarnings([
      W("Cast", { meaning: "1) all the actors in a film 2) to throw something" }),
      W("Conflict", { meaning: "1. the main struggle in a story. 2. a fight" }),
      W("Plot", { meaning: "What happens in a story" }),
      W("Rank", { meaning: "Level 1) is the lowest" }),
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"Cast"');
    expect(warnings[0]).toContain("Cast (to …)");
    expect(warnings[1]).toContain('"Conflict"');
  });
});

describe("opposites of a word with several meanings", () => {
  const words = () => [
    W("Restrained", { antonyms: ["Unrestrained"] }), W("Restrained (media)", { antonyms: ["Unrestrained (media)"] }),
    W("Unrestrained", { antonyms: ["Restrained"] }), W("Unrestrained (media)", { antonyms: ["Restrained (media)"] }),
  ];
  const opposites = (list) => Object.fromEntries(V2.linkAntonyms(list).map((w) => [w.word, w.opposite]));
  const want = { Restrained: "Unrestrained", "Restrained (media)": "Unrestrained (media)", Unrestrained: "Restrained", "Unrestrained (media)": "Restrained (media)" };

  it("links each meaning to the meaning it names, whatever the order", () => {
    expect(opposites(words())).toEqual(want);
    expect(opposites(words().reverse())).toEqual(want);
  });

  it("a headword alone goes to the plain entry, not to the last meaning in the list", () => {
    const list = [W("Hot", { antonyms: ["Cold"] }), W("Cold (weather)"), W("Cold")];
    expect(opposites(list).Hot).toBe("Cold");
  });
});
