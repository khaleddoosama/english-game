-- Activity log deletion tests (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_player uuid;
  v_ids bigint[];
  n integer;
  report text := '';
begin
  perform public.register_player('t_audit_del', 'secret1');
  select id into v_player from public.profiles where username = 't_audit_del';
  with ins as (
    insert into public.admin_audit (admin_id, action, target, entity, item_key)
    values (v_admin, 'content.update', 'test', 'words', 't-a'), (v_admin, 'content.update', 'test', 'words', 't-b'), (v_admin, 'content.update', 'test', 'words', 't-c')
    returning id)
  select array_agg(id order by id) into v_ids from ins;

  -- Players can't delete, directly or through the functions.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  begin perform public.admin_audit_delete(v_ids); raise exception 'FAIL: player deleted log entries';
  exception when insufficient_privilege then report := report || 'player refused; '; end;
  begin perform public.admin_audit_clear(); raise exception 'FAIL: player cleared the log';
  exception when insufficient_privilege then null; end;
  execute 'set local role authenticated';
  delete from public.admin_audit where id = any (v_ids);
  execute 'reset role';
  if (select count(*) from public.admin_audit where id = any (v_ids)) <> 3 then raise exception 'FAIL: a direct delete got through'; end if;
  report := report || 'no direct delete; ';

  -- The admin deletes two; one note records it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  n := public.admin_audit_delete(v_ids[1:2] || array[-1::bigint]);
  if n <> 2 then raise exception 'FAIL: deleted % instead of 2', n; end if;
  if (select count(*) from public.admin_audit where id = any (v_ids)) <> 1 then raise exception 'FAIL: wrong entries left'; end if;
  if not exists (select 1 from public.admin_audit where action = 'audit.delete' and admin_id = v_admin and (details ->> 'count')::integer = 2) then raise exception 'FAIL: deletion not noted'; end if;
  if public.admin_audit_delete(array[]::bigint[]) <> 0 then raise exception 'FAIL: empty list'; end if;
  report := report || 'delete selected + note; ';

  -- Clear: everything goes, then one note says how many.
  n := public.admin_audit_clear();
  if n < 2 then raise exception 'FAIL: clear removed only %', n; end if;
  if (select count(*) from public.admin_audit) <> 1 or not exists (select 1 from public.admin_audit where action = 'audit.clear' and (details ->> 'count')::integer = n)
    then raise exception 'FAIL: clear left % rows', (select count(*) from public.admin_audit); end if;
  report := report || format('clear (%s) + note', n);

  raise exception 'AUDIT DELETE TESTS PASSED: %', report;
end;
$$;
