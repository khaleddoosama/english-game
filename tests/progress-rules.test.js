// The progress rules (src/features/progress/progressRules.js): what a save holds (the extras with the game's numbers
// on top), the settings a game opens with (saved, or the admin's defaults for a new player), which badges are earned
// and which are new, when to look for another device's changes (visible, at most every 10 s), and the reset state.
// Made-up words and levels. Docs: docs/modules/progress/progress-state.md.
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../src/engine/progress";
import { badgesFor } from "../src/engine/catalog";
import { REFRESH_GAP_MS, earnedBadgeIds, newBadges, progressToSave, refreshDue, resetState, startingSettings } from "../src/features/progress/progressRules";

const STATE = {
  activeSession: { id: "practice-1" }, score: 120, streak: 3, bestStreak: 7, attempted: 40, mastery: { Drizzle: { total: 4 } },
  levelsCleared: ["cat-Weather"], levelStats: { "cat-Weather": { stars: 2 } }, studyStreak: 2, bestStudyStreak: 5, lastStudyDate: "2026-10-19",
  pools: { Gust: { gap: [] } }, bestSpeedScore: 80, bestSpeedCombo: 6, confusions: { "Drizzle|Gust": { count: 2 } }, settings: { dailyGoal: 15 },
};
const mastered = { stage: "Mastered", correct: 9, total: 9, reviewStep: 6, productionCorrect: 3, everMastered: true, streak: 5, lastSeen: Date.now() };
const LEVELS = [
  { id: "cat-Weather", title: "Weather", items: [{ kind: "word", key: "Drizzle", obj: { word: "Drizzle" } }, { kind: "word", key: "Gust", obj: { word: "Gust" } }] },
  { id: "cat-Hotel", title: "Hotel", items: [{ kind: "word", key: "Vacancy", obj: { word: "Vacancy" } }] },
];

describe("what is saved", () => {
  it("the extras ride along, the game's numbers win over stale copies in them, with the progress version", () => {
    const extras = { sessionLogs: [{ id: "r1" }], seenSentences: { "We saw the ______ today.": 1 }, score: 5, mastery: {} };
    const out = progressToSave(extras, STATE);
    expect(out).toEqual({ ...extras, ...STATE, schemaVersion: SCHEMA_VERSION });
    expect(out.score).toBe(120);
    expect(Object.keys(out).slice(0, 4)).toEqual(["sessionLogs", "seenSentences", "score", "mastery"]);
  });

  it("nothing outside the progress is added", () => {
    expect(Object.keys(progressToSave({}, { ...STATE, words: ["x"], customStories: [] }))).not.toContain("words");
  });
});

describe("the settings a game opens with", () => {
  it("saved settings are used; a new player gets the admin's defaults", () => {
    expect(startingSettings({ settings: { dailyGoal: 30 } }, { settings: { dailyGoal: 30 } }, { dailyGoal: 5 }).dailyGoal).toBe(30);
    expect(startingSettings(null, { settings: DEFAULT_SETTINGS }, { dailyGoal: 5, questionsPerRound: 8 })).toMatchObject({ dailyGoal: 5, questionsPerRound: 8 });
    expect(startingSettings({ score: 3 }, { settings: DEFAULT_SETTINGS }, { dailyGoal: 5 }).dailyGoal).toBe(5);
  });

  it("the defaults are not changed by the copy", () => {
    const defaults = { dailyGoal: 5 };
    startingSettings(null, {}, defaults).dailyGoal = 99;
    expect(defaults).toEqual({ dailyGoal: 5 });
  });
});

describe("badges", () => {
  const badges = badgesFor(LEVELS);

  it("streak badges by the best streak; a lesson's badge when all its words are mastered", () => {
    expect([...earnedBadgeIds(badges, { mastery: {}, bestStreak: 4, levels: LEVELS })]).toEqual([]);
    expect([...earnedBadgeIds(badges, { mastery: {}, bestStreak: 10, levels: LEVELS })]).toEqual(["streak-5", "streak-10"]);
    expect([...earnedBadgeIds(badges, { mastery: { Vacancy: mastered }, bestStreak: 0, levels: LEVELS })]).toEqual(["cat-Hotel"]);
    expect([...earnedBadgeIds(badges, { mastery: { Vacancy: mastered, Drizzle: mastered, Gust: mastered }, bestStreak: 20, levels: LEVELS })]).toEqual(badges.map((b) => b.id));
  });

  it("new badges: earned now and not seen, in the badges' order", () => {
    const seen = new Set(["streak-5"]);
    expect(newBadges(badges, seen, { mastery: { Vacancy: mastered }, bestStreak: 12, levels: LEVELS }).map((b) => b.id)).toEqual(["cat-Hotel", "streak-10"]);
    expect(newBadges(badges, new Set(badges.map((b) => b.id)), { mastery: {}, bestStreak: 99, levels: LEVELS })).toEqual([]);
    expect([...seen]).toEqual(["streak-5"]);
  });
});

describe("looking for another device's changes", () => {
  it("only while visible, and at most every 10 seconds", () => {
    expect(REFRESH_GAP_MS).toBe(10000);
    expect(refreshDue("visible", 0, 10000)).toBe(true);
    expect(refreshDue("visible", 0, 9999)).toBe(false);
    expect(refreshDue("hidden", 0, 60000)).toBe(false);
  });
});

it("reset: zero numbers, nothing studied, empty records; new objects each time", () => {
  const zero = resetState();
  expect(zero).toEqual({ score: 0, streak: 0, bestStreak: 0, attempted: 0, mastery: {}, levelsCleared: [], levelStats: {}, studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null, pools: {}, confusions: {}, bestSpeedScore: 0, bestSpeedCombo: 0, solvedStories: [], sessionLogs: [] });
  expect(resetState().mastery).not.toBe(zero.mastery);
});
