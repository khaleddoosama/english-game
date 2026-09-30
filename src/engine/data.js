import { Angry, ArrowLeftRight, BookOpen, Compass, HelpCircle, Keyboard, ListChecks, Newspaper, PenLine, Scale, Search, ShoppingBag, Target, Users, Users2 } from "lucide-react";
import { V2 } from "./v2";
import { checkImageLinks } from "../features/media/media";
import { PRODUCTION_GATE_STEP } from "./constants";
/* ---------------------------------- DATA ---------------------------------- */

export const BUILTIN_WORDS = [];


export const BUILTIN_GRAMMAR = [];

// Authored challenge content is intentionally data-driven. The built-in set
// stays empty so existing installations do not suddenly gain hidden sample
// progress keys; curated challenges arrive through content/backup imports.
export const BUILTIN_CHALLENGES = [];

/* ------------------------------ DYNAMIC DATA -------------------------------- */
// WORDS/GRAMMAR start as just the built-in content, then get merged with
// anything imported from Anki (see the import feature below). LEVELS/BADGES
// are re-derived every time that merge happens — so these live as mutable
// module-level bindings rather than one-time constants.

export let WORDS = BUILTIN_WORDS;
export let GRAMMAR = BUILTIN_GRAMMAR;
export let CHALLENGES = BUILTIN_CHALLENGES;

// Explicit level ordering: the 5 built-in topics, plus any new topics or
// capacity-overflow continuations ("Media II") created by imports, inserted
// right after their base topic so related levels stay grouped together.
// Starts empty now that built-in seed data is gone — real categories come
// in entirely from imported content (see mergeCustomData, which reassigns
// this once content loads).
export let LEVEL_ORDER = [];

/* --------------------------------- LEVELS ---------------------------------- */
// Each level is one topic (matching the original Anki topic tags), mixing
// its vocabulary, grammar rules, and puns together — not separated by type.
// Levels unlock in order — you must clear one (finish its round) before the
// next becomes playable.

export function levelItemKey(item) {
  if (item.kind === "word") return item.obj.word;
  if (item.kind === "grammar") return `grammar:${item.obj.id}`;
  if (item.kind === "challenge") return `challenge:${item.obj.id}`;
  return `pun:${item.obj.id}`;
}

export const MASTERY_STAGE = { NEW: "New", FAMILIAR: "Familiar", LEARNED: "Learned", MASTERED: "Mastered" };
export const MASTERY_STAGE_RANK = { New: 0, Familiar: 1, Learned: 2, Mastered: 3 };
export const PRODUCTION_MODES = new Set(["typing", "gapTyping", "phrasalTransform", "finalReport"]);
export const REVIEW_STEP_MAX = 4;
export { PRODUCTION_GATE_STEP };
export const isWordKey = (key) => !/^(grammar|combo|challenge|pun):/.test(String(key));
export const MAX_CONFUSIONS = 80;
// Confusion entries are {count,lastAt}; older data stored a bare number.
// A record whose count was lost (null/NaN) still proves at least one confusion.
export const confusionCount = (v) => { const n = typeof v === "number" ? v : Number(v?.count); return Number.isFinite(n) && n > 0 ? n : (v ? 1 : 0); };
export const MAX_RELATIONSHIPS = 220;
export const RECENT_RESULT_LIMIT = 8;

export function getAccuracy(stats) {
  const total = Number(stats?.total || 0);
  return total > 0 ? (Number(stats?.correct || 0) / total) * 100 : 0;
}

export function normalizeModeStats(modeStats) {
  return {
    ...modeStats,
    correct: Number(modeStats?.correct || 0),
    total: Number(modeStats?.total || 0),
    spellingMisses: Number(modeStats?.spellingMisses || 0),
    lastResult: modeStats?.lastResult || null,
    lastDifficulty: Math.max(1, Number(modeStats?.lastDifficulty || 1)),
  };
}

