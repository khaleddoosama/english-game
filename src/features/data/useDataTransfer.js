// Import & export (/data, and Admin -> Data & backup) and the Profile page's backups: make a file, check a file,
// apply it, and send a failed file to the AI for a repair. The steps with no state are in importPlan.js and
// transfer.js; this hook applies them to the shell's state, as the shell always did. Docs:
// docs/modules/admin/import-export.md.
import { LEVEL_ORDER, WORDS, mergeCustomData } from "../../engine/data";
import { aiFixImportJson } from "../../engine/ai";
import { importModeError, inspectImport } from "./transfer";
import { contentImportPlan, exportFileOf, importDoneText, restoredProgressOf } from "./importPlan";

// isAdmin                 a player can only restore their own progress (importModeError)
// exportedBy              written into a backup: the username, or "local"
// liveContent()           the live content lists, read when a file is made or checked
// backupPayload()         everything a backup holds (progress and content), built by the shell
// contentNoteRef          the content note; an imported file's note replaces it
// setContent(content)     sets the five custom lists ({ words, grammar, challenges, combos, stories })
// migrateRenamedProgress  progress follows the renames of a v3 import (content admin)
// applyRestoredProgress(restored)   replaces the progress with a backup's (the shell saves it as a replacement)
// set                     { setDataVersion, setShowFreshCopyPrompt, setToast, setQuickBackupCopied }
export function useDataTransfer({ isAdmin, exportedBy, liveContent, backupPayload, contentNoteRef, setContent, migrateRenamedProgress, applyRestoredProgress, set }) {
  const { setDataVersion, setShowFreshCopyPrompt, setToast, setQuickBackupCopied } = set;

  // Files: a full backup (progress + content), content only (admin), or the words as a spreadsheet (admin).
  function exportFile(kind) {
    return exportFileOf(kind, { content: liveContent(), words: WORDS, backup: kind === "backup" ? backupPayload() : null, exportedBy });
  }
  function downloadBackup() {
    const file = exportFile("backup");
    const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function handleQuickBackup() {
    try {
      await navigator.clipboard.writeText(exportFile("backup").text);
      setQuickBackupCopied(true);
      setToast({ kind: "import", text: "Full backup copied. Paste it into Import & export to restore it." });
      setTimeout(() => setQuickBackupCopied(false), 2500);
    } catch (e) {
      console.error("Quick backup copy failed:", e);
      setToast({ text: "Couldn't copy to the clipboard. Use Download backup instead." });
    }
  }
  // Step 1: read and check a file against the current content (throws { message, issues } when it can't be used).
  function checkImport(text) { return inspectImport(text, liveContent()); }
  // Step 2: apply. mode: "content" (merge content, keep progress), "full" (content and progress from a backup),
  // "progress" (a player's own progress from a backup; content stays as it is).
  function applyImport(check, mode) {
    const raw = check.raw;
    const refused = importModeError(check, mode, isAdmin);
    if (refused) throw new Error(refused);
    if (mode !== "progress") {
      const { content, order, note, renames } = contentImportPlan(raw, mode, liveContent(), LEVEL_ORDER);
      contentNoteRef.current = note || contentNoteRef.current;
      mergeCustomData(content.words, content.grammar, content.challenges, order);
      setContent(content);
      if (renames) migrateRenamedProgress(renames);
    }
    if (mode === "progress" || mode === "full") applyRestoredProgress(restoredProgressOf(raw, mode));
    setDataVersion((v) => v + 1);
    setShowFreshCopyPrompt(false);
    const text = importDoneText(mode);
    setToast({ kind: "import", text });
    return text;
  }
  // A file that fails the checks can go to AI for a repair; the result is checked again before anything is applied.
  async function aiFixImport(text, issues) {
    const result = await aiFixImportJson(text, issues.join("\n"));
    return { text: JSON.stringify(result.fixed, null, 2), changes: result.changes.length ? result.changes : ["AI adjusted the file to pass the checks."] };
  }

  return { exportFile, checkImport, applyImport, aiFixImport, downloadBackup, handleQuickBackup };
}
