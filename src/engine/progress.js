import { LEVELS, MASTERY_STAGE, MAX_CONFUSIONS, PRODUCTION_GATE_STEP, confusionCount, getAccuracy, getMasteryStage, getProductionCorrect, isWordKey, levelMasteredCount, normalizeMasteryRecord } from "./data";
import { getAllowedModes, getStrongConfusion, modeAccuracy, selectAdaptiveMode } from "./questions";
export function pruneConfusions(confusions) {
  const entries = Object.entries(confusions || {}).sort((a, b) => {
    const ac = confusionCount(a[1]), bc = confusionCount(b[1]);
    const at = Number(a[1]?.lastAt || 0), bt = Number(b[1]?.lastAt || 0);
    return bc - ac || bt - at;
  });
  return Object.fromEntries(entries.slice(0, MAX_CONFUSIONS));
}

export function getWeakWordCandidates(words, mastery, confusions = {}, now = Date.now()) {
  return words.map((word) => {
    const stats = normalizeMasteryRecord(mastery[word.word]);
    const accuracy = getAccuracy(stats);
    const lastWrong = stats.lastResult === "wrong";
    const lowAccuracy = stats.total >= 3 && accuracy < 70;
    const weakModes = Object.entries(stats.modes).filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65).map(([id]) => id);
    const spelling = stats.spellingMisses > 0;
    const missingProduction = stats.correct >= 2 && getProductionCorrect(stats) === 0;
    const confusion = getStrongConfusion(word, confusions);
    const failedSentence = stats.sentenceAttempts >= 1 && stats.sentenceSuccesses < stats.sentenceAttempts;
    if (!lastWrong && !lowAccuracy && !weakModes.length && !spelling && !missingProduction && !confusion && !failedSentence) return null;
    let priority = 0;
    if (lastWrong) priority += 7;
    if (lowAccuracy) priority += 6;
    if (weakModes.length) priority += 5;
    if (spelling) priority += 4;
    if (missingProduction) priority += 4;
    if (confusion) priority += Math.min(7, confusion.count * 2);
    if (failedSentence) priority += 5;
    return { word, stats, accuracy, lastWrong, lowAccuracy, weakModes, spelling, missingProduction, confusion, failedSentence, priority };
  }).filter(Boolean).sort((a, b) => b.priority - a.priority || a.accuracy - b.accuracy || Number(a.stats.lastReviewedAt || 0) - Number(b.stats.lastReviewedAt || 0));
}

export function pickWeakMode(word, stats, confusions = {}, quarantine = null) {
  const s = normalizeMasteryRecord(stats);
  const isQuarantined = (mode) => !!quarantine && quarantine.has(`${String(word.word || "").trim().toLowerCase()}|${mode}`);
  const confusion = getStrongConfusion(word, confusions);
  if (s.spellingMisses > 0 && (!s.modes.typing || modeAccuracy(s, "typing") < 80) && !isQuarantined("typing")) return "typing";
  const weak = Object.entries(s.modes).filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
  if (weak.length && getAllowedModes(word).includes(weak[0][0]) && !isQuarantined(weak[0][0])) return weak[0][0];
  if (confusion && !isQuarantined("meaning") && !isQuarantined("impostor")) return Math.random() < 0.5 ? "meaning" : "impostor";
  if (getProductionCorrect(s) === 0 && s.correct >= 2 && !word.skipTyping && !isQuarantined("gapTyping")) return "gapTyping";
  return selectAdaptiveMode(word, s, { sessionType: "weak", confusion, quarantine });
}

export function deriveLearningInsights(words, mastery, confusions = {}, now = Date.now()) {
  const modeTotals = {};
  words.forEach((word) => {
    const stats = normalizeMasteryRecord(mastery[word.word]);
    Object.entries(stats.modes).forEach(([id, m]) => {
      const agg = modeTotals[id] || { correct: 0, total: 0 };
      agg.correct += m.correct; agg.total += m.total; modeTotals[id] = agg;
    });
  });
  const weakest = Object.entries(modeTotals).filter(([, x]) => x.total >= 3).sort((a, b) => (a[1].correct/a[1].total) - (b[1].correct/b[1].total))[0];
  const confusionEntry = Object.entries(confusions || {}).filter(([, v]) => confusionCount(v) >= 2).sort((a,b)=>confusionCount(b[1])-confusionCount(a[1]))[0];
  const closeToMastery = words.filter((w) => {
    const stats = normalizeMasteryRecord(mastery[w.word]);
    return getMasteryStage(stats, {kind:"word",obj:w}) === MASTERY_STAGE.LEARNED && stats.total >= 4 && getAccuracy(stats) >= 75;
  }).length;
  return {
    weakestMode: weakest ? { id: weakest[0], accuracy: (weakest[1].correct/weakest[1].total)*100 } : null,
    topConfusion: confusionEntry ? { pair: confusionEntry[0].split("|"), count: Number(confusionEntry[1]?.count || confusionEntry[1] || 0) } : null,
    closeToMastery,
  };
}

