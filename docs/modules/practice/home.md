# Home

What Home (`/`, and `/stories`) shows: what to play next. Part of the [practice](README.md) module. Starting a round is
in [starting-rounds.md](starting-rounds.md); which tab is open and what a player limited to their library sees is
decided by the rules in `homeState.js` (below).

Status: **Implemented** (current code). Written down from `WordHunter.jsx` before Home's screen moved into
`features/home/HomeScreen.jsx`; the move kept it (see Tests).

## Files and interface

- [HomeScreen.jsx](../../../src/features/home/HomeScreen.jsx): `HomeScreen({ notices, section, onSection, resume, goal,
  stories, speed, onLive, views })`. It only shows what it is given and calls back. The groups of props are described
  at the top of the file.
- [homeState.js](../../../src/features/home/homeState.js), no state: `resolveHomeView`, `homeTabs`, `inLibrary`,
  `limitLessons`, `itemsScope`, `describeItems`, and (new with the move) `goalView(today, goal)`,
  `storyList(stories, words, mastery, solved, findWord, known)`, `speedCard(mastered, min, bestScore, bestCombo)`.
- [LessonsView](../../../src/features/home/LessonsView.jsx), [CourseLevelsView](../../../src/features/home/CourseLevelsView.jsx),
  [HomeTabs](../../../src/features/home/HomeTabs.jsx), [StageCard](../../../src/features/home/StageCard.jsx).
- [index.js](../../../src/features/home/index.js) exports `HomeScreen`, `StageCard`, `describeItems`, `homeTabs`,
  `itemsScope`, `limitLessons`, `resolveHomeView`. Used by the shell and by the library's `MyViewsHome`, both through
  the index (guarded in `tests/architecture.test.js` and `tests/library-boundary.test.js`); Home imports only the
  engine.

The shell still decides the data (the library's keys and views, the progress, the app settings), keeps whether the
announcement is hidden and whether the fresh-copy notice is up, and renders `MyViewsHome` (lazy) for the views tab.

## What it shows

- **The admin's announcement** (Admin -> Settings), with its tone (info, success, warning). Hiding it hides that
  message on this device; a new message shows again.
- **The fresh-copy notice** when nothing was saved here (the admin only): "Open Import & Export" or "Dismiss".
- **Practice / Stories**, two sections (`/` and `/stories`).
- **Resume <round> (n/total)** while a round is open and not finished.
- **Practice:** today's goal ("n / goal questions · accuracy", or "Daily goal reached" and "+n bonus questions
  today"); the Speed Round card (locked with "Master n more word(s) to unlock" under 5 mastered words, else the pool
  and the bests); the Live Challenge card; the view tabs (when there are lessons or the library is ready) and the open
  view: Gateway (the admin's course levels), By lesson, or one of my views. While the library is still loading for a
  player limited to it, a skeleton shows instead of Gateway or By lesson.
- **Stories:** the admin's story builder; the stories, fewest new words first, each with its questions, "n new
  words: preview first" or "Ready for review", "Solved · best" and "Play again" or "Open story"; or "No authored
  stories loaded…" when there are none.

## Tests

| What | Where |
| --- | --- |
| The fresh-copy notice, the announcement (tone, hidden, a new one), today's goal (and reached), the Speed Round and Live cards, the stories list, Resume (local mode) | `e2e/specs/home.cjs` |
| The view tabs, Gateway, My views on Home | `e2e/specs/homeviews.cjs`, `e2e/specs/library.cjs` |
| The rules | `tests/home-state.test.js` |
| The screen and its pieces (callbacks, which view shows) | `tests/home-components.test.jsx` |

How the behaviour was kept: `home.cjs` passes on the code before the move and after it (with `practice`,
`homeviews`, `library`, `libsolo`, `nested`, `progress`, `recording`, `sweep`, `gamecopy`). The new rules were
compared with the old inline code on random made-up days, stories and counts (9,000 checks; one-off, not kept).
Deliberate breaks (24) each make the two test files fail.

## Known Issues

- "1 new words" is written with a plural for one word. Kept as is (wording only).
