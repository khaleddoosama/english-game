#!/usr/bin/env bash
# Upgrade and rollback check for migrations 0037-0042. A database as it is before them (0001-0036, with
# made-up data in it), then the six migrations, then what must have changed and what must not, then the
# rollback script, then a comparison of the WHOLE schema (functions with their source hash and who may
# execute them, tables with RLS and privileges, columns, constraints, indexes, policies, triggers) with the
# schema before, and finally the migrations again on top of the rolled-back database.
#   PGADMIN=postgres://postgres:postgres@localhost:5432/postgres supabase/ci/check-upgrade.sh
# Creates and drops its own database. Nothing real is touched. Runs in CI (job "database").
#
# What this proves: the migrations and the rollback script, on a plain PostgreSQL with Supabase stand-ins
# (supabase-stub.sql), starting from the migration files of this repository. What it does NOT prove: that a
# real project is in that "before" state. For that, run supabase/ci/preflight-compare.sh against it first.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGADMIN:?set PGADMIN to a connection URL of a database server (any database, a superuser)}"
db="wh_up_$$_$(date +%s)"
work="$(mktemp -d)"
admin() { psql "$PGADMIN" -X -v ON_ERROR_STOP=1 -q "$@"; }
admin -c "create database $db" >/dev/null
case "$PGADMIN" in *\?*) base="${PGADMIN%%\?*}"; query="?${PGADMIN#*\?}" ;; *) base="$PGADMIN"; query="" ;; esac
export PGURL="${base%/*}/$db$query"
trap 'admin -c "drop database if exists $db with (force)" >/dev/null || true; rm -rf "$work"' EXIT
q() { psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -A -t "$@"; }
apply() { psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f "$1" >/dev/null; }
fingerprint() { q -f supabase/ci/schema-fingerprint.sql > "$1"; }

psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/supabase-stub.sql
for f in supabase/migrations/00[0-2]*.sql supabase/migrations/003[0-6]*.sql; do apply "$f"; done
echo "before: migrations up to 0036 applied"
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/upgrade-seed.sql >/dev/null
echo "before: made-up data seeded"
fingerprint "$work/schema_before"
# The committed expectations (supabase/ci/expected, used by preflight-compare.sh) must be what this run sees.
# WRITE_EXPECTED=1 rewrites them after a change of the migrations or of the fingerprint.
expect() { # expect <actual> <committed>
  if [ "${WRITE_EXPECTED:-}" = 1 ]; then cp "$1" "$2"; echo "wrote $2"; elif ! diff -q "$1" "$2" >/dev/null; then echo "$2 is out of date (run with WRITE_EXPECTED=1):"; diff "$2" "$1" | head -20; exit 1; fi
}
expect "$work/schema_before" supabase/ci/expected/schema-before-0037.txt

snapshot() { q -c "select jsonb_build_object(
    'profiles', (select count(*) from public.profiles), 'mastery', (select count(*) from public.mastery), 'progress', (select count(*) from public.progress),
    'content', (select count(*) from public.content_items), 'senses', (select count(*) from public.senses), 'library', (select count(*) from public.library_entries),
    'collections', (select count(*) from public.collections), 'collection_senses', (select count(*) from public.collection_senses),
    'friendships', (select count(*) from public.friendships), 'shares', (select count(*) from public.collection_shares),
    'aliases', (select count(*) from public.item_key_aliases))" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, indent=1))"; }
snapshot > "$work/rows_before"

forward() { for f in supabase/migrations/003[7-9]*.sql supabase/migrations/004[0-2]*.sql; do apply "$f"; echo "applied $(basename "$f")"; done; }
forward
fingerprint "$work/schema_after"
changed=$(diff "$work/schema_before" "$work/schema_after" | grep -c '^[<>]' || true)
[ "$changed" -gt 0 ] || { echo "the fingerprint did not see the migrations (it would not see a failed rollback either)"; exit 1; }
expect "$work/schema_after" supabase/ci/expected/schema-after-0042.txt
echo "after: the fingerprint sees $changed changed lines (functions, a table, a constraint, privileges)"

psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/upgrade-check.sql
echo "after: data and behaviour checks passed"
snapshot > "$work/rows_after"
# Row counts: only what the migrations are meant to change may differ (the checks above add and delete rows
# of their own, so this is informational, not a gate).
diff "$work/rows_before" "$work/rows_after" > /dev/null && echo "after: no row count changed" || echo "after: row counts differ (the data checks above create and delete rows)"

# rollback: the whole schema is what it was
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f supabase/rollback/0037_0042_down.sql >/dev/null
fingerprint "$work/schema_down"
if diff -q "$work/schema_before" "$work/schema_down" >/dev/null; then
  echo "rollback: the whole schema is exactly as before ($(wc -l < "$work/schema_before") objects: functions with source hash and privileges, tables with RLS and privileges, columns, constraints, indexes, policies, triggers)"
else
  echo "rollback: the schema is DIFFERENT from before:"; diff "$work/schema_before" "$work/schema_down" | head -40; exit 1
fi
q -c "select count(*) from public.collection_shares where status not in ('pending','accepted','dismissed')" | grep -qx 0 && echo "rollback: no row breaks the old status check"

# and forward again: a rolled-back database takes the migrations as a fresh one does
forward >/dev/null
fingerprint "$work/schema_again"
if diff -q "$work/schema_after" "$work/schema_again" >/dev/null; then echo "again: migrations after a rollback give the same schema as the first time"; else echo "again: DIFFERENT"; diff "$work/schema_after" "$work/schema_again" | head -20; exit 1; fi
