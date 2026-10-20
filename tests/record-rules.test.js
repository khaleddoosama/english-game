// The recording rules (src/features/progress/recordRules.js): read sentences (newest 4000), which answers count and
// once per question, the day's count and its goal, the streak, pool variants (two right answers lock one for a week;
// when to write a new sentence), confusions from wrong word choices, the round log and the day's history, a lesson's
// stats and star (70%), the best result of a story, and new words introduced. Made-up words. Docs: docs/modules/progress/answer-recording.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCK_DAYS } from "../src/engine/questions";
import { localDateKey } from "../src/engine/data";
import * as R from "../src/features/progress/recordRules";

const NOW = new Date(2026, 9, 20, 12).getTime(), WEEK = LOCK_DAYS * 86400000;
const W = (word, extra = {}) => ({ word, meaning: `The meaning of ${word}.`, gap: `We saw the ______ today.`, ...extra });
const WORDS = [W("Drizzle"), W("Gust"), W("Humid"), W("Arid")];
const round = (kind, title, answers, size = answers.length, extra = {}) => ({ id: `${kind}-1`, kind, title, queue: Array.from({ length: size }, (_, i) => ({ id: `q${i}` })), answers, ...extra });
const right = { correct: true }, wrong = { correct: false };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("answers", () => {
  it("read sentences: the time of each; only the newest 4000 are kept", () => {
    expect(R.withSeenSentences({ a: 1 }, ["b", "a"], 9)).toEqual({ a: 9, b: 9 });
    const many = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`s${i}`, i]));
    const out = R.withSeenSentences(many, ["new"], 99999);
    expect(Object.keys(out)).toHaveLength(4000);
    expect(out.new).toBe(99999);
    expect(out.s0).toBeUndefined();
    expect(R.withSeenSentences(undefined, ["x"], 1)).toEqual({ x: 1 });
  });

  it("sentences are remembered except in a Speed Round; reported, ungraded or failed answers do not count", () => {
    expect(R.marksSentences({}, {}, { kind: "practice" })).toBe(true);
    expect(R.marksSentences({}, {}, { kind: "speed" })).toBe(false);
    expect(R.marksSentences({}, null, {})).toBe(false);
    expect(R.countsAnswer({}, { correct: true })).toBe(true);
    for (const r of [{ reported: true }, { unverified: true }, { aiFailed: true }]) expect(R.countsAnswer({}, r)).toBe(false);
    expect(R.countsAnswer({ noTelemetry: true }, {})).toBe(false);
    expect(R.countsAnswer(null, {})).toBe(false);
  });

  it("one answer per question of a session", () => {
    expect(R.answerKey({ id: "practice-7", index: 3 })).toBe("practice-7:3");
    expect(R.answerKey({ id: "practice-7", index: 0 })).toBe("practice-7:0");
    expect(R.answerKey(null)).toBe("session:-1");
  });

  it("the day's count, a new day from zero, and the answer that reaches the goal", () => {
    const today = localDateKey();
    expect(R.dayAfterAnswer({ date: today, answered: 4, correct: 2 }, true)).toEqual({ date: today, answered: 5, correct: 3 });
    expect(R.dayAfterAnswer({ date: "2026-10-19", answered: 30, correct: 20 }, false)).toEqual({ date: today, answered: 1, correct: 0 });
    expect(R.goalJustReached({ date: today, answered: 4 }, { answered: 5 }, 5)).toBe(true);
    expect(R.goalJustReached({ date: today, answered: 5 }, { answered: 6 }, 5)).toBe(false);
    expect(R.goalJustReached({ date: today, answered: 2 }, { answered: 3 }, 5)).toBe(false);
  });

  it("the streak: one more for a right answer without help, else zero; 10 points", () => {
    expect([R.nextStreak(4, true), R.nextStreak(4, false)]).toEqual([5, 0]);
    expect(R.POINTS_PER_ANSWER).toBe(10);
  });
});

