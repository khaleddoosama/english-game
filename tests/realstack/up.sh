#!/usr/bin/env bash
# A local stand-in for a Supabase project, from Docker Hub images (use this when `supabase start` cannot pull
# its images): supabase/postgres 15.8 + GoTrue + PostgREST, all on 127.0.0.1 (database 54331, GoTrue 54332,
# PostgREST 54333). Realtime, Storage and Studio are NOT started; the few objects the migrations need from
# them are created by hand below. Then: node tests/realstack/proxy.cjs  (the gateway on 54330), and see
# docs/integration-tests.md for the test command. Stop with: docker rm -f whdb whauth whrest
set -euo pipefail
cd "$(dirname "$0")/../.."
# (set DOCKER_HOST if the daemon is not at the default place)
SECRET=super-secret-jwt-token-with-at-least-32-characters-long
docker run -d --name whdb --network host -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.060 postgres -c config_file=/etc/postgresql/postgresql.conf -c port=54331 -c listen_addresses=127.0.0.1 >/dev/null
U=postgres://supabase_admin:postgres@127.0.0.1:54331/postgres
for i in $(seq 1 60); do psql $U -X -q -A -t -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
psql $U -X -q -c "alter role supabase_auth_admin with password 'postgres'" -c "alter role authenticator with password 'postgres'" -c "alter role postgres with password 'postgres'" >/dev/null
docker run -d --name whauth --network host -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=54332 -e API_EXTERNAL_URL=http://127.0.0.1:54330 -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:54331/postgres" -e GOTRUE_SITE_URL=http://127.0.0.1:4176 -e GOTRUE_JWT_SECRET=$SECRET -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false supabase/gotrue:v2.172.1 >/dev/null
# What the Realtime service would create (the migrations put policies on it); same two objects as supabase-stub.sql.
psql $U -X -q -v ON_ERROR_STOP=1 <<'SQL'
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text, private boolean);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
grant execute on function realtime.topic() to authenticated;
alter table realtime.messages owner to postgres;
-- and the columns the Storage service's own migrations add to buckets
alter table storage.buckets add column if not exists public boolean default false, add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[];
SQL
for f in supabase/migrations/*.sql; do psql postgres://postgres:postgres@127.0.0.1:54331/postgres -X -v ON_ERROR_STOP=1 -q -1 -f $f >/dev/null 2>/tmp/mig.err || { echo "FAIL $f"; grep -v NOTICE /tmp/mig.err | head -3; exit 1; }; done
echo "migrations applied (as role postgres)"
docker run -d --name whrest --network host -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:54331/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=54333 -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions postgrest/postgrest:v12.2.12 >/dev/null
sleep 5; docker logs whrest 2>&1 | tail -2
