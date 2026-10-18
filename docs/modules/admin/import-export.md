# Import, export and backups (administration)

The Import & Export screen (`/data` for everyone, and Admin → Data & backup): export files, check a file, and apply
it. Part of the [admin](README.md) module. The checks with no state (`inspectImport`, `importModeError`,
`importModes`, `wordsCsv`) are in [transfer.js](../../../src/features/data/transfer.js); the screen is
[ImportExport.jsx](../../../src/features/data/ImportExport.jsx).

Status: **Implemented** (current code). This page describes the behaviour as it is; the operations below live in
`src/app/WordHunter.jsx` and reach the screen as `dataTools`.

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
     (`migrateProgressData`).
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
| Pictures inside imported content | `tests/image-import.test.js` |
| Importing the course in a browser (used to set up many specs) | `e2e/specs/*.cjs` |

**Gaps (before this slice):** what `applyImport` does to the content, the level order and the progress in each mode,
and what the exported files hold, have no unit tests; no browser test exports and imports a file back.

## Backups from the Profile page

- `downloadBackup()` saves the `"backup"` file; `handleQuickBackup()` copies its text to the clipboard and shows a toast
  (or, when the clipboard is refused, a toast that says to use Download instead). Profile calls them
  (`onDownloadBackup`, `onCopyBackup`).
