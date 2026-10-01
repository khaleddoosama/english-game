-- Activity log clean-up (Admin -> Activity log -> Delete selected / Delete
-- all). There is still no delete policy on admin_audit: entries go only
-- through these two admin functions, and every removal leaves one entry
-- saying who removed how many, so the log never empties without a trace.

create or replace function public.admin_audit_delete(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform public.require_admin();
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 10000 then
    raise exception 'Too many entries at once (at most 10,000).' using errcode = '22023';
  end if;
  delete from public.admin_audit where id = any (p_ids);
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.admin_audit (admin_id, action, target, entity, details)
    values ((select auth.uid()), 'audit.delete', format('%s log entr%s deleted', n, case when n = 1 then 'y' else 'ies' end), 'audit', jsonb_build_object('count', n));
  end if;
  return n;
end;
$$;

create or replace function public.admin_audit_clear()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform public.require_admin();
  delete from public.admin_audit where id is not null;
  get diagnostics n = row_count;
  insert into public.admin_audit (admin_id, action, target, entity, details)
  values ((select auth.uid()), 'audit.clear', format('Activity log cleared (%s entr%s)', n, case when n = 1 then 'y' else 'ies' end), 'audit', jsonb_build_object('count', n));
  return n;
end;
$$;

revoke execute on function public.admin_audit_delete(bigint[]) from public, anon;
revoke execute on function public.admin_audit_clear() from public, anon;
grant execute on function public.admin_audit_delete(bigint[]) to authenticated;
grant execute on function public.admin_audit_clear() to authenticated;
