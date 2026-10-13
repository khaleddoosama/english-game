# Database (Supabase / Postgres)

Source of truth: `supabase/migrations/0001 … 0025` (apply in order). Never
edit an applied migration; add a new one. Every feature has a SQL test in
`supabase/tests/`. Run one by hand as `begin; \i supabase/tests/x.sql; rollback;` —
it ends by raising `… TESTS PASSED`.

## 1. Rules used by all migrations

- RLS is on for every table. Tables that only functions may touch have **no policies**.
- Functions are `security definer` with `set search_path = ''` and check `auth.uid()` / `is_admin()` themselves.
- `execute` is revoked from `public, anon`; granted to `authenticated` (or `service_role` for server-only ones).
- Admin pages call `admin_*` functions; each starts with `require_admin()`.

## 2. Tables

### Accounts

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= auth user), `username` (`^[a-z0-9_]{3,20}$`, unique), `role` (`admin`/`player`), `score`, `mastered_count`, `study_streak`, `best_study_streak`, `week_start`, `week_score`, `live_wins`, `live_played` | players cannot update it directly since 0016; `save_progress_v2` fills the leaderboard numbers. With `leaderboard = false` (0013) players read only their own row |
| `signup_log` (0022) | network hash, time | no policies; only `register_player` uses it |

### Content (shared, admin writes)

