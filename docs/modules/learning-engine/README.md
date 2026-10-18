# Module: learning-engine

The rules of learning: how a round is picked, how questions are built, how an answer is graded, and how a word moves from New to Mastered. Mostly pure functions. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decisions: [ADR 0003](../../adr/0003-grading-location.md), [ADR 0008](../../adr/0008-session-evidence-mastery.md).

## 1. Purpose and scope

**Purpose.** Decide what the player is asked and what an answer means for what they know.

**Responsibilities (Implemented)**

- Pick a round: new words, known words in rotation, words missed last time first, weak words, narrowing by lesson, unit, course level or a personal view, and avoiding sentences read recently ([v2.js](../../../src/engine/v2.js) `practice`).
- Build questions: many modes (meaning, gap, typing, reverse, picture, opposite, collocation, family, grammar choose / judge / fix, grammar court, story and combo questions, Final Case) and the older builders used by Live and the Speed Round ([questions.js](../../../src/engine/questions.js)).
- Make distractors that are safe: words with several meanings never appear together, confusable pairs and the player's own mistakes come first.
- Grade an answer (`V2.grade`): normalised text comparison, one-letter typo detection ("spelling"), `unverified` for free-writing questions.
- Turn a finished session into mastery changes (`V2.sessionEvidence`) and decide the stage (`V2.stage`, `getMasteryStage`).
- Level, star, badge and study-streak maths ([data.js](../../../src/engine/data.js)); progress file normalisation and defaults ([progress.js](../../../src/engine/progress.js)).
- Weak-word selection and learning insights ([progress.js](../../../src/engine/progress.js)).

**Out of scope**

- Calling an AI to judge an answer or write content (the prompts are in [engine/ai.js](../../../src/engine/ai.js), which belongs to [ai-media](../ai-media/README.md)).
- Storage, network and screens.
- The Live Challenge rules, except that Live reuses the question builders ([live](../live/README.md)).

## 2. Public operations

| Operation | Input | Output |
| --- | --- | --- |
| `V2.practice(content, mastery, category, rng, quarantine, opts)` | course lists, mastery map, optional lesson, random function, set of banned `word|mode` pairs, options (round size, new-word intake, pools, confusions, seen sentences, scope, unit, course level, extra-question builder) | a session `{id, kind, title, queue, index, answers, introductions, reserves ...}` |
| `V2.storySession`, `V2.chainSession` | a story or combo | a session |
| `V2.grade(question, value, words)` | question, answer(s), words | `{correct, spelling, unverified}` |
| `V2.sessionEvidence(mastery, session, now)` | mastery map, finished session | a new mastery map |
| `V2.stage(record)` | one mastery record | New, Familiar, Learned or Mastered |
| `getMasteryStage(record, item)` | record, item kind | the stage as the game shows it |
| `getWeakWordCandidates`, `pickWeakMode`, `deriveLearningInsights` | words, mastery, confusions | ranked weak words, a mode, insight numbers |
| `migrateProgressData(raw)` / `emptyProgressData()` / `normalizeSettings(raw)` | saved data | normalised data of the current schema (`SCHEMA_VERSION` 6) |
| `V2.validateContent`, `prepareImport`, `mergeContent`, `normalizeV3`, `applyRenames`, `withoutRemovedFields` | files and content | issues, prepared data, merged lists (used by [content](../content/README.md)) |

## 3. Files and database objects

- Files: [engine/v2.js](../../../src/engine/v2.js), [questions.js](../../../src/engine/questions.js), [progress.js](../../../src/engine/progress.js), [data.js](../../../src/engine/data.js), [constants.js](../../../src/engine/constants.js).
- Screens: none.
- Database objects: none. The server never runs these rules (except the Live copy of the rules in SQL, see [live](../live/README.md)).

## 4. Business rules

