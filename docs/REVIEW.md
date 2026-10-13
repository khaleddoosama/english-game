# Code and database review

Reviewed 2026-10-13 on `master` (plus the new `/api/hello`). Read-only: nothing
in the database was changed.

## Health

| Check | Result |
|---|---|
| `npm test` | 26 files, 270 tests, all pass |
| `npm run lint` | clean |
| `npm run build` | OK (PWA, 34 precache entries, ~950 KiB) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Supabase project `word-hunter` | ACTIVE_HEALTHY, Postgres 17, 21 public tables, RLS on for all |

Data size now: 768 content items, 371 mastery rows, 3 players, 886 AI calls
logged, 2412 audit rows, 9 Live challenges.

## Database findings

1. **Migration list drift (most important).** The repo has 25 migration
   files (`0001`–`0025`). The live project's migration list has 24 entries with
   other names, and has **no entries** for `0017` content_publish, `0018`
   report_ownership, `0019` server_only_writes, `0020` live_fairness, `0021`
   daily_history, `0022` signup_limits, and `0012`/`0013` are named differently.
   The tables from those files exist (`content_drafts`, `report_tombstones`,
   `signup_log`), so they were applied by hand (SQL editor), not through the
   migration tool. Risk: `supabase db push` or a branch would try to re-run or
   skip them. Fix: compare the live schema with the repo, then repair the
   history (`supabase migration repair`) or add a single baseline migration.
2. **Security advisor — expected, no action:** 48 `SECURITY DEFINER` functions
   callable by `authenticated` and `register_player` by `anon`. This is the
   design (every function checks `require_admin()` / `auth.uid()`). When you add
   a function, keep that check as its first line.
3. **Security advisor — worth fixing:** *Leaked password protection is off*
   (Supabase → Authentication → Password security). Passwords are the only
   login, so turn it on.
4. **Info:** four tables have RLS with no policy (`content_drafts`,
   `live_answer_keys`, `report_tombstones`, `signup_log`). Intended: only
   functions reach them. Keep a comment in the migration saying so.
5. **Performance, low priority:** no index on foreign keys
   `app_settings.updated_by`, `friendships.requested_by`,
   `live_invites.invited_by`; `signup_log` has no primary key. Tables are tiny
   today, so this does not hurt yet.
6. `admin_audit` grows fast (2412 rows for 3 players). Plan a retention rule
   or archive when it passes ~50k rows.

## Code findings

1. `src/app/WordHunter.jsx` is 2282 lines (next largest: `engine/questions.js`
   837, `engine/v2.js` 803, `engine/ai.js` 733). Splitting WordHunter into
   screens would make changes safer.
2. `src/engine/v2.js` wraps everything in one big IIFE (`V2 = (() => {…})()`),
   which hurts tree-shaking and readability. Candidate for named exports.
3. ESLint only enforces undefined names, hooks order and unused vars. No
   formatter (Prettier) and no type checking.
4. No browser-level (Playwright) tests; UI is covered through unit tests only.
   Chromium is available in the cloud environment if you want to add a smoke test.
5. `word-hunter-backup.json` (1.7 MB) is committed. It holds an old
   `activeSession` and progress, so check it has no private data, and consider
   moving it out of git (the README uses it for the first run).
6. `legacy/` and `imports/` are excluded from lint and build; remove them
   when they are no longer needed.
7. Good: server-side AI allow-list, daily quotas, answer keys never sent to
   players, diff-based saves with 3-way merge, SQL tests per feature, CI that
   runs migrations on an empty Postgres.

## Suggested next steps (in order)

1. Turn on leaked-password protection.
2. Repair the migration history (finding 1).
3. Add a `.github/pull_request_template.md` if you want PR notes in one shape.
4. Split `WordHunter.jsx`.
5. Add a Playwright smoke test (login → practice round).
