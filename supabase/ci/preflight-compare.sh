#!/usr/bin/env bash
# READ-ONLY comparison of a database (for example a real project) with what migrations 0037-0042 and their
# rollback script assume. Run it BEFORE applying or rolling back anything; the local definitions in this
# repository are not evidence about a real database.
#   supabase/ci/preflight-compare.sh "postgres://...."        (any role that can read the catalogs)
# It sends only SELECTs, in a session that is read-only (default_transaction_read_only = on).
#
# Verdict, from the fingerprint lines of the objects these migrations touch (supabase/ci/schema-fingerprint.sql):
#   BEFORE   the database is exactly as the migrations expect to find it (0001-0036): they can be applied
#   AFTER    the migrations are already applied exactly as in this repository: the rollback script fits
#   OTHER    neither: the lines that differ are printed. Do not apply or roll back until each one is explained.
# The whole-schema difference is printed as a count only (unrelated objects may differ on a real project).
set -euo pipefail
cd "$(dirname "$0")/../.."
url="${1:?give the connection URL of the database to look at}"
export PGOPTIONS="-c default_transaction_read_only=on"
touched='^function (dictionary_sync|dictionary_follow_renames|word_key_norm|admin_delete_player|content_save_v2|apply_item_renames|friend_remove|view_shares_inbox|save_progress_v2)\(|progress_ops|collection_shares|^function [a-z_]*\) '
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
psql "$url" -X -q -A -t -f supabase/ci/schema-fingerprint.sql > "$work/now"
if psql "$url" -X -q -A -t -c "select to_regclass('supabase_migrations.schema_migrations') is not null" 2>/dev/null | grep -qx t; then
  echo "migrations recorded by the platform (newest 8):"
  psql "$url" -X -q -A -t -c "select version || coalesce(' ' || name, '') from supabase_migrations.schema_migrations order by version desc limit 8" 2>/dev/null || true
else echo "(no supabase_migrations.schema_migrations table: the list of applied migrations is not available here)"; fi
pick() { grep -E "$touched" "$1" | sort; }
pick "$work/now" > "$work/now.touched"
pick supabase/ci/expected/schema-before-0037.txt > "$work/before.touched"
pick supabase/ci/expected/schema-after-0042.txt > "$work/after.touched"
echo "objects looked at: $(wc -l < "$work/now.touched") (of $(wc -l < "$work/now") in schema public)"
if diff -q "$work/now.touched" "$work/before.touched" >/dev/null; then echo "VERDICT: BEFORE - as the migrations expect (0001-0036). They can be applied; the rollback script does not apply yet."
elif diff -q "$work/now.touched" "$work/after.touched" >/dev/null; then echo "VERDICT: AFTER - migrations 0037-0042 are applied as in this repository. The rollback script fits."
else
  echo "VERDICT: OTHER - this is neither. Lines only in this database (>) or only in the 'before' expectation (<):"
  { diff "$work/before.touched" "$work/now.touched" || true; } | cut -c1-400 | head -60
  exit 2
fi
echo "whole schema, informational: $(diff "$work/now" supabase/ci/expected/schema-before-0037.txt | grep -c '^[<>]' || true) lines differ from the 'before' fingerprint, $(diff "$work/now" supabase/ci/expected/schema-after-0042.txt | grep -c '^[<>]' || true) from the 'after' one"
