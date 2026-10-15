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
| 1 | `0f77ea8` | `docs/modules/my-library.md` and this file. No module document or architecture document existed (only `README.md`); no prompt files exist in the repository, so the work follows the written request | docs only |
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
- **Migrations 0037 and 0038** are written and tested on throwaway databases only;
  they need your review before any deployment.

## To continue in a new conversation

1. Read `CLAUDE.md`, `docs/modules/my-library.md`, this file.
2. `git log --oneline -15` on `ccr-29322d12-v8wkmd`; `git status` must be clean.
3. Run `npm run lint && npx vitest run`. For the database tests start any
   PostgreSQL 15+ and run `PGADMIN=<url> supabase/ci/run-integration.sh`
   (details: `docs/integration-tests.md`).
4. Pick from "Not done". Anything that changes a shared contract
   (`libraryApi.js` calls, a migration, `homeState`, `repo.js`) needs the owner's say first.