export function normalizeMasteryRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  const modes = {};
  if (source.modes && typeof source.modes === "object") {
    Object.entries(source.modes).forEach(([modeId, modeStats]) => { modes[modeId] = normalizeModeStats(modeStats); });
  }
  return {
    ...source,
    correct: Number(source.correct || 0),
    total: Number(source.total || 0),
    modes,
    productionCorrect: Number(source.productionCorrect || 0),
    productionAttempts: Number(source.productionAttempts || 0),
    spellingMisses: Number(source.spellingMisses || 0),
    sentenceAttempts: Number(source.sentenceAttempts || 0),
    sentenceSuccesses: Number(source.sentenceSuccesses || 0),
    aiEvaluatedAttempts: Number(source.aiEvaluatedAttempts || 0),
    everMastered: source.everMastered === true,
    regressionStrikes: Math.max(0, Number(source.regressionStrikes || 0)),
    lastResult: source.lastResult || null,
    lastReviewedAt: Number(source.lastReviewedAt || 0) || null,
    nextReviewAt: Number(source.nextReviewAt || 0) || null,
    reviewStep: Math.max(0, Number(source.reviewStep || 0)),
    recentResults: Array.isArray(source.recentResults) ? [...source.recentResults] : [],
  };
}

export function getCorrectModeCount(stats) {
  const normalized = normalizeMasteryRecord(stats);
  return Object.values(normalized.modes).filter((mode) => mode.correct > 0).length;
}

export function getProductionCorrect(stats) {
  const normalized = normalizeMasteryRecord(stats);
  const fromModes = Object.entries(normalized.modes)
    .filter(([modeId]) => PRODUCTION_MODES.has(modeId))
    .reduce((sum, [, mode]) => sum + Number(mode.correct || 0), 0);
  return Math.max(normalized.productionCorrect, fromModes);
}

export function getMasteryStage(stats, item) {
  const normalized = normalizeMasteryRecord(stats);
  if (normalized.correct <= 0) return MASTERY_STAGE.NEW;
  const kind = item?.kind || (item?.key?.startsWith("grammar:") ? "grammar" : item?.key?.startsWith("pun:") ? "pun" : item?.key?.startsWith("challenge:") ? "challenge" : "word");
  const accuracy = getAccuracy(normalized);
  if (kind === "word" && normalized.everMastered && normalized.regressionStrikes < 3) return MASTERY_STAGE.MASTERED;
  if (kind === "word" && normalized.evidenceV2) return V2.stage(normalized);
  if (kind === "word") {
    const variedCorrectModes = getCorrectModeCount(normalized);
    if (normalized.total >= 5 && accuracy >= 80 && variedCorrectModes >= 2 && getProductionCorrect(normalized) >= 1) return MASTERY_STAGE.MASTERED;
    if (normalized.correct >= 2 && variedCorrectModes >= 2) return MASTERY_STAGE.LEARNED;
    return MASTERY_STAGE.FAMILIAR;
  }
  if (normalized.total >= 5 && accuracy >= 80) return MASTERY_STAGE.MASTERED;
  if (normalized.total >= 2 && accuracy >= 70) return MASTERY_STAGE.LEARNED;
  return MASTERY_STAGE.FAMILIAR;
}

export function isItemMastered(stats, item) {
  return getMasteryStage(stats, item) === MASTERY_STAGE.MASTERED;
}

export function levelMasteredCount(level, mastery) {
  return level.items.filter((it) => isItemMastered(mastery[levelItemKey(it)], it)).length;
}
// A lesson's words split by course unit ("units", from the Anki tags), in
// the order units first appear; a word in two units is in both. Lessons
// without unit data fall back to subCategory. Words with none go last, as
// "Other words".
export function levelGroups(level) {
  const words = level.items.filter((it) => it.kind === "word");
  const field = words.some((it) => Array.isArray(it.obj.units) && it.obj.units.length) ? "unit" : "subCategory";
  const groups = new Map();
  const add = (id, title, it) => { if (!groups.has(id)) groups.set(id, { id, field, title, items: [] }); groups.get(id).items.push(it); };
  for (const it of words) {
    const ids = field === "unit" ? (it.obj.units || []) : it.obj.subCategory ? [it.obj.subCategory] : [];
    if (!ids.length) add("", "Other words", it);
    for (const id of ids) add(id, field === "unit" ? String(id).replace(/-/g, " ") : it.obj.subCategoryTitle || id, it);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.id), ...list.filter((g) => !g.id)];
}
export function levelStageBreakdown(level, mastery) {
  const counts = { New: 0, Familiar: 0, Learned: 0, Mastered: 0 };
  level.items.forEach((it) => { counts[getMasteryStage(mastery[levelItemKey(it)], it)] += 1; });
  return counts;
}

