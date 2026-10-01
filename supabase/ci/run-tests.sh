#!/usr/bin/env bash
# Applies every migration to an empty plain Postgres (with stand-ins for
# Supabase's own schemas) and runs every SQL test inside a rolled-back
# transaction. Each test ends by raising "... TESTS PASSED" or "FAIL: ...".
#   PGURL=postgres://postgres:postgres@localhost:5432/postgres supabase/ci/run-tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGURL:?set PGURL to an empty database}"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f supabase/ci/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }
  echo "applied $(basename "$f")"
done
# The tests act as the first admin.
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "select public.register_player('ci_admin', 'secret1')" -c "update public.profiles set role = 'admin' where username = 'ci_admin'" >/dev/null
fail=0
for f in supabase/tests/*.sql; do
  out=$(printf 'begin;\n\\i %s\nrollback;\n' "$f" | psql "$PGURL" -q 2>&1 || true)
  if grep -q "TESTS PASSED" <<<"$out"; then
    echo "ok    $(basename "$f")"
  else
    echo "FAIL  $(basename "$f")"; grep -E "ERROR|FAIL" <<<"$out" | head -5; fail=1
  fi
done
exit $fail
