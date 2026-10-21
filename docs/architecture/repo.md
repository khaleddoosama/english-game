# The repo layer (`src/lib/repo.js` and `src/lib/repo/`)

`createSupabaseRepo({ userId, isAdmin, client })` is what the app uses to load and save
content and progress. Its outside is unchanged by the split below: `mode`, `status`,
`loadContent`, `saveContent`, `loadProgress`, `saveProgress`, `refreshProgress`, `onMerged`,
`resetProgress`, `wipeContent`, `dispose`; and the exports `CONTENT_KINDS`, `weekStart`,
`stableJson`, `createLocalRepo` (`_internals`, which nothing read, was removed on 2026-10-20).

## Where things are now (556 -> 289 lines in `repo.js`)

| File | Owns | Pure? |
| --- | --- | --- |
| `repo.js` | the **progress engine** and the composition of the repo | no (state below) |
| `repo/contentStore.js` | content: `load`, `save`, what the server is known to hold, the content version | state of its own |
| `repo/reportsSync.js` | the player's reports and, for the admin, others': what the reports table is known to hold | state of its own |
| `repo/contentPlan.js` | what a content save must send (positions with gaps, removals, level order and note) | pure |
| `repo/progressShape.js` | which field goes in which saved section, mastery diff, week start, profile summary | pure |
| `repo/unsyncedMerge.js` | a device copy that never reached the server, against the server | pure |
| `repo/reportsMerge.js` | the player's reports against the reports table | pure |
| `repo/fetchAll.js` | read every row, a page at a time | pure |
| `repo/status.js` | the "saving / saved / offline / error" status | small state |
| `repo/localRepo.js` | the repo for local mode (IndexedDB only) | its own |

## Shared state: what is where, and why the progress engine stayed together

Everything below lives in the one closure of `createSupabaseRepo`, so a repo has exactly one
copy of each. Splitting a function away without its state would create a second copy.

| State | Written by | Read by | Home now |
| --- | --- | --- | --- |
| content rows, content meta, content version | content load, content save | content save | `contentStore` (only it touches them) |
| saved reports, saved remote reports | reports reconcile on load, reports sync on save | the "is there anything to send" check, sync | `reportsSync` (only it touches them) |
| saved sections (JSON), saved revisions | load, push (after a save and after a conflict), refresh | push (what changed, what revision to expect), refresh, merge of an unsent copy, snapshot base | `repo.js` |
| saved mastery (JSON and references), mastery watermark | load, push, refresh | push (diff), refresh | `repo.js` |
| saved profile summary | load, push | push | `repo.js` |
| last local state (`lastLocal`) | save, load, merge, refresh | refresh, merge on conflict | `repo.js` |
| the save queue (`latest`, `running`), the retry timer, the local revision (`localRev`) | `saveProgress`, `flush`, `resetProgress`, `dispose` | `flush`, `refreshProgress`, `resetProgress` | `repo.js` |
| the snapshot queue (`idbQueue`) | `saveProgress`, `flush`, `resetProgress` | itself (a promise chain) | `repo.js` |
| merged-listeners | `onMerged` | `notifyMerged` after a conflict or a refresh | `repo.js` |
| the status | `flush`, `loadProgress` | the app | `createStatusHub()` instance made in `repo.js` |

The progress engine (load, push, refresh, flush, reset) reads and writes the same
sections/mastery/queue state in every function, and relies on their order (for example
`resetProgress` waits for the running save, then clears all of it). Moving any one of them to
another file would mean passing that whole state around or sharing a mutable object, which
is exactly how a second, diverging copy gets made. So it stays one unit. Its **pure** parts
(diff, merge, split) are out already; a further split would first need that state to become one
explicit object, which is the next step if it is wanted.

Two quirks kept as they were (they are behaviour, not part of the split):

- `resetProgress` clears the saved sections/mastery/profile and the snapshot but not the
  saved reports maps.
- The saved reports of a player are filled by `reconcile` on every load, never cleared.

## Tests that guard it

| Scenario | Test |
| --- | --- |
| save, resend only what changed, reload | `tests/repo.test.js` |
| network failure, retry after 15 s, `online` event, coalescing, dispose, closing the page during a save, offline start, refresh, reset | `tests/repo-saving.test.js` |
| two devices, merge rules, F01/F02/F03/F07/F08 of the review | `tests/review-audit.test.js` |
| the pure parts | `tests/repo-parts.test.js` |
| the two stores | `tests/repo-stores.test.js` |
| operation ids: kept across retries and a closed page, fallback for a database without them | `tests/repo-save-ops.test.js` |
| the same against real PostgreSQL | `tests/integration/progress-devices.test.js`, `progress-ops.test.js`, `content-rename.test.js` |
| a real Chromium tab closed during a save (real IndexedDB, repo bundled) | `e2e/specs/saveclose.cjs` (needs `PGURL`) |
| supabase-js, GoTrue, PostgREST | `tests/realstack/batch.test.js` |

Not tested: `navigator.onLine` in a real browser, storage-full on IndexedDB
beyond what `repo.test.js` and `review-audit.test.js` cover, and two tabs of one device sharing one
IndexedDB (each repo here has its own mock store).

## A defect found while testing, and fixed on its own

A save that the database received but whose answer never came back (connection lost, page closed)
was added a second time when the device came back: the unsent copy was merged as if the server did
not have it, so counters (score, attempted, daily totals) went up twice (150 became 200). Fixed in
`unsyncedMerge.js`: a section the server already holds exactly as the device copy has it is kept as is.
That guard covered only the case where nobody else saved meanwhile. The general case (another device saved on
top before the resend) is closed by operation ids (migration 0042):

- `src/lib/repo/saveOps.js` (pure): `newOpId`, `lacksOpSupport` (`PGRST202` / `42883`: the database does not know ids),
  `wasNotApplied` (an error with a database code means rolled back), `baseAfter`.
- State in `repo.js` (kept together with the rest of the engine): `inflight` = `{op, args}` of the unanswered save, `opsSupported`.
  `pushProgress` first resolves `inflight` (same args, same id), then diffs and sends a new save with a new id,
  writing the snapshot (with `inflight`) **before** sending. `loadProgress` resolves the snapshot's `inflight` first and rewrites the
  snapshot base as if that save had been applied, so `mergeUnsynced` adds nothing twice.
- Snapshot shape: `{data, dirty, rev, at, base, inflight?}`; `inflight` is absent when nothing is unanswered.
- Behaviour change: while a save has no answer, the 15-second retry is that same save; the newest state follows it.
  Limits and compatibility: `docs/migrations/review-0037-0042.md`, "0042".
