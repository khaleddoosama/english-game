// Import & export logic with no React in it, so the checks can be tested
// on their own. WordHunter wires these to the game's state.
import { V2 } from "../../engine/v2";
import { isWordKey } from "../../engine/data";
import { migrateProgressData } from "../../engine/progress";

export const IMPORT_MODES = ["content", "full", "progress"];
const WORD_COLUMNS = ["word", "type", "category", "subCategory", "meaning", "situation", "gap", "hints", "synonyms", "antonyms", "collocations", "image"];

const csvCell = (v) => {
  const t = Array.isArray(v) ? v.join(" | ") : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
// A UTF-8 BOM keeps Excel from mangling non-ASCII text.
export function wordsCsv(words) {
  return "﻿" + [WORD_COLUMNS.join(","), ...(words || []).map((w) => WORD_COLUMNS.map((c) => csvCell(w[c])).join(","))].join("\r\n");
}

export const isBackupFile = (raw) => raw.kind === "backup" || (!raw.kind && (raw.mastery !== undefined || raw.pools !== undefined));

const importError = (message, extra = {}) => Object.assign(new Error(message), { issues: [], ...extra });

// Reads and checks a file against the current content. Throws an Error with
// `issues` (and `json: true` for a parse error) when it can't be used;
// otherwise returns what applying it would change.
export function inspectImport(text, current) {
  if (typeof text !== "string" || !text.trim()) throw importError("The file is empty.");
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw importError(`This isn't valid JSON (${e.message}).`, { json: true }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw importError("This file isn't a Word Hunter backup or content file.");
  const issues = V2.validateContent(raw, current);
  if (issues.length) throw importError(`${issues.length} problem${issues.length === 1 ? "" : "s"} in this file.`, { issues });
  const prep = V2.prepareImport(raw, current), data = prep.data, existing = prep.existing;
  const isBackup = isBackupFile(raw);
  const diff = (field, key) => {
    const out = { updated: 0, added: 0, unchanged: 0 };
    for (const incoming of data[field] || []) {
      const found = (existing[field] || []).find((x) => V2.norm(x[key]) === V2.norm(incoming[key]));
      if (!found) out.added++; else if (JSON.stringify(found) === JSON.stringify(incoming)) out.unchanged++; else out.updated++;
    }
    return out;
  };
  let progress = null;
  if (isBackup) {
    try {
      const p = migrateProgressData(raw);
      const words = Object.entries(p.mastery || {}).filter(([k]) => isWordKey(k));
      progress = { score: p.score, words: words.length, mastered: words.filter(([, v]) => V2.stage(v) === "Mastered").length, studyStreak: p.studyStreak, sessions: (p.sessionLogs || []).length };
    } catch { progress = null; }
  }
  return {
    raw, isBackup, v3: raw.schemaVersion === 3, exportedAt: raw.exportedAt || null, exportedBy: raw.exportedBy || null,
    words: diff("words", "word"), grammar: diff("grammar", "id"), challenges: diff("challenges", "id"),
    stories: (data.stories || []).length, combos: (data.combos || []).length,
    renames: prep.renames, warnings: prep.warnings || [], progress,
  };
}

// Why a mode can't be applied to a checked file, or null when it can.
// Players may only bring back their own progress.
export function importModeError(check, mode, isAdmin) {
  if (!IMPORT_MODES.includes(mode)) return `Unknown import mode "${mode}".`;
  if ((mode === "progress" || mode === "full") && !check?.isBackup) return "This file has no progress in it.";
  if (mode !== "progress" && !isAdmin) return "Only the admin can import game content.";
  return null;
}

// The modes a file can be applied with, best first.
export function importModes(check, isAdmin) {
  const order = isAdmin ? ["content", "full", "progress"] : ["progress"];
  return order.filter((m) => !importModeError(check, m, isAdmin));
}
