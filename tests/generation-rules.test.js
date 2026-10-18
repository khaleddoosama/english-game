// New practice sentences and variants, the steps with no state (src/features/ai-helpers/generationRules.js): how the
// AI's answer is added to the pools, what a grammar variant request sends, and the wait after a failed try. Made-up
// content. Docs: docs/modules/ai-media/pool-generation.md.
import { describe, expect, it } from "vitest";
import {
  VARIANT_RETRY_MS, comboVariantFields, grammarVariantAsk, grammarVariantFields, idOfKey, mayRetryVariant, newItemId,
  withGeneratedTexts, withVariantItem,
} from "../src/features/ai-helpers/generationRules.js";

const word = (w) => ({ word: w, type: "vocab", category: "Travel", meaning: `The meaning of ${w}.`, situation: `We saw the ${w}.`, gap: "We saw the ______." });
const WORDS = [word("Ferry"), word("Harbour")];
let n = 0;
const ids = () => `gen-${++n}`;
const fresh = { attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };

describe("new sentences in a word's pools", () => {
  it("each answer is added at the end of its word's pool as a fresh item, after the word's own text and the earlier items", () => {
    n = 0;
    const prev = { Ferry: { gap: [{ id: "old", text: "We took the ______ home.", attempts: 3, correctCount: 2 }] } };
    const next = withGeneratedTexts(prev, [{ word: "Ferry", poolType: "gap", text: "The ______ left at noon." }, { word: "Harbour", poolType: "meaning", text: "A safe place for boats." }], WORDS, ids);
    expect(next.Ferry.gap.map((x) => x.text)).toEqual(["We saw the ______.", "We took the ______ home.", "The ______ left at noon."]);
    expect(next.Ferry.gap[1]).toMatchObject({ id: "old", attempts: 3, correctCount: 2 });
    expect(next.Ferry.gap[2]).toEqual({ id: "gen-1", text: "The ______ left at noon.", ...fresh });
    expect(next.Harbour.meaning.at(-1)).toEqual({ id: "gen-2", text: "A safe place for boats.", ...fresh });
    expect(prev.Ferry.gap).toHaveLength(1);
  });
  it("a word the game does not know, or an empty text, is skipped", () => {
    const prev = {};
    expect(withGeneratedTexts(prev, [{ word: "Lantern", poolType: "gap", text: "x ______" }, { word: "Ferry", poolType: "gap", text: "" }], WORDS, ids)).toEqual({});
  });
  it("a word with no pool yet starts from the word's own text", () => {
    const next = withGeneratedTexts({}, [{ word: "Ferry", poolType: "gap", text: "The ______ was late." }], WORDS, ids);
    expect(next.Ferry.gap.map((x) => x.text)).toEqual(["We saw the ______.", "The ______ was late."]);
  });
  it("the default id is gen-<time>-<random>", () => {
    expect(newItemId()).toMatch(/^gen-\d+-[a-z0-9]{1,5}$/);
  });
});

describe("new variants of a combo or grammar question", () => {
  it("a combo variant keeps its situation and prompt and goes at the end; the key's other fields stay", () => {
    const prev = { "combo:c1": { variant: [{ id: "v1", prompt: "first" }], seen: 2 } };
    const next = withVariantItem(prev, "combo:c1", comboVariantFields({ situation: "At the port…", prompt: "Which two words?", extra: "dropped" }), () => "gen-x");
    expect(next["combo:c1"]).toEqual({ seen: 2, variant: [{ id: "v1", prompt: "first" }, { id: "gen-x", situation: "At the port…", prompt: "Which two words?", ...fresh }] });
  });
  it("a grammar variant keeps prompt, options, answer and explanation; a key with no variants starts a list", () => {
    const next = withVariantItem({}, "grammar:g1", grammarVariantFields({ prompt: "She ___ home.", options: ["went", "go"], answer: "went", explanation: "Past.", extra: 1 }), () => "gen-y");
    expect(next["grammar:g1"].variant).toEqual([{ id: "gen-y", prompt: "She ___ home.", options: ["went", "go"], answer: "went", explanation: "Past.", ...fresh }]);
  });
  it("the id after the first colon", () => {
    expect(idOfKey("grammar:g-1")).toBe("g-1");
    expect(idOfKey("combo:a:b")).toBe("a:b");
  });
});

describe("what a grammar variant request sends", () => {
  const rule = { id: "g1", rule: "Past simple", explanation: "For finished actions.", category: "Travel", questions: [{ type: "choose", prompt: "She ___ (go) home.", options: ["went", "go"], answer: "went" }] };
  it("the rule and its explanation, and every prompt already used (its own and its variants)", () => {
    const { spec, used } = grammarVariantAsk(rule, { "grammar:g1": { variant: [{ prompt: "They ___ (see) it." }, {}] } }, "grammar:g1");
    expect(spec).toMatchObject({ rule: "Past simple", ruleExplanation: "For finished actions." });
    expect(used).toEqual(["She ___ (go) home.", "They ___ (see) it."]);
  });
});

describe("the wait after a failed try", () => {
  it("ten minutes: not before, yes after; never failed means yes", () => {
    expect(VARIANT_RETRY_MS).toBe(600000);
    expect(mayRetryVariant(1_000_000, 1_000_000 + VARIANT_RETRY_MS - 1)).toBe(false);
    expect(mayRetryVariant(1_000_000, 1_000_000 + VARIANT_RETRY_MS)).toBe(true);
    expect(mayRetryVariant(undefined, Date.now())).toBe(true);
  });
});
