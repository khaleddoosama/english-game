# Module: library

A player's own library of words and grammar rules, the views (folders) they arrange them in, and ways to share a view: with friends, by link, or through the catalog. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decisions: [ADR 0004](../../adr/0004-text-keys-for-words-and-progress.md), [ADR 0007](../../adr/0007-library-as-new-model.md), [ADR 0002](../../adr/0002-online-and-local-modes.md).

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
- Practising a view ([practice](../practice/README.md) takes a view's contents as a scope).
- Friends ([social](../social/README.md)); Live challenges built from a view ([live](../live/README.md)).

## 2. Public operations

The `LibraryApi` interface in [libraryApi.js](../../../src/features/library/libraryApi.js). All calls return promises; ids are the server's ids (in local mode, the game's own keys).

| Group | Operations | Notes |
| --- | --- | --- |
| Views | `tree()`, `create(name, parent?, source?)`, `rename(id, name)`, `move(id, parent?)`, `remove(id)` | Names are unique under one parent and cannot contain "::". `source` makes a view from an official one (a course level, a session, a lesson). |
| View contents | `add(view, senseIds)`, `drop(view, senseId)`, `addRules(view, ruleIds)`, `dropRule(view, ruleId)`, `contents(view, deep?)` | `contents` returns `[{kind: "sense" or "rule", id}]`; `deep` includes views inside. |
| Library | `libraryAdd(senseIds)`, `libraryRemove(senseId)`, `libraryAddRules`, `libraryRemoveRule`, `libraryList()` | Removing a word takes it out of every view of the player. |
| Own words and changes | `createWord(card)`, `patch(senseId, patch, note?)` | Backend only: no player screen calls them (see Status). |
| Sharing | `share(view, userIds)`, `inbox()`, `accept(shareId)`, `dismiss(shareId)` | Friends only. |
| Links | `linkCreate(view)`, `linkInfo(token)`, `linkAccept(token)`, `linkRevoke(token)` | `linkInfo` says why a link does not work: not found, taken back, expired, removed. |
| Catalog | `catalogPublish`, `catalogEdit`, `catalogUnpublish`, `catalogList(query?, limit?)`, `catalogTake` | One open entry per view. |
| Hook | `useLibrary({enabled, me, knownWord})` | `{status: loading, ready or off, api, ids, refreshIds}`. |
| Id map | `ids.senseOf(key)`, `ids.keyOfSense(id)`, `ids.ruleOf(key)`, `ids.keyOfRule(id)` | Built from `legacy_key` columns plus the player's own words. |

## 3. Files, screens and database objects

- Screens: [LibraryPage](../../../src/features/library/LibraryPage.jsx) with [ViewTree](../../../src/features/library/components/ViewTree.jsx), [ViewPanel](../../../src/features/library/components/ViewPanel.jsx), [AddWords](../../../src/features/library/components/AddWords.jsx), [AddRules](../../../src/features/library/components/AddRules.jsx), [LibraryWords](../../../src/features/library/components/LibraryWords.jsx), [LibraryRules](../../../src/features/library/components/LibraryRules.jsx), [CreateViews](../../../src/features/library/components/CreateViews.jsx), [SharePanel](../../../src/features/library/components/SharePanel.jsx), [ShareInbox](../../../src/features/library/components/ShareInbox.jsx), [WordPicker](../../../src/features/library/components/WordPicker.jsx); [CatalogPage](../../../src/features/library/CatalogPage.jsx); [JoinPage](../../../src/features/library/JoinPage.jsx); [MyViewsHome](../../../src/features/library/components/MyViewsHome.jsx) on Home.
- Logic: [libraryRules.js](../../../src/features/library/libraryRules.js) (limits and messages shared by both implementations), [libraryTree.js](../../../src/features/library/libraryTree.js), [libraryIds.js](../../../src/features/library/libraryIds.js), [scope.js](../../../src/features/library/scope.js), [useViews.js](../../../src/features/library/useViews.js), [useViewScope.js](../../../src/features/library/useViewScope.js), [onlineLibraryApi.js](../../../src/features/library/onlineLibraryApi.js), [local/](../../../src/features/library/local).
- Tables: `headwords`, `senses`, `sense_links`, `grammar_rules`, `grammar_questions`, `collections` (views; `owner_id` null means the official course), `collection_senses`, `collection_rules`, `library_entries`, `library_rules`, `collection_shares`, `view_links`, `view_link_takes`, `catalog_entries`, `catalog_takes`; unused: `sense_progress`, `rule_progress`.
- Functions: `view_create`, `view_edit`, `view_remove`, `view_add`, `view_drop`, `view_add_rules`, `view_drop_rule`, `view_contents`, `view_tree`, `library_add`, `library_remove`, `library_add_rules`, `library_remove_rule`, `library_list`, `library_patch`, `sense_create`, `view_share`, `view_shares_inbox`, `view_share_accept`, `view_share_dismiss`, `view_copy_tree`, `view_link_create`, `view_link_info`, `view_link_accept`, `view_link_revoke`, `catalog_publish`, `catalog_edit`, `catalog_unpublish`, `catalog_list`, `catalog_take`, `view_depth`, `view_height`.
- Migrations 0026 to 0036.

