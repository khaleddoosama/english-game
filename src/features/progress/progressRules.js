// Rules for the player's progress as the game holds it: what is saved, how a game opens, which badges are new, when
// to look for another device's changes. No state. Docs: docs/modules/progress/progress-state.md.
import { SCHEMA_VERSION, getBadgeProgress, normalizeSettings } from "../../engine/progress";

// How often the game may look for another device's changes when it comes back to the foreground.
export const REFRESH_GAP_MS = 10000;

// What is saved: everything the progress object held when it was loaded (`extras`: the round log, the day's count,
// reports, read sentences...), with the numbers the game keeps in its own state on top.
export function progressToSave(extras, s) {
  return { ...extras, activeSession: s.activeSession, schemaVersion: SCHEMA_VERSION, score: s.score, streak: s.streak, bestStreak: s.bestStreak, attempted: s.attempted, mastery: s.mastery, levelsCleared: s.levelsCleared, levelStats: s.levelStats, studyStreak: s.studyStreak, bestStudyStreak: s.bestStudyStreak, lastStudyDate: s.lastStudyDate, pools: s.pools, bestSpeedScore: s.bestSpeedScore, bestSpeedCombo: s.bestSpeedCombo, confusions: s.confusions, settings: s.settings };
}

// The settings a game opens with: the saved ones, or for a new player (nothing saved) the admin's defaults.
export function startingSettings(raw, data, newPlayerDefaults) {
  return normalizeSettings(raw?.settings ? data.settings : { ...newPlayerDefaults });
}

// The ids of the badges earned with this progress ({ mastery, bestStreak, levels }).
export function earnedBadgeIds(badges, progress) {
  return new Set(badges.filter((b) => getBadgeProgress(b, progress).earned).map((b) => b.id));
}

// The badges earned now that are not in `seen`, in the badges' order.
export function newBadges(badges, seen, progress) {
  return badges.filter((b) => !seen.has(b.id) && getBadgeProgress(b, progress).earned);
}

// Whether to look for another device's changes now: the page is visible and the last look was long enough ago.
export function refreshDue(visibility, last, now) {
  return visibility === "visible" && now - last >= REFRESH_GAP_MS;
}

// The progress after "Reset progress" (the content is not touched); new objects each time.
export function resetState() {
  return {
    score: 0, streak: 0, bestStreak: 0, attempted: 0, mastery: {}, levelsCleared: [], levelStats: {},
    studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null, pools: {}, confusions: {}, bestSpeedScore: 0, bestSpeedCombo: 0,
    solvedStories: [], sessionLogs: [],
  };
}
