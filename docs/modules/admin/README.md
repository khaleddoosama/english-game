# Module: admin

Operating the game: analytics, players, content tools, question reports, data quality, the activity log, app settings, and backups. Proposed boundary, see [module-map.md](../../architecture/module-map.md).

## 1. Purpose and scope

**Purpose.** Give the owner one place to see how the game is used, manage accounts and content, and change app-wide rules, with every change recorded.

**Responsibilities (Implemented)**

- Fourteen sections under `/admin/<section>/<item>?filters`: Overview, Players, Live challenges, AI usage; Words, Categories, Reports, Stories and more, Grammar, Data quality, Content health; Activity log, Settings, Import and export.
- Analytics through `admin_*` functions; tables with filters, paging, CSV and bulk actions.
- Player management: make admin or player, set a password, reset progress, delete.
- Content editing screens (they change the course through [content](../content/README.md)).
- Reports: see every detail, resolve, reopen, delete, ask AI for a verdict and a drafted fix.
- Activity log with field-by-field before and after, revert a change, delete selected entries or clear all (leaving a note).
- App settings: sign-ups, maintenance, announcement, AI, voice, Live limits, ranks, new-player defaults.
- A local-mode version of the same data shapes, so the panel works offline and in tests.

**Out of scope**

- Persisting content and progress ([content](../content/README.md), [progress](../progress/README.md)).
- The AI features themselves ([ai-media](../ai-media/README.md)).
- Anything a player can do.

## 2. Public operations

The admin API ([adminApi.js](../../../src/features/admin/adminApi.js)); online each call is one database function.

