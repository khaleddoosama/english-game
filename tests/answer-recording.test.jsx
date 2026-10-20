// @vitest-environment jsdom
// What answers and finished rounds record (src/features/progress/useAnswerRecording.js), wired to the real
// useProgress as the shell wires them, with a fake repo and fake sentence writing: an answer counts once (day's count,
// questions answered, streak and best, 10 points, the goal's message once); reported, ungraded and Speed Round
// answers; read sentences; pools and new sentences; confusions; new words; the end of a practice round, a story, a
// Final Case recall and a Speed Round (each recorded once); the Final Case report. Made-up words.
// Docs: docs/modules/progress/answer-recording.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDateKey } from "../src/engine/data";
import { useAnswerRecording, useProgress } from "../src/features/progress";

const W = (word, category = "Weather") => ({ word, category, meaning: `The meaning of ${word}.`, gap: `We saw the ${"_".repeat(6)} today.`, situation: `It was a ${word} day.` });
const WORDS = [W("Drizzle"), W("Gust"), W("Humid", "Climate"), W("Arid", "Climate")];
const CONTENT = { words: WORDS, levels: [{ id: "cat-Weather", title: "Weather", items: [] }], badges: [] };
const NOW = new Date(2026, 9, 20, 12).getTime();
const GAP = "We saw the ______ today.";
const q = (extra = {}) => ({ id: "Drizzle:gap", type: "mcq", mode: "gap", prompt: GAP, answers: ["Drizzle"], targets: ["Drizzle"], options: ["Drizzle", "Gust"], ...extra });
const session = (extra = {}) => ({ id: "practice-1", kind: "practice", title: "Weather", index: 0, queue: [q()], answers: [], ...extra });

let out, rec, root, host, toasts, gen;
function Probe() {
  out = useProgress({ repo: { saveProgress: async () => {} }, loaded: true, gameContent: () => CONTENT });
  rec = useAnswerRecording({ progress: out, gameContent: () => CONTENT, onToast: (t) => toasts.push(t.text), generation: gen });
  return null;
}
const run = (fn) => act(async () => fn());
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  toasts = []; gen = { triggerGeneration: vi.fn(), triggerVariantGeneration: vi.fn(), keepGrammarFresh: vi.fn() };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
  await run(() => out.startFrom({ score: 50, streak: 2, bestStreak: 2, attempted: 10, dailyProgress: { date: localDateKey(), answered: 3, correct: 1 }, settings: { dailyGoal: 5 }, completedSessions: [] }, {}));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe("an answer", () => {
  it("counts once: the day's count, questions answered, the streak, 10 points; the goal's message once", async () => {
    await run(() => rec.recordSessionResult(q(), { correct: true, value: "Drizzle" }, session({ index: 0 })));
    await run(() => rec.recordSessionResult(q(), { correct: true, value: "Drizzle" }, session({ index: 0 })));
    expect([out.attempted, out.streak, out.bestStreak, out.score]).toEqual([11, 3, 3, 60]);
    expect(out.dailyProgress).toEqual({ date: localDateKey(), answered: 4, correct: 2 });
    expect(out.progressExtrasRef.current.dailyProgress).toEqual(out.dailyProgress);
    await run(() => rec.recordSessionResult(q(), { correct: false, value: "Gust" }, session({ index: 1 })));
    await run(() => rec.recordSessionResult(q(), { correct: true, value: "Drizzle" }, session({ index: 2 })));
    expect(toasts).toEqual(["Daily goal reached: 5 questions today. Anything more is a bonus!"]);
    expect([out.attempted, out.streak, out.bestStreak, out.score, out.dailyProgress.answered]).toEqual([13, 1, 3, 70, 6]);
  });

  it("a right answer with help keeps no streak and earns no points, but counts as right for the day", async () => {
    await run(() => rec.recordSessionResult(q(), { correct: true, assisted: true, value: "Drizzle" }, session()));
    expect([out.streak, out.score, out.dailyProgress.correct, out.attempted]).toEqual([0, 50, 2, 11]);
  });

  it("reported or ungraded answers count nothing, but their sentence is remembered; a Speed Round's sentences are not", async () => {
    await run(() => rec.recordSessionResult(q(), { reported: true }, session()));
    await run(() => rec.recordSessionResult(q(), { unverified: true }, session({ index: 1 })));
    expect([out.attempted, out.score]).toEqual([10, 50]);
    expect(Object.values(out.progressExtrasRef.current.seenSentences)).toEqual([NOW]);
    out.progressExtrasRef.current = { ...out.progressExtrasRef.current, seenSentences: {} };
    await run(() => rec.recordSessionResult(q(), { correct: true, value: "Drizzle" }, session({ kind: "speed" })));
    expect(out.progressExtrasRef.current.seenSentences).toEqual({});
    expect(out.attempted).toBe(11);
  });

  it("a wrong word chosen is a confusion with the word asked", async () => {
    await run(() => rec.recordSessionResult(q(), { correct: false, value: "Gust" }, session()));
    expect(out.confusions).toEqual({ "Drizzle|Gust": { count: 1, lastAt: NOW } });
    expect(out.confusionsRef.current).toBe(out.confusions);
    await run(() => rec.trackConfusion(W("Drizzle"), "Drizzle"));
    expect(out.confusions["Drizzle|Gust"].count).toBe(1);
  });

  it("several wrong words in one answer are all kept", async () => {
    await run(() => rec.recordSessionResult(q({ type: "multi", answers: ["Drizzle", "Gust"], targets: ["Drizzle", "Gust"] }), { correct: false, value: ["Humid", "Arid"] }, session()));
    expect(Object.keys(out.confusions).sort()).toEqual(["Drizzle|Humid", "Gust|Arid"]);
  });
});