- **Stages for a word with session evidence.** Each finished round adds one scored result per word, so "answers" below means scored rounds. Mastered needs at least 5 scored rounds, 80% of them right, correct answers in at least two modes, at least one correct typed answer, and independent success in at least 3 different rounds. Once reached, Mastered is kept until the word collects 3 regression strikes (each failed round adds one, each successful round removes one). Learned: at least 2 right and 2 modes. Familiar: any right. New: none.
- **Evidence per round.** One scored result per word per round, and a round is applied once (ids kept, bounded to 50). The word's result is a success only if every answer to it in that round was right and unassisted. A hint on any answer to the word makes the round a miss for that word: the review step goes back to 0 and, for a word that had been mastered, a strike is added. Reported, unverified, AI-failed and Speed Round answers add nothing at all.
- **Review step.** A successful round raises a word's step by one, up to 4; a miss sets it to 0. Until the player has typed it correctly once, the step stops at 2 ("production gate") and the word gets typing questions.
- **Rotation, not scheduling.** Known words come back in rotation, least recently reviewed first, with missed words ahead. The field for a next review time exists but is always 0; there is no spaced-repetition schedule.
- **Variants.** A sentence variant locks for 7 days after two independent correct answers; when none is fresh, a new one is written in the background (see [ai-media](../ai-media/README.md)).
- **Questions.** Typed answers are used for production; options come from the whole dictionary even when the round is narrowed to a view, so a small view is not an easy one.
- **Other kinds.** Grammar, challenge and pun items use a simpler stage rule: Mastered at 5 answers and 80% (`LC-01`).

## 5. Data flow

Pure in, pure out. The caller passes the content lists, the mastery map and options, and stores whatever comes back. [practice](../practice/README.md) calls `practice`, `grade` and `sessionEvidence`; [progress](../progress/README.md) calls `migrateProgressData` and `V2.stage` (for the mastered count); [content](../content/README.md) calls the import helpers.

## 6. Failure, retry, cancel, offline

- No network, no storage, no timers: nothing here fails for those reasons, and everything works offline.
- A session that cannot build safe questions comes back with an empty queue; the summary tells the player to come back later.
- Unknown or damaged saved fields are normalised on read (`migrateProgressData`, `normalizeMasteryRecord`), including a repair for broken confusion counts.
- Random choices take a random function so tests can fix them.

## 7. Tests

| Check | Where |
| --- | --- |
| Engine rules, question building, stages | [tests/engine.test.js](../../../tests/engine.test.js) |
| Grammar questions, variants and repetition | [tests/grammar.test.js](../../../tests/grammar.test.js), [grammar-variants.test.js](../../../tests/grammar-variants.test.js), [grammar-repeat.test.js](../../../tests/grammar-repeat.test.js) |
| Several meanings of one word | [tests/senses.test.js](../../../tests/senses.test.js) |
| Session evidence, merge behaviour | [tests/review-audit.test.js](../../../tests/review-audit.test.js) |
| Live question building | [tests/live-variety.test.js](../../../tests/live-variety.test.js) |
| Study numbers | [tests/study-stats.test.js](../../../tests/study-stats.test.js) |

**Gaps.** The two stage functions are not compared in a test, so their difference for grammar is unpinned (`LC-01`). The per-answer handler `recordSessionResult` and the session-end handler `completeSession` live in WordHunter and have no unit tests (`MT-04`). The old grading code in WordHunter (`registerResult`) is dead but still carries a second set of rules (`MT-03`).

## 8. Example journey

Mia (synthetic) practises the word "Reluctant" for the third time on three separate days.

1. Each round, `practice` offers it in a different mode (meaning, gap, then typing, because the production gate holds it at step 2 until she types it).
2. She answers each correctly without hints. At the end of each round `sessionEvidence` adds one correct result and records the session id.
3. After the third independent session with a correct typed answer and two modes, `stage` returns Mastered. The Home card, the badge progress and the mastered count change.
4. If she presses "Hint" on a later question, that round counts as a miss for the word: its step goes back to 0 and, once it is mastered, it gains a strike.

## 9. Status

**Implemented.** The rules above.

**Planned** (roadmap Phase 2)

- One stage function for all item kinds, with the grammar rule agreed with the owner.
- A rule for unreviewed AI sentences.
- Phase 0 tests that pin the current stages for words and grammar.

**Known Issues**

- `LC-01` two definitions of "mastered".
- `LC-03` score and streaks change per answer, mastery per finished session.
- `MT-03` dead round engine with duplicate rules in WordHunter.
- `MT-04` the session handlers are untested.
