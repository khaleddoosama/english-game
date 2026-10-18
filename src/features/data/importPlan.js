// Import & export, the steps with no state: the file an export makes, what applying a checked file does to the
// content and the level order, and the progress a backup brings back. No React, no I/O.
// Moved unchanged out of the app shell (src/app/WordHunter.jsx); see docs/modules/admin/import-export.md.
import { V2 } from "../../engine/v2";
import { insertLevelTitles, migrateProgressData } from "../../engine/progress";
import { wordsCsv } from "./transfer";

// kind: "backup" | "content" | "wordsCsv". content: the live content; words: the game's words (for the spreadsheet);
// backup: everything a backup holds (progress and content); exportedBy: a username, or "local".
export function exportFileOf(kind, { content, words, backup, exportedBy }, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (kind === "content") return { name: `word-hunter-content-${day}.json`, type: "application/json", text: JSON.stringify(V2.contentOnly(content), null, 2) };
  if (kind === "wordsCsv") return { name: `word-hunter-words-${day}.csv`, type: "text/csv;charset=utf-8", text: wordsCsv(words) };
  return { name: `word-hunter-backup-${day}.json`, type: "application/json", text: JSON.stringify({ ...backup, exportedAt: now.toISOString(), exportedBy }) };
}

// The content side of applying a checked file. "content": merged into the live content, the level order follows
// renamed categories and gets the new ones, and the renames are returned so progress can follow. "full": the content
// comes from the file alone and the file's level order is used when it has one; no renames for progress.
// Throws the first problem when the file does not pass the checks against what it would be merged into.
export function contentImportPlan(raw, mode, live, levelOrder) {
  const restoreProgress = mode === "full";
  const issues = V2.validateContent(raw, restoreProgress ? {} : live);
  if (issues.length) throw new Error(issues[0]);
  const prep = V2.prepareImport(raw, restoreProgress ? {} : live), data = prep.data;
  const content = V2.mergeContent(prep.existing, data);
  const catMap = new Map(prep.renames.categories.map((r) => [r.from, r.to]));
  const baseOrder = [...new Set(levelOrder.map((t) => catMap.get(t) || t))];
  const order = restoreProgress && Array.isArray(raw.levelOrder) ? raw.levelOrder : insertLevelTitles(baseOrder, [...new Set([...(prep.levelOrder || []), ...[...content.words, ...content.grammar, ...content.challenges].map((x) => x.category).filter(Boolean)])]);
  return { content, order, note: data.note, renames: restoreProgress ? null : prep.renames };
}

// The progress a "progress" or "full" import brings back, in the current schema.
export const restoredProgressOf = (raw, mode) => migrateProgressData(mode === "full" ? V2.prepareImport(raw, {}).data : raw);

// What the player is told (and the screen shows) after an import.
export const importDoneText = (mode) => (mode === "full" ? "Backup restored: content and progress" : mode === "progress" ? "Your progress was restored" : "Content imported; everyone's progress is kept");
