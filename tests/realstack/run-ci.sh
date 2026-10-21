#!/usr/bin/env bash
# The real-stack tests after tests/realstack/up.sh: starts the gateway, waits for GoTrue and PostgREST, runs the tests,
# and fails unless every test ran and passed (a skipped suite - for example a missing variable - is a failure here).
# CI job "realstack" (.github/workflows/ci.yml). Docs: docs/integration-tests.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
export REALSTACK_URL=http://127.0.0.1:54330
export REALSTACK_PGURL=postgres://supabase_admin:postgres@127.0.0.1:54331/postgres
export REALSTACK_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
# With the Realtime service (up.sh with WITH_REALTIME=1) the delivery tests run too; they are skipped otherwise.
export REALSTACK_REALTIME="${WITH_REALTIME:-}"
node tests/realstack/proxy.cjs > /tmp/realstack-proxy.log 2>&1 &
proxy=$!
trap 'kill $proxy 2>/dev/null || true' EXIT
ready() { curl -s -o /dev/null -w '%{http_code}' "$1" | grep -qE '^(200|401|404)$'; }
for i in $(seq 1 60); do ready http://127.0.0.1:54332/health && ready http://127.0.0.1:54333/ && ready http://127.0.0.1:54330/auth/v1/health && break; sleep 2; done
ready http://127.0.0.1:54330/auth/v1/health || { echo "GoTrue or the gateway did not start"; docker logs whauth 2>&1 | tail -20; exit 1; }
out=/tmp/realstack-results.json
rc=0; npx vitest run tests/realstack --no-file-parallelism --reporter=default --reporter=json --outputFile="$out" || rc=$?
node -e '
  const r = require(process.argv[1]);
  console.log(`real stack: ${r.numPassedTests} passed, ${r.numFailedTests} failed, ${r.numPendingTests + r.numTodoTests} skipped`);
  if (r.numFailedTests || r.numPendingTests || r.numTodoTests || !r.numPassedTests) process.exit(1);
' "$out" || rc=1
if [ "$rc" -ne 0 ]; then echo "--- GoTrue"; docker logs whauth 2>&1 | tail -15; echo "--- PostgREST"; docker logs whrest 2>&1 | tail -15; [ -n "$REALSTACK_REALTIME" ] && { echo "--- Realtime"; docker logs whrealtime 2>&1 | tail -40; }; fi
exit "$rc"
