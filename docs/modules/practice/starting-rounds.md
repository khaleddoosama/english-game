# Starting rounds

How a round starts: a lesson or one of its units, a course level, Home items, a personal view, a story, or the Speed
Round. Part of the [practice](README.md) module. How the engine then picks and orders the questions is in
[practice-selection.md](../learning-engine/practice-selection.md); what answers and the end of a round record is in
[answer-recording.md](../progress/answer-recording.md).

Status: **Implemented** (current code). Written down from `WordHunter.jsx` before Practice's starting code moved into
`features/practice`; the move kept it (see Tests).

## Files and interface

- [practiceRules.js](../../../src/features/practice/practiceRules.js), no state: `lessonStart(level, group)`,
  `courseLevelStart(level, part)`, `newWordsFor(base, sessionLogs, title)`, `moreNewWordsText(base, newWords,
  introduced)`, `usedUpGapWords(words, inRound, mastery, pools, seen)`, `lessonStars(levelStats, clearedSet, id)`,
  `speedQueue(content, masteredWords, size)`, `speedSession(queue, seconds, now)`, `practiceExtra(content, word, stage,
  { pools, seen, imageOk }, rng)`, and `MIN_MASTERED_FOR_SPEED` (5), `GAP_REFRESH_MAX` (8).
- [usePractice.js](../../../src/features/practice/usePractice.js): `usePractice({ progress, gameContent, liveContent,
  quarantine, home, views, itemsScope, imageOk, onLesson, onToast, triggerGeneration, onOpen })` returns
  `{ launchSession, startLevel, startCourseLevel, startItemsPractice, startViewPractice, launchStory, startSpeedRound }`.
- [index.js](../../../src/features/practice/index.js) exports `usePractice`, `lessonStars`, `MIN_MASTERED_FOR_SPEED`.
  Only the shell uses it (guarded in `tests/architecture.test.js`); the module imports only the engine (the library's
  views and the picture check are passed in).

The shell still draws Home (lessons, Gateway, My views, stories, the Speed Round card) and keeps which lesson is open.

## Starting a round

Every start builds a session, puts it in the progress as the open round (saved like the rest), and opens `/play`.

- **A lesson** (By lesson, "Practice"): its words, titled with the lesson. **One of its units** (the lesson's "N units"
  list): "Lesson · Unit"; a sub-category the same way; words in no group "Lesson · Other words". A player who sees only
  their library plays only the lesson's words they have.
- **A course level** (Gateway, the admin's view): its words from every lesson, titled "A1.2"; one of its sessions
  "A1.2 · Session"; its words in no session "A1.2 · Other words"; words with no level "No course level".
- **Home items** and **a personal view** (and, if asked, the views inside it): their words. A view that is empty says
  "This view is empty. Add some words first."; a view that cannot be read shows why. Nothing starts while the library
  is not ready.
- **A story**: its own round (its target words introduced first if new). A story that cannot be built shows why.
- **The Speed Round**: needs 5 mastered words (the card says how many more otherwise). Up to the engine's queue size
  of short choice questions about mastered words, never the same word twice in a row, timed from Settings (30 to
  120 s; 60 by default). If no question can be built: "No short questions with safe options are available."

## How many new words

New words come first in a round (Settings: new words per round). The last round with the same title decides: 90% or
more gives two more new words (10 at most) and the message "Strong last round here — N new words this time."; under
60% gives two fewer (at least one). A setting of 0 stays 0.

## Fresh sentences

Known words of the round whose gap sentences were all read recently (8 at most) get new ones written in the
background, so the next rounds do not run out. Each word of a practice round may also get one extra question style
(who am I, idioms, stories, opposites, two people, select two, word partners, word family, a picture, an opposite
clue), typed once the word is Learned; a prompt that would give the answer away is never used.

## Tests

| What | Where |
| --- | --- |
| A lesson, a unit, a course level, new words after a strong and a weak round (and the message), a story, the Speed Round locked and open, Resume (local mode, read from the saved round) | `e2e/specs/practice.cjs` |
| Practice from a view, from Home items | `e2e/specs/library.cjs`, `e2e/specs/libsolo.cjs`, `e2e/specs/homeviews.cjs` |
| The rules | `tests/practice-rules.test.js` |
| The hook with the real `useProgress` and engine | `tests/practice-hook.test.jsx` |

How the behaviour was kept: `practice.cjs` passes on the code before the move and after it (with `progress`,
`recording`, `homeviews`, `library`, `libsolo`, `nested`, `poolgen`, `sweep`, `livelib`). The rules were moved unchanged
and compared with the old inline code on the course in `e2e/fixtures/course-backup.json`: every lesson and group, every
course level and part, 2,500 extra questions (2,216 built), new-word counts, used-up sentences, stars and Speed Round
queues (7,714 checks; one-off, not kept). Deliberate breaks: 37 of 40 make the tests fail; the other three change
nothing that can happen (a saved Speed Round time is always one of the allowed values; with this content the built
questions already have that id and none lacks a target).

## Known Issues

- Every lesson is open: the step-by-step unlocking is switched off on purpose in the shell (`isLevelUnlocked`). Kept
  as is.
