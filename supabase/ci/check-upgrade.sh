#!/usr/bin/env bash
# Upgrade check for migrations 0037-0040: a database as it is before them (0001-0036,
# with made-up data in it), then the four migrations, then what must have changed and
# what must not, then the rollback script, then a comparison with the "before" definitions.
#   PGADMIN=postgres://postgres:postgres@localhost:5432/postgres supabase/ci/check-upgrade.sh
# Creates and drops its own database. Nothing real is touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGADMIN:?set PGADMIN to a connection URL of a database server (any database, a superuser)}"
db="wh_up_$$_$(date +%s)"
admin() { psql "$PGADMIN" -X -v ON_ERROR_STOP=1 -q "$@"; }
admin -c "create database $db" >/dev/null
case "$PGADMIN" in *\?*) base="${PGADMIN%%\?*}"; query="?${PGADMIN#*\?}" ;; *) base="$PGADMIN"; query="" ;; esac
export PGURL="${base%/*}/$db$query"
trap 'admin -c "drop database if exists $db with (force)" >/dev/null || true' EXIT
q() { psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -A -t "$@"; }

psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/supabase-stub.sql
for f in supabase/migrations/00[0-2]*.sql supabase/migrations/003[0-6]*.sql; do psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null; done
echo "before: migrations up to 0036 applied"
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/upgrade-seed.sql >/dev/null
echo "before: made-up data seeded"

defs() { q -c "select string_agg(pg_get_functiondef(p.oid), E'\n--\n' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('dictionary_sync', 'admin_delete_player', 'content_save_v2', 'friend_remove', 'view_shares_inbox')"; }
snapshot() { q -c "select jsonb_build_object(
    'profiles', (select count(*) from public.profiles), 'mastery', (select count(*) from public.mastery), 'progress', (select count(*) from public.progress),
    'content', (select count(*) from public.content_items), 'senses', (select count(*) from public.senses), 'library', (select count(*) from public.library_entries),
    'collections', (select count(*) from public.collections), 'collection_senses', (select count(*) from public.collection_senses),
    'friendships', (select count(*) from public.friendships), 'shares', (select count(*) from public.collection_shares),
    'aliases', (select count(*) from public.item_key_aliases))"; }
defs > /tmp/up_defs_before.$$
snapshot > /tmp/up_snap_before.$$
q -c "select jsonb_object_agg(status, n) from (select status, count(*) n from public.collection_shares group by 1) x" > /tmp/up_shares_before.$$

for f in supabase/migrations/0037*.sql supabase/migrations/0038*.sql supabase/migrations/0039*.sql supabase/migrations/0040*.sql; do
  psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null; echo "applied $(basename "$f")"
done
snapshot > /tmp/up_snap_after.$$
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/upgrade-check.sql
echo "after: data checks passed (counts: $(cat /tmp/up_snap_before.$$ | tr -d '\n' | cut -c1-60)…)"
diff <(echo "$(cat /tmp/up_snap_before.$$)" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, sort_keys=True, indent=1))") <(python3 -c "import json,sys; d=json.load(open('/tmp/up_snap_after.$$')); print(json.dumps(d, sort_keys=True, indent=1))") && echo "after: no row count changed" || true

# rollback: the functions are what they were, nothing else is left behind
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f supabase/rollback/0037_0040_down.sql >/dev/null
defs > /tmp/up_defs_after_down.$$
if diff -q /tmp/up_defs_before.$$ /tmp/up_defs_after_down.$$ >/dev/null; then echo "rollback: the five functions are exactly as before"; else echo "rollback: DIFFERENT"; diff /tmp/up_defs_before.$$ /tmp/up_defs_after_down.$$ | head -20; exit 1; fi
left=$(q -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('dictionary_follow_renames', 'word_key_norm')")
[ "$left" = "0" ] && echo "rollback: the two new helper functions are gone" || { echo "rollback: helpers left"; exit 1; }
q -c "select count(*) from public.collection_shares where status not in ('pending','accepted','dismissed')" | grep -qx 0 && echo "rollback: the status check is the old one again, no row breaks it"
rm -f /tmp/up_*.$$