describe("pools", () => {
  it("a variant answered right twice is locked for a week; a new one is added; the seed stands in for none", () => {
    const pools = { "combo:rain": { variant: [{ id: "v1", attempts: 1, correctCount: 1, lockedUntil: null }, { id: "v2", attempts: 0, correctCount: 0, lockedUntil: null }] } };
    const out = R.withVariantAnswer(pools, "combo:rain", "v1", true, NOW);
    expect(out.pools["combo:rain"].variant[0]).toEqual({ id: "v1", attempts: 2, correctCount: 2, lockedUntil: NOW + WEEK });
    expect(out.stillFresh).toBe(true);
    expect(pools["combo:rain"].variant[0].attempts).toBe(1);
    const added = R.withVariantAnswer(pools, "combo:rain", "v9", false, NOW);
    expect(added.pools["combo:rain"].variant.at(-1)).toEqual({ id: "v9", attempts: 1, correctCount: 0, lockedUntil: null });
    expect(R.withVariantAnswer({}, "grammar:g1", "seed", true, NOW).pools["grammar:g1"].variant).toEqual([{ id: "seed", attempts: 1, correctCount: 1, lockedUntil: null }]);
  });

  it("no variant free: say so (a new one is written)", () => {
    const pools = { "combo:rain": { variant: [{ id: "v1", attempts: 1, correctCount: 1, lockedUntil: null }, { id: "v2", attempts: 2, correctCount: 2, lockedUntil: NOW + 1000 }] } };
    expect(R.withVariantAnswer(pools, "combo:rain", "v1", true, NOW).stillFresh).toBe(false);
    expect(R.withVariantAnswer(pools, "combo:rain", "v1", false, NOW).stillFresh).toBe(true);
  });

  it("a word's sentence: counted on its item; a new sentence when nothing else is free after a right answer", () => {
    const word = W("Drizzle");
    // "seed" is the word's own sentence; "b" one written later
    const two = { Drizzle: { gap: [{ id: "seed", attempts: 0, correctCount: 1, lockedUntil: null }, { id: "b", text: "B ______.", attempts: 0, correctCount: 0, lockedUntil: null }] } };
    const out = R.withWordPoolAnswer(two, word, "gap", "seed", true, NOW);
    expect(out.pools.Drizzle.gap.find((i) => i.id === "seed")).toMatchObject({ attempts: 1, correctCount: 2, lockedUntil: NOW + WEEK, text: "We saw the ______ today." });
    expect(out.generate).toBe(false);
    const lockedB = { Drizzle: { gap: [two.Drizzle.gap[0], { ...two.Drizzle.gap[1], lockedUntil: NOW + 5000 }] } };
    expect(R.withWordPoolAnswer(lockedB, word, "gap", "seed", true, NOW).generate).toBe(true);
    expect(R.withWordPoolAnswer(lockedB, word, "gap", "seed", false, NOW).generate).toBe(false);
    expect(R.withWordPoolAnswer({}, word, "gap", "seed", true, NOW).generate).toBe(true);
  });
});

describe("confusions", () => {
  it("a wrong word chosen is paired with the word asked; meanings point at their word; right answers and typing add none", () => {
    expect(R.wrongWordChoices({ type: "mcq", answers: ["Drizzle"], targets: ["Drizzle"] }, { correct: false, value: "Gust" }, WORDS).map(([t, c]) => [t.word, c])).toEqual([["Drizzle", "Gust"]]);
    expect(R.wrongWordChoices({ type: "mcq", mode: "meaning", answers: ["The meaning of Drizzle."], targets: ["Drizzle"] }, { correct: false, value: "The meaning of Humid." }, WORDS).map(([t, c]) => [t.word, c])).toEqual([["Drizzle", "Humid"]]);
    expect(R.wrongWordChoices({ type: "multi", answers: ["Drizzle", "Gust"], targets: ["Drizzle", "Gust"] }, { correct: false, value: ["Drizzle", "Humid", "Arid"] }, WORDS).map(([t, c]) => [t.word, c])).toEqual([["Drizzle", "Humid"], ["Gust", "Arid"]]);
    expect(R.wrongWordChoices({ type: "mcq", answers: ["Drizzle"], targets: ["Drizzle"] }, { correct: true, value: "Drizzle" }, WORDS)).toEqual([]);
    expect(R.wrongWordChoices({ type: "typing", answers: ["Drizzle"], targets: ["Drizzle"] }, { correct: false, value: "Gust" }, WORDS)).toEqual([]);
    expect(R.wrongWordChoices({ type: "mcq", answers: ["Drizzle"], targets: ["Drizzle"] }, { correct: false, value: "not a word" }, WORDS)).toEqual([]);
  });

  it("each confusion counts up with its time; the same word or no word adds nothing", () => {
    const content = { words: WORDS };
    const once = R.withConfusion({}, content, W("Drizzle"), "gust", 5);
    expect(once).toEqual({ "Drizzle|Gust": { count: 1, lastAt: 5 } });
    expect(R.withConfusion(once, content, W("Drizzle"), "Gust", 6)["Drizzle|Gust"]).toEqual({ count: 2, lastAt: 6 });
    expect(R.withConfusion(once, content, W("Drizzle"), "Drizzle", 6)).toBe(null);
    expect(R.withConfusion(once, content, W("Drizzle"), "nothing", 6)).toBe(null);
    expect(R.withConfusion(once, content, null, "Gust", 6)).toBe(null);
  });
});