export function getBadgeProgress(badge, { mastery, bestStreak }) {
  if (badge.type === "category") {
    const level = LEVELS.find((l) => l.title === badge.category);
    const done = levelMasteredCount(level, mastery);
    return { done, total: level.items.length, earned: done >= level.items.length };
  }
  if (badge.type === "streak") {
    return { done: Math.min(bestStreak, badge.threshold), total: badge.threshold, earned: bestStreak >= badge.threshold };
  }
  const earned = LEVELS.every((l) => levelMasteredCount(l, mastery) >= l.items.length);
  return { done: earned ? 1 : 0, total: 1, earned };
}


export function levelTitleBase(title) {
  const m = title.match(/^(.*) (I{1,3}|IV|V|VI|VII|VIII)$/);
  return m ? m[1] : title;
}

// Finds groups of existing level base-topics that are loose-duplicates of
// each other (e.g. ["Food Dining", "FoodDining", "Food And Dining"]), for
// the one-time cleanup tool that merges them back into one.
// Inserts any brand-new level titles into the ordering, right after the
// last existing level that shares the same base topic (so "Media II" lands
// next to "Media" instead of at the very end).
export function insertLevelTitles(currentOrder, newTitles) {
  const order = [...currentOrder];
  newTitles.forEach((title) => {
    if (order.includes(title)) return;
    const base = levelTitleBase(title);
    let insertAt = order.length;
    for (let i = order.length - 1; i >= 0; i--) {
      if (levelTitleBase(order[i]) === base) {
        insertAt = i + 1;
        break;
      }
    }
    order.splice(insertAt, 0, title);
  });
  return order;
}


export const SCHEMA_VERSION = 6;
// General settings — tunable knobs for round length and question mix.
// Kept small and additive so old saves without a `settings` block just
// fall back to these defaults.
export const DEFAULT_SETTINGS = {
  questionsPerRound: 12, newWordsPerRound: 3, weakReviewSize: 8, enablePairModes: true, sound: true, dailyGoal: 20, levelView: "lesson",
  // Play: auto-advance after a right answer (ms, 0 = off), hints, the word
  // read aloud after answering, Speed Round length.
  autoAdvanceMs: 0, hints: true, speakWord: false, speedSeconds: 60,
  // Display: text size, number shortcuts on options, calmer animations.
  textSize: "normal", shortcuts: true, reduceMotion: false,
  // Defaults for challenges I create.
  // null: use the admin's defaults (app settings).
  liveQuestions: null, liveSeconds: null, theme: "dark", voiceRate: 1, hearts: true,
};
export const AUTO_ADVANCE_OPTIONS = [0, 1000, 2000, 3000];
export const SPEED_SECONDS_OPTIONS = [30, 45, 60, 90, 120];
export const TEXT_SIZES = ["normal", "large", "xlarge"];
export function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    questionsPerRound: Math.max(4, Math.min(30, Number(s.questionsPerRound) || DEFAULT_SETTINGS.questionsPerRound)),
    // 0 is a valid choice here, so a missing value (a fresh game) must fall
    // back to the default instead of turning into NaN and meaning "none".
    newWordsPerRound: Math.max(0, Math.min(10, Number.isFinite(Number(s.newWordsPerRound)) && s.newWordsPerRound !== null && s.newWordsPerRound !== "" ? Number(s.newWordsPerRound) : DEFAULT_SETTINGS.newWordsPerRound)),
    weakReviewSize: Math.max(3, Math.min(20, Number(s.weakReviewSize) || DEFAULT_SETTINGS.weakReviewSize)),
    enablePairModes: s.enablePairModes !== false,
    sound: s.sound !== false,
    dailyGoal: Math.max(5, Math.min(100, Number(s.dailyGoal) || DEFAULT_SETTINGS.dailyGoal)),
    theme: s.theme === "light" ? "light" : "dark",
    voiceRate: [.5,.75,1,1.25].includes(Number(s.voiceRate)) ? Number(s.voiceRate) : 1,
    hearts: s.hearts !== false,
    levelView: s.levelView === "group" ? "group" : "lesson",
    autoAdvanceMs: AUTO_ADVANCE_OPTIONS.includes(Number(s.autoAdvanceMs)) ? Number(s.autoAdvanceMs) : DEFAULT_SETTINGS.autoAdvanceMs,
    hints: s.hints !== false,
    speakWord: s.speakWord === true,
    speedSeconds: SPEED_SECONDS_OPTIONS.includes(Number(s.speedSeconds)) ? Number(s.speedSeconds) : DEFAULT_SETTINGS.speedSeconds,
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : "normal",
    shortcuts: s.shortcuts !== false,
    reduceMotion: s.reduceMotion === true,
    liveQuestions: s.liveQuestions != null && [5, 10, 15, 20, 25, 30].includes(Number(s.liveQuestions)) ? Number(s.liveQuestions) : null,
    liveSeconds: s.liveSeconds != null && [0, 10, 15, 20, 30, 45, 60].includes(Number(s.liveSeconds)) ? Number(s.liveSeconds) : null,
  };
}
export const STORAGE_KEY = "progress-v6";
export const LEGACY_V5_STORAGE_KEY = "progress-v5";
export const LEGACY_V4_STORAGE_KEY = "progress-v4";
export const LEGACY_V3_STORAGE_KEY = "progress-v3";
export const CUSTOM_CONTENT_KEY = "custom-content-v1";

