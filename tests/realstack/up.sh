#!/usr/bin/env bash
# A local stand-in for a Supabase project, from Docker Hub images (use this when `supabase start` cannot pull
# its images): supabase/postgres 15.8 + GoTrue + PostgREST, all on 127.0.0.1 (database 54331, GoTrue 54332,
# PostgREST 54333). With WITH_REALTIME=1 (CI) the Realtime service runs too (4000): it creates its own objects in the
# database (realtime.messages, realtime.send, realtime.topic) before the migrations, and delivers what the triggers
# of migration 0043 send. Without it, those objects are stand-ins created by hand below (stored, never delivered).
# Storage and Studio are not started. Then: node tests/realstack/proxy.cjs  (the gateway on 54330), and see
# docs/integration-tests.md for the test command. Stop with: docker rm -f whdb whauth whrest whrealtime
set -euo pipefail
cd "$(dirname "$0")/../.."
# (set DOCKER_HOST if the daemon is not at the default place)
SECRET=super-secret-jwt-token-with-at-least-32-characters-long
docker run -d --name whdb --network host -e POSTGRES_PASSWORD=postgres supabase/postgres:15.8.1.060 postgres -c config_file=/etc/postgresql/postgresql.conf -c port=54331 -c listen_addresses=127.0.0.1 >/dev/null
U=postgres://supabase_admin:postgres@127.0.0.1:54331/postgres
for i in $(seq 1 60); do psql $U -X -q -A -t -c "select 1" >/dev/null 2>&1 && break; sleep 1; done
psql $U -X -q -c "alter role supabase_auth_admin with password 'postgres'" -c "alter role authenticator with password 'postgres'" -c "alter role postgres with password 'postgres'" >/dev/null
docker run -d --name whauth --network host -e GOTRUE_API_HOST=127.0.0.1 -e GOTRUE_API_PORT=54332 -e API_EXTERNAL_URL=http://127.0.0.1:54330 -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:54331/postgres" -e GOTRUE_SITE_URL=http://127.0.0.1:4176 -e GOTRUE_JWT_SECRET=$SECRET -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_EXTERNAL_PHONE_ENABLED=false supabase/gotrue:v2.172.1 >/dev/null
if [ "${WITH_REALTIME:-}" = 1 ]; then
  # The Realtime service, as Supabase's own docker-compose runs it: it migrates its schema _realtime, seeds the tenant
  # "realtime-dev" (this database, this JWT secret), and creates its objects in the realtime schema of the database
  # the first time the tenant connects (asked for below with the health check).
  psql $U -X -q -c "create schema if not exists _realtime" -c "alter schema _realtime owner to supabase_admin" >/dev/null
  docker run -d --name whrealtime --network host -e PORT=4000 -e DB_HOST=127.0.0.1 -e DB_PORT=54331 -e DB_USER=supabase_admin -e DB_PASSWORD=postgres -e DB_NAME=postgres -e DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime' -e DB_ENC_KEY=supabaserealtime -e API_JWT_SECRET=$SECRET -e SECRET_KEY_BASE=UpNVntn3cDxHJpq99YMc1T1AQgQpc8kfYTuRgBiYa15BLrx8etQoXz3gZv1/u2oq -e ERL_AFLAGS='-proto_dist inet_tcp' -e DNS_NODES="''" -e RLIMIT_NOFILE=10000 -e APP_NAME=realtime -e SEED_SELF_HOST=true -e RUN_JANITOR=true supabase/realtime:${REALTIME_TAG:-v2.34.47} sh -c "/app/bin/migrate && /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)' && /app/bin/server" >/dev/null
  ANON=$(node -e 'const c=require("node:crypto");const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"})+"."+b({role:"anon",iss:"supabase-demo",exp:Math.floor(Date.now()/1000)+3600});console.log(h+"."+c.createHmac("sha256",process.argv[1]).update(h).digest("base64url"))' "$SECRET")
  for i in $(seq 1 90); do
    curl -s -o /dev/null -H "Authorization: Bearer $ANON" http://127.0.0.1:4000/api/tenants/realtime-dev/health || true
    [ "$(psql $U -X -q -A -t -c "select to_regclass('realtime.messages') is not null and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null")" = t ] && break
    sleep 2
  done
  [ "$(psql $U -X -q -A -t -c "select to_regclass('realtime.messages') is not null")" = t ] || { echo "Realtime did not create its objects"; docker logs whrealtime 2>&1 | tail -40; exit 1; }
  # realtime.messages is split by day; Realtime's janitor makes the partitions on its own schedule. Make them now
  # (yesterday to three days ahead), or every write (realtime.send, and Realtime's own permission check) fails.
  psql $U -X -q -v ON_ERROR_STOP=1 -c "do \$\$ declare d date; begin for d in select generate_series(current_date - 1, current_date + 3, interval '1 day')::date loop execute format('create table if not exists realtime.%I partition of realtime.messages for values from (%L) to (%L)', 'messages_' || to_char(d, 'YYYY_MM_DD'), d, d + 1); end loop; end \$\$" >/dev/null
  # The migrations (run as postgres, as on a project) put policies on realtime.messages: postgres must be able to.
  psql $U -X -q -v ON_ERROR_STOP=1 -c "do \$\$ declare o text; begin select tableowner into o from pg_tables where schemaname = 'realtime' and tablename = 'messages'; if o <> 'postgres' then execute format('grant %I to postgres', o); end if; end \$\$" >/dev/null
  echo "Realtime up; its objects are in the database"
else
# What the Realtime service would create (the migrations put policies on it, and migration 0043's triggers call
# realtime.send); the same objects as supabase/ci/supabase-stub.sql - keep the two in step.
psql $U -X -q -v ON_ERROR_STOP=1 <<'SQL'
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text, private boolean);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
grant execute on function realtime.topic() to authenticated;
-- Broadcast from the database: stores the message (the real service then delivers it); never fails the caller.
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$
begin
  begin
    perform set_config('realtime.topic', topic, true);
    insert into realtime.messages (payload, event, topic, private, extension) values (payload, event, topic, private, 'broadcast');
  exception when others then
    raise warning 'ErrorSendingBroadcastMessage: %', sqlerrm;
  end;
end $$;
alter function realtime.send(jsonb, text, text, boolean) owner to postgres;
alter table realtime.messages owner to postgres;
SQL
fi
# The columns the Storage service's own migrations add to buckets.
psql $U -X -q -v ON_ERROR_STOP=1 -c "alter table storage.buckets add column if not exists public boolean default false, add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[]" >/dev/null
for f in supabase/migrations/*.sql; do psql postgres://postgres:postgres@127.0.0.1:54331/postgres -X -v ON_ERROR_STOP=1 -q -1 -f $f >/dev/null 2>/tmp/mig.err || { echo "FAIL $f"; grep -v NOTICE /tmp/mig.err | head -3; exit 1; }; done
echo "migrations applied (as role postgres)"
psql $U -X -q -c "do \$\$ declare f regprocedure; begin for f in select oid::regprocedure from pg_proc where proname = 'save_progress_v2' and pronamespace = 'public'::regnamespace loop execute format('revoke execute on function %s from authenticated, public', f); end loop; end \$\$" >/dev/null # TEMPORARY BREAK
docker run -d --name whrest --network host -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:54331/postgres" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SECRET -e PGRST_SERVER_HOST=127.0.0.1 -e PGRST_SERVER_PORT=54333 -e PGRST_DB_EXTRA_SEARCH_PATH=public,extensions postgrest/postgrest:v12.2.12 >/dev/null
sleep 5; docker logs whrest 2>&1 | tail -2
