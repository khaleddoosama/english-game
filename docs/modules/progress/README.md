# Module: progress

A player's saved state: how it is split, saved, restored, merged across devices, and kept safe offline. Proposed boundary, see [module-map.md](../../architecture/module-map.md). Decision: [ADR 0005](../../adr/0005-revisioned-progress-sections.md).

## 1. Purpose and scope

**Purpose.** Never lose a player's play, keep two devices consistent, and keep the saves small.

**Responsibilities (Implemented)**

- Split the progress object into sections and mastery rows; send only what changed.
- Keep a local snapshot before each send; retry later.
- Detect that another device wrote first, merge by meaning, and try again.
- Pull other devices' changes when the app comes back to the foreground.
- Restore a backup (replace) and reset progress.
- Send the numbers behind the leaderboard (score, streaks, weekly gain, mastered count).
- Keep question reports in step between the player's progress and the `reports` table.
- Offer a save status (idle, saving, saved, offline, error).

**Out of scope**

- What the numbers mean ([learning-engine](../learning-engine/README.md)); the screens that change them ([practice](../practice/README.md)).
- Shared content ([content](../content/README.md)).
- Id-keyed progress (`sense_progress`, `rule_progress`): created but unused, see ADR 0004.

## 2. Public operations

The repo interface (online and local). From [repo.js](../../../src/lib/repo.js):

| Operation | Input | Output | Notes |
| --- | --- | --- | --- |
| `loadProgress()` | none | the progress object, or `null` for a new player | Merges an unsent local snapshot with the server's copy; falls back to the snapshot when offline; throws when there is neither. |
| `saveProgress(data, {replace})` | full progress object, flag | resolves when the newest state has been sent (or queued) | `replace` is for a restored backup: no conflict check, score not counted as weekly points. |
| `refreshProgress()` | none | `true` if something from another device was merged in | Skips when a save is running or queued. |
| `onMerged(fn)` | callback | unsubscribe function | Called with merged data after a conflict merge or a refresh. |
| `resetProgress()` | none | resolves | Waits for a running save, calls `reset_my_progress`, clears the snapshot. |
| `status` | none | `{get, subscribe}` | Values: idle, saving, saved, offline, error. |
| `dispose()` | none | none | Removes listeners and timers. |
| `save_progress_v2(p_sections, p_expected, p_mastery, p_mastery_removes, p_profile, p_replace)` | JSON, JSON, JSON, text list, JSON, flag | `{revs}` or `{conflict, sections}` | Database function. |
| `reset_my_progress()` | none | nothing | Database function; deletes the player's sections and mastery and zeroes the leaderboard numbers. |

## 3. Files and database objects

- Files: the progress half of [lib/repo.js](../../../src/lib/repo.js) and its parts in [lib/repo/](../../../src/lib/repo) (`progressShape`, `saveOps`, `unsyncedMerge`, `reportsSync`, `status`, `localRepo`; map: [architecture/repo.md](../../architecture/repo.md)), [lib/progressMerge.js](../../../src/lib/progressMerge.js), [lib/idb.js](../../../src/lib/idb.js), [lib/stableJson.js](../../../src/lib/stableJson.js), the defaults and normalisation in [engine/progress.js](../../../src/engine/progress.js); the game's side (state, saving, reset, restore, study days, badges) in [features/progress](../../../src/features/progress) ([progress-state.md](progress-state.md)); the status indicator in [Shell.jsx](../../../src/features/shell/Shell.jsx).
- Sections: `core` (score, streaks, attempts, settings, daily progress...), `session` (the active session), `pools` (sentence variants), `seen` (read sentences), `confusions`, `history` (round log, completed sessions, solved stories, daily history), `levels` (level stats and cleared levels), `reports`.
- Tables: `progress` (user, section, data, rev), `mastery` (user, item key, stats), `reports`, `report_tombstones`, `profiles` (leaderboard columns).
- Functions: `save_progress_v2`, `save_progress` (older), `reset_my_progress`, `progress_bump_rev` (trigger), `json_int`, `apply_item_renames` (renames), the reports triggers.
- Browser: IndexedDB `progress:<userId>` (data, dirty flag, revision, base revisions and sections); local mode `local:progress`.

## 4. Business rules and permissions

- A player reads and writes only their own rows (row policies). The admin also reads other players' reports.
- A save names the revision it last saw for each section it changes. If any differs, nothing is written and the server's copy comes back (`conflict`).
- On a conflict the browser merges three ways (base = what it last saw, local, server). A value only one side changed takes that side; if both changed: counters add, bests take the larger, lists join by id, days add up, mastery records take the one with more answers while keeping every applied session id.
- Mastery rows have no revision. On a plain save the server keeps whichever record has more answers (`DP-04`). Removing a key deletes the row.
- Reports go first in a save, so progress never lists a report the table does not have. The admin decides "resolved"; a player's edit does not change that, and a deleted report cannot come back.
- Leaderboard numbers: score and streaks are copied from the `core` section; the weekly gain is the increase in score since the last save; the mastered count is sent separately. The server stores what it is sent, floored at 0 (`PE-01`).
- Restoring a backup (`replace`) overwrites without a conflict check; players may only restore their own progress file.
- Renamed words: a save that still uses an old name is stored under the new one.

