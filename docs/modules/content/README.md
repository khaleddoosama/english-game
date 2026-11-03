# Module: content

The shared course that every player plays from: words, grammar rules, challenges, stories and combos, and the order of the lessons. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decision: [ADR 0004](../../adr/0004-text-keys-for-words-and-progress.md). Every field of a word, where it is written and read: [word-fields.md](word-fields.md).

## 1. Purpose and scope

**Purpose.** Hold one agreed copy of the course, let the admin change it safely, let every player read it quickly (also offline), and keep the dictionary copy used by the library in step.

**Responsibilities (Implemented)**

- Load the course for a player: version check, incremental download, IndexedDB cache.
- Save the course for the admin: differences only, ordered positions, big saves staged and published in one step, renames applied to every player's progress in the same transaction.
- Build and keep the in-memory course used by the game (words, grammar, challenges, level order, levels, badges) from the loaded lists (`gameContent()` / `setGameContent`, [content-catalog.md](content-catalog.md)).
- Import and export: content files, full backups, progress-only files, the words spreadsheet, validation, warnings, optional AI repair.
- Keep `senses`, `grammar_rules` and the official views in step with the course (`dictionary_sync`).

**Out of scope**

- How questions are built from words ([learning-engine](../learning-engine/README.md)).
- A player's progress ([progress](../progress/README.md)).
- Personal libraries and views ([library](../library/README.md)).
- The admin screens that edit content ([admin](../admin/README.md)); they call this module.

## 2. Public operations

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `repo.loadContent()` | none | content object (lists plus `levelOrder`, `note`) or `null` when the course is empty | Falls back to the cache when the server cannot be reached. |
| `repo.saveContent(content, {renames})` | full content, rename list `[{kind: word or category, from, to}]` | resolves; throws with `conflict: true` when someone else saved first | Admin only; a non-admin repo ignores the call. |
| `repo.wipeContent()` | none | resolves | Saves an empty course (admin). |
| `setGameContent(words, grammar, challenges, levelOrder)` / `gameContent()` | lists, order / none | none / the copy `{ words, grammar, challenges, levelOrder, levels, badges }` | `setGameContent` builds a new copy (`buildCatalog`), keeps it, and checks word picture links in the background. Only the shell imports them; it passes them to the features. |
| `inspectImport(text, current)` | file text, current content | what applying it would change: counts added, updated, unchanged; renames; warnings; progress summary | Throws an error with a list of issues when the file cannot be used. |
| `importModeError(check, mode, isAdmin)` | check result, mode, role | reason or `null` | Players may restore only their own progress. |
| `wordsCsv(words)` | word list | CSV text with a byte-order mark | |
| `dictionary_sync()` | none | counts | Admin-only database function; also run once by migration 0027. |
| `content_save_v2(...)` | draft id, upserts, removes, level order, note, renames, expected version, publish flag | `{version, renamed}` or the staged count | Database function. |

## 3. Files and database objects

