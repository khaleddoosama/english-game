# How Word Hunter is divided into modules

Status: pattern proven on one module, **My Library** (`docs/modules/library/README.md`).
The rest of the app follows the plan at the end. Written from the code on branch
`ccr-29322d12-v8wkmd`; the numbers are from that day.

Practice selection now has a [current-code guide](../modules/learning-engine/practice-selection.md)
and a [work record](../work-tracking/practice-baseline.md). Its word-question
selection loop is now a private helper inside `v2.js`; the public API is unchanged.

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

Since then (2026-10-18) the reports, content admin, import/export, Ask AI and story clusters moved out and the old
round engine was removed (`MT-03`), then pool and variant generation moved out; the file is 1,027 lines. After that removal these engine exports may have no
caller outside the engine: `buildEntryQuestion`, `entryFileMeta`, `uniqueStrings` (questions), `buildContrastiveFeedback`,
`containsRequiredTerm`, `spellingDistanceInfo` (ai), `deriveLearningInsights` (progress), `setLastChallengeId`,
`PRODUCTION_MODES`, `MASTERY_STAGE_RANK`, `getStarsForAccuracy`, `formatAccuracy` (data). Checked on 2026-10-19 (with
`MT-02` step 2): `buildEntryQuestion` and `uniqueStrings` are used inside `questions.js` and stay; `entryFileMeta`,
`buildContrastiveFeedback` and, with them, `semanticRelation`, `isStrictIdiom`, `challengeProgressEligible`,
`challengeValidationIssues`, `buildAdaptiveRound`, `buildRound` and `SPEED_MODES` had no caller at all and were
removed. **Not removed yet** (no caller outside their own file; they do not read the content): `containsRequiredTerm`,
`spellingDistanceInfo`, `deriveLearningInsights`, `setLastChallengeId` / `LAST_CHALLENGE_ID`, `PRODUCTION_MODES`,
`MASTERY_STAGE_RANK`, `getStarsForAccuracy`, `formatAccuracy` (follow-up).

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

## Practice question selection

Moved to the learning-engine module: [modules/learning-engine/practice-selection.md](../modules/learning-engine/practice-selection.md).

## Plan for the other modules

Order is by how self-contained the cluster is and how well it is covered.

| # | Module | Why this order | First step |
| --- | --- | --- | --- |
| 1 | `repo` split into content / progress / reports (**done** except the progress engine, see `repo.md`) | Biggest single file under the shell, best test net (unit + real database) | extract the pure parts of `progress` and `reports`, keep the same exported repo object |
| 2 | Question reports (**done**: `docs/modules/practice/question-reports.md`) | Self-contained handlers, one data shape | `features/reports`: pure rules + `useQuestionReports`; the shell passes the same props to Admin and the round |
| 3 | Content administration (**done**: `docs/modules/admin/content-admin.md`) | Touches content and mastery; has the rename path now covered by integration tests | `features/content-admin`: pure rules + `useContentAdmin`; the shell passes the same props to Admin and the round |
| 4 | Import / export orchestration (**done**: `docs/modules/admin/import-export.md`) | `features/data` already had `transfer.js` (pure) | `features/data`: `importPlan.js` (pure) + `useDataTransfer`; the shell passes the same `dataTools` and Profile props |
| 5 | AI helpers (**done**: `docs/modules/ai-media/ask-ai.md`, `story-generation.md`, `pool-generation.md`; the old round engine it was mixed with is removed, `MT-03`) | Many epochs/refs; needs care with cancellation | `features/ai-helpers`: pure rules + one hook per helper (`useAskAi`, `useStoryGeneration`, `useAiGeneration`); the shell passes the same props to the round, My Library and question reports |
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
- loop `engine` <-> `lib` (`lib` imports the engine, and the engine imports `lib`); the media part is fixed: since `MT-02` the picture check (`checkImageLinks`) is called by the content module, so the engine imports no feature
- loop `features/social` <-> `features/live`

## What was not verified

- A real Supabase project. Local mode (browser specs), a throwaway PostgreSQL (integration) and a local stack of Supabase's own images (GoTrue, PostgREST, Postgres 15; `tests/realstack`) were run; the app's screens were not run against that stack.
- Bundle behaviour in production beyond `vite build` chunk sizes.
