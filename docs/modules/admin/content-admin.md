# Content admin (administration)

The admin's tools for changing the shared course from Admin: rename a word, edit a word's fields, merge categories,
remove empty levels, edit the level list (rename, reorder, delete), and the progress that has to follow a rename.
Part of the [admin](README.md) module; the content itself (loading, caching, saving) is [content](../content/README.md).

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [contentAdminRules.js](../../../src/features/content-admin/contentAdminRules.js): the pure rules (no state, no React):
  `renamedWord`, `withWordFields`, `mergedCategories`, `withoutEmptyLevels`, `editedLevels`, `levelListWithout`,
  `pendingOf`, `movedKeys`, `renamedConfusions`, `levelIdMap`, `renamedClearedLevels`, `hasRenames`.
- [useContentAdmin.js](../../../src/features/content-admin/useContentAdmin.js): applies them to the shell's state.
  Reached only through [index.js](../../../src/features/content-admin/index.js) (`tests/architecture.test.js`).

`useContentAdmin({ isAdmin, content, set, progress, followReportRename })` returns `{ renameWord, updateWordFields,
migrateRenamedProgress, mergeCategories, removeEmptyLevels, updateAdminContent, deleteLevelCategory,
takePendingRenames, returnPendingRenames }`. The shell passes the first seven to Admin and the round exactly as before;
the content save calls `takePendingRenames()` and, when the save fails, `returnPendingRenames(renames)`.
Reads and rebuilds the game's copy through `gameContent` / `setGameContent`, which the shell passes from the content module ([content-catalog.md](../content/content-catalog.md)). Depends on the engine only (`wordIdentity`: `renameProblem`; `v2`).

## Operations

| Operation | Called from | What changes | Sent to the server |
| --- | --- | --- | --- |
| `renameWord(from, nextWord)` | Admin, word editor (`onRenameWord`) | Refused with a toast if another word already has the new name (`renameProblem`, `src/engine/wordIdentity.js`). Otherwise the word is replaced, and stories, combos, challenges and other words that point at the old name follow (`V2.applyRenames`). Then progress follows (below). | The rename, with the next content save |
| `updateWordFields(wordName, patch)` | inside the shell | One word's fields merged with `patch`; no rename | the next content save |
| `mergeCategories(canonical, duplicates)` | Admin, categories (`onMergeCategories`) | Every word, grammar rule, challenge, combo and story in a duplicate category moves to `canonical`. The level order keeps one entry: `canonical` stays where it was, or takes the place of the first duplicate if it was not in the order. Nothing happens when no duplicate differs from `canonical`. Progress follows as a category rename. | Category renames, with the next content save |
| `removeEmptyLevels()` | Admin (`onRemoveEmptyLevels`) | Levels with no item are taken out of the level order; returns how many | the next content save |
| `updateAdminContent("levels", list)` | Admin, levels editor (`onUpdate`) | A level missing from `list` is deleted **with its items**; a level whose title changed (same id `cat-<title>`) is renamed, and its items move; the order becomes the order of `list`. Progress follows the renames. | Category renames, with the next content save |
| `updateAdminContent(field, list)` | Admin editors (`onUpdate`) | `words`, `grammar`, `challenges`, `combos` or `stories` replaced by `list` | the next content save |
| `deleteLevelCategory(level)` | the delete-category dialog | `updateAdminContent("levels", …)` without that level (so its items are deleted) | the next content save |

After each change the hook rebuilds the game's content (`setGameContent`, see [content-catalog.md](../content/content-catalog.md)) and bumps
`dataVersion`, which schedules the content save (debounced, 150 ms).

## Progress that follows a rename (`migrateRenamedProgress(renames)`)

`renames = { words: [{ from, to }], categories: [{ from, to }] }`. Also called by an import that renames (a v3 import
with the same id and a new spelling or title).

- **Admin only:** each rename is queued in the hook's list of waiting renames and sent with the next `repo.saveContent`, where
  `content_save_v2` moves **every player's** progress on the server. If that save fails, the renames are put back at
  the front of the queue for the next save.
- **This device, words:** the keys of mastery, question pools and confusion pairs (both sides of `a|b`) move from the
  old name to the new one. A key is not moved over an existing record of the new name (the old one is dropped).
  Question reports follow (`followRename` of the reports module).
- **This device, categories:** level stats (`cat-<title>`) move the same way; cleared levels are renamed and deduplicated.

## Tests

| What | Where |
| --- | --- |
| The rules: rename with linked items, merge (level-order position), empty levels, levels editor, progress keys | `tests/content-admin-rules.test.js` |
| The hook: each operation on real React state; refusal; admin-only queue; a failed save puts renames back in front | `tests/content-admin-hook.test.jsx` |
| Merge, delete and remove empty categories in a browser, saved and after a reload (made-up content) | `e2e/specs/catadmin.cjs` |
| Only through the index, engine only, no loop | `tests/architecture.test.js` |
| The rename refusal rule and the editor's message | `tests/word-rename.test.js` |
| Renames on the real database: progress, library and views follow; a clash is refused | `tests/integration/content-rename.test.js`, `supabase/tests/dictionary_rename.sql`, `supabase/tests/rename_conflict.sql` |
| Rename in a browser: refused into an existing name, nothing changed | `e2e/specs/wordrename.cjs` |
| Content save with renames | `tests/repo-stores.test.js`, `tests/repo-saving.test.js` |

How the behaviour was kept: the rules were moved first, unchanged, and compared with the old shell code on 3,000
random synthetic cases (one-off, not kept); `catadmin.cjs` passes on the build before the move and after it.

**Gaps.** `updateAdminContent` for a single list (words, grammar...) is tested only for stories. A category deleted
on one device leaves that device's mastery of its words in place (the words are gone, the records stay).

## Decisions

- `CA-OBS-01` (decided by the owner on 2026-10-18: **keep as is**). On this device, merging a category into one that
  already has level stats keeps only the target's stats; the merged category's stats are dropped (the same rule as for
  words: a key is never moved over an existing one). Pinned by `tests/content-admin-rules.test.js` ("category renames
  move level stats by level id"). What the server does with the same category rename was not checked here.
