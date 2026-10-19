# The game's copy of the content (content)

The words, grammar rules, challenges, levels and badges that questions, lessons and badges are built from. Part of
the [content](README.md) module. The five lists the admin edits live in React state ([content-sync.md](content-sync.md));
this page is about the copy the game builds from them, held in module variables of
[engine/data.js](../../../src/engine/data.js) (`MT-02` in the [roadmap](../../architecture/roadmap.md)).

Status: **Implemented** (current code). The behaviour below was written down before step 1 of `MT-02`; step 1 kept it
(see Tests). The later steps are **Planned** and listed at the end.

## Files and interface

- [engine/catalog.js](../../../src/engine/catalog.js), no state: `buildCatalog(words, grammar, challenges,
  levelOrder)` returns `{ words, grammar, challenges, levelOrder, levels, badges }` with the rules below;
  `buildLevel(title, words, grammar, challenges)`, `badgesFor(levels)` and `dedupeBy(list, keyFn)` are its steps
  (`dedupeBy` is also offered by `engine/data`, as before). It imports only `V2`.
- [engine/data.js](../../../src/engine/data.js) keeps the current copy: `mergeCustomData(words, grammar, challenges,
  levelOrder)` adds the built-in lists (off), calls `buildCatalog`, makes the old variables (`WORDS`, `GRAMMAR`,
  `CHALLENGES`, `LEVEL_ORDER`, `LEVELS`, `BADGES`) point at the new copy's parts, and checks the picture links.
  `currentCatalog()` returns the copy as one object (a new object after each call). Outside the engine it is reached
  only as `gameContent()` of [features/content](../../../src/features/content/gameContent.js) (step 3).
- The old exports `rebuildDerived()` and the no-argument `buildLevel(title)` of `engine/data` are gone; nothing
  outside that file called them.

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

**The engine takes it as an argument** (`MT-02` step 2): it imports none of the variables (`tests/architecture.test.js`).

- `engine/questions`: every function that needs the words or challenges takes the copy (any `{ words, challenges }`)
  as its first argument: `buildQuestion(content, mode, word, pools, options)`, `buildChallengeQuestion`,
  `buildTwoPeopleQuestion`, `buildSelectTwoQuestion`, `buildSpeedQuestion`, `findWordByLabel(content, label)`,
  `getAllowedModes(content, word)`, `selectAdaptiveMode(content, word, stats, context)`,
  `legacyQuestionToV2(content, question, entry, suffix)`, `v2SessionFromEntries(content, entries, options)`, and
  the helpers inside the file.
- `engine/progress`: `pickWeakMode(content, word, stats, confusions, quarantine)`; `getBadgeProgress(badge, {
  mastery, bestStreak, levels })`.
- `engine/ai`: `generateContent(words, batch, pools)` and `generateStory(words, targets, categories, rules)`.
- `engine/data`: `courseLevelGroups(words, grammar)` (no defaults any more).

**The features get it from the content module** (`MT-02` step 3). [features/content](../../../src/features/content/gameContent.js)
offers `gameContent()` (the current copy) and `setGameContent(words, grammar, challenges, levelOrder)` (rebuilds it;
the same as `mergeCustomData`). Outside the engine, nothing else imports the variables, `currentCatalog` or
`mergeCustomData` (`tests/architecture.test.js`). The shell imports the two from the content module and passes them:

| Feature | Gets |
| --- | --- |
| Content admin (`useContentAdmin`), Ask AI (`useAskAi`), import and export (`useDataTransfer`) | `gameContent`, `setGameContent` |
| Story generation (`useStoryGeneration`, `StoryBuilder`), pool generation (`useAiGeneration`), question reports (`useQuestionReports`) | `gameContent` |
| Live (`LiveChallenge`, down to the create form) | `gameContent`; `liveQuestions(words, count, { content, … })` takes the copy |
| The round (`SessionView`) | the `words` it already took (other meanings of a word now use it too) |

Every place that read a variable now calls `gameContent()` at the same moment (in a render, a handler or after an
answer arrives), so it sees the same copy as before. The shell reads it the same way.

