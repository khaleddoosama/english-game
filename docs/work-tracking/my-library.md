# Work tracking: Module My Library

Branch: `ccr-29322d12-v8wkmd` (pushed; no pull request; nothing merged or deployed).
Scope: `src/features/library/`, its tests and docs, and the library part of
`supabase/`. Other modules are only read, except where a batch says otherwise.

## Done before this tracking file existed (earlier batches, same branch)

| Commit | What | Verified by |
| --- | --- | --- |
| `b65c0ee` | unit tests for rounds from a view: options, scope, rotation, grading, mastery, content input | `npm test` |
| `f796d20`..`d5e06da` | four defects: pasted list repeats, local own-word length, content check crash on empty entry, typed question showing the answer (test first, fix after) | `npm test` |
| `f4b058d` | rule -> test list `docs/library-unit-test-matrix.md` | review |
| `feb7a38` | integration tests as anon / authenticated against real PostgreSQL | `supabase/ci/run-integration.sh` |
| `e30b4d7` | migration 0037: a renamed word keeps its sense | SQL test + integration |
| `f1835ed` | migration 0038: deleting a player who used the library | SQL test + integration |
| `50e98e3` | integration docs, CI step | local run; the CI step itself was **not** run on GitHub |

## Batches in this conversation

| # | Commit | What | Result |
| --- | --- | --- | --- |
| 1 | `0f77ea8` | `docs/modules/my-library.md` (now `docs/modules/library/README.md`) and this file. No module document or architecture document existed (only `README.md`); no prompt files exist in the repository, so the work follows the written request | docs only |
| 2 | test commit, then fix commit (`git log --oneline`, subjects "Test: edges of the My Library module…" and "Local library API: stop exposing the internal edit helper") | `tests/library-boundary.test.js`: who imports the module, what it imports, the two API implementations offer the same calls. It found the local mirror leaking an internal `edit` helper; removed (not part of the documented API, unused) | test red before the fix, green after |
| 3 | "Test: hooks of the My Library module…" | `tests/library-hooks.test.jsx`: `useLibrary` (not enabled, online ready/off in four ways, refreshIds, local mode, one library per player) and `useViews` (tree, open view, key mapping, `act` success/failure, load failures). 17 tests; 4 deliberate breakages of the hooks were each caught | green |
| 4 | `48b70e2` | tracking and module doc updated with the checks below | docs |

Checked after batch 3 (branch head):

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx vitest run` | 54 files passed, 9 skipped; 599 tests passed, 74 skipped (the skipped ones need `PGURL`) |
| `npm run e2e -- lib grammar-lib homeviews catalog nested sweep` | 11 of 11 browser specs passed (local mode) |
| `supabase/ci/run-integration.sh`, `supabase/ci/run-tests.sh`, `library-contract`, `library-differential` | passed at `50e98e3` on a throwaway local PostgreSQL 16; **not rerun** in this conversation because nothing in `supabase/` or the API files they cover changed (the one source change, in `local/localViewsApi.js`, is covered by the unit tests above) |

## Refactoring step (second conversation): the module becomes a model

Goal: separate view / orchestration / rules / data access, give My Library one
public file, remove import loops through it, pin behaviour first, keep data
contracts. Pattern, assessment and plan for the other modules:
`docs/architecture/modules.md`.

| # | Commit subject | What | Kind |
| --- | --- | --- | --- |
| 5 | "E2E: characterise how the app shell uses the library" | `e2e/specs/libshell.cjs` (16 checks) green on the **old** code | test before the move |
| 6 | "Test: behaviour of the library glue before it moves…" | `tests/library-orchestration.test.jsx` written from the old inline behaviour; red until 7 | test before the move |
| 7 | "Add the library's glue pieces and its public index" | `libraryHome.js`, `viewRound.js`, `ownWords.js`, `libraryActions.js`, `useLibraryHome.js`, `LibraryRoutes.jsx`, `index.js` | refactor (new code, unused yet) |
| 8 | "Library: open the library in one function, reuse scopeOfView, move the page's changes…" | `openLibrary.js`; `useViewScope` and `LibraryPage` use the new pieces | refactor |
| 9 | "App shell: use the library through its public index" | `WordHunter.jsx` and `LiveChallenge.jsx` import `features/library` only; inline glue deleted | refactor |
| 10 | "Library no longer imports the friends module…" | `useLibrary({ people })`; `tests/architecture.test.js` + `tests/importGraph.js` | refactor (removes a loop) |
| 11 | this commit | `docs/architecture/modules.md`, module doc, README layout, this file | docs |

Fixes kept apart: the only behaviour-visible change is none. Two small
non-behaviour cleanups sit in refactor commits and are named there: the local
API no longer exposes an internal `edit` helper (commit before these, batch 2),
and `useLibrary` takes `people` instead of importing the friends module.

### Verified (branch head, this conversation)

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx vitest run` | 56 files passed, 9 skipped; 632 tests passed, 74 skipped (need `PGURL`) |
| `npx vite build` then `npm run e2e` (all) | 14 of 14 browser specs passed, on a **rebuilt** `dist/` (note: `npm run e2e` reuses an existing `dist/`) |
| Chunks | `LibraryPage`, `JoinPage`, `CatalogPage`, `MyViewsHome` still separate chunks; main chunk +2 kB |
| Not rerun | `supabase/` SQL tests, `library-contract`, `library-differential`, `tests/integration`: no file in `supabase/` or the API files they cover changed in this step (they last passed at `50e98e3`) |

