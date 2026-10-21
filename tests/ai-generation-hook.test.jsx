// @vitest-environment jsdom
// The generation hook (src/features/ai-helpers/useAiGeneration.js): new sentences added to the pools, one request per
// word pool or variant key at a time, failures only logged, the 10-minute wait for a failed grammar variant, and Reset.
// Real React state; the AI calls are mocked; made-up content. The steps with no state: generation-rules.test.js.
// Docs: docs/modules/ai-media/pool-generation.md.
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gameContent, setGameContent } from "../src/features/content";

const generateContent = vi.fn(), generateComboVariant = vi.fn(), generateGrammarVariant = vi.fn();
vi.mock("../src/lib/aiPrompts", async (original) => ({ ...(await original()),
  generateContent: (...a) => generateContent(...a), generateComboVariant: (...a) => generateComboVariant(...a), generateGrammarVariant: (...a) => generateGrammarVariant(...a) }));
const { useAiGeneration } = await import("../src/features/ai-helpers");

const word = (w) => ({ word: w, type: "vocab", category: "Travel", meaning: `The meaning of ${w}.`, situation: `We saw the ${w}.`, gap: "We saw the ______." });
const WORDS_IN = [word("Ferry"), word("Harbour")];
const combo = { id: "c1", category: "Travel", words: ["Ferry", "Harbour"], situation: "At the port…", prompt: "Which two?" };
const rule = { id: "g1", rule: "Past simple", explanation: "For finished actions.", category: "Travel", questions: [{ type: "choose", prompt: "She ___ (go) home.", options: ["went", "go"], answer: "went" }] };
const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

let root, host, api, state, seen;
function Probe() {
  const [pools, setPools] = useState({});
  // Only the hook updates the reference here (the shell also copies pools into it after each render).
  const poolsRef = useRef(pools);
  state = { pools, poolsRef };
  api = useAiGeneration({ gameContent, liveContent: () => ({ words: WORDS_IN, grammar: [rule], combos: [combo], challenges: [], stories: [] }), poolsRef, setPools, seenSentences: () => seen });
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  seen = {};
  generateContent.mockReset(); generateComboVariant.mockReset(); generateGrammarVariant.mockReset();
  setGameContent(WORDS_IN, [rule], [], ["Travel"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const run = (fn) => act(async () => { await fn(); });
const texts = (w, type) => (state.pools[w]?.[type] || []).map((x) => x.text);

describe("new sentences for word pools", () => {
  it("the AI's sentences are added to the end of each word's pool", async () => {
    generateContent.mockResolvedValue([{ word: "Ferry", poolType: "gap", text: "The ______ left at noon." }]);
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(generateContent).toHaveBeenCalledWith(gameContent().words, [{ word: "Ferry", poolType: "gap" }], {});
    expect(generateContent.mock.calls[0][0].map((w) => w.word)).toEqual(WORDS_IN.map((w) => w.word));
    expect(texts("Ferry", "gap")).toEqual(["We saw the ______.", "The ______ left at noon."]);
  });
  it("a pair already being asked for is left out; nothing is sent when none is left", async () => {
    const pending = later();
    generateContent.mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    await act(async () => { api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}); });
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }, { word: "Harbour", poolType: "gap" }], {}));
    expect(generateContent).toHaveBeenLastCalledWith(gameContent().words, [{ word: "Harbour", poolType: "gap" }], {});
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(generateContent).toHaveBeenCalledTimes(2);
    await run(async () => { pending.resolve([]); });
  });
  it("a failure is only logged, the pools stay, and the pair can be asked for again", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    generateContent.mockRejectedValueOnce(new Error("AI off")).mockResolvedValueOnce([{ word: "Ferry", poolType: "gap", text: "Again a ______." }]);
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(log).toHaveBeenCalledWith("Content generation failed:", expect.any(Error));
    expect(state.pools).toEqual({});
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(texts("Ferry", "gap")).toContain("Again a ______.");
  });
});

describe("variants", () => {
  it("a combo variant is added under its key, and the pools reference is updated at once", async () => {
    generateComboVariant.mockResolvedValue({ situation: "On the boat…", prompt: "Which two words?" });
    await run(() => api.triggerVariantGeneration("combo", "combo:c1"));
    expect(generateComboVariant).toHaveBeenCalledWith(combo);
    expect(state.pools["combo:c1"].variant).toEqual([expect.objectContaining({ situation: "On the boat…", prompt: "Which two words?", attempts: 0 })]);
    expect(state.poolsRef.current["combo:c1"].variant).toHaveLength(1);
  });
  it("a grammar variant sends the rule and the prompts already used", async () => {
    generateGrammarVariant.mockResolvedValue({ prompt: "They ___ (see) it.", options: ["saw", "see"], answer: "saw", explanation: "Past." });
    await run(() => api.triggerVariantGeneration("grammar", "grammar:g1"));
    const [spec, used] = generateGrammarVariant.mock.calls[0];
    expect(spec).toMatchObject({ rule: "Past simple", ruleExplanation: "For finished actions." });
    expect(used).toEqual(["She ___ (go) home."]);
    expect(state.pools["grammar:g1"].variant[0]).toMatchObject({ prompt: "They ___ (see) it.", answer: "saw" });
  });
  it("one request per key at a time; an unknown combo or rule asks for nothing", async () => {
    const pending = later();
    generateComboVariant.mockReturnValueOnce(pending.promise);
    await act(async () => { api.triggerVariantGeneration("combo", "combo:c1"); });
    await run(() => api.triggerVariantGeneration("combo", "combo:c1"));
    expect(generateComboVariant).toHaveBeenCalledTimes(1);
    await run(async () => { pending.resolve({ situation: "s", prompt: "p" }); });
    await run(() => api.triggerVariantGeneration("combo", "combo:nope"));
    await run(() => api.triggerVariantGeneration("grammar", "grammar:nope"));
    expect(generateComboVariant).toHaveBeenCalledTimes(1);
    expect(generateGrammarVariant).not.toHaveBeenCalled();
  });
});

describe("keeping grammar fresh", () => {
  it("asks for a variant when the rule has nothing unseen; after a failure it waits ten minutes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    seen = { "she ___ (go) home.": Date.now(), "she went home.": Date.now() };
    generateGrammarVariant.mockRejectedValueOnce(new Error("AI off")).mockResolvedValue({ prompt: "We ___ (eat).", options: ["ate", "eat"], answer: "ate", explanation: "Past." });
    await run(() => api.keepGrammarFresh("g1"));
    expect(generateGrammarVariant).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-18T10:09:59Z"));
    await run(() => api.keepGrammarFresh("g1"));
    expect(generateGrammarVariant).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-18T10:10:01Z"));
    await run(() => api.keepGrammarFresh("g1"));
    expect(generateGrammarVariant).toHaveBeenCalledTimes(2);
  });
  it("a rule with something unseen left asks for nothing; neither does an unknown rule", async () => {
    await run(() => api.keepGrammarFresh("g1"));
    await run(() => api.keepGrammarFresh("nope"));
    expect(generateGrammarVariant).not.toHaveBeenCalled();
  });
});

describe("Reset", () => {
  it("clears what is pending, so the same pair can be asked for at once", async () => {
    const pending = later();
    generateContent.mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    await act(async () => { api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}); });
    api.clearPending();
    await run(() => api.triggerGeneration([{ word: "Ferry", poolType: "gap" }], {}));
    expect(generateContent).toHaveBeenCalledTimes(2);
    await run(async () => { pending.resolve([]); });
  });
});
