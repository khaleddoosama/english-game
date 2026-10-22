// Ask AI about a word, the steps with no state (src/features/ai-helpers/askAiRules.js): the term that is asked, the
// category a new word goes to, the entry made from an answer, and why it cannot be added. Made-up content.
// Docs: docs/modules/ai-media/ask-ai.md.
import { describe, expect, it } from "vitest";
import { aiWordEntry, aiWordProblem, askTerm, contextCategoryOf } from "../src/features/ai-helpers/askAiRules.js";

const live = { words: [{ word: "Ferry", type: "vocab", category: "Travel", meaning: "A boat that carries people.", situation: "We took the Ferry to the island.", gap: "We took the ______ to the island." }], grammar: [], challenges: [], combos: [], stories: [] };
const answer = (extra = {}) => ({ word: "Lantern", type: "vocab", partsOfSpeech: ["noun"], category: "Camping", meaning: "A light you can carry.", situation: "We lit the Lantern at night.", gap: "We lit the ______ at night.", hints: ["It gives light."], pronunciation: "LAN-tern", nearWords: [{ word: "Torch", difference: "uses a battery" }], ...extra });

describe("the term that is asked", () => {
  it("is trimmed, with single spaces, and at most 80 characters", () => {
    expect(askTerm("  rain \t  cloud\n")).toBe("rain cloud");
    expect(askTerm("x".repeat(100))).toHaveLength(80);
    expect(askTerm(null)).toBe("");
  });
});

describe("the category a new word goes to", () => {
  it("the current level first, then a practice round's title, else none", () => {
    expect(contextCategoryOf({ title: "Hotel" }, { kind: "practice", title: "Mixed" })).toBe("Hotel");
    expect(contextCategoryOf(null, { kind: "practice", title: "Mixed" })).toBe("Mixed");
    expect(contextCategoryOf(null, { kind: "review", title: "Review" })).toBeNull();
  });
});

describe("the entry made from an answer", () => {
  it("keeps the card's fields, marks it as added by AI, and drops what only the drawer shows", () => {
    expect(aiWordEntry(answer({ commonMistake: { sentence: "s", correction: "c", why: "w" } }), null)).toEqual({
      word: "Lantern", type: "vocab", partsOfSpeech: ["noun"], category: "Camping", meaning: "A light you can carry.",
      situation: "We lit the Lantern at night.", gap: "We lit the ______ at night.", hints: ["It gives light."], _aiAdded: true,
      commonMistake: { sentence: "s", correction: "c", why: "w" },
    });
  });
  it("the player's category wins over the AI's; with neither it is AI Discoveries", () => {
    expect(aiWordEntry(answer(), "Hotel").category).toBe("Hotel");
    expect(aiWordEntry(answer({ category: "" }), null).category).toBe("AI Discoveries");
  });
  it("no parts of speech, no hints: no empty partsOfSpeech, hints is an empty list", () => {
    const entry = aiWordEntry(answer({ partsOfSpeech: [], hints: undefined }), null);
    expect(entry).not.toHaveProperty("partsOfSpeech");
    expect(entry.hints).toEqual([]);
  });
});

describe("why an entry cannot be added", () => {
  it("a good new word: nothing", () => {
    expect(aiWordProblem(aiWordEntry(answer(), null), live)).toBeNull();
  });
  it("any Arabic letter is refused", () => {
    expect(aiWordProblem(aiWordEntry(answer({ meaning: "A light (فانوس)." }), null), live)).toBe("The generated card contains non-English text. Regenerate it before adding.");
  });
  it("a card whose gap was unusable (left empty by the answer's check) is refused before the content checks", () => {
    expect(aiWordProblem(aiWordEntry(answer({ gap: "" }), null), live)).toBe("This card has no usable gap sentence. Ask again before adding.");
  });
  it("a card that fails the content checks is refused with the first problem", () => {
    expect(aiWordProblem(aiWordEntry(answer({ type: "slang" }), null), live)).toBe("Cannot add this card: words[0].type: unsupported type");
    expect(aiWordProblem(aiWordEntry(answer({ situation: "" }), null), live)).toMatch(/^Cannot add this card: words\[0\]\.situation/);
  });
});
