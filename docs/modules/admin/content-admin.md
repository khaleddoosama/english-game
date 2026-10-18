# Content admin (administration)

The admin's tools for changing the shared course from Admin: rename a word, edit a word's fields, merge categories,
remove empty levels, edit the level list (rename, reorder, delete), and the progress that has to follow a rename.
Part of the [admin](README.md) module; the content itself (loading, caching, saving) is [content](../content/README.md).

Status: **Implemented** (current code). This page describes the behaviour as it is; the code lives in
`src/app/WordHunter.jsx` (functions named below).

## Operations

| Operation (shell function) | Called from | What changes | Sent to the server |
| --- | --- | --- | --- |
| `renameWord(from, nextWord)` | Admin, word editor (`onRenameWord`) | Refused with a toast if another word already has the new name (`renameProblem`, `src/engine/wordIdentity.js`). Otherwise the word is replaced, and stories, combos, challenges and other words that point at the old name follow (`V2.applyRenames`). Then progress follows (below). | The rename, with the next content save |
| `updateWordFields(wordName, patch)` | inside the shell | One word's fields merged with `patch`; no rename | the next content save |
| `mergeCategories(canonical, duplicates)` | Admin, categories (`onMergeCategories`) | Every word, grammar rule, challenge, combo and story in a duplicate category moves to `canonical`. The level order keeps one entry: `canonical` stays where it was, or takes the place of the first duplicate if it was not in the order. Nothing happens when no duplicate differs from `canonical`. Progress follows as a category rename. | Category renames, with the next content save |
| `removeEmptyLevels()` | Admin (`onRemoveEmptyLevels`) | Levels with no item are taken out of the level order; returns how many | the next content save |
| `updateAdminContent("levels", list)` | Admin, levels editor (`onUpdate`) | A level missing from `list` is deleted **with its items**; a level whose title changed (same id `cat-<title>`) is renamed, and its items move; the order becomes the order of `list`. Progress follows the renames. | Category renames, with the next content save |
| `updateAdminContent(field, list)` | Admin editors (`onUpdate`) | `words`, `grammar`, `challenges`, `combos` or `stories` replaced by `list` | the next content save |
| `deleteLevelCategory(level)` | the delete-category dialog | `updateAdminContent("levels", …)` without that level (so its items are deleted) | the next content save |

After each change the shell rebuilds the game's content (`mergeCustomData`, `src/engine/data.js`) and bumps
`dataVersion`, which schedules the content save (debounced, 150 ms).

## Progress that follows a rename (`migrateRenamedProgress(renames)`)

`renames = { words: [{ from, to }], categories: [{ from, to }] }`. Also called by an import that renames (a v3 import
with the same id and a new spelling or title).

- **Admin only:** each rename is queued in `pendingRenamesRef` and sent with the next `repo.saveContent`, where
  `content_save_v2` moves **every player's** progress on the server. If that save fails, the renames are put back at
  the front of the queue for the next save.
- **This device, words:** the keys of mastery, question pools and confusion pairs (both sides of `a|b`) move from the
  old name to the new one. A key is not moved over an existing record of the new name (the old one is dropped).
  Question reports follow (`followRename` of the reports module).
- **This device, categories:** level stats (`cat-<title>`) move the same way; cleared levels are renamed and deduplicated.

## Tests

| What | Where |
| --- | --- |
| The rename refusal rule and the editor's message | `tests/word-rename.test.js` |
| Renames on the real database: progress, library and views follow; a clash is refused | `tests/integration/content-rename.test.js`, `supabase/tests/dictionary_rename.sql`, `supabase/tests/rename_conflict.sql` |
| Rename in a browser: refused into an existing name, nothing changed | `e2e/specs/wordrename.cjs` |
| Content save with renames | `tests/repo-stores.test.js`, `tests/repo-saving.test.js` |

**Gaps (before this slice):** the shell functions above have no unit tests of their own: merging categories, removing
empty levels, the levels editor (delete with items, rename), and moving progress keys are tested only through the
browser and the database.