describe("pools", () => {
  it("a word's sentence answered: counted, and a new one asked for when nothing else is free", async () => {
    await run(() => rec.recordSessionResult(q({ poolType: "gap", poolItemId: "seed" }), { correct: true, value: "Drizzle" }, session()));
    expect(out.pools.Drizzle.gap[0]).toMatchObject({ id: "seed", attempts: 1, correctCount: 1 });
    expect(out.poolsRef.current).toBe(out.pools);
    expect(gen.triggerGeneration).toHaveBeenCalledWith([{ word: "Drizzle", poolType: "gap" }], out.pools);
  });

  it("a variant answered: counted; when none is free a new variant is asked for; grammar is kept fresh", async () => {
    const key = "grammar:g1";
    await run(() => out.setPools({ [key]: { variant: [{ id: "v1", attempts: 1, correctCount: 1, lockedUntil: null }] } }));
    await run(() => rec.recordSessionResult(q({ poolType: "grammar", progressKey: key, poolItemId: "v1", targets: [] }), { correct: true, value: "x" }, session()));
    expect(out.pools[key].variant[0]).toMatchObject({ attempts: 2, correctCount: 2 });
    expect(gen.triggerVariantGeneration).toHaveBeenCalledWith("grammar", key);
    expect(gen.keepGrammarFresh).toHaveBeenCalledWith("g1");
  });
});

describe("new words", () => {
  it("are marked introduced, and the day is a study day", async () => {
    await run(() => rec.introduceWords([W("Drizzle")]));
    expect(out.mastery.Drizzle.introducedAt).toBe(NOW);
    expect(out.masteryRef.current).toBe(out.mastery);
    expect([out.studyStreak, out.lastStudyDate]).toEqual([1, localDateKey()]);
  });
});

