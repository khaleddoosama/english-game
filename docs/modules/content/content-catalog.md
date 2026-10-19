# The game's copy of the content (content)

The words, grammar rules, challenges, levels and badges that questions, lessons and badges are built from. Part of
the [content](README.md) module. The five lists the admin edits live in React state ([content-sync.md](content-sync.md));
this page is about the copy the game builds from them, held today in module variables of
[engine/data.js](../../../src/engine/data.js) (`MT-02` in the [roadmap](../../architecture/roadmap.md)).

Status: **Implemented** (current code), written down before any change of `MT-02`. **Planned** changes are listed at
the end and marked as such.

## What is built (`mergeCustomData(words, grammar, challenges, levelOrder)`)

- **Words**: the given words (the built-in seed words are never added, `INCLUDE_BUILTIN_IN_PLAY` is off), one per
  word text compared trimmed and lower-cased (the first one wins; a word with no text is dropped), then
  `linkAntonyms` ([dictionary-rules.md](dictionary-rules.md)) sets each word's `opposite` from its antonyms.
- **Grammar rules**: one per `id` (the first wins; a rule with no id is dropped).
- **Challenges**: one per `id` the same way; a value that is not a list counts as none.
- **Level order**: the given list itself (not a copy).
- **Levels**: one per name in the level order, in that order: id `cat-<name>`, title `<name>`, and the items of that
  category: its words, then its grammar rules, then its challenges, each in list order. An item whose category is not
  in the order is in no level. A name with no items still makes an empty level.
- **Badges**: one "`<name>` Files Closed" badge per level (same id as the level), then "Warming Up" (streak 5),
  "On a Roll" (10), "Unstoppable" (20) and "Full Case Archive" (completionist).
- Every word's picture link (an `http(s)` link not in our own storage) is checked in the background, so questions can
  tell which pictures load (`imageLinkOk`, [features/media](../../../src/features/media/media.jsx)).

Before the first call the copy is empty: no words, no levels, only the four fixed badges.

## Who changes it

Every change calls `mergeCustomData` and then bumps `dataVersion` (React state in the shell), which re-renders what
reads the copy and schedules the content save.

| When | Where |
| --- | --- |
| Start-up, with the saved content and its level order (or the current one) | `applySavedContent`, [features/content](../../../src/features/content/useContentLists.js) |
| Pictures moved to the bucket (online, admin) | `useContentSave` |
| An admin edit: add, edit or delete an item; rename; merge, remove or edit categories | [features/content-admin](../../../src/features/content-admin/useContentAdmin.js) |
| The admin adds a word from Ask AI | [features/ai-helpers](../../../src/features/ai-helpers/useAskAi.js) |
| A content import or a full backup; "Start over" empties it | [features/data](../../../src/features/data/useDataTransfer.js) |

## Who reads it

The variables are imported directly: `WORDS` (shell, `engine/questions`, `engine/ai`, the live engine, the session
view, the AI helpers, question reports, import and export), `GRAMMAR` (shell, `engine/ai`, story generation),
`CHALLENGES` (shell, `engine/questions`), `LEVEL_ORDER` (shell, content load and save, content admin, Ask AI, story
builder, import), `LEVELS` (shell, `engine/progress` for badges) and `BADGES` (shell). `courseLevelGroups()` and
`buildLevel()` in `engine/data` read them too when no lists are given.

## Known Issues

- `MT-02`: the copy is replaced by reassigning module variables. Nothing can be tested or rendered with a different
  copy without calling `mergeCustomData` first, and a test that calls it changes the copy for the rest of its file.
- Changing the copy and re-rendering are two separate steps (`mergeCustomData`, then a `dataVersion` bump). Every
  writer above does both today; a new one that forgets the bump would leave screens showing the old copy until the
  next render.
- Found by `gamecopy.cjs` (kept as is): a level with no items counts as finished, so its badge is earned at once
  (a new empty category adds an earned badge); and with no levels at all "Full Case Archive" counts as earned (the
  header shows 1/4 before any content). Both come from `getBadgeProgress` in `engine/progress.js`.
- The level order is kept by reference: it is the same list the caller passed (often the current `LEVEL_ORDER`).

## Tests

| What | Where |
| --- | --- |
| Levels, badges and counts after an import, an edit and a reload, in a browser | `e2e/specs/gamecopy.cjs` |
| Opposites, de-duplication and levels through the engine | `tests/engine.test.js`, `tests/senses.test.js` |
| Course levels from given lists | `tests/course-levels.test.js` |

## Planned (`MT-02`, not done yet)

1. Build the copy in one pure step that returns one object (words, grammar, challenges, level order, levels,
   badges), with the same rules as above; the old variables follow it.
2. The engine functions take that object (or its lists) as an argument instead of reading the variables.
3. The features and the shell get it from the content module instead of importing the variables.
4. Remove the old variables, with a guard that nothing imports them.