describe("the end of a round", () => {
  it("rounds recorded: the newest 500", () => {
    const many = Array.from({ length: 500 }, (_, i) => `r${i}`);
    const out = R.withCompleted(many, "new");
    expect([out.length, out[0], out.at(-1)]).toEqual([500, "r1", "new"]);
    expect(R.withCompleted(undefined, "a")).toEqual(["a"]);
  });

  it("the round log: newest first, 50 kept, and the day's history", () => {
    const entry = R.roundLogEntry(round("practice", "Weather", [right, wrong, right]), NOW);
    expect(entry).toEqual({ id: "practice-1", kind: "practice", title: "Weather", correct: 2, total: 3, at: NOW });
    expect(R.roundLogEntry(round("weak", undefined, [right]), NOW).title).toBe("weak");
    const old = Array.from({ length: 50 }, (_, i) => ({ id: `o${i}` }));
    const out = R.afterRoundLog({ sessionLogs: old }, entry);
    expect([out.sessionLogs.length, out.sessionLogs[0].id, out.sessionLogs.at(-1).id]).toEqual([50, "practice-1", "o48"]);
    expect(out.dailyHistory[localDateKey()]).toMatchObject({ rounds: 1, answered: 3, correct: 2 });
    expect([R.isWholeRound(round("practice", "Weather", [right], 2)), R.isWholeRound(round("practice", "Weather", []))]).toEqual([false, false]);
  });

  it("a whole practice round of a lesson: its stats; the star at 70% or more", () => {
    const levels = [{ id: "cat-Weather", title: "Weather" }];
    expect(R.lessonRound(round("practice", "Weather", [right, right, wrong, right, right, right, wrong, wrong, right, right]), levels)).toEqual({ levelId: "cat-Weather", accuracy: 70 });
    expect(R.lessonRound(round("practice", "Weather", [right], 2), levels)).toBe(null);
    expect(R.lessonRound(round("weak", "Weather", [right]), levels)).toBe(null);
    expect(R.lessonRound(round("practice", "Other", [right]), levels)).toBe(null);
    expect(R.STAR_ACCURACY).toBe(70);
    expect(R.withLessonStat({}, "cat-Weather", 70)["cat-Weather"]).toMatchObject({ attempts: 1, bestAccuracy: 70 });
    expect(R.withLessonCleared(["cat-Weather"], "cat-Weather")).toEqual(["cat-Weather"]);
    expect(R.withLessonCleared([], "cat-Weather")).toEqual(["cat-Weather"]);
  });

  it("a story keeps its best result; a broken entry is dropped", () => {
    const story = (answers) => round("story", "Rainy day", answers, answers.length, { sourceStoryId: "st-1" });
    expect(R.withSolvedStory([], story([right, wrong]))).toEqual([{ id: "st-1", correct: 1, total: 2 }]);
    expect(R.withSolvedStory([{ id: "st-1", correct: 2, total: 2 }, null, "x"], story([right, wrong]))).toEqual([{ id: "st-1", correct: 2, total: 2 }]);
    expect(R.withSolvedStory([{ id: "st-1", correct: 0, total: 2 }], story([right, right]))).toEqual([{ id: "st-1", correct: 2, total: 2 }]);
    expect(R.withSolvedStory([], round("story", "x", [right]))).toBe(null);
    expect(R.withSolvedStory([], { ...story([right]), queue: [{}, {}] })).toBe(null);
  });

});

describe("words", () => {
  it("new words are marked introduced the first time only", () => {
    const out = R.withIntroduced({ Drizzle: { introducedAt: 5, total: 3 } }, [W("Drizzle"), W("Gust")], NOW);
    expect(out).toEqual({ Drizzle: { introducedAt: 5, total: 3 }, Gust: { introducedAt: NOW } });
  });

});
