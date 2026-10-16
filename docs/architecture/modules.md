# How Word Hunter is divided into modules

Status: pattern proven on one module, **My Library** (`docs/modules/my-library.md`).
The rest of the app follows the plan at the end. Written from the code on branch
`ccr-29322d12-v8wkmd`; the numbers are from that day.

Practice selection now has a [current-code guide](#practice-question-selection-current-code)
and a [behavior baseline](../work-tracking/practice-baseline.md). Only tests
and documentation are complete for that slice; no Practice extraction has happened.

## The problem this solves

`src/app/WordHunter.jsx` is one component of ~2100 lines with 78 `useState`,
21 `useEffect` and 24 `useRef`. It shows screens, runs operations (start a
round, save, import, ask the AI), holds business rules and calls data access, all
in one scope. `src/lib/repo.js` (556 lines) is one closure that holds content
loading and saving, progress saving and merging, report syncing and the
"saving…" status. A change anywhere risks everything, and nothing can be tested
without the whole app.

## The pattern (four layers, one front door)

A module is a folder `src/features/<name>/`. Inside it, code belongs to one of
four layers, and may use only the layers below it:

| Layer | What it is | In My Library |
| --- | --- | --- |
| **View** | React components: draw state, send events. No data calls, no rules. | `LibraryPage.jsx`, `CatalogPage.jsx`, `JoinPage.jsx`, `LibraryRoutes.jsx`, `components/*` |
| **Orchestration** | Hooks and functions that run an operation: call the data layer, apply rules, decide what to tell the player, reload. React only where state is needed. | `useLibrary`, `useLibraryHome`, `useViews`, `useViewScope`, `openLibrary.js`, `libraryActions.js`, `viewRound.js`, `ownWords.js` |
| **Rules** | Pure functions and constants: no React, no I/O. Testable with plain inputs. | `libraryRules.js`, `libraryTree.js`, `libraryHome.js`, `scope.js`, `libraryIds.js` (mapping part) |
| **Data access** | The only place that talks to the server or storage, behind one interface with a test double. | `libraryApi.js` with `onlineLibraryApi.js` and `local/*` |

Rules of the pattern:

1. **One public file.** `index.js` lists what other modules may import, with a
   comment each. Nothing else in the folder may be imported from outside.
   Lazy screens are exported as components (`LibraryRoutes`, `MyViewsHome`) so the
   code-splitting stays (`lazy(() => import(...))` lives inside the module).
2. **The shell composes, it does not decide.** `WordHunter.jsx` places a module's
   components and passes it data and callbacks. What a module needs to work out
   (counts, keys, which screen, what to say) is the module's.
3. **A module does not import another module's internals, and does not import a
   module that imports it.** If it needs something from another module, the app
   passes it in (as `useLibrary({ people })` does for local friends), or it moves
   to `lib/` / `engine/` after it is proven to be used by two or more modules.
4. **`shared` is not a folder to start.** There is no `shared/`. Something moves
   to `src/lib` (infrastructure) or `src/engine` (game logic) only when two modules
   already use it. Nothing was moved there in this step.
5. **Data contracts do not change in a refactoring step.** Database functions,
   the library API, stored shapes and the shape of `library`
   (`{ status, api, ids, refreshIds }`) are the same before and after. A defect
   found on the way is fixed in its own commit, with its own test.
6. **Behaviour is pinned before it moves**: a browser spec and/or unit tests that
   pass on the old code, then the move, then the same tests.

## Guards (tests that keep the pattern)

| Test | Keeps |
| --- | --- |
| `tests/library-boundary.test.js` | who imports the module (only the shell and Live, only `features/library`), what the module imports, parity of its two API implementations |
| `tests/architecture.test.js` | no new loops between files or between modules; the library in none; the engine below the features. Known loops are listed and the test fails when one is fixed too, so the list only gets shorter |
| `tests/importGraph.js` | the helper both use |

## How to extract the next module (checklist)

1. List what the shell does for the area (search the area's words in `WordHunter.jsx`; note state, effects, handlers, JSX).
2. Pin it: add a browser spec (`e2e/specs/`) or unit tests that pass **now**.
3. Name the public surface (`index.js`): hooks and components the shell needs, nothing else.
4. Move rules out first (pure functions + tests), then operations (hooks/functions + tests), then screens.
5. Switch the shell to `index.js` in one commit; delete the inline code in the same commit.
6. Update the boundary test's expected imports and the module document; rebuild and run the specs (`npm run e2e` reuses an existing `dist/`: run `npx vite build` first).
7. Dependencies on other modules: inject, do not import.

## What was done for My Library

| Before | After |
| --- | --- |
| The shell held the offers count, the player's keys and biggest views for Home, the "limit Home to my library" rule, the lookup of a view's words for a round, the call that keeps a new word in the library, and the three screens with their "loading / not available" fallbacks | `useLibraryHome`, `homeLimits`, `scopeOfView`, `keepInLibrary`, `LibraryRoutes`, all behind `features/library/index.js`; the shell calls them |
| `LibraryPage` built each change and its sentence inside button props | `libraryActions.js` (pure, tested); the page only runs them |
| `useLibrary` decided what "ready/off" means inside an effect | `openLibrary()` (no React); the hook keeps the state |
| `useViewScope` and the shell each turned view rows into a scope | one function, `scopeOfView` |
| Local mirror exposed an internal helper (`edit`) | removed |
| `useLibrary` imported the friends module (loop library -> social -> live -> library) | friends are passed in (`people`) |
| Other modules imported five different files of the module | two importers, one file |

Shell size: 2155 -> 2125 lines for this slice (the slice was small: most of the
shell is other areas). Main chunk +2 kB (logic moved in); the three screens and
`MyViewsHome` are still their own chunks.

## Assessment of the rest

### `WordHunter.jsx` (about 2100 lines)

Clusters found by function name (line numbers approximate, from the day of writing):

| Cluster | Where | Mixed with |
| --- | --- | --- |
| Question reports: review, resolve, reopen, delete, retire a variant | 400-460 | progress extras, the repo |
| Admin content edits: rename word, update fields, merge categories, remove empty levels, delete category, progress migration after a rename | 440-570 | content state, mastery |
| AI helpers: story generation, pool/variant generation, "Ask AI" and adding its word | 85-150, 575-640, 720-810 | custom content, toasts |
| Progress state and saving: apply loaded data, debounced saves, study day, results | 280-400, 810-900 | everything |
| Practice and session flow: start level/course/view/weak review, answer handlers, finishing a round | 1000-1500 | AI checks, progress |
| Import, export, backup, reset, wipe | 1500-1620 | content state |
| Home and screen composition (JSX) | 1700-2125 | all of the above through closure |

### `repo.js` (556 lines, one closure)

| Concern | Today | Direction |
| --- | --- | --- |
| Content load/save (cache, positions, drafts, renames) | `loadContent`, `saveContent` | `repo/content.js` |
| Progress save/merge (revisions, conflicts, snapshot, refresh) | `pushProgress`, `refreshProgress`, `mergeUnsynced`, `flush` | `repo/progress.js`; `masteryDiff`, `splitSections` and the merge are already pure |
| Reports sync | `syncReports`, `reconcileReports` | `repo/reports.js` |
| Status ("saving", "offline") | `statusHub` | small shared piece |
| Local implementation | `createLocalRepo` | `repo/local.js` |

`repo.js` is covered by `tests/repo.test.js`, `tests/repo-saving.test.js`, `tests/review-audit.test.js` (with a
JS fake of the database) and `tests/integration/*` (real PostgreSQL). **Done in part**: the pure parts and the
content and reports stores are out (556 -> 289 lines); the progress engine stayed together on purpose. See
`docs/architecture/repo.md` for the state map and the reason.

## Practice question selection (current code)

This slice builds an offline Practice session: eligible words, question forms,
safe options, question order, grammar slots, and unused questions for later
reinforcement. The current entry point is `V2.practice`, not a new feature module.
Code described here is the `cb2fb57` base; characterization finished at `7104306`.

### Files and responsibilities

| File | Role in this path |
| --- | --- |
| `src/app/WordHunter.jsx` | `startPractice` gathers inputs and adjusts new-word intake from the previous round. `buildPracticeExtra` supplies extra styles; `launchSession` sends the result to the UI. |
| `src/engine/v2.js` | `practice` chooses and arranges candidates; `makeQuestion` builds basic word questions, `optionWords` chooses distractors, grammar builders produce rule questions. `reinforcement` consumes reserves later. |
| `src/engine/questions.js` | Extra-style factories such as Who Am I, Opposites and paired questions; `legacyQuestionToV2` adapts their output to the session contract. `buildRound`/`buildAdaptiveRound` are not called by the current Practice start path. |
| `src/engine/data.js` | Mutable shared content (`WORDS`, `GRAMMAR`, `CHALLENGES`), level groups and mode metadata used by the shell and older factories. |
| `src/engine/text.js` | Text normalization used by extra-question safety checks; no imports. |
| `src/features/session/SessionView.jsx` | Shows introductions, then `session.queue[session.index]`; `AnswerControl` renders the answer type. Offers reinforcement through the existing engine interface. |

### Interface used by callers

Import `{ V2 }` from `src/engine/v2.js` and call:

```js
V2.practice(content, mastery = {}, category = null,
  rng = Math.random, quarantine = null, opts = {})
```

| Input | Meaning |
| --- | --- |
| `content` | Already loaded runtime content: required `words` array; optional `grammar`, `combos`, `challenges`. Not a raw import file. |
| `mastery` | Current learning records keyed by exact word text or prefixed activity key, e.g. `grammar:<id>`. Read for selection; not persisted here. |
| `category` | Optional lesson filter, compared using existing topic normalization. |
| `rng` | Function returning a draw in `[0, 1)`; used for shuffles, ties and session ID. |
| `quarantine` | Optional Set of `lowercase-trimmed-word|mode` keys excluded from candidate generation. |
| `opts` scope | `scope: { words: Set, rules: Set }`, `unit`, `subCategory`, `noGroup`, `courseLevel`, `noCourseLevel` narrow the requested content. Distractors still use the full `content.words`. |
| `opts` session/context | `questionsPerRound`, `newWordsPerRound`, `title`; `pools` (existing variants), `seen` (normalized sentences to timestamps), `confusions` (word-pair records). |
| `opts.extraQuestion` | Optional `(word, stage, rng) => question \| null` callback. Called for eligible known words outside the production gate. Uses the same question contract as the built-in factories. |

The synchronous result is a session containing `kind: 'practice'`, `id`,
`title`, `queue`, `introductions`, `index: 0`, `answers: []`, `initialLength`,
`targetLength`, `reserves`, and `extraAdded: false`. The requested length is a
target, not a guarantee; an empty or short queue is valid current output.
Questions carry `id`, `mode`, `type`, `prompt`, `answers`, and `targets`;
choice questions also carry `options`. Optional metadata includes `difficulty`,
`explanation`, `hints`, pool identifiers, grammar `progressKey`, and
`initialTraining` for the opening fallback. Preserve these shapes and keys.

Example using already loaded content and state (no fetch or generation call):

```js
const session = V2.practice(content, mastery, null, rng, quarantine, {
  questionsPerRound: 12,
  newWordsPerRound: 3,
  scope: { words: new Set(["Word0", "Word1"]), rules: new Set() },
  pools, seen, extraQuestion: buildPracticeExtra,
});
const firstQuestion = session.queue[0]; // May be undefined; introductions are separate.
```

`V2.reinforcement(session)` later returns a session with at most two extra
questions for missed targets and `extraAdded: true`; it returns the supplied
session unchanged if already processed or not Practice. It uses reserves in
order and checks recent targets and shown sentences. Reserves are candidates,
not a promise that every item can be appended.

### Request flow and state

1. Home's level/course/items/view handler resolves the scope and calls `startPractice`.
2. The shell reads settings, previous-round results, mastery/pool/confusion refs
   and seen sentences, then calls `V2.practice` with `buildPracticeExtra`.
3. The engine filters content, picks new/known words, chooses modes and builds
   candidates. Extra styles go through the callback and, where needed, the
   factories/adaptor in `questions.js`. Grammar candidates are built separately.
4. The selection loop rejects stale/repeated candidates, prioritizes unused
   targets, balances modes, and leaves unselected candidates in `reserves`.
   Grammar is then inserted and the complete session is returned.
5. `launchSession` sets `activeSession` and the session screen. `SessionView`
   advances its index through that prebuilt queue; it does not generate a fresh
   question on each Continue.

The engine does no network/storage I/O. Its queue, usage counters and sets are
local to the call, but candidate arrays are spliced and an opening candidate
can receive `initialTraining`. Do not assume deep cloning of callback questions
or content objects. `v2.js` also has a shared normalization cache and reads
`Date.now()` for freshness, locks and IDs. Tests must fix both time and RNG.

The shell owns learner state in React state/refs; older factories read mutable
`data.js` exports and some use ambient `Math.random`. `buildPracticeExtra`
also reads pool/seen refs and image eligibility. Thus the whole UI path is not
made deterministic just by passing an RNG to `V2.practice`. The separate
`poolsSnapshotForSession` in `questions.js` serves entry-based sessions such as
Weak Evidence/Final Recall, not this main Practice call.

After building the session, the shell may request fresh text in the background
and update a toast. Saving, AI requests, media checks, Library scope retrieval,
and answer side effects remain outside this slice and behind existing interfaces.

### Where to start a future change

| Intended change | Starting point |
| --- | --- |
| Basic word question wording/shape or distractors | `makeQuestion` / `optionWords` in `v2.js` |
| Extra question style | `buildPracticeExtra` in the shell, then its factory in `questions.js` or `v2.js`; preserve the adapted question shape |
| Word/mode eligibility, ordering, repetition or short-round behavior | `practice` in `v2.js`; the proposed first extraction is only its word-question selection loop |
| Grammar question form / selection | `grammarQuestion` / the grammar selection block in `practice` |
| Follow-up questions after mistakes | `reinforcement` and the reserves contract |

Changing a learning rule is a separate behavior change, not part of the planned
extraction. Scoring, mastery, persistence and UI wiring are unchanged. The known
single-style short-round observation is tracked as **PRACTICE-OBS-01** in the
[work record](../work-tracking/practice-baseline.md#observed-edge-requiring-separate-review);
it has not been classified as a confirmed bug or accepted as intended pedagogy.

### Tests

From the repository root, with dependencies installed from the lockfile:

```sh
npm test -- tests/practice-selection.test.js
```

This is the focused nine-case selection baseline, using synthetic content,
seeded RNG and a frozen Date. The [work record](../work-tracking/practice-baseline.md#execution-record)
lists the broader relevant command and actual before/after results. It includes
scope/options, single-new-word, grammar, senses, course levels and grading tests.
No new UI/E2E coverage was needed because no UI wiring changed; the full engine,
real shell callback and production behavior are not exhaustively covered here.

## Plan for the other modules

Order is by how self-contained the cluster is and how well it is covered.

| # | Module | Why this order | First step |
| --- | --- | --- | --- |
| 1 | `repo` split into content / progress / reports (**done** except the progress engine, see `repo.md`) | Biggest single file under the shell, best test net (unit + real database) | extract the pure parts of `progress` and `reports`, keep the same exported repo object |
| 2 | Question reports | Self-contained handlers, one data shape | pin with `tests/` on `sameReport`, `reconcileReports`; move handlers to `features/reports` |
| 3 | Content administration | Touches content and mastery; has the rename path now covered by integration tests | move `renameWord`, `migrateRenamedProgress`, `mergeCategories`... behind a `useContentAdmin` hook |
| 4 | Import / export orchestration | `features/data` already has `transfer.js` (pure) | move `applyImport`, `exportFile`, backup handlers next to it |
| 5 | AI helpers | Many epochs/refs; needs care with cancellation | pin with the existing `ai-*` tests, then one hook per helper |
| 6 | Progress state | Everything reads it; do after 1 | after `repo/progress` is split |
| 7 | Session/practice flow | Largest, most coupled | last, one answer type at a time |

### File import cycles and module dependency cycles are different things

- A **file import cycle** is `a.js` importing `b.js` which imports `a.js` (through any chain). It can break
  loading order and makes the files impossible to move apart. `tests/architecture.test.js` finds them
  over the real imports. **Today: none.** (The only one, `engine/ai` <-> `engine/questions`, was removed by moving
  `normalizeAnswerText` to `engine/text.js`.)
- A **module dependency cycle** is about folders: module A has a file that imports a file of module B, and B has a
  file that imports a file of A, with no file loop at all. Nothing fails at run time, but A and B can no longer be
  understood or changed one without the other. **Today: two**, listed below. My Library is in none of them.

So "0 file cycles" does not mean "no cycles between modules": the second kind is what the remaining work is about.

Known debts the guards list (outside My Library; module cycles, not file cycles):

- ~~loop `engine/ai` <-> `engine/questions`~~ fixed: `normalizeAnswerText` moved to `engine/text.js`
- loop `engine` <-> `features/media` <-> `lib` (the engine imports the media feature, and `lib` imports the engine)
- loop `features/social` <-> `features/live`

## What was not verified

- A real Supabase project. Local mode (browser specs), a throwaway PostgreSQL (integration) and a local stack of Supabase's own images (GoTrue, PostgREST, Postgres 15; `tests/realstack`) were run; the app's screens were not run against that stack.
- Bundle behaviour in production beyond `vite build` chunk sizes.
