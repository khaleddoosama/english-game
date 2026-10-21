# Production schema compared with the migrations (read-only)

Status: **Implemented** as a one-off check on 2026-10-21. It is not automated: no CI job can reach the production
project, and none should.

## What was compared

- The production project (PostgreSQL 17.11), read through the Supabase connector with `SELECT`s only: nothing was
  written, no data rows were read, only the catalogs.
- The query of `supabase/ci/schema-fingerprint.sql` (functions, tables, columns, constraints, indexes, policies and
  triggers of schema `public`), compared with `supabase/ci/expected/schema-after-0043.txt`, which CI builds from
  migrations 0001-0043 (`supabase/ci/check-upgrade.sh`).
- The policies on `realtime.messages` (outside the fingerprint), compared with the same migrations applied to an
  empty PostgreSQL 16 with `supabase/ci/supabase-stub.sql`.
- The platform's list of applied migrations (`supabase_migrations.schema_migrations`).

To keep the output small, each fingerprint line was compared by its MD5, per kind, and only differing lines were read
in full.

## Result

The schema is the one migrations **0001-0043** describe. Equal: all 294 columns, 132 constraints, 87 indexes, 41
policies and 13 triggers of `public`, and the 3 policies on `realtime.messages`. The remaining lines differ for two
reasons, neither of which changes behaviour:

| Difference | Objects | Why it does not matter |
| --- | --- | --- |
| Table privileges list `MAINTAIN` | all 41 tables | A privilege PostgreSQL 17 adds to the default grants; CI builds the expected file on PostgreSQL 16. With `MAINTAIN` left out, every table line is equal. |
| Function source hash | 8 of 114 functions: `friendship_signal`, `live_challenge_signal`, `live_invite_signal`, `live_player_signal` (0043), `dictionary_sync_core`, `sense_create`, `view_edit`, `view_link_accept` | Only whitespace and `--` comments differ: with whitespace collapsed (and comments removed on the repository side) the hashes are equal. Security, settings and privileges are equal. |

This also answers an earlier note: `dictionary_sync_core` on production differs from the repository's only in
comments and whitespace ([review-0037-0042.md](review-0037-0042.md), "Production application").

The platform's migration list ends at `progress_save_operations` (0042). 0043 was applied by hand in the SQL Editor
on 2026-10-19 and is not recorded there ([Live module](../modules/live/README.md)); its objects are all present.

## Not covered

- Other schemas (`auth`, `storage`, the rest of `realtime`), object owners, extensions, and the platform's settings.
- Data: no rows were read.
- `supabase/ci/preflight-compare.sh` still gives verdicts for 0037-0042 only and would count the `MAINTAIN` and whitespace
  differences as differences; this check was made by hand.
