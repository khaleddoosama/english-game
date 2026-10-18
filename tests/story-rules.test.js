// Story generation, the step with no state (src/features/ai-helpers/storyRules.js): which words and grammar rules a
// new story hides. Made-up content; a seeded random so each case is repeatable. Docs:
// docs/modules/ai-media/story-generation.md.
import { describe, expect, it } from "vitest";
import { storyPlan } from "../src/features/ai-helpers/storyRules.js";

const seeded = (seed = 1) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const vocab = (category, n, from = 0) => Array.from({ length: n }, (_, i) => ({ word: `${category}${from + i}`, type: "vocab", category, meaning: "m" }));
const plan = (over = {}, seed = 1) => storyPlan({ words: [], grammar: [], categories: [], stories: [], mastery: {}, confusions: {}, ...over }, seeded(seed));
const names = (list) => list.map((w) => w.word).sort();

describe("enough words", () => {
  it("fewer than five vocab words in the chosen categories is refused (other types do not count)", () => {
    const words = [...vocab("Hotel", 4), { word: "Room service", type: "idiom", category: "Hotel", meaning: "m" }];
    expect(() => plan({ words, categories: ["Hotel"] })).toThrow("The selected categories need at least five vocab words in total.");
  });
  it("words outside the chosen categories do not count", () => {
    expect(() => plan({ words: [...vocab("Hotel", 3), ...vocab("Food", 9)], categories: ["Hotel"] })).toThrow();
  });
});

describe("how many vocab targets", () => {
  it("categories + 3, at least 5 and at most 7, and never more than there are", () => {
    const words = ["A", "B", "C", "D", "E"].flatMap((c) => vocab(c, 3));
    expect(plan({ words, categories: ["A", "B"] }).targets).toHaveLength(5);
    expect(plan({ words, categories: ["A", "B", "C"] }).targets).toHaveLength(6);
    expect(plan({ words, categories: ["A", "B", "C", "D", "E"] }).targets).toHaveLength(7);
    expect(plan({ words: vocab("A", 6), categories: ["A"] }).targets).toHaveLength(5);
  });
  it("taken in turn from each category", () => {
    const { targets } = plan({ words: [...vocab("A", 5), ...vocab("B", 5)], categories: ["A", "B"] });
    expect(targets.filter((w) => w.category === "A")).toHaveLength(3);
    expect(targets.filter((w) => w.category === "B")).toHaveLength(2);
  });
});

describe("which words first", () => {
  it("words already hidden in a story go to the back, so fresh ones are used first", () => {
    const words = vocab("A", 8);
    const stories = [{ targetWords: ["a0", "A1", "a2"] }];
    for (let seed = 1; seed < 20; seed++) expect(names(plan({ words, categories: ["A"], stories }, seed).targets)).toEqual(["A3", "A4", "A5", "A6", "A7"]);
  });
  it("…but are used when the category has nothing else", () => {
    expect(plan({ words: vocab("A", 5), categories: ["A"], stories: [{ targetWords: ["A0"] }] }).targets).toHaveLength(5);
  });
  it("the player's weak words come first", () => {
    const words = vocab("A", 9);
    const mastery = { A7: { total: 4, correct: 1, lastResult: "wrong" }, A8: { total: 4, correct: 1, lastResult: "wrong" } };
    for (let seed = 1; seed < 20; seed++) expect(names(plan({ words, categories: ["A"], mastery }, seed).targets)).toEqual(expect.arrayContaining(["A7", "A8"]));
  });
});

describe("the other word types", () => {
  const extras = ["idiom", "binomial", "fyi", "phrasal"].map((type) => ({ word: `the ${type}`, type, category: "A", meaning: "m" }));
  it("one of each type the categories have, on top of the vocab targets", () => {
    const { targets } = plan({ words: [...vocab("A", 6), ...extras], categories: ["A"] });
    expect(targets.filter((w) => w.type === "vocab")).toHaveLength(5);
    expect(targets.filter((w) => w.type !== "vocab").map((w) => w.type).sort()).toEqual(["binomial", "fyi", "idiom", "phrasal"]);
  });
  it("picked among the three best only", () => {
    const idioms = Array.from({ length: 6 }, (_, i) => ({ word: `idiom ${i}`, type: "idiom", category: "A", meaning: "m" }));
    const stories = [{ targetWords: ["idiom 0", "idiom 1", "idiom 2"] }];
    const picked = new Set();
    for (let seed = 1; seed < 60; seed++) picked.add(plan({ words: [...vocab("A", 5), ...idioms], categories: ["A"], stories }, seed).targets.find((w) => w.type === "idiom").word);
    expect([...picked].sort()).toEqual(["idiom 3", "idiom 4", "idiom 5"]);
  });
});

describe("grammar rules", () => {
  it("up to two, from the chosen categories only, one per rule text", () => {
    const grammar = [
      { id: "g1", rule: "Past simple", category: "A" }, { id: "g2", rule: "past  SIMPLE", category: "A" },
      { id: "g3", rule: "Present perfect", category: "A" }, { id: "g4", rule: "Modals", category: "A" }, { id: "g5", rule: "Passive", category: "Z" },
    ];
    for (let seed = 1; seed < 30; seed++) {
      const { grammarRules } = plan({ words: vocab("A", 5), grammar, categories: ["A"] }, seed);
      expect(grammarRules).toHaveLength(2);
      expect(grammarRules.every((g) => g.category === "A")).toBe(true);
      expect(new Set(grammarRules.map((g) => g.rule.toLowerCase().replace(/\s+/g, " "))).size).toBe(2);
    }
  });
});

it("the same random gives the same plan", () => {
  const over = { words: [...vocab("A", 6), ...vocab("B", 6)], categories: ["A", "B"] };
  expect(plan(over, 42)).toEqual(plan(over, 42));
});
