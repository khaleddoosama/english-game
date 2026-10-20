# Module: library (My Library)

A player's own library of words and grammar rules, the views (folders) they arrange them in, and ways to share a view: with friends, by link, or through the catalog. Boundary: [module-map.md](../../architecture/module-map.md). How the module is layered, and the pattern other modules follow: [architecture/modules.md](../../architecture/modules.md). Decisions: [ADR 0004](../../adr/0004-text-keys-for-words-and-progress.md), [ADR 0007](../../adr/0007-library-as-new-model.md), [ADR 0002](../../adr/0002-online-and-local-modes.md).

Related records: rule-by-rule test list [library-unit-test-matrix.md](../../library-unit-test-matrix.md); work log and handover [work-tracking/my-library.md](../../work-tracking/my-library.md); migration review [review-0037-0042.md](../../migrations/review-0037-0042.md).

## 1. Purpose and scope

**Purpose.** Let a player decide which words and rules they study, group them, and pass groups to others, without changing the shared course or anyone's progress.

**Responsibilities (Implemented)**

- The library: words and rules a player has chosen, removed by a flag so it can be undone.
- Views: folders up to four levels deep; a word or rule can be in any number of views; progress belongs to the word, never to a view.
- Sharing: offer a view to friends (they accept or dismiss in an inbox); a link (`/join/<token>`, good for 30 days, can be taken back); the catalog (publish, search, take).
- A copy of a shared view always becomes the receiver's own: the views inside, the words and the rules; words that only the sender made stay private.
- The id map between the game's text keys and the database ids, and the "library is ready" switch.
- A local (localStorage) implementation of the same interface for local mode and tests.

**Out of scope**

- The shared course and the dictionary copy ([content](../content/README.md) keeps `dictionary_sync`).
- The practice engine (`src/engine/v2.js`); [practice](../practice/README.md) takes a view's contents as a scope.
- Saving progress (`src/lib/repo.js`, [progress](../progress/README.md)).
- Friends ([social](../social/README.md)); Live challenges built from a view ([live](../live/README.md)).

## 2. Public operations

### The module's front door

Other modules import only from [index.js](../../../src/features/library/index.js). Nothing else in the folder may be imported from outside; [tests/library-boundary.test.js](../../../tests/library-boundary.test.js) enforces it.

| Export | What it is | Used by |
| --- | --- | --- |
| `useLibrary({ enabled, me, knownWord, people })` | The library for this player: `{ status: loading, ready or off, api, ids, refreshIds }`. `people` = `{ areFriends, nameOf }` for local mode. | shell |
| `useLibraryHome({ library, screen })` | Offers waiting, the player's keys and biggest views, for Home and Profile | shell |
| `homeLimits({ status, isAdmin, keys })` | Is Home cut down to the player's library, or waiting for it | shell |
| `scopeOfView(library, viewId, deep)`, `scopeIsEmpty(scope)` | A view as the scope of a practice round | shell |
| `keepInLibrary(library, card)` | A new word also goes into the library (best effort) | shell (Ask AI "Add to Collection") |
| `LibraryRoutes` | The `/join`, `/catalog` and `/library` screens, with their fallbacks | shell |
| `MyViewsHome` (lazy) | The "My views" tabs on Home | shell |
| `useMyViews(library)`, `useViewScope(library, viewId)` | My views, and what one holds | Live challenges |

### The API (`LibraryApi`)

Defined in [libraryApi.js](../../../src/features/library/libraryApi.js), with two implementations: [onlineLibraryApi.js](../../../src/features/library/onlineLibraryApi.js) (one database function per call; the function does every check) and [local/](../../../src/features/library/local) (localStorage mirror). The boundary test checks both offer the same calls. All calls return promises; ids are the server's ids (in local mode, the game's own keys). Errors are `LibraryError { message, code }` (SQLSTATE).