| Operation | Function | Result |
| --- | --- | --- |
| `overview()` | `admin_overview` | counts: players, active users, content, reports, AI calls, Live matches |
| `activity(days)` | `admin_activity` | per-day sessions, answers, active and new players, AI calls, Live matches (from each player's daily totals) |
| `players()`, `playerDetail(id)` | `admin_players`, `admin_player_detail` | table rows and one drawer |
| `wordStats()` | `admin_word_stats` | per word: players, attempts, correct |
| `liveMatches()`, `liveChallenges()`, `endChallenge(code)` | `admin_live_matches`, `admin_live_challenges`, `live_end` | |
| `dataIssues()`, `analytics(view)` | `admin_data_issues`, `admin_analytics` | rows from the `analytics` schema views (word quality, category summary and others) |
| `aiUsage(days)`, `aiSummary(days)`, `aiCalls(filters)` | `admin_ai_usage`, `admin_ai_summary`, a table read | totals and the call log |
| `audit(filters)`, `auditIds(filters)`, `deleteAudit(ids)`, `clearAudit()` | table read, `admin_audit_delete`, `admin_audit_clear` | |
| `setRole`, `setPassword`, `resetPlayer`, `deletePlayer` | `admin_set_role`, `admin_set_password`, `admin_reset_player`, `admin_delete_player` | |
| `saveAppSettings(next)` | `admin_save_settings` | the validated settings |

## 3. Files, screens and database objects

- Screens: [AdminPanel](../../../src/features/admin/AdminPanel.jsx), the sections in [sections/](../../../src/features/admin/sections), [ContentHealthPanel](../../../src/features/admin/ContentHealthPanel.jsx), editors for [words](../../../src/features/admin/editors/WordEditor.jsx) and [grammar](../../../src/features/admin/editors/GrammarEditor.jsx), shared parts ([DataTable](../../../src/features/admin/DataTable.jsx), [charts](../../../src/features/admin/charts.jsx), [diff](../../../src/features/admin/diff.jsx), [adminUi](../../../src/features/admin/adminUi.jsx)), [ImportExport](../../../src/features/data/ImportExport.jsx).
- Content admin (rename a word, merge categories, the levels editor, the progress that follows a rename): [features/content-admin](../../../src/features/content-admin), guide [content-admin.md](content-admin.md).
- Import, export and backups (make a file, check it, apply it in each mode, the Profile page's backups): [features/data](../../../src/features/data), guide [import-export.md](import-export.md).
- Tables: `admin_audit`, `ai_calls`, `app_settings`, `reports`, plus reads of `profiles`, `progress`, `mastery`, `live_*`.
- Schema `analytics`: views for data quality and word and category numbers (migrations 0010, 0011).
- Functions: all `admin_*` functions, `require_admin`, `is_admin`, `audit_*` triggers and helpers, `jsonb_changes`, `session_log_rows`, `activity_day_rows`, `try_date`.
- Migrations 0006, 0007, 0009, 0010, 0011, 0012, 0014, 0015, 0021, 0022.

## 4. Business rules and permissions

- Every `admin_*` function, the content publish functions and `dictionary_sync` start with an admin check; a non-admin gets "admin only". A static check on the migrated database found a guard in all 23 of them.
- The admin tab and routes are hidden from players, but the check that matters is in the database.
- The admin cannot remove their own admin role.
- Audit: every change to content, a report decision or a player action is recorded with who, when, what, and each field's before and after. Entries are removed only through `admin_audit_delete` and `admin_audit_clear`, which leave a note of the removal.
- App settings are validated twice (browser and database) with the same ranges: for example sign-ups per network 5 to 200, daily AI calls 0 to 2,000, Live players 2 to 10, Live lifetime 1 to 168 hours. Maintenance and announcement are shown by the browser only (`PE-03`).
- Reports: the admin alone decides "resolved"; a player's later edit keeps that decision; a deleted report cannot come back.
- The report AI review and fix suggestions are admin tools; the player-side review is a separate task.
- The panel remembers the last admin page (`wh-admin-path`) so the tab reopens it.

## 5. Data flow

- Reads: each section calls the admin API with the current range (7, 30 or 90 days) and a refresh tick; results are cached only in component state.
- Content writes: the section calls a WordHunter handler (`onUpdate`, rename, merge, delete), which updates the content state; the content save effect writes it ([content](../content/README.md)).
- Report decisions: the reports hook ([question-reports.md](../practice/question-reports.md)) updates the progress `reports` list, and the repo writes the `reports` table for other players' reports (admin only).
- Player actions and settings: one function call each; the audit entry is written by the function.
- Local mode: the same shapes are computed from the browser's own data; player management says "needs the online version".

## 6. Failure, retry, cancel, offline

- A failed read shows an error in that section; the refresh button retries. No automatic retry.
- Content writes follow [content](../content/README.md): a conflict asks the admin to reload and redo.
- Actions that change players or end challenges ask for confirmation.
- Without a connection, analytics are unavailable; content editing continues in the browser and is saved with the next successful write (a warning explains).
- AI tools respect the usual timeouts and can be cancelled ([ai-media](../ai-media/README.md)).

## 7. Tests

| Check | Where |
| --- | --- |
| Admin API shapes and local mode | [tests/admin.test.js](../../../tests/admin.test.js) |
| Activity log screens and diff | [tests/audit.test.js](../../../tests/audit.test.js) |
| AI usage log screen | [tests/ai-log.test.js](../../../tests/ai-log.test.js) |
| Analytics functions and views, refusal of a player | [supabase/tests/analytics.sql](../../../supabase/tests/analytics.sql) |
| Audit entries, delete and clear, reports | [supabase/tests/audit_and_reports.sql](../../../supabase/tests/audit_and_reports.sql), [audit_delete.sql](../../../supabase/tests/audit_delete.sql), [report_ownership.sql](../../../supabase/tests/report_ownership.sql) |
| Settings, sign-up limits, rank visibility | [supabase/tests/app_settings.sql](../../../supabase/tests/app_settings.sql), [signup_limits.sql](../../../supabase/tests/signup_limits.sql), [ranks.sql](../../../supabase/tests/ranks.sql) |
| Daily history behind the charts | [supabase/tests/daily_history.sql](../../../supabase/tests/daily_history.sql) |
| Panel opens with a course loaded, at two widths | [e2e/specs/sweep.cjs](../../../e2e/specs/sweep.cjs) |
| Content admin rules and hook | [content-admin-rules.test.js](../../../tests/content-admin-rules.test.js), [content-admin-hook.test.jsx](../../../tests/content-admin-hook.test.jsx) |
| Merge, delete and remove empty categories in a browser | [e2e/specs/catadmin.cjs](../../../e2e/specs/catadmin.cjs) |
| Import and export rules and hook | [import-plan.test.js](../../../tests/import-plan.test.js), [data-transfer-hook.test.jsx](../../../tests/data-transfer-hook.test.jsx), [import-export.test.js](../../../tests/import-export.test.js) |
| Export a backup and import it back in a browser | [e2e/specs/importexport.cjs](../../../e2e/specs/importexport.cjs) |

**Gaps.** Refusal of a non-admin is tested in some SQL files, not for every `admin_*` function (the static check above is not a behavioural test). No test exercises the sections against real analytics data in the browser. Player management and the AI tools have no automated test.

## 8. Example journey

The owner investigates a complaint that a question is wrong. (Synthetic data.)

1. A player reports a gap question: reason "My answer should have been accepted". The report is saved with the full question, the answer and the player's name.
2. In Admin, Reports, the owner opens it, asks AI for a verdict and a drafted fix, then edits the word in the Words section. The change is saved through the content path and shows in the Activity log with the before and after.
3. The owner resolves the report. The player's quarantine on that word and question type ends; the report stays resolved even if the player edits their copy.
4. If the fix was wrong, the owner reverts the change from the Activity log.

## 9. Status

**Implemented.** Everything above.

**Decided:** merging a category into one that already has level stats keeps only the target's stats on this device (`CA-OBS-01`, the owner decided to keep this on 2026-10-18; [content-admin.md](content-admin.md#decisions)).

**Planned**

- Phase 1: the admin sees a visible failure when the dictionary copy does not update after a save.
- Phase 3: server-side checks that make the leaderboard numbers trustworthy (Admin, Players shows them).

**Known Issues**

- `PE-03` maintenance and announcement are enforced in the browser only.
- `DP-03` a failed dictionary copy is invisible to the admin.
- `DP-05` reports are stored in two places.
- `MT-01` (for this module, fixed for content tools and import/export) the content operations moved to `features/content-admin`, and import, export and backups to `features/data`; WordHunter keeps only the progress parts they need (`backupPayload`, `applyRestoredProgress`).
