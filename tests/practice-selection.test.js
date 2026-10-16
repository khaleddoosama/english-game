import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V2 } from "../src/engine/v2";
import { dictionary, introduced, seeded } from "./libraryFixtures";

const NOW = Date.UTC(2026, 9, 16, 12);
const ids = (questions) => questions.map((q) => q.id);
const names = (words) => words.map((w) => w.word);
const familiar = (words) => introduced(names(words));
const round = (words, { mastery = familiar(words), quarantine = null, grammar = [], seed = 7, ...opts } = {}) =>
  V2.practice({ words, grammar }, mastery, null, seeded(seed), quarantine, {
    questionsPerRound: 12, newWordsPerRound: 0, ...opts,
  });
const blockModes = (words, modes) => new Set(words.flatMap((w) => modes.map((mode) => `${w.word.toLowerCase()}|${mode}`)));
const oldestFirst = (words) => Object.fromEntries(words.map((w, i) => [w.word, { ...familiar([w])[w.word], lastReviewedAt: i + 1 }]));

// Use the existing extraQuestion boundary to supply small, authored questions.
// No internal selector is exported or mocked for these tests.
const extra = (w, mode = "whoami", prompt = `Clue ${w.word.slice(4)}: which word fits?`) => ({
  id: `${w.word}:${mode}`, mode, type: "mcq", targets: [w.word],
  prompt, answers: [w.word], options: [w.word, "Other"], explanation: w.meaning,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // All draws in this path must use the supplied, freshly seeded RNG.
  vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Unexpected ambient random draw"); });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("practice question selection through the session contract", () => {
  it("keeps the seeded question order, unused questions and initial session fields", () => {
    const words = dictionary(6), mastery = familiar(words);
    const before = structuredClone({ words, mastery });
    const s = round(words, { mastery, questionsPerRound: 4 });

    // A compact pre-refactor trace: the four distinct targets precede repeats,
    // equally ranked modes keep their existing tie order, and reserves retain
    // their order for the later reinforcement consumer. Not an optimality claim.
    expect(ids(s.queue)).toEqual(["Word1:reverse", "Word4:gapTyping", "Word3:gap", "Word2:reverse"]);
    expect(ids(s.reserves)).toEqual([
      "Word1:gap", "Word1:gapTyping", "Word4:reverse", "Word4:gap",
      "Word3:reverse", "Word3:gapTyping", "Word2:gapTyping", "Word2:gap",
    ]);
    expect(s).toMatchObject({ kind: "practice", title: "Practice", index: 0, answers: [], introductions: [], initialLength: 4, targetLength: 4, extraAdded: false });
    expect({ words, mastery }).toEqual(before);
    expect(round(words, { mastery, questionsPerRound: 4 })).toEqual(s);
  });

  it("asks each target at most twice and leaves two other questions between its appearances", () => {
    const words = dictionary(3);
    const s = round(words, { extraQuestion: (w) => extra(w) });

    // Each word has a definition, a gap, and a distinct extra clue available:
    // the repetition limit, not an exhausted pool, ends this round at six.
    expect(s.queue).toHaveLength(6);
    for (const name of names(words)) {
      const positions = s.queue.flatMap((q, i) => q.targets.includes(name) ? [i] : []);
      expect(positions).toHaveLength(2);
      expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(3);
      expect(s.reserves.some((q) => q.targets.includes(name))).toBe(true);
    }
    expect(s.initialLength).toBe(6);
    expect(s.targetLength).toBe(12);
  });

  it("balances extra question styles while keeping tied words in their existing order", () => {
    const words = dictionary(9);
    const s = round(words, {
      mastery: oldestFirst(words), questionsPerRound: 9,
      quarantine: blockModes(words, ["reverse", "gap", "gapTyping"]),
      extraQuestion: (w) => extra(w, Number(w.word.slice(4)) < 5 ? "whoami" : "grammarCourt"),
    });

    // These styles currently have different weights; alternating blindly or
    // always taking the oldest candidate would both change this sequence.
    expect(ids(s.queue)).toEqual([
      "Word0:whoami", "Word5:grammarCourt", "Word1:whoami", "Word2:whoami",
      "Word6:grammarCourt", "Word3:whoami", "Word4:whoami", "Word7:grammarCourt", "Word8:grammarCourt",
    ]);
    expect(s.reserves).toEqual([]);
  });

  it("shows a shared gap sentence only once across words and answer styles", () => {
    const words = dictionary(6, (i) => ({ gap: i % 2 ? "Someone felt ______." : "  Someone  felt ______ . " }));
    const s = round(words);
    const gapQuestions = (qs) => qs.filter((q) => ["gap", "gapTyping"].includes(q.mode));

    expect(gapQuestions(s.queue)).toHaveLength(1);
    // Unselected same-sentence candidates remain reserves; they are not all
    // usable reinforcement questions. The consumer must still check them.
    expect(gapQuestions(s.reserves).length).toBeGreaterThan(0);
    expect(new Set(gapQuestions([...s.queue, ...s.reserves]).map((q) => q.mode))).toEqual(new Set(["gap", "gapTyping"]));
  });

  it.each(["twopeople", "selecttwo"])("excludes an old %s sentence from both the queue and reserves, while ordinary clues expire", (mode) => {
    const words = dictionary(4), oldSentence = "An older clue.";
    const s = round(words, {
      mastery: oldestFirst(words),
      quarantine: blockModes(words, ["reverse", "gap", "gapTyping"]),
      seen: { "an older clue.": NOW - 21 * 3600000 },
      extraQuestion: (w) => w.word === "Word0"
        ? { ...extra(w, mode), sentences: ["A new clue.", "  An older clue . "] }
        : extra(w, "whoami", w.word === "Word1" ? oldSentence : undefined),
    });

    expect(ids([...s.queue, ...s.reserves])).not.toContain(`Word0:${mode}`);
    expect(ids(s.queue)).toContain("Word1:whoami");
  });

  it("characterizes a single-style round stopping at two despite other valid targets", () => {
    // OBSERVED EDGE, not an endorsed learning rule: see the baseline notes.
    // Do not fix this as part of extracting the selector.
    const words = dictionary(6);
    const s = round(words, { quarantine: blockModes(words, ["reverse", "gapTyping"]) });
    expect(ids(s.queue)).toEqual(["Word1:gap", "Word4:gap"]);
    expect(ids(s.reserves)).toEqual(["Word3:gap", "Word2:gap", "Word5:gap", "Word0:gap"]);
    expect(s).toMatchObject({ initialLength: 2, targetLength: 12 });
  });

  it("leaves room for grammar and keeps its existing positions in a mixed round", () => {
    const words = dictionary(12);
    const grammar = [1, 2].map((i) => ({
      id: `rule${i}`, category: "Lesson 1", prompt: `Rule ${i}: choose.`,
      options: ["yes", "no"], answer: "yes",
    }));
    const s = round(words, { grammar });
    expect(s.queue).toHaveLength(12);
    expect(s.queue.filter((q) => q.targets.length)).toHaveLength(10);
    expect(s.queue.flatMap((q, i) => q.progressKey?.startsWith("grammar:") ? [i] : [])).toEqual([3, 8]);
    expect(s.initialLength).toBe(12);
    expect(s.reserves.every((q) => !q.progressKey?.startsWith("grammar:"))).toBe(true);
  });

  it("keeps reserves usable by reinforcement in their existing order", () => {
    const s = round(dictionary(6), { questionsPerRound: 4 });
    const answered = { ...s, answers: s.queue.map(() => ({ correct: false })) };
    const before = structuredClone(answered);
    const reinforced = V2.reinforcement(answered);

    expect(reinforced.queue.slice(0, s.queue.length)).toEqual(s.queue);
    // The existing consumer takes these two questions from the returned
    // reserves. Reordering the reserves could change the learner's next task.
    expect(ids(reinforced.queue.slice(s.queue.length))).toEqual(["Word1:gap", "Word4:reverse"]);
    expect(reinforced.extraAdded).toBe(true);
    expect(reinforced.initialLength).toBe(4);
    expect(answered).toEqual(before);
    expect(V2.reinforcement(reinforced)).toEqual(reinforced);
  });
});