export function getStarsForAccuracy(accuracy) {
  if (accuracy >= 95) return 3;
  if (accuracy >= 85) return 2;
  if (accuracy >= 70) return 1;
  return 0;
}

export function formatAccuracy(accuracy) {
  const value = Number(accuracy || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function formatStars(stars = 0) {
  const safe = Math.max(0, Math.min(3, Number(stars || 0)));
  return `${"⭐".repeat(safe)}${"☆".repeat(3 - safe)}`;
}

export function updateLevelStat(previous = {}, accuracy, grandfatherStars = 0, now = Date.now()) {
  const oldBest = typeof previous.bestAccuracy === "number" ? previous.bestAccuracy : null;
  const bestAccuracy = oldBest === null ? accuracy : Math.max(oldBest, accuracy);
  return {
    ...previous,
    attempts: Number(previous.attempts || 0) + 1,
    bestAccuracy,
    stars: Math.max(Number(previous.stars || 0), getStarsForAccuracy(accuracy), grandfatherStars),
    lastPlayedAt: now,
    migrated: previous.migrated && oldBest === null && accuracy < 70 ? true : false,
  };
}

// Spaced repetition is off: nothing is ever scheduled or "due". reviewStep
// survives only as a streak of correct answers, capped until the word has
// one correct production — the production gate reads it.
export function updateReviewStreak(stats, correct, now = Date.now(), opts = {}) {
  const prev = normalizeMasteryRecord(stats);
  const productionCorrect = prev.productionCorrect + (opts.productionNow ? 1 : 0);
  const stepCap = productionCorrect > 0 ? REVIEW_STEP_MAX : PRODUCTION_GATE_STEP;
  const reviewStep = correct ? Math.min(prev.reviewStep + 1, stepCap) : Math.max(0, prev.reviewStep - 1);
  return { reviewStep, lastReviewedAt: now, nextReviewAt: 0 };
}

// Today's answered/correct counts for the daily goal; a record from an
// earlier day reads as a fresh zero.
export function todayProgress(record, today = localDateKey()) {
  return record && record.date === today ? record : { date: today, answered: 0, correct: 0 };
}

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isPreviousLocalDay(previousKey, todayKey) {
  if (!previousKey || !todayKey) return false;
  const [y, m, d] = previousKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  const next = new Date(y, m - 1, d, 12, 0, 0);
  next.setDate(next.getDate() + 1);
  return localDateKey(next) === todayKey;
}

export function nextStudyStreakState(lastStudyDate, studyStreak, bestStudyStreak, today = localDateKey()) {
  if (lastStudyDate === today) return { lastStudyDate, studyStreak, bestStudyStreak };
  const nextStreak = isPreviousLocalDay(lastStudyDate, today) ? Math.max(1, studyStreak + 1) : 1;
  return { lastStudyDate: today, studyStreak: nextStreak, bestStudyStreak: Math.max(bestStudyStreak, nextStreak) };
}


export function buildLevel(title) {
  return {
    id: `cat-${title}`,
    title,
    items: [
      ...WORDS.filter((w) => w.category === title).map((w) => ({ kind: "word", obj: w })),
      ...GRAMMAR.filter((g) => g.category === title).map((g) => ({ kind: "grammar", obj: g })),
      ...CHALLENGES.filter((c) => c.category === title).map((c) => ({ kind: "challenge", obj: c })),
    ],
  };
}

export const TOPIC_ICONS = {
  Personality: Users,
  Media: Newspaper,
  Marketing: ShoppingBag,
  Mindset: Target,
  "Pet Peeves": Angry,
};

// Temporarily disabled modes: excluded from mode selection everywhere below
// (getAllowedModes + pickWeakMode's forced picks). Remove an id here to
// re-enable it later — no other code needs to change.
export const DISABLED_MODES = new Set();
// Toggled at runtime from the Settings tab (enablePairModes) — kept as a
// mutable module-level set to match the existing LEVEL_ORDER/WORDS pattern
// rather than threading a settings object through every mode-selection call.
export let RUNTIME_DISABLED_MODES = new Set();
export function setRuntimeDisabledModes(modes) { RUNTIME_DISABLED_MODES = modes; }

export const WORD_MODES = ["meaning", "gap", "gapTyping", "situation", "story", "typing", "opposite", "whoami", "twopeople", "selecttwo", "impostor", "phrasalTransform", "idiomDetective"];
export const MODE_META = {
  meaning: { label: "Meaning Hunter", icon: Search },
  gap: { label: "Fill the Gap", icon: PenLine },
  gapTyping: { label: "Evidence Typing", icon: Keyboard },
  situation: { label: "Situation", icon: Compass },
  story: { label: "Story Challenge", icon: BookOpen },
  typing: { label: "Typing", icon: Keyboard },
  opposite: { label: "Opposite Battle", icon: ArrowLeftRight },
  whoami: { label: "Who Am I?", icon: HelpCircle },
  twopeople: { label: "Two People", icon: Users2 },
  selecttwo: { label: "Select Two", icon: ListChecks },
  impostor: { label: "Word Impostor", icon: Target },
  phrasalTransform: { label: "Phrasal Transform", icon: ArrowLeftRight },
  idiomDetective: { label: "Idiom Detective", icon: Search },
};

export const CHALLENGE_MODE_META = {
  story: { label: "Story Challenge", icon: BookOpen },
  idiomStory: { label: "Advanced Idiom Story", icon: BookOpen },
  reverseIdiomStory: { label: "Reverse Idiom Story", icon: ArrowLeftRight },
  impostor: { label: "Impostor", icon: Target },
  reverseImpostor: { label: "Reverse Impostor", icon: ListChecks },
  phrasalTransform: { label: "Phrasal Verb Transform", icon: ArrowLeftRight },
  grammarCourt: { label: "Advanced Grammar Court", icon: Scale },
};

export let LEVELS = [];
export let BADGES = [];
export let LAST_CHALLENGE_ID = null;
export function setLastChallengeId(id) { LAST_CHALLENGE_ID = id; }

export function rebuildDerived() {
  LEVELS = LEVEL_ORDER.map(buildLevel);
  BADGES = [
    ...LEVELS.map((level) => ({
      id: level.id,
      type: "category",
      category: level.title,
      label: `${level.title} Files Closed`,
    })),
    { id: "streak-5", type: "streak", threshold: 5, label: "Warming Up" },
    { id: "streak-10", type: "streak", threshold: 10, label: "On a Roll" },
    { id: "streak-20", type: "streak", threshold: 20, label: "Unstoppable" },
    { id: "completionist", type: "completionist", label: "Full Case Archive" },
  ];
}
rebuildDerived();

// Keeps only the first entry for each key — a safety net so a word can never
// be dealt into the same round twice, no matter how it ended up duplicated
// (repeated imports, a review that reintroduced an entry, case differences).
export function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// The original ~64 words / 15 grammar cards / 6 puns were only ever seed
// examples for building the game. Once real content is imported they're
// just noise mixed into real levels, so gameplay excludes them by default.
// They're never deleted (still exported below) — flip this to true to bring
// them back into every level, or import the export as regular content to
// selectively resurrect specific ones as fully-editable custom entries.
export const INCLUDE_BUILTIN_IN_PLAY = false;

// Merges freshly imported content into the live data and rebuilds
// LEVELS/BADGES. Called once on load (with anything saved from a previous
// import) and again right after a new import completes.
export function mergeCustomData(customWords, customGrammar, customChallenges, levelOrder) {
  const baseWords = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_WORDS : [];
  const baseGrammar = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_GRAMMAR : [];
  const baseChallenges = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_CHALLENGES : [];
  WORDS = V2.linkAntonyms(dedupeBy([...baseWords, ...customWords], (w) => w.word && w.word.trim().toLowerCase()));
  GRAMMAR = dedupeBy([...baseGrammar, ...customGrammar], (g) => g.id);
  CHALLENGES = dedupeBy([...baseChallenges, ...(Array.isArray(customChallenges) ? customChallenges : [])], (c) => c && c.id);
  LEVEL_ORDER = levelOrder;
  rebuildDerived();
  checkImageLinks(WORDS);
}