### Not tested

- The real Supabase stack, production data, the Vercel routes, the CI job on GitHub (unchanged from before).
- `repo.js` and the rest of `WordHunter.jsx` were assessed, not changed.
- The `people` injection online: it is only used in local mode; online the argument is ignored.
- `LibraryRoutes` with real pages is covered for the link page and the catalog (text), and by the browser specs for all three screens.

### Decisions for the owner

- Three import loops remain outside this module (listed in `docs/architecture/modules.md` and enforced by `tests/architecture.test.js`). Which to fix first?
- Next module to extract: the plan proposes splitting `repo.js` first, then question reports.
- The earlier open decisions (offers from a former friend, quiet no-ops, merging a rename, deleted senses in `view_contents`, a one-word new view) are unchanged.

## Step 3 (third conversation): loop, repo split, four decisions, migration review

Owner's decisions: fix loop (a); split `repo.js` gradually; four behaviour decisions (A-D); review 0037/0038
(and the new 0039/0040). Refactoring and fixes are in separate commits.

| Group | Commits (subjects) | Kind |
| --- | --- | --- |
| Loop `engine/ai` <-> `engine/questions` | "Engine: normalizeAnswerText moves to engine/text.js…" | refactor; guard now expects no file loops |
| Pin repo saving before the split | "Test: how the repo saves progress when the network fails…" (15 tests) | tests |
| repo.js split | "…move the pure parts into src/lib/repo/", "…content state and reports state move into their own stores", "…local-mode repo moves…" | refactor (556 -> 289 lines) |
| Defect found by the close-page scenario | "Test (red): a save the server received but the device never heard back…", "Fix: progress saved by the server but not acknowledged is no longer counted twice…", "Integration test: the lost-answer save…" | fix (separate) |
| Decision C (rename into an existing name) | "Test (red)…", "Rename a word: the app refuses…", "Migration 0039…" | tests, app, migration |
| Decision D (one new word) | "Test (red)…", "Engine: a round whose only candidate is the word just introduced asks it once…" | test, fix |
| Decision B (not-mine view) | "Tests: removing a view that is not mine…" | tests only (behaviour already right) |
| Decision A (offers after the friendship) | "Test (red)…", "Migration 0040…" | tests, migration, local mirror |
| Migration review and rollback | "Upgrade check for migrations 0037-0040…", `docs/migrations/review-0037-0042.md`, `supabase/rollback/0037_0042_down.sql` | docs, scripts |

### Verified (step 3, kept for history)

Superseded by step 4 below (tested commit `d04e2e9`).

## Step 4 (fourth conversation): idempotent saves, rename step closed, browser tests, upgrade check in CI, real stack

