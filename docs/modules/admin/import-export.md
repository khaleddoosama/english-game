# Import, export and backups (administration)

The Import & Export screen (`/data` for everyone, and Admin → Data & backup): export files, check a file, and apply
it. Part of the [admin](README.md) module.

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [transfer.js](../../../src/features/data/transfer.js): checking a file, with no state (`inspectImport`,
  `importModeError`, `importModes`, `wordsCsv` and the warnings).
- [importPlan.js](../../../src/features/data/importPlan.js): the other steps with no state: `exportFileOf` (the file an
  export makes), `contentImportPlan` (the content and level order after applying a file), `restoredProgressOf` (the
  progress a backup brings back), `importDoneText` (what the player is told).
- [useDataTransfer.js](../../../src/features/data/useDataTransfer.js): applies them to the shell's state. Reached
  through [index.js](../../../src/features/data/index.js); the screen
  [ImportExport.jsx](../../../src/features/data/ImportExport.jsx) is imported on its own so it stays a lazily loaded
  file (`tests/architecture.test.js`).

`useDataTransfer({ isAdmin, exportedBy, liveContent, backupPayload, contentNoteRef, setContent, migrateRenamedProgress,
applyRestoredProgress, set })` returns `{ exportFile, checkImport, applyImport, aiFixImport, downloadBackup,
handleQuickBackup }`. The shell keeps `backupPayload()` (it reads every progress field) and
`applyRestoredProgress(restored)` (it sets every progress field and `restoringRef`); `migrateRenamedProgress` comes from
[content admin](content-admin.md). The shell passes the first four to the screen as `dataTools`, and the last two to
Profile, exactly as before. Depends on the engine only (`data`: `LEVEL_ORDER`, `WORDS`, `mergeCustomData`; `ai`:
`aiFixImportJson`; `v2`; `progress`).

## Export (`exportFile(kind)`)

| kind | File | What is in it |
| --- | --- | --- |
| `"backup"` | `word-hunter-backup-<day>.json` | Everything saved with the progress (`progressExtrasRef`), the content (`V2.contentOnly`), the level order, the progress fields (score, streaks, mastery, levels, stats, pools, confusions, speed bests, settings, the open round), `kind: "backup"`, `schemaVersion`, `contentSchemaVersion: 2`, `exportedAt`, `exportedBy` (username, or `local`). One line of JSON |
| `"content"` | `word-hunter-content-<day>.json` | `V2.contentOnly` of the live content, indented |
| `"wordsCsv"` | `word-hunter-words-<day>.csv` | The game's words as a spreadsheet (`wordsCsv`) |

`<day>` is today's date (UTC, `YYYY-MM-DD`). The screen saves the file or copies its text.

## Import

1. **Check** (`checkImport(text)` = `inspectImport(text, liveContent())`): refuses an empty file, text that is not
   JSON, a file that is not an object, or content that fails `V2.validateContent`; otherwise says what would change.
2. **Apply** (`applyImport(check, mode)`), refused first by `importModeError` (unknown mode; a mode with progress for a
   file that has none; a content mode for a player):
   - **`content`** (admin): the file's content is merged into the live content (`V2.prepareImport`, then
     `V2.mergeContent`). A v3 file can rename words and categories; the level order follows the category renames and
     new categories are inserted (`insertLevelTitles`). The file's note replaces the content note when it has one.
     Progress follows the renames (`migrateRenamedProgress`, see [content-admin.md](content-admin.md)). Everyone's
     progress is kept.
   - **`full`** (admin): the content comes from the file alone (not merged with the live content), the level order is
     the file's when it has one, renames are not moved over progress, and the progress is replaced by the file's
     (`migrateProgressData`). The whole restored object is kept with the progress (`progressExtrasRef`), so in this
     mode fields the game no longer has (`puns`, a word's `example`, `sentenceBuild`) are dropped from it first.
   - **`progress`** (anyone, a backup only): the progress is replaced by the file's; the content stays as it is.
   - After any mode: `dataVersion` is bumped (the content save follows), the "fresh copy" banner is closed, and a toast
     says what happened (the same text is returned to the screen).
3. **AI repair** (`aiFixImport(text, issues)`): a file that fails the checks can be sent to the AI; the repaired text
   comes back to the screen and is checked again before anything is applied.

A restored progress is saved as a replacement (`restoringRef`), not merged with what the server holds.

## Tests

| What | Where |
| --- | --- |
| Checking a file: refused files, accepted files, what would change; modes per role; the words spreadsheet | `tests/import-export.test.js` |
| The steps with no state: the exported files, each mode's content and level order, v3 renames, the restored progress | `tests/import-plan.test.js` |
| The hook: each mode on real React state, a player's refusal, the files, Download and Copy backup, AI repair | `tests/data-transfer-hook.test.jsx` |
| Export a backup and the content, then import the backup back in "My progress only" and "Content and my progress", saved and after a reload (made-up content) | `e2e/specs/importexport.cjs` |
| Only through the index or the screen, engine only, no loop | `tests/architecture.test.js` |
| Pictures inside imported content | `tests/image-import.test.js` |
| Importing the course in a browser (used to set up many specs) | `e2e/specs/*.cjs` |

How the behaviour was kept: the steps with no state were moved first, unchanged, and compared with the old shell code
on random synthetic files (one-off, not kept); `importexport.cjs` passes on the build before the hook move and after
it. Deliberate breaks of `importPlan.js` (5) and of the hook (7) each make a test fail.

**Gaps.** The AI repair is tested with the AI call mocked; the real repair is not. The words spreadsheet export and
the paste box are not covered in a browser. `applyRestoredProgress` (in the shell) is covered only by the browser test.

## Backups from the Profile page

- `downloadBackup()` saves the `"backup"` file; `handleQuickBackup()` copies its text to the clipboard and shows a toast
  (or, when the clipboard is refused, a toast that says to use Download instead). Profile calls them
  (`onDownloadBackup`, `onCopyBackup`).