- Files: the content store [lib/repo/contentStore.js](../../../src/lib/repo/contentStore.js) and [contentPlan.js](../../../src/lib/repo/contentPlan.js), reached through `loadContent` / `saveContent` of [lib/repo.js](../../../src/lib/repo.js) (layer map: [architecture/repo.md](../../architecture/repo.md)); [lib/saveToLibrary.js](../../../src/lib/saveToLibrary.js) (new items join the admin's library), [features/content/gameContent.js](../../../src/features/content/gameContent.js) (keeps the game's copy: `gameContent`, `setGameContent`) and [engine/catalog.js](../../../src/engine/catalog.js) (`buildCatalog`: the game's copy, levels and badges, in one step; guide [content-catalog.md](content-catalog.md)), [features/data](../../../src/features/data) (`transfer.js`, `importPlan.js`, `useDataTransfer.js`, `ImportExport.jsx`; guide [admin/import-export.md](../admin/import-export.md)), loading and saving in [features/content](../../../src/features/content) (guide [content-sync.md](content-sync.md)), the dictionary rules in [engine/dictionary.js](../../../src/engine/dictionary.js) (names and `findWord`, senses, `compatible`, antonyms and opposites, stubs for missing words, `applyRenames`, `mergeContent`, `withoutRemovedFields`, `contentOnly`; guide [dictionary-rules.md](dictionary-rules.md)), the v3 format and the content checks inside [engine/v2.js](../../../src/engine/v2.js) (`validateContent`, `prepareImport`, `normalizeV3`), [lib/idb.js](../../../src/lib/idb.js).
- Screens: Import and Export (`/data`, also under Admin), the first-run "Fresh copy detected" banner on Home, and the content editors in Admin ([Words](../../../src/features/admin/sections/Words.jsx), [Categories](../../../src/features/admin/sections/Categories.jsx), [Grammar](../../../src/features/admin/sections/Grammar.jsx), [Stories and more](../../../src/features/admin/sections/Library.jsx)).
- Tables: `content_items` (kind, key, data, position, deleted, updated_at), `content_meta` (one row: version, level order, note), `content_drafts`, `item_key_aliases`, and the copy tables listed in [library](../library/README.md).
- Functions: `content_save_v2`, `apply_content_changes`, `apply_item_renames`, `dictionary_sync`, `dictionary_sync_core`; triggers that write `admin_audit`.
- Storage: bucket `word-images` (see [ai-media](../ai-media/README.md)).
- Browser: IndexedDB key `content-cache` (version, last sync time, items, level order, note); local mode key `local:content`.

## 4. Business rules and permissions

- Everyone signed in can read the course. Only the admin can write it (row policies and `require_admin`).
- A word's key is its whole text; the headword is the text before a trailing bracket. Two meanings of one headword need two entries. The merged course is de-duplicated by the lower-cased word text, so entries that differ only by case collapse to the first.
- Removing an item sets a tombstone (`deleted`) so other devices can drop it in an incremental sync.
- Positions keep their order with gaps, so inserting or deleting does not renumber the rest.
- Saves over 250 items are staged in a draft and published together, so players never see half a save. A save made from an old version is refused ("The content was changed in another tab or by another admin...").
- A rename of a word or category moves progress, pools, confusions, reports and level records in the same transaction, and is recorded as an alias so a device that still sends the old name is mapped to the new one.
- Import rules: players can only bring back their own progress; admins can import content, a full backup (content and progress, replacing) or progress. A level that is neither a course level (A1.2 ...) nor a plain difficulty (A1 to C2) is reported as a warning, as are numbered meanings inside one entry.
- The built-in seed examples are never part of play (`INCLUDE_BUILTIN_IN_PLAY` is off).

## 5. Data flow

**Load** (every start)

1. Read `content_meta.version`. If the cached version matches, use the cache.
2. Otherwise download changed items (`updated_at` after the last sync; first time: all non-deleted items), merge into the cache, store it, and build the lists.
3. Offline: use the cache if there is one; otherwise fail (the app shows the load error).

**Save** (admin)

1. The admin's edit updates WordHunter state and calls `setGameContent`, so the change shows at once.
2. A 150 ms debounced effect passes the full lists to `saveContent`, which finds what changed against what the server holds, sends it, and keeps the admin's own cache current.
3. After a successful publish the browser asks for `dictionary_sync` without waiting for the answer.
4. Failures are queued behind earlier saves; the pending renames are put back and a warning explains that the last change will be saved with the next edit.

**Import**: `inspectImport` (read-only) then `applyImport` (updates state; the save effect writes it). A restored backup also sets the "replace" flag for progress.

## 6. Failure, retry, cancel, offline

- Conflict (`40001`): the admin must reload and redo the last change. There is no automatic merge.
- Server unreachable on save: the warning banner explains; the next edit retries everything that differs.
- Closing the tab during a content write asks for confirmation.
- `dictionary_sync` failure is only logged to the console (`DP-03`).
- Players cannot save content; a player's repo returns early.
- A picture imported inside content (a data URL or a copy made in local mode) is moved to `word-images` in the background; one that cannot be stored is retried on the next content change.
- Offline players play from the cache; they do not see course changes until they reconnect.

## 7. Tests

| Check | Where |
| --- | --- |
| Whole backup round-trips in order; only changes are sent; conflicts; draft publishing; renames | [tests/repo.test.js](../../../tests/repo.test.js), [tests/review-audit.test.js](../../../tests/review-audit.test.js) (against an in-memory fake of the functions, [fakeSupabase.js](../../../tests/fakeSupabase.js)) |
| Publish, drafts, version check, renames in SQL | [supabase/tests/content_publish.sql](../../../supabase/tests/content_publish.sql) |
| Dictionary copy: headwords, senses, links, collections, grammar questions, re-run | [supabase/tests/dictionary_sync.sql](../../../supabase/tests/dictionary_sync.sql) |
| Import and export checks, modes, warnings | [tests/import-export.test.js](../../../tests/import-export.test.js) |
| Course levels and sessions | [tests/course-levels.test.js](../../../tests/course-levels.test.js) |
| Word editor | [tests/word-editor.test.js](../../../tests/word-editor.test.js) |
| Admin-side audit entries for content | [supabase/tests/audit_and_reports.sql](../../../supabase/tests/audit_and_reports.sql) |

**Gaps.** What a rename does to a player's library and views is tested on the database (`dictionary_rename.sql`, `rename_conflict.sql`, migrations 0037 and 0039) applied to production on 2026-10-18 (`DP-01`). No test makes `dictionary_sync` fail after a save. The repo tests use the committed backup file as their data, which holds real account progress (`DP-07`).

## 8. Example journey

The admin renames the word "Chilly" to "Chilly (cold)" in Admin, Words. (Synthetic data.)

1. The editor calls `renameWord`; state and the game's levels update at once. The rename is queued with the next save.
2. 150 ms later `saveContent` sends the new item, the removal of the old key and the rename in one publish. The server writes the item, moves every player's mastery, pools, confusions and reports to the new key, and records an alias.
3. The browser calls `dictionary_sync`. With migration 0037 the existing sense is renamed (before 0037: the old sense is flagged deleted and a new sense is created).
4. With 0037, a player who had the old word in their library still sees it there under the new name, and their mastery is intact. Before 0037, the word drops out of their library and Home hides it (`DP-01`). A rename into a name another word has is refused (0039).
5. Other devices see the new `content_meta.version` on their next start and download the two changed items.

## 9. Status

**Implemented.** Everything above.

**Planned** (roadmap)

- Phase 1: `dictionary_sync` becomes part of the publish or reports its failure; a safe repair for past renames ([diagnosis-renamed-words.md](../../migrations/diagnosis-renamed-words.md)). A rename carrying library entries and views is done (0037, in production since 2026-10-18).
- Phase 4: replace the module variables with an object passed down. (The content store is already split out of `repo.js`.)
- Phase 5: a synthetic fixture instead of the committed backup.

**Known Issues**

- `DP-01` rename breaks library links (Confirmed). Fixed by 0037 for new renames (in production since 2026-10-18); old renames not repaired.
- `DP-02` `sense_create` has one caller; private words cannot be played.
- `DP-03` best-effort dictionary copy.
- `DP-07` the committed backup holds real account progress and doubles as a test fixture.
- ~~`MT-02` mutable global content~~: fixed 2026-10-19, the content module keeps the one copy ([content-catalog.md](content-catalog.md)).
