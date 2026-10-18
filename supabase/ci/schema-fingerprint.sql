-- One line per thing in schema public that a migration can change, sorted, for diffing two databases:
-- functions (source hash, security, settings, who may execute), tables (RLS, who may do what),
-- columns, constraints, indexes, policies, triggers. Read-only: only SELECTs.
--   psql "$URL" -X -q -A -t -f supabase/ci/schema-fingerprint.sql > fingerprint.txt
-- Not included: data, the other schemas (auth, storage, ...), object owners (they differ per host).
-- Names are printed with their schema whatever the session's search_path is (it differs per role on a real project).
-- Function sources are hashed without carriage returns: a body created from a file with Windows line endings
-- (as on the production project) is the same function.
set search_path = pg_catalog;
select line from (
  select 'function ' || p.oid::regprocedure::text
         || ' src=' || md5(replace(p.prosrc, E'\r', '')) || ' secdef=' || p.prosecdef || ' vol=' || p.provolatile::text
         || ' cfg=' || coalesce(p.proconfig::text, '-')
         || ' acl=' || coalesce((select string_agg(coalesce(nullif(r.rolname, ''), 'PUBLIC') || ':' || x.privilege_type, ',' order by r.rolname, x.privilege_type)
                                  from aclexplode(p.proacl) x left join pg_roles r on r.oid = x.grantee), 'default') as line
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'table ' || c.oid::regclass::text || ' kind=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
         || ' acl=' || coalesce((select string_agg(coalesce(nullif(r.rolname, ''), 'PUBLIC') || ':' || x.privilege_type, ',' order by r.rolname, x.privilege_type)
                                  from aclexplode(c.relacl) x left join pg_roles r on r.oid = x.grantee), 'default')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'column ' || c.oid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull
         || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
         || ' acl=' || coalesce((select string_agg(coalesce(nullif(r.rolname, ''), 'PUBLIC') || ':' || x.privilege_type, ',' order by r.rolname, x.privilege_type)
                                  from aclexplode(a.attacl) x left join pg_roles r on r.oid = x.grantee), '-')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
  union all
  select 'index ' || indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'policy ' || tablename || ' ' || policyname || ' cmd=' || cmd || ' roles=' || roles::text || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
  from pg_policies where schemaname = 'public'
  union all
  select 'trigger ' || t.tgrelid::regclass::text || ' ' || pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
) x order by line;