| Group | Operations | Notes |
| --- | --- | --- |
| Views | `tree()`, `create(name, parent?, source?)`, `rename(id, name)`, `move(id, parent?)`, `remove(id)` | Names are unique under one parent (any case) and cannot contain "::". `source` makes a view from an official one (a course level, a session, a lesson). |
| View contents | `add(view, senseIds)`, `drop(view, senseId)`, `addRules(view, ruleIds)`, `dropRule(view, ruleId)`, `contents(view, deep?)` | `contents` returns `[{kind: "sense" or "rule", id}]`; `deep` includes views inside. |
| Library | `libraryAdd(senseIds)`, `libraryRemove(senseId)`, `libraryAddRules`, `libraryRemoveRule`, `libraryList()` | Removing a word takes it out of every view of the player. |
| Own words and changes | `createWord(card)`, `patch(senseId, patch, note?)` | `createWord` is called by `keepInLibrary`; `patch` has no caller (see Status). |
| Sharing | `share(view, userIds)`, `inbox()`, `accept(shareId)`, `dismiss(shareId)` | Friends only. |
| Links | `linkCreate(view)`, `linkInfo(token)`, `linkAccept(token)`, `linkRevoke(token)` | `linkInfo` says why a link does not work: not found, taken back, expired, removed. |
| Catalog | `catalogPublish`, `catalogEdit`, `catalogUnpublish`, `catalogList(query?, limit?)`, `catalogTake` | One open entry per view. |
| Id map | `ids.senseOf(key)`, `ids.keyOfSense(id)`, `ids.ruleOf(key)`, `ids.keyOfRule(id)` | Built from `legacy_key` columns plus the player's own words. |

## 3. Files, screens and database objects

