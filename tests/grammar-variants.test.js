// Grammar questions the game writes itself: after a rule's question is asked
// and nothing fresh is left for it, one is written in the background and the
// next round shows it. (The AI call is stubbed.)
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callAiText = vi.fn();
vi.mock("../src/lib/ai", () => ({ callAiText: (...a) => callAiText(...a), speechUrl: vi.fn(), forgetSpeechUrl: vi.fn() }));
const { V2 } = await import("../src/engine/v2");
const { generateGrammarVariant } = await import("../src/engine/ai");

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const CATEGORY = "Pet Peeves";
const base = V2.withoutRemovedFields(backup);
const NOW = Date.now(), HOUR = 3600000;
const legacy = { id: "g-old", category: CATEGORY, rule: "Present perfect", prompt: "She ______ here since 2020.", options: ["has lived", "lives", "is living"], answer: "has lived", explanation: "Since + present perfect." };
const several = { id: "g-new", category: CATEGORY, rule: "Used to", explanation: "x", questions: [
  { type: "choose", prompt: "Pick: A or B?", options: ["A", "B"], answer: "A", explanation: "" },
  { type: "choose", prompt: "Pick: C or D?", options: ["C", "D"], answer: "C", explanation: "" },
] };
const written = (id, prompt, extra = {}) => ({ id, prompt, options: ["x", "y"], answer: "x", explanation: "why", attempts: 0, correctCount: 0, lockedUntil: null, flagged: false, ...extra });
const seenAt = (prompt, hoursAgo = 1) => ({ [V2.sentence(prompt)]: NOW - hoursAgo * HOUR });
const round = (grammar, pools = {}, seen = {}) => V2.practice({ ...base, grammar }, {}, CATEGORY, seeded(3), null, { questionsPerRound: 12, newWordsPerRound: 10, pools, seen });
const grammarOf = (s) => s.queue.filter((q) => String(q.id).startsWith("grammar:"));

describe("when a new question is needed", () => {
  it("a rule whose only question was just read needs one", () => {
    expect(V2.grammarNeedsVariant(legacy, {}, {})).toBe(false);
    expect(V2.grammarNeedsVariant(legacy, {}, seenAt(legacy.prompt))).toBe(true);
  });

  it("not while a written one is waiting, or at the cap", () => {
    const waiting = { "grammar:g-old": { variant: [{ id: "seed", attempts: 1 }, written("gen-1", "Another one ______")] } };
    expect(V2.grammarNeedsVariant(legacy, waiting, seenAt(legacy.prompt))).toBe(false);
    const full = { "grammar:g-old": { variant: Array.from({ length: V2.GRAMMAR_VARIANT_MAX }, (_, i) => written(`gen-${i}`, `Q ${i}`, { lockedUntil: NOW + HOUR })) } };
    expect(V2.grammarNeedsVariant(legacy, full, seenAt(legacy.prompt))).toBe(false);
  });

  it("a rule with several questions needs one only when all of its own were read", () => {
    expect(V2.grammarNeedsVariant(several, {}, seenAt("Pick: A or B?"))).toBe(false);
    expect(V2.grammarNeedsVariant(several, {}, { ...seenAt("Pick: A or B?"), ...seenAt("Pick: C or D?") })).toBe(true);
  });

  it("a rule with no usable question needs nothing", () => {
    expect(V2.grammarNeedsVariant({ id: "empty", rule: "x" }, {}, {})).toBe(false);
  });
});

describe("the next round shows the new question", () => {
  it("a one-question rule: its question was read, so the written one comes", () => {
    const pools = { "grammar:g-old": { variant: [{ id: "seed", attempts: 1 }, written("gen-1", "New one: the child ______ a book.")] } };
    const g = grammarOf(round([legacy], pools, seenAt(legacy.prompt)));
    expect(g).toHaveLength(1);
    expect(g[0].prompt).toBe("New one: the child ______ a book.");
    expect(g[0]).toMatchObject({ poolType: "grammar", poolItemId: "gen-1", progressKey: "grammar:g-old" });
  });

  it("…and nothing is asked while the written one hasn't arrived", () => {
    expect(grammarOf(round([legacy], {}, seenAt(legacy.prompt)))).toHaveLength(0);
  });

  it("a rule with several questions falls back to a written one when its own were read", () => {
    const pools = { "grammar:g-new": { variant: [written("gen-9", "Fresh one ______")] } };
    const seen = { ...seenAt("Pick: A or B?"), ...seenAt("Pick: C or D?") };
    const g = grammarOf(round([several], pools, seen));
    expect(g.map((q) => q.prompt)).toEqual(["Fresh one ______"]);
  });

  it("its own questions come first while some are unread", () => {
    const pools = { "grammar:g-new": { variant: [written("gen-9", "Fresh one ______")] } };
    const g = grammarOf(round([several], pools, seenAt("Pick: A or B?")));
    expect(g.map((q) => q.prompt)).toEqual(["Pick: C or D?"]);
  });
});

describe("the question the AI writes", () => {
  const ask = (reply, avoid = []) => {
    callAiText.mockResolvedValueOnce(typeof reply === "string" ? reply : JSON.stringify(reply));
    return generateGrammarVariant({ rule: legacy.rule, ...legacy }, avoid);
  };
  beforeEach(() => callAiText.mockReset());

  it("accepts a good question and tells the AI the rule and what to avoid", async () => {
    const out = await ask({ prompt: "They ______ in Cairo for ten years.", options: ["have lived", "live", "are living"], answer: "have lived", explanation: "For + present perfect." }, ["Old one ______"]);
    expect(out).toMatchObject({ prompt: "They ______ in Cairo for ten years.", answer: "have lived" });
    const sent = callAiText.mock.calls[0][0];
    expect(sent).toContain("Present perfect");
    expect(sent).toContain("Old one ______");
    expect(callAiText.mock.calls[0][1]).toMatchObject({ task: "New grammar question" });
  });

  it("refuses a repeat, a missing answer, a lost blank, too few options", async () => {
    await expect(ask({ prompt: "She ______ here since 2020.", options: ["a", "b"], answer: "a" })).rejects.toThrow(/repeated/);
    await expect(ask({ prompt: "Another ______ one.", options: ["a", "b"], answer: "c" })).rejects.toThrow(/incomplete/);
    await expect(ask({ prompt: "No blank in this sentence.", options: ["a", "b"], answer: "a" })).rejects.toThrow(/blank/);
    await expect(ask({ prompt: "One ______ option.", options: ["a"], answer: "a" })).rejects.toThrow(/incomplete/);
    await expect(ask({ prompt: "Same ______ twice.", options: ["a", "a"], answer: "a" })).rejects.toThrow(/incomplete/);
  });

  it("a rule with only judge/fix questions still gives the AI an example to imitate", () => {
    const g = { id: "j", rule: "r", explanation: "e", questions: [{ type: "judge", correct: false, sentence: "He go.", fix: "He goes.", explanation: "s" }] };
    expect(V2.grammarVariantBase(g)).toMatchObject({ options: ["He go.", "He goes."], answer: "He goes." });
  });
});
