# Known bugs to fix (not part of the refactor)

Behaviour that players can see and that the refactor kept on purpose: each move had to keep behaviour, so these were
written down instead of fixed. Each one is its own later PR, with a test that fails before the fix. Status of all
three: **Confirmed, not fixed** (2026-10-20). Found by `e2e/specs/gamecopy.cjs` (1, 2) and while testing the content
step 2 (3); first noted in [content-catalog.md](../modules/content/content-catalog.md).

Other known problems are listed in each module's "Known Issues" and in the [roadmap](../architecture/roadmap.md).

## 1. A lesson with no words gives its badge at once

- **Where:** `getBadgeProgress` in [engine/progress.js](../../src/engine/progress.js): a lesson's badge is earned when
  the mastered count reaches the number of its items; with no items that is 0 >= 0.
- **Reproduce** (local mode, made-up content): import a content file whose `levelOrder` lists a lesson with no words
  (for example `"levelOrder": ["Weather", "Empty"]`, words only in Weather), or add an empty category as the admin.
  The header's badge count goes up by one at once and the Badges page shows "Empty Files Closed" as earned, with no
  word mastered.
- **Proposed:** a lesson's badge needs at least one word, all mastered. While a lesson is empty its badge is shown as
  not earned (0/0 words).
- **Test to add first:** `tests/progress-rules.test.js` (`earnedBadgeIds` with an empty lesson) and the hook test for
  the toast; `e2e/specs/gamecopy.cjs` already shows the current count.

## 2. "Full Case Archive" is earned with no lessons

- **Where:** the same function: the "completionist" badge asks whether *every* lesson is finished; with no lessons
  `[].every(...)` is true. With empty lessons (bug 1) it is also true.
- **Reproduce:** open the game with no content at all (a new local game before any import). The header shows
  "1/4" badges: Full Case Archive is earned.
- **Proposed:** earned only when there is at least one lesson with words and every lesson with words is finished.
- **Test to add first:** `tests/progress-rules.test.js` (no lessons; only empty lessons; one finished lesson and one
  empty lesson).

## 3. The "opposite" question's extra options may include a synonym of the asked word

- **Where:** `buildOppositeDirect` in [engine/questions.js](../../src/engine/questions.js). The usual wrong options
  (`sampleDistractors` → `V2.optionWords`) never include a word that is a synonym of the asked word or must not
  appear with it. When fewer than three are left, the fill-up takes any word that is not an opposite of the asked
  word and fits with the answer (`safeOppositeDistractor`), but it does not check the asked word itself.
- **Reproduce** (made-up words): Happy (opposite Sad, synonyms ["Glad"]), Sad, Glad, and at most one other word.
  "The opposite of Happy" can show Glad as an option. Choosing it is still graded wrong, but the question puts a
  word that means the same as Happy next to its opposite.
- **Proposed:** the fill-up uses the same rule as the usual options (`V2.compatible` with the asked word too). If
  fewer than three wrong options remain, ask with fewer options (the question still works with two) rather than
  add a synonym.
- **Test to add first:** `tests/engine*.test.js` with the small made-up set above, many seeded runs, no option
  is a synonym of the asked word.
