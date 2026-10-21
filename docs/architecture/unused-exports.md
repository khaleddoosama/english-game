# Unused exports

Status: **Implemented** (2026-10-20). Behaviour of the game did not change: only code that nothing called was removed,
and names used only inside their own file stopped being exported.

## The rule

Every named export in `src/` is used outside its own file: by another source file, a test, a browser spec, the API,
the database scripts, or as a property of an object (a call to `V2.findWord` counts as a use of `findWord`).
An export that nobody reads is either dead code (remove it) or not part of the file's interface (keep it, without
`export`). A name that only tests use stays exported: the tests are its callers.

Checked by `tests/unused-exports.test.js` (runs with `npx vitest run`, so in the CI job "app"). It fails with the
list of exports that have no use elsewhere.

## How a use is found

Every file in `src`, `tests`, `e2e` (without `e2e/out`), `api`, `supabase` and `public`, and the root config files,
is split into identifiers. An export is used when its name appears as a whole identifier in any other file. This
also covers:

- re-exports (`export { x } from "./file"` names `x`);
- access through an object such as `V2.x` or `api.x`, and `import * as`;
- names written in strings (a mock, a script) or comments.

It is a text search, a helper guard for the patterns this code uses today, not a proof. It can call a dead export
used (a word that happens to match). It can also miss a real use whose name is never written whole, for example
`module["foo" + "Bar"]` for `fooBar`; the code has no such access today, and lint and the build would not catch it
either, so keep names written out.

Not searched: `legacy/` (the original single file, kept for reference only), `imports/` (data files), `e2e/out`
(generated output; while it was searched it hid five unused exports), `dist`, `node_modules`. Default exports are not
checked (every `src` file is imported by path; checked by hand on 2026-10-20).

## What the batch of 2026-10-20 changed

Before, 130 named exports had no use outside their file: 125 found first by the same method, and 5 more that
`e2e/out` had hidden. `levenshtein` joined them once its one outside caller was removed.

**Removed, no caller at all** (22):

- `engine/ai.js` (now `lib/aiPrompts.js`): `containsRequiredTerm`, `spellingDistanceInfo`.
- `engine/data.js`: `MASTERY_STAGE_RANK`, `MAX_RELATIONSHIPS`, `RECENT_RESULT_LIMIT`, `WORD_MODES`, `formatAccuracy`,
  `updateReviewStreak`, `setLastChallengeId` with `LAST_CHALLENGE_ID`, and `REVIEW_STEP_MAX` (read only by
  `updateReviewStreak`).
- `engine/progress.js`: `deriveLearningInsights`; the old storage keys `STORAGE_KEY`, `LEGACY_V5_STORAGE_KEY`,
  `LEGACY_V4_STORAGE_KEY`, `LEGACY_V3_STORAGE_KEY`, `CUSTOM_CONTENT_KEY` (no code reads those keys).
- `engine/questions.js`: `getAdaptiveDifficulty`, `setPoolsSnapshotForSession`, and `levenshtein` and `modeAccuracy`
  (read only by removed code). Without its setter, `poolsSnapshotForSession` is a constant empty object, as it already
  was in practice ([practice-selection.md](../modules/learning-engine/practice-selection.md)).
- `lib/repo.js`: `_internals` (an object of three helpers that no test read).

**No longer exported, used inside their file** (109): helpers and limits in `engine/ai.js`, `engine/data.js`
(`PRODUCTION_MODES`, `getStarsForAccuracy`, …), `engine/progress.js`, `engine/questions.js` (the single question
builders behind `buildQuestion`, `sampleDistractors`, `safeOppositeDistractor`, …), `engine/dictionary.js`
(`synonymsOf`), the admin sections, auth, data transfer, library ids, Live, media, progress, social, stats,
`lib/ai.js` (`postAiRequest`), `lib/progressMerge.js` (`mergeMap`, `mergeField`, `HISTORY_LIMIT`),
`lib/repo/contentPlan.js` (`POSITION_GAP`) and `lib/sound.js` (`CUES`). The full list is the commit
"Stop exporting names used only inside their file".

How it was checked: lint (an unused name is an error), the build, all unit tests and the browser specs. The
production build before and after was compared chunk by chunk: 18 of 20 JavaScript chunks are the same; in the
other two (the admin panel and the main chunk) only minified names differ, and six constants (5, 20, 0.12, 120, 50,
4000) are now declared once instead of written in place. The removed code was already left out of the build.
The comparison is strong extra evidence, not a proof on its own (two chunks do differ); the tests and browser specs
are the other part. The unit test
counts did not change (1149 passed before; 1151 after, the 2 new guard tests). Deliberate breaks: a new unused
export, an internal function exported again, a name added back to an `export { }` list, a feature constant exported
again, and a new file with an unused class and an alias each make the guard fail.

## Known Issues

- A name that appears in any other file, even in a comment, counts as used, so a dead export with a common name
  can pass.
- A use whose name is never written whole (a computed property such as `module["foo" + "Bar"]`) is not seen. On
  2026-10-20 no such access to a module or `V2` was found in `src` or `tests`; the namespace imports in tests
  (`import * as`) write each name they read in full, in code or in a string (`D[name]` over a written list in
  `tests/dictionary-rules.test.js`).
- Exports used only by tests are allowed on purpose; the check does not tell them apart from the app's interface.
- `known-bugs.md` bug 3 names `buildOppositeDirect` and `safeOppositeDistractor`; they are now internal to
  `questions.js`, so its test will go through `buildQuestion` (or export them again for that test).