## 4. Business rules and permissions

- Limits (database and local mirror, one list in `libraryRules.js`): 200 views per player, depth 4, 200 items per call, 5,000 words in a library, 20 friends per share and 50 shares waiting per recipient, 50 open links per player (each 30 days), 20 catalog entries per player (title up to 60 characters, description up to 300), catalog results up to 100 per call.
- A player reads the dictionary, official views, their own library, views and progress, and shares addressed to them. Writes go only through the functions, which check the caller.
- Nothing is deleted physically: removal sets a timestamp.
- A word can be added to a library only if it is public and not rejected, or the player's own.
- Sharing to friends needs an accepted friendship at the time of sending and at accepting. A link works for any signed-in player; taking it twice returns the copy already made unless that copy was removed. You cannot take your own link or your own catalog entry.
- A copy gets the name "<view> (from <sender>)" and counts against the receiver's view limit; there is room check before copying.
- The catalog points at the live view: someone taking it later gets the owner's current words; earlier copies are not touched. The owner and the admin can take an entry down.
- Home: a player (not the admin) sees only words and rules in their own library, and nothing is shown until the library keys have loaded.
- The library is "off" (hidden) while the tables or the dictionary copy are missing.

## 5. Data flow

- **Start.** `useLibrary` checks `view_tree`; then `loadIds` pages through `senses` and `grammar_rules` for rows that have a `legacy_key` (1,000 per request), plus the player's own words, to build the key and id maps. If no rows map, the library is off.
- **Screens** read the tree, the library list and a view's contents through the API; changes call the API and then reload the pieces they need.
- **Practice** from a view: `contents(view, deep)` then `scopeFromContents` turns ids into word keys and rule ids.
- **Sharing**: the sender calls `share`, `linkCreate` or `catalogPublish`. The receiver's accept calls the copy function once and returns counts: views, words, rules, skipped private words.
- **New words** reach the id map only after a reload or `refreshIds()`; the picker retries once and then says the word is "not in the library yet".

## 6. Failure, retry, cancel, offline

