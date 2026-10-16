# Practice selection characterization

Date: 2026-10-16

Branch: `test/practice-selection-baseline`

Base: `cb2fb571caf518922c3fdb2a0ab727a350b8ddc9` from
`ccr-29322d12-v8wkmd`. This does not incorporate the divergent `master`
commit `2a7da81`. The Library branch was not changed.

## Scope

Tests only, plus this record. No application code, data shapes, dependencies,
learning rules, UI wiring, migrations, or production access changed.
The proposed extraction of the word-question selection loop has NOT begun.

`tests/practice-selection.test.js` adds nine cases through the existing
`V2.practice` and `V2.reinforcement` interfaces. Synthetic words reuse
`tests/libraryFixtures.js`; authored extra questions enter through the existing
`opts.extraQuestion` callback. No private functions are exported or mocked.

The new cases protect:

- A compact seeded queue/reserve ordering trace, initial session fields,
  reproducibility, and unchanged input content/mastery.
- Two appearances per target and two intervening questions, with additional
  candidates still available.
- Weighted style selection and stable ordering of tied candidates.
- One occurrence of a normalized gap sentence across words and answer styles.
- Lifetime exclusion of previously seen Two People/Select Two sentences from
  both queue and reserves, compared with an ordinary clue older than 20 hours.
- The single-style edge below, explicitly as observed behavior.
- Ten word questions plus two grammar questions at the existing positions in
  a 12-question mixed round.
- Consumption of the returned reserves by reinforcement, including its order,
  two-question addition, unchanged original session, and no second addition.

Existing tests already cover scope filtering, word rotation, option exclusions,
the single-new-word opening exception and `initialTraining`, grammar freshness,
and grading/mastery. Those cases were retained rather than copied.

New tests freeze Date at `2026-10-16T12:00:00.000Z`, create a fresh seeded RNG
per call, and fail on an unexpected ambient `Math.random()` call. Timer and
mock state is restored after each test. Explicit question-order expectations
characterize this base version; they do not assert that its ordering is optimal.

## Execution record

Node: `v24.19.0`. Vitest: `5.0.3`.

Before adding tests, the clean worktree ran:

```sh
npm test -- tests/engine.test.js tests/library-round-scope.test.js tests/library-round-options.test.js tests/round-single-new-word.test.js tests/grammar-repeat.test.js tests/grammar-variants.test.js tests/senses.test.js tests/course-levels.test.js tests/library-round-grading.test.js
```

Result: **9 files, 106 tests passed**, exit 0 (1.25 seconds).

After adding tests, the same command with
`tests/practice-selection.test.js` appended passed: **10 files, 115 tests**,
exit 0 (1.14 seconds). The new file also passed alone: **9 tests**, exit 0.

`./node_modules/.bin/eslint tests/practice-selection.test.js` passed, exit 0.
`git diff --check` passed. Application source, `package.json`, and
`package-lock.json` are identical to the base.

Setup limitation: offline `npm ci` failed with `ENOTCACHED` for
`zod-validation-error-4.0.2.tgz`. Normal `npm ci --ignore-scripts --no-audit
--no-fund --fetch-retries=0 --fetch-timeout=20000` then succeeded using the
existing lockfile. No dependency upgrade was made. npm emitted proxy-config
and dependency deprecation warnings; these did not fail the test runs.

Not run: the whole repository suite, UI/E2E tests, build, database integration,
or production checks. They are outside this test-only selection baseline.

## Observed edge requiring separate review

**PRACTICE-OBS-01 — a round with only one available style stops after two questions.**

Reproduction uses six familiar synthetic words with unique gap sentences and
quarantines `reverse` and `gapTyping`, leaving only `gap`. Requested length is
12. The current result contains two questions and four reserves for other
targets. The selector refuses a third consecutive question of the same mode
and stops when no eligible candidate remains.

This can produce a short round despite more valid questions being available.
It is an observed tradeoff, not a confirmed defect or an approved learning
rule. The characterization test names it as such. Do not change it during
the behavior-preserving refactor; any decision to relax the rule is separate.

## Refactor readiness

No blocker found for the limited extraction at this base commit, provided the
existing queue/reserve ordering, tie behavior, flags, and random consumption
are preserved. This is not a claim of complete coverage of the engine or UI.
No refactor, merge, push, or deployment is part of this stage.