| Request | What was done | Evidence |
| --- | --- | --- |
| 1 Save applied once | Red tests first (`tests/integration/progress-ops.test.js`: 230 instead of 180), migration 0042 (`progress_ops`, `p_op`), client keeps the id until answered and across a closed page, fallback for a database without ids, fake database extended; `tests/repo-save-ops.test.js` | integration 92 pass; unit 730 pass; real stack 11 pass; real-tab spec fails on the old repo (mutation) |
| 2 `apply_item_renames` | Privileges inspected: executable by `authenticated`, an admin could bypass 0039. Red test, migration 0041 (revoke). Direct tests as admin, player, visitor, and through PostgREST | `content-rename.test.js`, `tests/realstack` |
| 3 Browser tests | `e2e/specs/libsolo.cjs` (one new word: introduce, one valid question, saved, not Mastered, same after closing the tab), `wordrename.cjs` (refusal, nothing changed, control rename), `saveclose.cjs` (real tab close, real IndexedDB, repo bundled for the browser, real PostgreSQL) | `npm run e2e`; what each proves and does not: the specs' header comments and the review |
| 4 Friendship removed then restored before the inbox | Server test (already right: `friend_remove` ends the offers) and a **local mirror fix**: an offer carries a friendship stamp; one made before the stamp stays valid while friends (found by `libshare.cjs`) | `tests/library.test.js`, `tests/integration/sharing.test.js` |
| 5 Upgrade check in CI | `check-upgrade.sh` runs in the `database` job; it now covers 0037-0042 and compares the **whole schema** (functions with source hash and execute privileges, tables with RLS and privileges, columns, constraints, indexes, policies, triggers) before vs after rollback, and after rolling forward again. Rollback file is `0037_0042_down.sql`. Read-only `preflight-compare.sh` for a real database | local run passes; a rollback missing one grant is caught; the CI result is in the final report |
| 6 Real stack | Supabase's Postgres 15.8 + GoTrue + PostgREST (Docker Hub images; the CLI could not pull its own), supabase-js, sign-in through GoTrue. `tests/realstack/` | 11 pass; real PostgREST confirmed `PGRST202` for an unknown argument and 409 for `23505` |

Found on the way: the migrations need `realtime.messages` and storage bucket columns that the Realtime and
Storage services create (stood in by hand in `tests/realstack/up.sh`); in local mode a successful word rename
does not move the word inside the player's views (online it does, 0037) - a known gap of the local mirror, not changed;
`nextReviewAt` 0 becomes null when progress is loaded (same meaning).