- Every call turns a database error into a short readable message (`friendlyError`); no automatic retry.
- Offline: the library is not available; the Library tab and Home's view tabs need a connection to load.
- A race on names or limits shows the server's message. A link that fails explains why.
- Unmapped ids (a word the browser's map does not know) are silently left out of lists; a pasted list that includes unknown words reports them.
- Accepting an offer is protected against double taps by the server (the share must still be "pending").

## 7. Tests

| Check | Where |
| --- | --- |
| Views, limits, privacy, what each player can see | [supabase/tests/library.sql](../../../supabase/tests/library.sql), [library_rules.sql](../../../supabase/tests/library_rules.sql), [sense_create.sql](../../../supabase/tests/sense_create.sql) |
| Shares, links, catalog | [view_shares.sql](../../../supabase/tests/view_shares.sql), [view_links.sql](../../../supabase/tests/view_links.sql), [catalog.sql](../../../supabase/tests/catalog.sql) |
| Dictionary copy | [dictionary_sync.sql](../../../supabase/tests/dictionary_sync.sql) |
| The app's API against the real SQL functions (needs `PGURL`; CI sets it) | [tests/library-contract.test.js](../../../tests/library-contract.test.js) |
| Local mirror and the real thing give the same answers | [tests/library-differential.test.js](../../../tests/library-differential.test.js) |
| Local mirror rules, tree maths, ids, scope | [tests/library.test.js](../../../tests/library.test.js), [library-tree.test.js](../../../tests/library-tree.test.js), [library-ids.test.js](../../../tests/library-ids.test.js), [library-local-views.test.js](../../../tests/library-local-views.test.js), [view-scope.test.js](../../../tests/view-scope.test.js) |
| Screens | [library-page.test.jsx](../../../tests/library-page.test.jsx), [join-page.test.jsx](../../../tests/join-page.test.jsx), [catalog-page.test.jsx](../../../tests/catalog-page.test.jsx), [word-picker.test.jsx](../../../tests/word-picker.test.jsx), [view-scope-hooks.test.jsx](../../../tests/view-scope-hooks.test.jsx), [profile-catalog.test.jsx](../../../tests/profile-catalog.test.jsx) |
| Browser specs (local mode) | [library.cjs](../../../e2e/specs/library.cjs), [libjoin.cjs](../../../e2e/specs/libjoin.cjs), [libshare.cjs](../../../e2e/specs/libshare.cjs), [catalog.cjs](../../../e2e/specs/catalog.cjs), [catalogentry.cjs](../../../e2e/specs/catalogentry.cjs), [libgrammar.cjs](../../../e2e/specs/libgrammar.cjs), [grammar-lib.cjs](../../../e2e/specs/grammar-lib.cjs), [nested.cjs](../../../e2e/specs/nested.cjs) |

This is the best-tested module. **Gaps.** What a content rename or deletion does to library entries and views (`DP-01`); a failed or stale `dictionary_sync` (`DP-03`); the id map when thousands of words change at once; `library_patch` and notes (no screen).

## 8. Example journey

Omar (synthetic) makes a view and shares it. Dana (synthetic) takes it.

1. Omar opens Library, makes the view "Travel" with a view "Airport" inside, adds twelve words from the dictionary (each is added to his library first) and two grammar rules.
2. He practises "Travel" from Home; the round uses those words.
3. In the Share panel he taps "Get a link", copies `/join/<token>`, and sends it to Dana.
4. Dana opens the link. If she is signed out she logs in and the same address opens. She sees "Travel from omar: 12 words, 2 rules, 2 views". She taps "Take my copy".
5. The server creates "Travel (from omar)" in her library with the nested view, adds the words and rules to her library, and reports 0 skipped. Her progress on any word is her own; Omar's is unaffected.
6. Later the admin renames one of the twelve words. Omar's library and Dana's copy lose that word (Known Issue `DP-01`), while their mastery moves to the new name.

## 9. Status

**Implemented.** Everything above except where marked below.

**Implemented in the database, not reachable from a screen**

- `sense_create` for players: the only caller is the admin's "Add to Collection" in Ask AI, which also adds the word to the shared course.
- `library_patch` (a player's own changes to a shared word) and library notes: no screen calls them and the game never applies a patch to the words it plays.
- The review status for AI-written senses (`pending`, `rejected`): nothing sets it from the app.

**Planned** (roadmap)

- Phase 1: library entries and view membership follow a rename; a repair for past renames; visible failure of the dictionary copy.
- Phase 4: remove the `home` and `social` imports from the library code.
- Phase 5: decide whether to finish or drop the unused id-keyed progress tables.

**Known Issues**

- `DP-01` a rename drops the word from players' libraries and views (Confirmed).
- `DP-02` player-owned words and patches have no UI and are not played.
- `DP-03` the dictionary copy is refreshed on a best-effort call.
- `DP-06` `sense_progress` and `rule_progress` are unused.
- `MT-05` two implementations to keep equal (guarded by the differential and contract tests).