- Screens: [LibraryPage](../../../src/features/library/LibraryPage.jsx) (`/library`) with [ViewTree](../../../src/features/library/components/ViewTree.jsx), [ViewPanel](../../../src/features/library/components/ViewPanel.jsx), [AddWords](../../../src/features/library/components/AddWords.jsx), [AddRules](../../../src/features/library/components/AddRules.jsx), [LibraryWords](../../../src/features/library/components/LibraryWords.jsx), [LibraryRules](../../../src/features/library/components/LibraryRules.jsx), [CreateViews](../../../src/features/library/components/CreateViews.jsx), [SharePanel](../../../src/features/library/components/SharePanel.jsx), [ShareInbox](../../../src/features/library/components/ShareInbox.jsx), [WordPicker](../../../src/features/library/components/WordPicker.jsx); [CatalogPage](../../../src/features/library/CatalogPage.jsx) (`/catalog`); [JoinPage](../../../src/features/library/JoinPage.jsx) (`/join/<token>`); [LibraryRoutes](../../../src/features/library/LibraryRoutes.jsx) places them; [MyViewsHome](../../../src/features/library/components/MyViewsHome.jsx) on Home.
- Orchestration: [useLibrary.js](../../../src/features/library/useLibrary.js) and [openLibrary.js](../../../src/features/library/openLibrary.js) (is the library on, the API, the id maps), [useLibraryHome.js](../../../src/features/library/useLibraryHome.js), [useViews.js](../../../src/features/library/useViews.js), [useViewScope.js](../../../src/features/library/useViewScope.js), [viewRound.js](../../../src/features/library/viewRound.js), [ownWords.js](../../../src/features/library/ownWords.js), [libraryActions.js](../../../src/features/library/libraryActions.js) (the page's changes and their sentences).
- Pure rules: [libraryRules.js](../../../src/features/library/libraryRules.js) (limits and messages shared by both implementations), [libraryTree.js](../../../src/features/library/libraryTree.js), [libraryHome.js](../../../src/features/library/libraryHome.js), [scope.js](../../../src/features/library/scope.js), [libraryIds.js](../../../src/features/library/libraryIds.js), [libraryErrors.js](../../../src/features/library/libraryErrors.js).
- Outward dependencies: `lib/router`, `lib/supabase`, `engine/v2` (`V2.norm`, `V2.headword`), and `features/home` through its index (`StageCard`, `describeItems`, only for `MyViewsHome`). No dependency on the friends module: the app passes who the local friends are. The module is in no import loop ([tests/architecture.test.js](../../../tests/architecture.test.js)).
- Tables: `headwords`, `senses`, `sense_links`, `grammar_rules`, `grammar_questions`, `collections` (views; `owner_id` null means the official course), `collection_senses`, `collection_rules`, `library_entries`, `library_rules`, `collection_shares`, `view_links`, `view_link_takes`, `catalog_entries`, `catalog_takes`; unused: `sense_progress`, `rule_progress`.
- Functions: `view_create`, `view_edit`, `view_remove`, `view_add`, `view_drop`, `view_add_rules`, `view_drop_rule`, `view_contents`, `view_tree`, `library_add`, `library_remove`, `library_add_rules`, `library_remove_rule`, `library_list`, `library_patch`, `sense_create`, `view_share`, `view_shares_inbox`, `view_share_accept`, `view_share_dismiss`, `view_copy_tree`, `view_link_create`, `view_link_info`, `view_link_accept`, `view_link_revoke`, `catalog_publish`, `catalog_edit`, `catalog_unpublish`, `catalog_list`, `catalog_take`, `view_depth`, `view_height`.
- Migrations 0026 to 0036 (library), 0037 (a rename keeps the sense), 0038 (deleting a player removes their library data), 0039 (a rename needs a free name), 0040 (offers end with the friendship). 0041 and 0042 belong to content and progress.

## 4. Business rules and permissions

Limits (database and local mirror, one list in `libraryRules.js`):

| Rule | Value |
| --- | --- |
| Views per player | 200; 4 levels deep; name 1-60 characters, no `::`; unique among siblings (any case) |
| Words or rules per call | 200 |
| Words in a library | 5,000 |
| Own words per player | 500 (server only); name 1-120 characters, meaning 1-2,000 |
| Friends per share / offers waiting for a recipient | 20 / 50 |
| Open links per player / life of a link | 50 / 30 days |
| Catalog entries per player | 20; title 1-60, description up to 300; results up to 100 per call |
| A patch (the player's own wording) | an object, under 7,000 characters |

Behaviour:

- A player reads the dictionary, official views, their own library, views and progress, and shares addressed to them. Writes go only through the `security definer` functions, which check the caller. Every table has row-level security.
- Nothing is deleted physically by the app: removal sets a timestamp (`removed_at`, `deleted_at`). Exception: deleting a player removes their library data first; copies others took stay (0038).
- A word can be added to a library only if it is public and not rejected, or the player's own.
- Removing or dropping something that is not yours gives the same quiet answer as something that does not exist, and changes nothing. Real errors (network, server) are still thrown.
- Sharing to friends needs an accepted friendship when sending and when accepting. When a friendship ends, its offers leave the inbox and the badge and do not come back with a new friendship; copies already taken stay; the sender may offer again (0040). A link works for any signed-in player; taking it twice returns the copy already made unless that copy was removed. You cannot take your own link or your own catalog entry.
- A copy gets the name "<view> (from <sender>)" and counts against the receiver's view limit; there is a room check before copying.
- The catalog points at the live view: someone taking it later gets the owner's current words; earlier copies are not touched. The owner and the admin can take an entry down.
- A renamed word keeps its sense, so library entries and views follow the rename (0037). A rename into a name another word already has is refused, in the editor, in the app's rename handler and in `content_save_v2` (0039), with nothing changed. Two meanings of one headword stay allowed.
- Home: a player (not the admin) sees only words and rules in their own library, and nothing is shown until the library keys have loaded.
- The library is "off" (hidden) while the tables or the dictionary copy are missing.
- A practice round from a view asks only the view's words and rules; wrong answers still come from the whole dictionary. A view with one new word introduces it and then asks it once (`initialTraining`).

## 5. Data flow

- **Start.** `useLibrary` checks `view_tree`; then `loadIds` pages through `senses` and `grammar_rules` for rows that have a `legacy_key` (1,000 per request), plus the player's own words, to build the key and id maps. If no rows map, the library is off.
- **Screens** read the tree, the library list and a view's contents through the API; changes call the API and then reload the pieces they need.
- **Practice** from a view: `contents(view, deep)` then `scopeFromContents` turns ids into word keys and rule ids.
- **Sharing**: the sender calls `share`, `linkCreate` or `catalogPublish`. The receiver's accept calls the copy function once and returns counts: views, words, rules, skipped private words.
- **New words** reach the id map only after a reload or `refreshIds()`; the picker retries once and then says the word is "not in the library yet". A word the admin adds from Ask AI goes into their library through `keepInLibrary`.
- **Admin content saves**: after a save and a successful `dictionary_sync`, the words and rules that are new in that save join the admin's own library ([saveToLibrary.js](../../../src/lib/saveToLibrary.js), called from [contentStore.js](../../../src/lib/repo/contentStore.js)). Items already known are left alone. Best effort: a failure is only logged.

## 6. Failure, retry, cancel, offline

- Every call turns a database error into a short readable message (`friendlyError`); no automatic retry.
- Offline: the library is not available; the Library tab and Home's view tabs need a connection to load.
- A race on names or limits shows the server's message. A link that fails explains why.
- Unmapped ids (a word the browser's map does not know) are silently left out of lists; a pasted list that includes unknown words reports them.
- Accepting an offer is protected against double taps by the server (the share must still be "pending").

## 7. Tests

| Check | Where | Run |
| --- | --- | --- |
| Views, limits, privacy, what each player can see | [library.sql](../../../supabase/tests/library.sql), [library_rules.sql](../../../supabase/tests/library_rules.sql), [sense_create.sql](../../../supabase/tests/sense_create.sql) | `supabase/ci/run-tests.sh` |
| Shares, links, catalog, offers after a friendship ends | [view_shares.sql](../../../supabase/tests/view_shares.sql), [view_shares_friendship.sql](../../../supabase/tests/view_shares_friendship.sql), [view_links.sql](../../../supabase/tests/view_links.sql), [catalog.sql](../../../supabase/tests/catalog.sql) | same |
| Dictionary copy, renames, deleting a player | [dictionary_sync.sql](../../../supabase/tests/dictionary_sync.sql), [dictionary_rename.sql](../../../supabase/tests/dictionary_rename.sql), [rename_conflict.sql](../../../supabase/tests/rename_conflict.sql), [admin_delete_player.sql](../../../supabase/tests/admin_delete_player.sql) | same |
| The app's API against the real SQL functions | [library-contract.test.js](../../../tests/library-contract.test.js) | needs `PGURL` (CI sets it) |
| Local mirror and the real thing give the same answers | [library-differential.test.js](../../../tests/library-differential.test.js) | needs `PGURL` |
| App code against PostgreSQL as `anon` / `authenticated` (RLS, grants, sharing, two devices) | [tests/integration/](../../../tests/integration) | `supabase/ci/run-integration.sh`, see [integration-tests.md](../../integration-tests.md) |
| Upgrade and rollback of 0037-0042 | `supabase/ci/check-upgrade.sh` | CI `database` job |
| Local mirror rules, tree maths, ids, scope | [library.test.js](../../../tests/library.test.js), [library-tree.test.js](../../../tests/library-tree.test.js), [library-ids.test.js](../../../tests/library-ids.test.js), [library-local-views.test.js](../../../tests/library-local-views.test.js), [view-scope.test.js](../../../tests/view-scope.test.js) | `npm test` |
| Rounds from a view (options, scope, grading, mastery) | `tests/library-round-*.test.js`, [round-single-new-word.test.js](../../../tests/round-single-new-word.test.js) | `npm test` |
| Hooks, glue and boundary | [library-hooks.test.jsx](../../../tests/library-hooks.test.jsx), [library-orchestration.test.jsx](../../../tests/library-orchestration.test.jsx), [library-boundary.test.js](../../../tests/library-boundary.test.js), [architecture.test.js](../../../tests/architecture.test.js) | `npm test` |
| An admin's new words and rules join their library | [save-to-library.test.js](../../../tests/save-to-library.test.js), [repo-stores.test.js](../../../tests/repo-stores.test.js) | `npm test` |
| Screens | [library-page.test.jsx](../../../tests/library-page.test.jsx), [join-page.test.jsx](../../../tests/join-page.test.jsx), [catalog-page.test.jsx](../../../tests/catalog-page.test.jsx), [my-views-home.test.jsx](../../../tests/my-views-home.test.jsx), [word-picker.test.jsx](../../../tests/word-picker.test.jsx), [view-scope-hooks.test.jsx](../../../tests/view-scope-hooks.test.jsx), [profile-catalog.test.jsx](../../../tests/profile-catalog.test.jsx) | `npm test` |
| Browser | `e2e/specs/lib*.cjs` (incl. `libshell.cjs`, the shell's use of the library, and `libsolo.cjs`), `library.cjs`, `grammar-lib.cjs`, `homeviews.cjs`, `catalog*.cjs`, `nested.cjs`, `wordrename.cjs`, `sweep.cjs` | `npx vite build && npm run e2e` |

**Gaps.** The real Supabase stack is covered only for the changes of 0039-0042 (`tests/realstack`); the Vercel API routes and production data are not tested. The presentational pieces in `components/` are covered through `LibraryPage`, `MyViewsHome` and the browser specs, not one by one. `library_patch` and notes have no screen and no app-level test.

## 8. Example journey

Omar (synthetic) makes a view and shares it. Dana (synthetic) takes it.

1. Omar opens Library, makes the view "Travel" with a view "Airport" inside, adds twelve words from the dictionary (each is added to his library first) and two grammar rules.
2. He practises "Travel" from Home; the round uses those words.
3. In the Share panel he taps "Get a link", copies `/join/<token>`, and sends it to Dana.
4. Dana opens the link. If she is signed out she logs in and the same address opens. She sees "Travel from omar: 12 words, 2 rules, 2 views". She taps "Take my copy".
5. The server creates "Travel (from omar)" in her library with the nested view, adds the words and rules to her library, and reports 0 skipped. Her progress on any word is her own; Omar's is unaffected.
6. Later the admin renames one of the twelve words. With migration 0037 applied, the word stays in Omar's library and views and in Dana's copy under its new name, and their mastery moves with it. Renaming it into a name another word has is refused.

## 9. Status

**Implemented.** Everything above except where marked below.

**Database changes in production**

- Migrations 0037-0042 were applied to production on 2026-10-18, after a backup and a read-only comparison; the checks after match the expected schema. Record, rollback and what was found: [review-0037-0042.md](../../migrations/review-0037-0042.md#production-application-2026-10-18).

**Implemented in the database, not reachable from a screen**

- `sense_create` for players: the only caller is the admin's "Add to Collection" in Ask AI (through `keepInLibrary`), which also adds the word to the shared course.
- `library_patch` (a player's own changes to a shared word) and library notes: no screen calls them and the game never applies a patch to the words it plays.
- The review status for AI-written senses (`pending`, `rejected`): nothing sets it from the app.

**Planned** (roadmap)

- Repair of library entries left on deleted words by renames made before 0037 (diagnosis and plan: [diagnosis-renamed-words.md](../../migrations/diagnosis-renamed-words.md)); visible failure of the dictionary copy.
- Phase 4: remove the `home` import from the library code (`MyViewsHome` draws Home cards). The `social` import is already gone.
- Phase 5: decide whether to finish or drop the unused id-keyed progress tables.

**Known Issues**

- `DP-01` a rename drops the word from players' libraries and views. Fixed for new renames by 0037 (in production since 2026-10-18); old renames are not repaired (2 entries in production).
- `DP-02` player-owned words and patches have no player UI and are not played.
- `DP-03` the dictionary copy is refreshed on a best-effort call.
- `DP-06` `sense_progress` and `rule_progress` are unused.
- `MT-05` two implementations to keep equal (guarded by the differential and contract tests). In local mode a word rename does not move the word inside the player's views (online it does, 0037).
- `apply_item_renames` could be called directly by an admin and merge progress without the 0039 check. Fixed by 0041 (in production since 2026-10-18), which leaves it callable only from `content_save_v2`.
- `view_contents` returns deleted senses; the app drops ids it cannot map to a key.
- The library is hidden (`off`) when the first connection fails once, not only when the tables are missing.
