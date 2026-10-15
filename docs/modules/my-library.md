# Module: My Library

Status: documented from the code on branch `ccr-29322d12-v8wkmd` (migrations 0026-0040) (see
`docs/work-tracking/my-library.md` for what was checked and when). Written in
English, like the rest of the project's docs.

## Purpose

A player's own set of words and grammar rules (the **library**), and ways to
pick some of them as **views** (folders that can sit inside each other, up to
4 levels). A view can be practised, shared with a friend, shared by link, or
published in a **catalog**. Progress belongs to the word, never to a view.

User-facing description: `README.md`, section "My library and views".

## Scope

In the module (`src/features/library/`, `src/styles/library.css`):

| Part | Files |
| --- | --- |
| Front door | `index.js` |
| Screens | `LibraryPage.jsx` (`/library`), `CatalogPage.jsx` (`/catalog`), `JoinPage.jsx` (`/join/<token>`), `LibraryRoutes.jsx` (places them), `components/MyViewsHome.jsx` (the "My views" area of Home) |
| Screen pieces | `components/*` (view tree, view panel, word/rule pickers, share panel and inbox, create views) |
| Orchestration | `useLibrary.js` + `openLibrary.js` (is the library on, the API, the id maps), `useLibraryHome.js` (offers, keys, biggest views), `useViews.js` (tree, open view, contents, "run a change"), `useViewScope.js`, `viewRound.js`, `ownWords.js`, `libraryActions.js` (the page's changes and their sentences) |
| Rules (pure) | `libraryRules.js` (limits, messages, `senseFromCard`), `libraryTree.js` (tree, search, pasted lists), `libraryHome.js` (Home's keys, roots, limits), `scope.js` (a view as `{ words, rules }`), `libraryIds.js` (game key <-> server id), `libraryErrors.js` |
| The one interface | `libraryApi.js` with two implementations: `onlineLibraryApi.js` (Supabase functions) and `local/*` (localStorage mirror, for local mode and tests) |
| Database | migrations `0026`-`0040` (library, sync, sharing, links, catalog, rules, rename, delete, rename needs a free name, offers end with the friendship) and `supabase/tests/*.sql` |

Not in the module: the dictionary content itself (`content_items`, admin
editors), the practice engine (`src/engine/v2.js`), progress saving
(`src/lib/repo.js`), friends (`features/social`), Home cards (`features/home`).

## Public surface (what other modules may use)

Everything comes from `src/features/library/index.js`. Nothing else in the
folder may be imported from outside (`tests/library-boundary.test.js`).

| Export | What it is | Used by |
| --- | --- | --- |
| `useLibrary({ enabled, me, knownWord, people })` | the library for this player: `{ status, api, ids, refreshIds }`; `people` = `{ areFriends, nameOf }` for local mode | shell |
| `useLibraryHome({ library, screen })` | offers waiting, the player's keys and biggest views, for Home and Profile | shell |
| `homeLimits({ status, isAdmin, keys })` | is Home cut down to the player's library, or waiting for it | shell |
| `scopeOfView(library, viewId, deep)`, `scopeIsEmpty(scope)` | a view as the scope of a practice round | shell |
| `keepInLibrary(library, card)` | a new word also goes into the library (best effort) | shell |
| `LibraryRoutes` | the `/join`, `/catalog` and `/library` screens, with their fallbacks | shell |
| `MyViewsHome` (lazy) | the "My views" tabs on Home | shell |
| `useMyViews(library)`, `useViewScope(library, viewId)` | my views, and what one holds | Live challenges |

Pattern and layers: `docs/architecture/modules.md`.

The module depends on (outward): `lib/router`, `lib/supabase`, `engine/v2`
(`V2.norm`, `V2.headword`), `features/home/StageCard` and `homeState` (only
`MyViewsHome`, which draws Home cards). No dependency on the friends module: the
app passes who the local friends are. The module is in no import loop
(`tests/architecture.test.js`).

## The API contract (`libraryApi.js`)

All calls return promises; ids are the server's ids (in local mode, the game's
own word and rule keys). The full list is the comment at the top of
`libraryApi.js`. Online, every call is one database function (named in
`onlineLibraryApi.js`) and the function does every check; the app only names
the arguments. Errors are `LibraryError { message, code }` (SQLSTATE).

Both implementations must offer the same calls. `tests/library-boundary.test.js`
checks the names match.

## Data (migrations 0026-0038)

`headwords` and `senses` (a word and its meanings; public ones come from the
course through `dictionary_sync`, private ones belong to a player),
`sense_links`, `grammar_rules` and `grammar_questions`, `collections` (views;
official course ones have no owner), `collection_senses`, `collection_rules`,
`library_entries` and `library_rules` (what a player has), `sense_progress` and
`rule_progress`, `collection_shares`, `view_links` and `view_link_takes`,
`catalog_entries` and `catalog_takes`. Every table has row-level security;
players read their own and the public course, and write only through the
`security definer` functions. Nothing is physically removed by the app, only
flagged (`removed_at`, `deleted_at`), except where a migration says otherwise.

The game still keys words by their text. `senses.legacy_key` holds that text, and
`libraryIds.js` maps key <-> id. A word of the player's own has no legacy key;
its key is `Headword` or `Headword (label)`.

## Rules (the same on both sides: `libraryRules.js`)

| Rule | Value |
| --- | --- |
| Views per player | 200; 4 levels deep; name 1-60 characters, no `::`; unique among siblings (any case) |
| Words or rules per call | 200 |
| Words in a library | 5000 |
| Own words per player | 500 (server only); name 1-120 characters, meaning 1-2000 |
| Friends per share / offers waiting for a friend | 20 / 50 |
| Open links per player / life of a link | 50 / 30 days |
| Catalog entries per player | 20; title 1-60, description up to 300 |
| A patch (the player's own wording) | an object, under 7000 characters |

Behaviour worth knowing:

- Removing a word from the library takes it out of every view of the player's.
- A shared or taken copy is independent of the original. Words only the sender
  made are private and are left out (the result says how many, once for each
  place they were in).
- A renamed word keeps its sense, so library entries and views follow the rename
  (migration `0037`); a rename into a name another word has is refused (`0039`).
- Deleting a player removes their library data first; copies others took stay (`0038`).
- A practice round from a view asks only the view's words and rules; wrong
  answers still come from the whole dictionary. See `docs/library-unit-test-matrix.md`.

## Tests

| What | Where | Run |
| --- | --- | --- |
| Rules, tree, search, pasted lists, scope, local mirror, sharing mirror | `tests/library*.test.js`, `tests/view-scope*.test.*`, `tests/home-state.test.js` | `npm test` |
| Screens | `tests/library-page.test.jsx`, `catalog-page`, `join-page`, `my-views-home`, `word-picker`, `view-scope-hooks` | `npm test` |
| Rounds from a view (options, scope, grading, mastery) | `tests/library-round-*.test.js` | `npm test` |
| Hooks, glue and boundary | `tests/library-hooks.test.jsx`, `tests/library-orchestration.test.jsx`, `tests/library-boundary.test.js`, `tests/architecture.test.js` | `npm test` |
| The SQL functions | `supabase/tests/*.sql` | `supabase/ci/run-tests.sh` |
| App API against the SQL functions | `tests/library-contract.test.js`, `library-differential.test.js` | needs `PGURL` |
| App code against PostgreSQL as anon / authenticated | `tests/integration/*` | `supabase/ci/run-integration.sh` (`docs/integration-tests.md`) |
| Browser | `e2e/specs/lib*.cjs` (incl. `libshell.cjs`, the shell's use of the library), `library.cjs`, `grammar-lib.cjs`, `homeviews.cjs`, `catalog*.cjs`, `nested.cjs`, `sweep.cjs` | `npx vite build && npm run e2e` |

Rule-by-rule list: `docs/library-unit-test-matrix.md`.

## Decisions taken (owner, this branch) and what is still open

Taken, implemented and tested (details and evidence: `docs/migrations/review-0037-0042.md`,
`docs/work-tracking/my-library.md`):

1. **Offers after a friendship ends** leave the inbox and the badge and do not return with a new friendship;
   the accept still checks the friendship; copies already taken stay; the sender may offer again (migration 0040,
   the local mirror ends stale offers when the inbox is read).
2. **Removing or dropping what is not yours** keeps the same quiet answer as for something that does not exist,
   and changes nothing. Real errors (network, server) are still thrown. (Tests only; no code change.)
3. **Renaming a word to a name another word has** is refused, in the editor, in the app's rename handler and in
   `content_save_v2` (migration 0039), with nothing changed. Two meanings of one headword stay allowed. Merging is
   a separate feature, not started.
4. **A view with one new word** introduces it and then asks it once (`initialTraining`); the word becomes Familiar
   after a right answer, as for any first answer; no mastery rule changed; no question is made up.

Still open or limited:

- **Renames made before migration 0037** left library entries on deleted words; they are not repaired (the review
  has the query that finds them).
- **`apply_item_renames`**, called alone by an admin, still merges progress without the new check (it is the
  low-level step of `content_save_v2`).
- **`view_contents` returns deleted senses**; the app drops ids it cannot map to a key.
- **The library is hidden** until the dictionary has been copied (`useLibrary` status `off`), also when the
  connection fails once.
- **A save with no idempotency key**: see `docs/architecture/repo.md` (the limit after the lost-answer fix).

## Where to continue

`docs/work-tracking/my-library.md`.