| Table | Meaning |
|---|---|
| `content_items` `(kind, key)` | `kind ∈ words grammar challenges stories combos`; `data` = the item JSON; `position` (gaps of 1000 so inserts don't renumber); `deleted` tombstone; `updated_at` drives incremental sync |
| `content_meta` (one row, `id = 1`) | `level_order`, `note`, `version` — clients compare `version` to their cache |
| `content_drafts` (0017) | staging for large imports; no policies; read/written only by `content_save_v2` |
| `item_key_aliases` (0017) | remembers renames (`word`/`category`: `from_key → to_key`) so an offline device that still sends the old name is mapped |
| `app_settings` (one row) | all admin switches (see data-reference §12); readable by `anon` and `authenticated` |

### Player progress (private)

| Table | Meaning |
|---|---|
| `progress` `(user_id, section)` | `data` jsonb per section, plus **`rev`** (0016) that goes up on each update (trigger `progress_bump_rev`) |
| `mastery` `(user_id, item_key)` | `stats` jsonb — one row per word / `grammar:…` / `combo:…` / `challenge:…` |
| `reports` | `id`, `user_id`, `data`, `resolved_at`, `created_at` + real columns copied by trigger (0009: question, options, answers, learner answer, reason…) |
| `report_tombstones` (0018) | ids of deleted reports so an old device can't file them again |
| `ai_usage` `(user_id, day)` | calls per day for the quota |

### Live Challenge (see [live-challenge.md](live-challenge.md))

| Table | Meaning | Policies |
|---|---|---|
| `live_challenges` | one row per challenge: `code`, `host_id`, `title`, `question_count` (3–50), `seconds` (0 or 5–120), `max_players` (2–10), `start_mode` (`together`/`anytime`), `settings`, `questions` (no answers), `state` (`lobby`/`playing`/`done`), `created_at`, `started_at`, `ended_at`, `expires_at` | members, host, admin can select |
| `live_answer_keys` | `code → answers[]` (secret) | **none** |
| `live_players` | `(code, user_id)`: `joined_at`, `started_at`, `last_at`, `answered`, `correct`, `total_ms`, `finished_at` | members see who plays |
| `live_answers` | `(code, user_id, idx)`: `choice`, `correct`, `ms`, `answered_at` | a player sees their own; everyone's only through `live_view` after the end |
| `live_results` | final ranking per player (`rank`, `points`, `correct`, `total`, `players`, `total_ms`, `finished`, `is_host`, `played_at`); a trigger bumps `profiles.live_played/live_wins` (a host's win does not count) | readable by players; written only by `live_finalize` |
| `live_rooms` | old 4-letter rooms from 0001; dropped in 0008 | — |
| `live_invites` (0024) | `(code, user_id, invited_by, dismissed)` | read by the two people named |

### Social (0024, 0025)

`friendships (user_a < user_b, requested_by, status, ended_by)` — one row per pair. `status ∈ pending accepted declined removed cancelled`. Limits: 100 friends, 20 waiting requests, 20 invitations per call. After a decline or a removal the *other* player waits a week to ask again.

### Audit and AI

| Table | Meaning |
|---|---|
| `admin_audit` (0006, 0009) | every admin change with field-by-field before/after, written by **triggers**; deletable only through `admin_audit_delete` / `admin_audit_clear`, which leave a note (0014) |
| `ai_calls` (0015) | one row per AI/voice request: user, time, `kind` (`ai`/`tts`), `task`, `status` (`started ok error denied`), `reason`, `model`, `ms`, tokens, `preview`. The gate writes it; **only the server** finishes it (0019) |

## 3. Functions by area

**Accounts:** `register_player` (username+password, placeholder email on a `.test` domain, rate limits, always a player), `handle_new_user` (trigger → profile), `is_admin`, `require_admin`, `leaderboard_visible`, `request_ip`.

**Content:** `apply_content_changes` (old), **`content_save_v2`** (draft → publish in one step, checks `p_expected_version`, applies `p_renames`, error code `40001` = someone else saved), `apply_item_renames` (moves mastery, pools, confusions, reports, level stats, cleared levels).

**Progress:** **`save_progress_v2`** (one advisory lock per player; compares `p_expected` revisions section by section and returns `{conflict:[…], sections}` instead of writing; fills `score`, streaks and `week_score` from the saved data; `p_replace` is for restoring a backup), `reset_my_progress`, `json_int`.

**Settings:** `app_setting(key)`, `admin_save_settings` (validates every value).

**AI:** `ai_gate` (signed in? admin-only? switch off? quota? → inserts the `ai_calls` row and returns its id), `ai_call_finish` (service role only, once, within 15 minutes).

**Live:** `live_create`, `live_view`, `live_join`, `live_start`, `live_begin`, `live_answer`, `live_end`, `live_leave`, `live_remove_player`, `live_set_next`, `live_mine`, `live_invite_friends`, `live_my_invites`, `live_invite_dismiss`, `live_invites_sent`, `is_live_member`; internal (no one can call): `live_finalize`, `live_settle`.

**Social:** `friend_request`, `friend_respond`, `friend_remove`, `friends_list`, `friend_count`, `are_friends`, `social_counts`.

**Admin:** `admin_overview`, `admin_analytics`, `admin_players`, `admin_player_detail`, `admin_set_role`, `admin_set_password`, `admin_reset_player`, `admin_delete_player`, `admin_activity`, `admin_word_stats`, `admin_data_issues`, `admin_ai_summary`, `admin_ai_usage`, `admin_live_matches`, `admin_live_challenges`.

**Triggers:** `on_auth_user_created`, `on_live_result` (`bump_live_counters`), `progress_bump_rev`, report triggers (`reports_fill_columns`, `reports_keep_decision`, `reports_no_resurrect`, `reports_tombstone`), `audit_*` triggers.

## 4. `analytics` schema (not exposed by the API)

Views for the admin Data-quality and Overview pages, read through admin-only functions or in the SQL editor: `words`, `word_play`, `word_quality`, `word_mode_accuracy`, `mode_accuracy`, `category_summary`, `player_summary`, `report_details`, `live_challenge_summary`, `daily_activity`, `content_changes`, `data_issues`. Try `select * from analytics.data_issues;`.

## 5. Storage buckets

| Bucket | Who writes | Notes |
|---|---|---|
| `word-images` (public, 2 MB; webp/jpeg/png/gif) | admin only | `images.js` resizes uploads; `/api/image-import` stores copies as `links/<sha256>.<ext>` |
| `tts` (public, 4 MB; wav/mp3/ogg) | **server only** (secret key, since 0019) | files `v2/<sha256(model\|voice\|text)>.wav`; `v1/` files had the instruction spoken aloud and are never reused |

## 6. Realtime

Private channels named `live:<CODE>`. Policies on `realtime.messages` allow select/insert only if `is_live_member(substr(topic, 6))`. Today clients send the messages themselves (see [live-challenge.md](live-challenge.md) for why that matters).

## 7. How a progress save travels (database side)

1. App: `repo.saveProgress` → local IndexedDB snapshot marked `dirty` → `rpc('save_progress_v2', {p_sections (changed only), p_expected (revs), p_mastery (changed rows), p_mastery_removes, p_profile, p_replace})`.
2. DB: advisory lock → for each section compare `rev` with `p_expected`; any difference → return `{conflict, sections}` and write **nothing**.
3. App: three-way merge (`progressMerge.js`) of base / local / server → retry (max 4 times).
4. DB on success: upsert sections (revision +1 by trigger), upsert/delete mastery, update `profiles` numbers.

## 8. Checklist when you add a migration

1. New file `00NN_name.sql`, header comment saying *why*.
2. RLS on; policies or none (and say which).
3. `revoke execute … from public, anon; grant … to authenticated`.
4. A test `supabase/tests/<feature>.sql` ending with `raise exception '… TESTS PASSED'`.
5. Run `PGURL=… supabase/ci/run-tests.sh`.
6. Update this doc and the root README list.
