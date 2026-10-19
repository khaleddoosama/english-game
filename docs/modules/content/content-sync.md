# Loading and saving the content (content)

How the game loads the shared content when it starts, and how the admin's changes are saved. Part of the
[content](README.md) module. The repo calls are `loadContent()` and `saveContent(content, { renames })` of
[lib/repo.js](../../../src/lib/repo.js) (online: the content store, see [architecture/repo.md](../../architecture/repo.md);
local mode: the `local:content` key in IndexedDB).

Status: **Implemented** (current code). The behaviour below was written down before the code moved out of
`src/app/WordHunter.jsx`; the move kept it (see Tests).

## Files and interface

- [contentSyncRules.js](../../../src/features/content/contentSyncRules.js): the steps with no state:
  `contentPayload`, `contentSaveWarning`, `embeddedPictures`, `withStoredPictures`.
- [useContentLists.js](../../../src/features/content/useContentLists.js): the five lists and the note;
  `setContent(lists)` and `applySavedContent(saved)` (returns whether there was a saved copy).
- [useContentSave.js](../../../src/features/content/useContentSave.js): the save after a change and the picture move.
- Reached only through [index.js](../../../src/features/content/index.js) (`tests/architecture.test.js`).

`useContentLists()` returns `{ customWords, setCustomWords, … customStories, setCustomStories, contentNoteRef,
setContent, applySavedContent }`; the shell passes these names to the other hooks as before.
`useContentSave({ loaded, isAdmin, repo, lists, dataVersion, setDataVersion, saves, renames, setStorageWarning })`:
`saves` is the shell's save queue (`debouncedSave`, `pendingSavesRef`, `contentWritesRef`), shared with the progress
save; `renames` is the content admin's `takePendingRenames` / `returnPendingRenames`. The shell keeps the start-up load
(content and progress together, in that order) and calls `applySavedContent` in it.

## The content the game holds

Five lists in React state: words, grammar rules, challenges, combos, stories; and the content note (a ref). The
game's own copy for questions and levels is rebuilt from them with `setGameContent` and read with `gameContent()`
([content-catalog.md](content-catalog.md), `MT-02`). After each change `dataVersion` is bumped, which re-renders what
reads the copy and schedules the save. `liveContent()` returns the copy's words, grammar and challenges with the
combos, stories and note.

## Loading (once, when the game starts)

1. Content and progress are read together. When either read fails, the error screen is shown (with a retry) and
   nothing else happens, so an empty game never overwrites the saved one.
2. Saved content, if any: removed fields are dropped (`withoutRemovedFields`), the five lists and the note are set,
   and the game's copy is rebuilt with the saved level order (or the current one when the content has none). This
   happens **before** the progress is applied, so levels and badges exist when progress is read.
3. Then the progress (see [progress](../progress/README.md)).
4. Finally `dataVersion` is bumped and the game counts as loaded. When neither content nor progress was saved and the
   player is the admin, the "fresh copy" banner offers to open Import & Export.

## Saving (admin only)

- After the load, and after every change of a list or of `dataVersion`, a save is scheduled 150 ms later (changes in
  that time are saved together). A player's game never saves content. Because `dataVersion` is bumped at the end of
  the load, the admin's game saves its content once right after loading, changed or not.
- What is saved: the note, the five lists and the current level order (`gameContent().levelOrder`). Renames waiting from the
  content admin are taken and sent with the same save, so every player's progress follows them on the server.
- Saves run one after another, never two at a time.
- When a save fails: the renames are put back (they go with the next save), and the storage warning says
  "Content could not be saved to the server. Check your connection; your last change will be saved with the next
  edit. Take a Full Backup if this keeps happening." — or, for a conflict (someone else saved first), the conflict
  message. The next change saves the whole content again, so the refused change is not lost.
- While a content save is waiting or running, closing the tab asks first; leaving the page sends the waiting saves at
  once; signing out waits (up to 5 s) for them.

## Pictures inside the content

Online, for the admin: a word picture stored inside the content (a `data:` image, from an import or a copy made in
local mode) is moved to the `word-images` bucket and the word gets its link instead, so the picture is not sent to
every player with every load. Only words whose picture did not change meanwhile are updated; a picture that could
not be stored is tried again with the next change. Then the game's copy is rebuilt and the content is saved.

## Tests

| What | Where |
| --- | --- |
| The steps with no state: what a save sends, the warning, embedded pictures | `tests/content-sync-rules.test.js` |
| The hooks: applying a saved copy, saves (admin only, after the load, renames sent and put back, the warning, one after another), the picture move | `tests/content-sync-hook.test.jsx` |
| In a browser: the fresh-copy offer, the import saved, a change saved, a failed save warns and the next change saves both, the same after a reload | `e2e/specs/contentsave.cjs` |
| Only through the index, engine and lib only, no loop | `tests/architecture.test.js` |
| The content store: load, cache, sending only changes, conflicts, drafts, renames | `tests/repo.test.js`, `tests/repo-stores.test.js`, `tests/repo-parts.test.js` |
| Storing embedded pictures | `tests/images.test.js` |
| A real tab closed after a save (with a database) | `e2e/specs/saveclose.cjs` |
| The fresh-copy banner (used to start most browser specs) | `e2e/specs/*.cjs` |

How the behaviour was kept: `contentsave.cjs` passes on the build before the move and after it; the code moved line
for line (the four rules are the shell's own expressions). Deliberate breaks of the rules and hooks (14) each make a
test fail.

**Gaps.** The start-up load's order (content before progress) stays in the shell and is covered only by the browser
specs. The tab-close question and the flush when leaving the page are not tested. Renames reaching the server with a
save are tested with a fake repo here and on a real database in `tests/integration/content-rename.test.js`.