describe("the end of a round", () => {
  const whole = (answers, extra = {}) => session({ queue: answers.map((_, i) => q({ id: `q${i}` })), answers, ...extra });

  it("a whole practice round of a lesson: log, day's history, the words' records, stats and star, done; once", async () => {
    const s = whole([{ correct: true, type: "mcq" }, { correct: true, type: "mcq" }, { correct: true, type: "mcq" }]);
    let res;
    await run(() => { res = rec.completeSession(s); });
    expect(res).toEqual({});
    expect(out.sessionLogs.map((l) => [l.title, l.correct, l.total])).toEqual([["Weather", 3, 3]]);
    expect(out.progressExtrasRef.current.dailyHistory[localDateKey()]).toMatchObject({ rounds: 1, answered: 3, correct: 3 });
    expect(out.progressExtrasRef.current.completedSessions).toEqual(["practice-1"]);
    expect(out.mastery.Drizzle.appliedSessions).toContain("practice-1");
    expect(out.levelStats["cat-Weather"]).toMatchObject({ attempts: 1, bestAccuracy: 100 });
    expect(out.levelsCleared).toEqual(["cat-Weather"]);
    expect(out.activeSession).toMatchObject({ id: "practice-1", completed: true });
    expect(out.studyStreak).toBe(1);
    await run(() => { res = rec.completeSession({ ...s, completed: false }); });
    expect(res).toBe(null);
    expect(out.sessionLogs).toHaveLength(1);
  });

  it("under 70% no star; a round left early has no log or stats but its answers count", async () => {
    await run(() => rec.completeSession(whole([{ correct: true }, { correct: false }])));
    expect([out.levelStats["cat-Weather"]?.bestAccuracy, out.levelsCleared]).toEqual([50, []]);
    await run(() => rec.completeSession(session({ id: "practice-2", queue: [q(), q({ id: "q2" })], answers: [{ correct: true }] })));
    expect(out.sessionLogs).toHaveLength(1);
    expect(out.levelStats["cat-Weather"].attempts).toBe(1);
    expect(out.progressExtrasRef.current.completedSessions).toEqual(["practice-1", "practice-2"]);
  });

  it("a story keeps its best result", async () => {
    await run(() => rec.completeSession(whole([{ correct: true }, { correct: false }], { id: "story-1", kind: "story", sourceStoryId: "st-1" })));
    await run(() => rec.completeSession(whole([{ correct: false }, { correct: false }], { id: "story-2", kind: "story", sourceStoryId: "st-1" })));
    expect(out.solvedStories).toEqual([{ id: "st-1", correct: 1, total: 2 }]);
    expect(out.progressExtrasRef.current.solvedStories).toEqual(out.solvedStories);
  });

  it("the Final Case recall returns its score for the report screen", async () => {
    let res;
    await run(() => { res = rec.completeSession(whole([{ correct: true }, { correct: true, assisted: true }], { id: "final-1", kind: "finalRecall" })); });
    expect(res).toEqual({ finalRecall: { accuracy: 50, correct: 1, total: 2 } });
  });

  it("a Speed Round: the best score and combo kept, the round closed, a study day if answered; once", async () => {
    const speed = (id, answers) => ({ id, kind: "speed", queue: answers.map(() => q()), answers });
    let res;
    await run(() => out.setActiveSession(speed("speed-1", [])));
    await run(() => { res = rec.completeSession(speed("speed-1", [])); });
    expect(res.speed).toMatchObject({ points: 0, answered: 0 });
    expect([out.studyStreak, out.activeSession]).toEqual([0, null]);
    await run(() => { res = rec.completeSession(speed("speed-2", [{ correct: true }, { correct: true }])); });
    expect(res.speed.points).toBeGreaterThan(0);
    expect([out.bestSpeedScore, out.bestSpeedCombo, out.studyStreak]).toEqual([res.speed.points, res.speed.bestCombo, 1]);
    const best = out.bestSpeedScore;
    await run(() => { res = rec.completeSession(speed("speed-3", [{ correct: false }])); });
    expect(out.bestSpeedScore).toBe(best);
    await run(() => { res = rec.completeSession(speed("speed-3", [{ correct: false }])); });
    expect(res).toBe(null);
    expect(out.sessionLogs).toEqual([]);
  });
});

describe("the Final Case report", () => {
  it("a word used well counts; low confidence changes no record; both are a study day", async () => {
    await run(() => rec.applyFinalReport([W("Drizzle")], { confidence: "low", words: [{ word: "Drizzle", productionSuccess: true }] }));
    expect([out.mastery, out.studyStreak]).toEqual([{}, 1]);
    await run(() => rec.applyFinalReport([W("Drizzle")], { confidence: "high", words: [{ word: "Drizzle", productionSuccess: true }] }));
    expect(out.mastery.Drizzle).toMatchObject({ correct: 1, productionCorrect: 1 });
    expect(out.masteryRef.current).toBe(out.mastery);
  });
});
