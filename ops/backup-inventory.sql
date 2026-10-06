-- Read-only pre-backup / post-restore inventory. Run with psql as the database
-- operator. Save output privately; it contains table names and account counts.
\set ON_ERROR_STOP on
begin isolation level repeatable read read only;
select now() as captured_at, current_database() as database_name, version() as postgres_version;
-- Counts, including Auth, Storage metadata and migration history. Compare
-- counts at the same application write-freeze boundary, not while users write.
select string_agg(format('select %L as table_name, count(*)::bigint as row_count from %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' union all ' order by schemaname,tablename)
from pg_tables where schemaname in ('public','auth','storage','supabase_migrations')
\gexec
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') order by c.relname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;
select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,p.proacl as execution_grants,md5(pg_get_functiondef(p.oid)) as definition_hash
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' order by p.proname,arguments;
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t
join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage') and not t.tgisinternal order by n.nspname,c.relname,t.tgname;
select extname,extversion from pg_extension order by extname;
commit;