## Known Issues

- `MT-02`: the copy is still kept in module variables of `engine/data` (one per part, plus `currentCatalog()`); step
  4 removes them. The engine and the features can now be tested with any copy they are given, but the shell and the
  content module's own hooks still use the one kept there, and a test that calls `mergeCustomData` changes it for the
  rest of its file.
- Changing the copy and re-rendering are two separate steps (`mergeCustomData`, then a `dataVersion` bump). Every
  writer above does both today; a new one that forgets the bump would leave screens showing the old copy until the
  next render.
- Found by `gamecopy.cjs` (kept as is): a level with no items counts as finished, so its badge is earned at once
  (a new empty category adds an earned badge); and with no levels at all "Full Case Archive" counts as earned (the
  header shows 1/4 before any content). Both come from `getBadgeProgress` in `engine/progress.js`.
- Found while testing step 2 (kept as is): in the "opposite" question, when the usual wrong options run short, the
  fill-up may pick a synonym of the word (the usual wrong options leave synonyms out). It is still a wrong answer.
- The level order is kept by reference: it is the same list the caller passed (often the current `LEVEL_ORDER`).

## Tests

| What | Where |
| --- | --- |
| The rules above: one per text or id, opposites, levels, badges, the lists given are not changed; `mergeCustomData` keeping the copy and the old names | `tests/catalog-rules.test.js` |
| Levels, badges, counts and the exported copy from a saved copy, after an admin edit and after a reload, in a browser | `e2e/specs/gamecopy.cjs` |
| `engine/catalog` imports only `engine/v2`; only `engine/data` imports it | `tests/architecture.test.js` |
| Questions, mode choice, badges and course levels from a given copy, with the variables left empty | `tests/engine-content-argument.test.js` |
| `engine/questions`, `engine/progress` and `engine/ai` import none of the content variables | `tests/architecture.test.js` |
| Live questions, story generation and pool generation from a given `gameContent`, with the variables left empty | `tests/feature-content-argument.test.jsx` |
| Outside the engine, only the content module imports the variables, `currentCatalog` or `mergeCustomData` | `tests/architecture.test.js` |
| The AI calls get the words they were given | `tests/ai-generation-hook.test.jsx`, `tests/story-generation-hook.test.jsx`, `tests/ai-operations.test.js` |
| Opposites, de-duplication and levels through the engine | `tests/engine.test.js`, `tests/senses.test.js` |
| Course levels from given lists | `tests/course-levels.test.js` |

How the behaviour was kept: the build was moved unchanged into `buildCatalog` and compared with the old
`mergeCustomData` on 3,000 random made-up cases (the six variables equal, the level order the same list; one-off, not
kept); `gamecopy.cjs` passes on the build before the move and after it. Deliberate breaks of the rules and of
`mergeCustomData` (15) each make a test fail.

## `MT-02` steps

1. **Implemented**: the copy is built in one step with no state and returned as one object (above).
2. **Implemented**: the engine functions take the copy (or its lists) as an argument instead of reading the
   variables (see "Who reads it"). Unused functions found on the way were removed first (listed in
   [modules.md](../../architecture/modules.md)). Kept: the new code was compared with the old one on 400 random
   made-up contents with the same random numbers (60,321 checks: every question mode for every word, mode choice,
   two-person questions, speed questions, sessions, weak modes, badges; one-off, not kept); the browser specs pass
   before and after; deliberate breaks (11) each make `engine-content-argument.test.js` fail. One small difference:
   when a story is retried because a target word leaked, the swap now comes from the words of the first request,
   not from the words at the time of the retry.
3. **Implemented**: the features and the shell get it from the content module instead of importing the variables (see
   "Who reads it"). Kept: every read happens at the same moment as before, through a function that returns the same
   copy; the unit tests (962) and the browser specs pass; deliberate breaks of the features' reads (8) each make
   `feature-content-argument.test.jsx` fail.
4. **Planned**: remove the old variables, with a guard that nothing imports them.