## 5. Data flow

**Load.** Read the local snapshot; read sections, mastery and own reports from the server (the admin also reads others' reports). If the snapshot is dirty, merge it with the server (sections the server has not changed since the snapshot's base keep this device's values) and let the next save send it.

**Save** (debounced 600 ms; coalescing: only the newest state waits while one is in flight)

1. Write the snapshot (dirty).
2. Compute changed sections (by stable JSON) and changed mastery records (by reference, then JSON).
3. Sync reports, then call `save_progress_v2`.
4. On conflict: merge, update the base, notify the app, try again (up to 4 times).
5. On success: update what the server is known to hold; if nothing newer is waiting, write the snapshot as clean.

**Refresh** (focus or visible, at most every 10 s): compare section revisions and newer mastery rows; if different, fetch and merge them into the app state.

## 6. Failure, retry, cancel, offline

- A failed save keeps the newest state queued, writes the dirty snapshot, sets offline or error, and retries after 15 s and when the browser comes back online.
- If the snapshot cannot be written (storage full or blocked) the status turns to error and the console explains it.
- A failed load with no snapshot stops the game with a retry button, so an empty state can never overwrite real progress.
- After four conflicts in a row the save gives up for now ("Progress kept changing on another device; will try again.") and retries later.
- Sign-out waits up to 5 s for saves, then proceeds.
- Reset waits for a running save, drops queued data, and clears the snapshot.
- Page hide and unload flush the debounced save.
- Local mode writes the whole object to IndexedDB with no merge.

## 7. Tests

| Check | Where |
| --- | --- |
| Only changes are sent; mastery diff; conflicts; offline; retry; renames; replace | [tests/repo.test.js](../../../tests/repo.test.js) (in-memory fake of the functions), [tests/review-audit.test.js](../../../tests/review-audit.test.js) |
| Revisions, conflicts, leaderboard numbers, reset, mapping of renamed words in SQL | [supabase/tests/progress_merge.sql](../../../supabase/tests/progress_merge.sql), [content_publish.sql](../../../supabase/tests/content_publish.sql) |
| Reports: ownership, no resurrection, tombstones | [supabase/tests/report_ownership.sql](../../../supabase/tests/report_ownership.sql), [audit_and_reports.sql](../../../supabase/tests/audit_and_reports.sql) |
| Daily history numbers | [supabase/tests/daily_history.sql](../../../supabase/tests/daily_history.sql) |
| Merge functions in isolation | covered through [review-audit.test.js](../../../tests/review-audit.test.js); no dedicated file |
| The game's side: opening, the debounced save, saving on page hide, restore, reset, study days, badges, another device's changes | [tests/progress-hooks.test.jsx](../../../tests/progress-hooks.test.jsx), [progress-rules.test.js](../../../tests/progress-rules.test.js), [e2e/specs/progress.cjs](../../../e2e/specs/progress.cjs) |

**Gaps.** The fake used by the repo tests is written from the functions' semantics, so it can drift from the real SQL; the SQL tests cover the server half only. No test runs two real browsers against one account. No test sends an absurd score or writes `progress` directly (`PE-01`, `PE-02`). The effects that call the repo (debounce, flush on hide) are tested with a fake repo and in local mode, not against Supabase.

## 8. Example journey

Lena (synthetic) plays on her phone on the train, losing connection halfway.

1. Each answer changes state; after 600 ms the repo writes the snapshot and calls `save_progress_v2`. The header says "saving", then "saved".
2. In a tunnel the call fails: the header says "offline"; the snapshot is dirty. She keeps playing; each state replaces the waiting one.
3. At home, the browser reports online; the repo sends the newest state. Meanwhile she had played ten questions on her laptop. The server answers with a conflict for the `core` and `pools` sections. The repo merges: scores add, best streaks take the larger, pools merge per word. It saves again and tells the app, which updates its state.
4. If she closes the phone browser while offline, the next start finds the dirty snapshot and merges it with the server before showing the game.

## 9. Status

**Implemented.** Everything above.

**Planned** (roadmap)

- Phase 3: bound or recompute the leaderboard numbers on the server; remove direct writes to `progress` and `mastery`.
- Phase 4: separate from `content` in `repo.js`. (The game's side has its own module and tests since 2026-10-20.)
- Phase 5: decide between text keys and ids (`sense_progress`), and replace the committed backup fixture.

**Known Issues**

- `PE-01` score and mastered count are trusted from the client (Confirmed).
- `PE-02` direct writes to `progress` and `mastery` are allowed (Confirmed on the local stub).
- `DP-04` mastery has no revision.
- `DP-05` reports are stored in two places and reconciled on load.
- `DP-06` `sense_progress` and `rule_progress` exist but are unused.
- `DP-07` the committed backup holds one account's progress.
