# Progress in the game (state and saving)

How the game holds a player's progress while it runs: what it opens with, when it saves, what "reset" and "restore" do
to the screen, study days, badges, and another device's changes. Part of the [progress](README.md) module; how a save
reaches the server (sections, revisions, conflicts, the offline snapshot) is in the README and
[architecture/repo.md](../../architecture/repo.md).

Status: **Implemented** (current code). Written down from `WordHunter.jsx` before slice 1 of Learning Progress moved it
into `features/progress`; the move kept it (see Tests).

## Files and interface

- [progressRules.js](../../../src/features/progress/progressRules.js), no state: `progressToSave(extras, state)`,
  `startingSettings(raw, data, newPlayerDefaults)`, `earnedBadgeIds(badges, progress)`, `newBadges(badges, seen,
  progress)`, `refreshDue(visibility, last, now)`, `REFRESH_GAP_MS`, `resetState()`.
- [useProgress.js](../../../src/features/progress/useProgress.js):
  - `useProgress({ repo, loaded, gameContent, onReports, onBadge })` returns the numbers and their setters (score,
    streak, best streak, questions answered, words' records, levels cleared and their stats, study streak, best and
    last day, pools, confusions, Speed Round bests), the open session, the settings, the round log, solved stories and
    the day's count; the refs `progressExtrasRef`, `masteryRef`, `poolsRef`, `confusionsRef`, `restoringRef`; and
    `apply(data)`, `startFrom(raw, newPlayerDefaults)`, `restore(backup)`, `reset({ onError })`, `recordStudyDay()`,
    `extrasChanged()`, `toSave()`.
  - `useProgressSave({ repo, loaded, progress, debouncedSave, alsoOn })` saves after each change.
- [useSaveQueue.js](../../../src/features/progress/useSaveQueue.js): `useSaveQueue()` returns `{ debouncedSave,
  pendingSavesRef, runningSavesRef, contentWritesRef }`, shared with the content's save and with signing out.
- [index.js](../../../src/features/progress/index.js) exports `useProgress`, `useProgressSave`, `useSaveQueue`. Only
  the shell uses them (guarded in `tests/architecture.test.js`).

The shell still loads content and progress together on start (`repo.loadContent`, `repo.loadProgress`) and builds the
backup file. What answers and rounds record is in [answer-recording.md](answer-recording.md).

## Opening the game

- The saved progress is brought up to the current format (`migrateProgressData`) and put on screen. A new player
  (nothing saved) starts from zero.
- Settings: the saved ones; a new player gets the admin's defaults (Admin -> Settings, "new player defaults").
- Badges already earned at that moment are remembered, so they are not shown as new.
- Progress that cannot be read: the error is logged ("Could not read progress"), the game opens from zero and every
  badge earned later is shown. (A progress that cannot be *loaded* stops the game with "Try again" instead; see the
  README, failure.)
- The question reports in the progress are handed to the question reports module, which keeps its own list.

## Saving

- Nothing is saved before the game has opened.
- After it, any change of the open session, the numbers, the words' records, levels, study days, pools, confusions,
  Speed Round bests, settings or the question reports saves the whole progress object 600 ms after the last change: a
  burst of answers is one save. The repo then sends only what changed.
- What is saved: everything the progress object held when it was loaded or merged (the round log, the day's count,
  completed rounds, read sentences, solved stories...), with the game's own numbers on top, and the progress version
  (`SCHEMA_VERSION`).
- Some parts change only in that object (read sentences, the round log). They are saved with the next change, except
  Live marking sentences as read, which asks for a save itself (`extrasChanged`).
- Hiding the page (switching apps or tabs), closing or reloading it runs every waiting save at once. Leaving while an
  admin's content edit is still being written asks first (the browser's "Leave site?").
- A failed save is logged ("Could not save progress"); the repo keeps it and tries again.
- Signing out waits for the running saves (up to 5 s; [sign-in](../accounts/sign-in.md)).

## Restore and reset

- **Restore a backup** (Import & export, Profile): the backup's progress replaces what is on screen (numbers, records,
  settings, reports) and the next save is a replacement (no merge with the server's copy). Later saves are normal.
- **Reset progress**: the server's copy is deleted, then everything starts from zero: numbers, records, levels, study
  days, pools, confusions, Speed Round bests, the round log, solved stories, the open session and the day's count.
  Badges can be earned again. The content is not touched. If the server cannot be reached the game still shows zero
  and says "Progress couldn't be reset on the server. Check your connection and try again."

## Study days

- A finished round, a Speed Round with answers, new words introduced, or a Final Case report counts today as a study
  day. The first one each day adds one to the days in a row if the last was yesterday; otherwise the count starts at 1.
  The best count is kept.

## Badges

- A badge earned for the first time shows "New badge: <name>" (lesson badges when all its words are mastered; answer
  streaks of 5, 10 and 20; all lessons). Each is shown once per game opened (reset forgets them).

## Another device's changes (online)

- When the game comes back to the foreground (focus, or the page becomes visible), at most every 10 seconds, it asks
  the repo for changes from another device. Merged progress (from this check or after a save conflict) is put on
  screen as on opening. Not in local mode (one device) and not before the game has opened.

## Tests

| What | Where |
| --- | --- |
| Opening with saved progress, the save 600 ms later (not at once), at once on page hide, the numbers an answer changes, a badge shown once, a study day after yesterday's, the same numbers after a reload (local mode) | `e2e/specs/progress.cjs` |
| Reset keeps the content; restoring a backup | `e2e/specs/startover.cjs`, `e2e/specs/importexport.cjs` |
| The rules | `tests/progress-rules.test.js` |
| The hooks with a fake repo: opening (saved, new, unreadable), saving (not before opening, one per burst, reports and extras, page hide and leave, asking during a content write, a failed save), restore, reset (also offline), study days, badges, another device's changes | `tests/progress-hooks.test.jsx` |
| How a save reaches the server | see the [README](README.md#7-tests) |

How the behaviour was kept: `progress.cjs` passes on the code before the move and after it (with `finalcase`,
`startover`, `importexport`, `signin`, `contentsave`, `livelib`). The rules were moved unchanged and compared with the
old inline code on random made-up progress (20,000 checks; one-off, not kept). Deliberate breaks (36) each make the
two test files fail.

## Known Issues

- A lesson with no words gives its badge at once, and "Full Case Archive" is earned with no lessons (`every` of an
  empty list). Kept as is; to be decided.
