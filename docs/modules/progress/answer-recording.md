# What answers and rounds record

What one answer and the end of a round change in the player's progress. Part of the [progress](README.md) module;
how that progress is held and saved is in [progress-state.md](progress-state.md); what makes a word's stage go up
(the evidence of a round) is in the [learning-engine](../learning-engine/README.md).

Status: **Implemented** (current code). Written down from `WordHunter.jsx` before slice 2 of Learning Progress moved it
into `features/progress`; the move kept it (see Tests).

## Files and interface

- [recordRules.js](../../../src/features/progress/recordRules.js), no state: `withSeenSentences`, `marksSentences`,
  `countsAnswer`, `answerKey`, `dayAfterAnswer`, `goalJustReached`, `nextStreak`, `withVariantAnswer`,
  `withWordPoolAnswer`, `wrongWordChoices`, `withConfusion`, `withCompleted`, `isWholeRound`, `roundLogEntry`,
  `afterRoundLog`, `lessonRound`, `withLessonStat`, `withLessonCleared`, `withSolvedStory`, `finalRecallSummary`,
  `withIntroduced`, `withFinalReport`, and the limits `POINTS_PER_ANSWER` (10), `SEEN_SENTENCES_MAX` (4000),
  `COMPLETED_SESSIONS_MAX` (500), `ROUND_LOG_MAX` (50), `STAR_ACCURACY` (70).
- [useAnswerRecording.js](../../../src/features/progress/useAnswerRecording.js): `useAnswerRecording({ progress,
  gameContent, onToast, generation })` returns `{ markSentencesSeen, recordSessionResult, trackConfusion,
  introduceWords, completeSession, applyFinalReport }`. `progress` is `useProgress`'s result; `generation` is
  `{ triggerGeneration, triggerVariantGeneration, keepGrammarFresh }` from the AI helpers.
- Exported by [index.js](../../../src/features/progress/index.js); used by the shell only. The shell passes
  `recordSessionResult` and `introduceWords` to the round screen, `markSentencesSeen` to question reports and Live,
  and shows the screen `completeSession` asks for (Speed Round results, the Final Case report).

## One answer

- **Sentences read.** The sentences of the question (not definitions) are remembered with the time, so practice keeps
  them away for a while; the newest 4000 are kept. Also for reported or ungraded answers; not in a Speed Round.
- **What counts.** An answer that was reported, not graded ("different from the model"), whose AI check failed, or
  whose question asks not to count, changes nothing else. Each question of a round counts once (an answer given again
  after a reload is ignored).
- **The day.** The day's count goes up (answered, and right if right); a new day starts from zero. The answer that
  reaches the daily goal shows "Daily goal reached: N questions today. Anything more is a bonus!".
- **Streak and points.** Questions answered goes up. A right answer without help adds one to the answer streak (and
  the best streak) and 10 points; anything else sets the streak to 0. A right answer with help counts as right for
  the day only.
- **Pools.** The sentence or variant shown counts one attempt (and one right answer without help); two right answers
  lock it for 7 days. A combo or grammar variant answered when none is free asks for new variants. A word's sentence:
  new sentences are asked for when the pool needs more, or after a right answer when no other sentence is free. Any
  grammar question also asks to keep its rule's sentences fresh.
- **Confusions.** In a choice question answered wrong, each wrong option that is a word is paired with the word that
  was asked ("Drizzle|Gust"), counted, and dated; the list is pruned by the engine.

## New words

- Words shown on their learning cards are marked introduced (the first time only); the day counts as a study day.

## The end of a round

A round is recorded once (the last 500 rounds are remembered); ending it again does nothing.

- **Speed Round.** Best score and best combo are kept; the day is a study day if anything was answered; the round is
  closed and its results shown. No round log.
- **Other rounds.** If every question was answered: the round log gets the round (newest first, 50 kept) and the
  day's history counts it. The round's answers become the words' evidence ([learning-engine](../learning-engine/README.md)),
  also for a round left early; the day is a study day; the round is marked done.
  - A whole practice round of a lesson (by its title): the lesson's stats; at 70% or more, its star.
  - A whole story round: the story keeps its best result.
  - The Final Case recall: its score (right answers without help among the graded ones) opens the report screen.
- **The Final Case report**, graded by the AI: each word used well counts as one more right, written answer (mode
  "finalReport"); a low-confidence grading changes no word. Either way the day is a study day.

## Tests

| What | Where |
| --- | --- |
| A practice round played to the end and a Speed Round, read back from the save (local mode): each answer once, points, round log, day's history, lesson stats and star, done, new words, confusions, the goal's message, Speed Round bests | `e2e/specs/recording.cjs` |
| An answer's numbers, the badge and the study day after a Final Case | `e2e/specs/progress.cjs`, `e2e/specs/finalcase.cjs` |
| The rules | `tests/record-rules.test.js` |
| The hook with the real `useProgress`: an answer once, help, reported and ungraded answers, Speed Round sentences, confusions, pools and new sentences, new words, each kind of round's end (once), the Final Case report | `tests/answer-recording.test.jsx` |

How the behaviour was kept: `recording.cjs` passes on the code before the move and after it (with `progress`,
`finalcase`, `poolgen`, `reports`, `storygen`, `livelib`, `liveroom`, `sweep`). The rules were moved unchanged and
compared with the old inline code on random made-up answers and rounds (39,000 checks; one-off, not kept). Deliberate
breaks (51) each make the two test files fail.

## Known Issues

- None found in this move. (The badge oddities are in [progress-state.md](progress-state.md#known-issues).)
