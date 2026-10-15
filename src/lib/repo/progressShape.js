// The shape of the player's progress as the repo saves it: which fields go in
// which saved section, what a week is, what changed in the mastery records.
// Pure: no I/O, no state of the repo.
import { V2 } from "../../engine/v2";
import { isWordKey } from "../../engine/data";
import { stableJson } from "../stableJson";

// Fields of a full backup that are content, never progress.
export const CONTENT_FIELDS = new Set(["words", "combos", "stories", "grammar", "puns", "challenges", "levelOrder", "kind", "note", "contentSchemaVersion"]);
export const SECTION_OF = {
  activeSession: "session", pools: "pools", seenSentences: "seen", confusions: "confusions",
  sessionLogs: "history", completedSessions: "history", solvedStories: "history", dailyHistory: "history",
  reports: "reports", levelStats: "levels", levelsCleared: "levels",
};
// Progress object -> { section: {field: value} }, content fields dropped.
export function splitSections(data) {
  const out = {};
  for (const [field, value] of Object.entries(data || {})) {
    if (field === "mastery" || CONTENT_FIELDS.has(field) || value === undefined) continue;
    const section = SECTION_OF[field] || "core";
    (out[section] ||= {})[field] = value;
  }
  return out;
}

// Monday of this week, local time, as YYYY-MM-DD.
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Leaderboard numbers the server can't work out itself (score, streaks and
// this week's points come from the saved progress).
export const profileSummary = (data) => ({ mastered_count: masteredCount(data.mastery), week_start: weekStart() });

export const hasServerRows = (sections, masteryRows) => sections.length > 0 || masteryRows.length > 0;

function masteredCount(mastery) {
  let n = 0;
  for (const [key, stats] of Object.entries(mastery || {})) if (isWordKey(key) && V2.stage(stats) === "Mastered") n++;
  return n;
}

// Diff tracker for mastery: reference check first (records are replaced, not
// mutated), JSON compare only for records whose reference changed.
export function masteryDiff(prevRefs, prevJson, next) {
  const upserts = {}, removes = [];
  for (const [key, stats] of Object.entries(next || {})) {
    if (prevRefs.get(key) === stats) continue;
    const json = stableJson(stats);
    if (prevJson.get(key) !== json) upserts[key] = stats;
  }
  for (const key of prevJson.keys()) if (!next || !(key in next)) removes.push(key);
  return { upserts, removes };
}
