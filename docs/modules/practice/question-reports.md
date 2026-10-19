# Question reports (practice)

Part of the [practice](README.md) module; the admin's side is in [admin](../admin/README.md). Status: **Implemented** (current code). Moved here from `docs/modules/question-reports.md`.


A player can report a question that looks wrong. The report is kept with the progress, the admin reviews it
(optionally with the AI), resolves, reopens, deletes it, or retires the sentence it came from. While a report is
open, its (word, mode) pair is held back from the adaptive question choosers.

## Responsibility
- **Rules (pure):** `src/features/reports/reportRules.js`: what a report holds (`buildReport`), which report is which
  (`sameReport`: by id; old reports have none, so the same object), the list limit (`withReport`: every unresolved
  report plus the newest 150 resolved), change/remove one (`mapReport`, `withoutReport`), the quarantine
  (`quarantineOf`: `word|mode`, trimmed, lower case, unresolved only), and a renamed word (`followRenames`).
- **State and operations:** `src/features/reports/useQuestionReports.js`. Every change writes
  `progressExtrasRef.current.reports` (what is saved) first, then the React state, as the shell always did.

## Interface (`src/features/reports/index.js`)
`useQuestionReports({ progressExtrasRef, profile, liveContent, markSentencesSeen, touchSession, poolsRef, setPools, triggerGeneration })`
returns `{ reports, quarantine, report, review, remove, resolve, reopen, retire, load, followRename }`.
`report(q, session, reason, answer, details, prior)` is the round's `onReport`; `review`, `remove` the round's
`onReviewReport`, `onWithdrawReport`; `resolve`, `reopen`, `retire`, `remove`, `review` the Admin's. `load(list)`:
progress loaded or restored (the caller sets the ref). `followRename(map)`: a word was renamed.
The pool arguments are only for `retire` (it flags the variant and asks for a new one).

## Dependencies
`engine` only (`ai`: `reviewReportedQuestion`, `locateReportSource`; `questions`: `getWordPools`; `v2`). The game's words come
through the `gameContent` the shell passes ([content-catalog.md](../content/content-catalog.md)).
In no loop, and nothing but the index is imported from outside (`tests/architecture.test.js`).
Used by `src/app/WordHunter.jsx`; the screens it feeds are unchanged: the round (`SessionView`, with its report window)
and Admin (`sections/Reports.jsx`). Saving reports to the server is `src/lib/repo/reportsSync.js` (not part of this module).

## What stayed in the shell, and why
`finishFinalCaseReport` is the final-case *writing* exercise, not a question report (the name only looks alike): it
never touches the reports. The quarantine is read by Practice (`reportQuarantine` in the shell, passed to the question
choosers); that code is untouched. `migrateRenamedProgress` stays in the shell and calls `followRename`.

## Tests
| What | Where |
| --- | --- |
| the rules | `tests/question-reports-rules.test.js` |
| the hook: file, review (AI mocked), resolve, reopen, delete, retire, load, rename; ref and state agree | `tests/question-reports-hook.test.jsx` |
| the report window in a round | `tests/report-modal.test.jsx` (existing) |
| sync with the server | `tests/repo-parts.test.js`, `tests/repo-stores.test.js`, `tests/review-audit.test.js` (existing) |
| file a report in a browser, Admin resolves, reopens, deletes; saved with the progress | `e2e/specs/reports.cjs` (passes on the build before and after the move) |
| no loops, only the engine, only through the index | `tests/architecture.test.js` |

How the behaviour was kept: the rules were moved first, unchanged, and compared with the original code in the shell on
many inputs (every combination of question, round, answer kind, prior answer and sender; the list limit with 400
reports; resolve, reopen, delete, quarantine, rename). The hook was then compared with the original handlers (review,
retire, resolve: same saved list, same state, same pool changes, same generation request). Those comparisons were
one-off and are not kept as tests; the tests above pin the same behaviour from now on.

## Old problems found, not fixed here
1. After "Reset progress" the reports list in memory (Admin page, quarantine) is not cleared, while what is saved is
   (`handleReset` empties the ref but does not call `load([])`). It shows until the page is reloaded.
2. `retire` on a report whose `poolType` is not a known pool would throw (`wordPools[poolType].map`); the Admin only
   offers it for reports that have a pool.