### Verified (tested commit `d04e2e9`)

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx vitest run` | 64 files passed, 11 skipped; 730 tests passed, 112 skipped |
| `supabase/ci/run-tests.sh` (26 SQL test files) | all ok |
| `supabase/ci/run-integration.sh` | 92 passed |
| `supabase/ci/check-upgrade.sh` | passed (data checks, whole-schema rollback identity, forward again) |
| `npx vite build` + `npm run e2e` with `PGURL` | all specs ok (see the final report for the count) |
| `tests/realstack` on the local real stack | 11 passed |

### Not tested

- Any real Supabase project or production data (none was touched). `preflight-compare.sh` was never run on one.
- The app's screens against the real stack (only the repo and the SQL functions were).
- Realtime and Storage; the Vercel routes.
- Two tabs of one profile saving at once; an operation older than 90 days.
- The progress engine inside `repo.js` is still one piece (`docs/architecture/repo.md`).

### Migrations 0037-0042: applied to production on 2026-10-18

The record (backup, comparison, checks after, what was found) is the last section of
`docs/migrations/review-0037-0042.md`. Read that document first. Order, effects, compatibility (old and new clients), rollback, the
comparison to run on the real database first, and what was not verified are there.
Deferred on purpose: the repair of old renamed words (`docs/migrations/diagnosis-renamed-words.md`, diagnosis and plan
only), the two remaining module cycles, and new modules.

### To continue

1. Read `CLAUDE.md`, `docs/architecture/modules.md`, `docs/architecture/repo.md`, `docs/modules/library/README.md`, this file.
2. `git status` clean, `npm run lint && npx vitest run`. Database tests need any PostgreSQL 15+:
   `PGADMIN=<url> supabase/ci/run-integration.sh`, `PGURL=<empty db> supabase/ci/run-tests.sh`, `PGADMIN=<url> supabase/ci/check-upgrade.sh`.
   The real stack: `tests/realstack/up.sh` then the commands in `docs/integration-tests.md`.
3. Open items, in the owner's hands (the six migrations are applied, 2026-10-18; `preflight-compare.sh` was fixed
   afterwards to compare the functions, see the review): the module cycles `engine/media/lib` and `social/live`; the repair of old renames; merging two
   words (a feature with a preview); the next modules in the plan (question reports, content administration…).

## Not done / left on purpose

- **Folders of the module were not reshuffled** (the layers are named in the
  architecture document instead of being separate folders; moving files would only
  change import paths). The structure change is in who may import what.
- **Open product decisions** (module document, "Known differences"): offers from
  a former friend (server lists and refuses; local mirror hides), quiet no-ops
  for what is not yours, merging a rename into an existing name, deleted senses
  in `view_contents`, a one-word new view having no question. None was changed.
- **Not tested at all:** the real Supabase stack (GoTrue, PostgREST, Realtime),
  the Vercel API routes, the CI `database` job as run by GitHub, behaviour on
  production data. See `docs/integration-tests.md`.
- **Not tested directly as units:** the presentational pieces in `components/`
  (covered through `LibraryPage`, `MyViewsHome` and the browser specs).
- **Migrations 0037 and 0038** were tested on throwaway databases only when this was written;
  they are now applied to production (2026-10-18, see the review document).

## To continue in a new conversation

1. Read `CLAUDE.md`, `docs/modules/library/README.md`, this file.
2. `git log --oneline -15` on `ccr-29322d12-v8wkmd`; `git status` must be clean.
3. Run `npm run lint && npx vitest run`. For the database tests start any
   PostgreSQL 15+ and run `PGADMIN=<url> supabase/ci/run-integration.sh`
   (details: `docs/integration-tests.md`).
4. Pick from "Not done". Anything that changes a shared contract
   (`libraryApi.js` calls, a migration, `homeState`, `repo.js`) needs the owner's say first.

## Refactor batch: question reports (branch `refactor/question-reports`, from `cb2fb57`)

Separate branch and worktree from the work above; nothing of the earlier branch was changed. Scope: question reports and
their wiring in `WordHunter.jsx` only (no engine, no repo, no migration, no product rule).

| Step | Commit (subject) |
| --- | --- |
| pure rules moved unchanged | "Reports: the pure rules move out of the app shell unchanged…" |
| state and operations into the hook, shell wired | "Reports: the report state and operations move into useQuestionReports…" |
| tests (rules, hook, boundary) | "Tests: question reports…" |
| browser test | "Browser test: file a report in a round…" |

Documentation: `docs/modules/question-reports.md` (responsibility, interface, dependencies, tests, old problems).
`WordHunter.jsx`: 2131 -> 2065 lines. Old problems found are listed in the module document, not fixed.

### Verification of the question-reports batch (tested commit `9d3e557`)

CI run: https://github.com/khaleddoosama/english-game/actions/runs/38926062071 (branch `refactor/question-reports`): jobs `app`, `e2e`, `database` all succeeded.

| Check | Passed | Skipped | Failed |
| --- | --- | --- | --- |
| `npx vitest run` (local) | 758 tests, 66 files | 112 tests, 11 files (need a database or a browser) | 0 |
| Browser specs, local | 17 specs | 1 (`saveclose.cjs`: needs `PGURL`) | 0 |
| Browser specs, CI job `e2e` | 17 specs | 1 (`saveclose.cjs`, same reason) | 0 |
| CI job `database` | step `saveclose.cjs` ran with `PGURL` and exited 0; I did not read its 9 check lines | none | 0 |

`saveclose.cjs` was **not run locally** in this batch and is not counted as passed there; its result is the CI step above (and from the earlier batch, 9 checks on commit `d04e2e9`).
Unit-test counts in CI were not read (the `app` job succeeded); the counts above are the local ones.