export function normalizeLevelStats(levelStats = {}, levelsCleared = []) {
  const out = {};
  if (levelStats && typeof levelStats === "object") {
    Object.entries(levelStats).forEach(([key, value]) => {
      out[key] = {
        ...value,
        attempts: Number(value?.attempts || 0),
        bestAccuracy: typeof value?.bestAccuracy === "number" ? value.bestAccuracy : null,
        stars: Math.max(0, Math.min(3, Number(value?.stars || 0))),
        lastPlayedAt: Number(value?.lastPlayedAt || 0) || null,
      };
    });
  }
  (levelsCleared || []).forEach((levelId) => {
    out[levelId] = { ...(out[levelId] || {}), stars: Math.max(1, Number(out[levelId]?.stars || 0)), migrated: out[levelId]?.migrated ?? true };
  });
  return out;
}

export function migrateProgressData(raw = {}) {
  const levelsCleared = Array.isArray(raw.levelsCleared) ? [...new Set(raw.levelsCleared)] : [];
  const mastery = {};
  if (raw.mastery && typeof raw.mastery === "object") {
    Object.entries(raw.mastery).forEach(([key, record]) => { mastery[key] = normalizeMasteryRecord(record); });
  }
  // Repair confusion records whose count was corrupted to null/NaN by the old counter.
  const confusions = {};
  Object.entries(raw.confusions && typeof raw.confusions === "object" ? raw.confusions : {}).forEach(([pair, value]) => {
    confusions[pair] = { count: confusionCount(value), lastAt: Number(value?.lastAt || 0) };
  });
  // Production gate migration: words that climbed past PRODUCTION_GATE_STEP on
  // recognition evidence alone are pulled back to the gate, so their next
  // appearance is a typing question.
  Object.entries(mastery).forEach(([key, record]) => {
    if (!isWordKey(key) || record.productionCorrect > 0 || record.reviewStep <= PRODUCTION_GATE_STEP) return;
    mastery[key] = { ...record, reviewStep: PRODUCTION_GATE_STEP };
  });
  const solvedStories = Array.isArray(raw.solvedStories) ? raw.solvedStories.map(entry=>typeof entry==="string"?{id:entry,correct:0,total:0}:entry).filter(e=>e&&typeof e.id==="string") : [];
  const sessionLogs = Array.isArray(raw.sessionLogs) ? raw.sessionLogs.filter(e=>e&&typeof e.id==="string").slice(0,50) : [];
  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    score: Number(raw.score || 0),
    streak: Number(raw.streak || 0),
    bestStreak: Number(raw.bestStreak || 0),
    attempted: Number(raw.attempted || 0),
    mastery,
    levelsCleared,
    levelStats: normalizeLevelStats(raw.levelStats, levelsCleared),
    studyStreak: Number(raw.studyStreak || 0),
    bestStudyStreak: Number(raw.bestStudyStreak || 0),
    lastStudyDate: raw.lastStudyDate || null,
    pools: raw.pools && typeof raw.pools === "object" ? raw.pools : {},
    bestSpeedScore: Number(raw.bestSpeedScore || 0),
    bestSpeedCombo: Number(raw.bestSpeedCombo || 0),
    confusions,
    solvedStories,
    sessionLogs,
    settings: normalizeSettings(raw.settings),
  };
}

export function emptyProgressData() {
  return migrateProgressData({ schemaVersion: SCHEMA_VERSION });
}
