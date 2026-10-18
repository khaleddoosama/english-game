#!/usr/bin/env bash
# Integration tests: the app's own code (library API, repo, content save)
# against a real PostgreSQL with every migration applied, acting as the
# anon / authenticated roles (tests/integration). A fresh database is made
# for the run and dropped at the end, so nothing is left behind.
#   PGADMIN=postgres://postgres:postgres@localhost:5432/postgres supabase/ci/run-integration.sh [vitest args]
# Needs: psql, a PostgreSQL 15+ server you can create databases on, node 20+.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGADMIN:?set PGADMIN to a connection URL of a database server (any database, a superuser)}"
db="wh_it_$$_$(date +%s)"
admin() { psql "$PGADMIN" -X -v ON_ERROR_STOP=1 -q "$@"; }
admin -c "create database $db" >/dev/null
# Same server, other database: swap the database name at the end of the URL, keeping any ?options.
case "$PGADMIN" in
  *\?*) base="${PGADMIN%%\?*}"; query="?${PGADMIN#*\?}" ;;
  *)    base="$PGADMIN"; query="" ;;
esac
export PGURL="${base%/*}/$db$query"
trap 'admin -c "drop database if exists $db with (force)" >/dev/null || true' EXIT
psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -f supabase/ci/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql "$PGURL" -X -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }
done
# One file at a time: the tests share the content tables.
npx vitest run tests/integration --no-file-parallelism "$@"
