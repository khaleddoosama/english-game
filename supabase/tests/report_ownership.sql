-- A player can't undo the admin's decision on a report, and a deleted
-- report can't be filed again by an old copy (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_player uuid;
  v_other uuid;
  r record;
  n integer;
  report text := '';
begin
  perform public.register_player('t_ro_one', 'secret1');
  perform public.register_player('t_ro_two', 'secret1');
  select id into v_player from public.profiles where username = 't_ro_one';
  select id into v_other from public.profiles where username = 't_ro_two';

  -- A player files a report; it can't be filed already resolved.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.reports (id, data, resolved_at) values ('rep-ro-1', '{"id":"rep-ro-1","reason":"Typo","resolvedAt":1}', now());
  execute 'reset role';
  select * into r from public.reports where id = 'rep-ro-1';
  if r.resolved_at is not null or r.data -> 'resolvedAt' <> 'null'::jsonb then raise exception 'FAIL: player filed a resolved report %', row_to_json(r); end if;
  report := report || 'filed open; ';

  -- The admin resolves it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.reports set resolved_at = '2026-10-01', data = data || '{"resolvedAt":1790000000000}' where id = 'rep-ro-1';
  execute 'reset role';

  -- The player edits the text, and tries to reopen it or hand it to someone else.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.reports set data = '{"id":"rep-ro-1","reason":"More detail","resolvedAt":null}', resolved_at = null, user_id = v_other where id = 'rep-ro-1';
  insert into public.reports (id, data) values ('rep-ro-1', '{"id":"rep-ro-1","reason":"Upsert","resolvedAt":null}')
    on conflict (id) do update set data = excluded.data, resolved_at = excluded.resolved_at;
  execute 'reset role';
  select * into r from public.reports where id = 'rep-ro-1';
  if r.resolved_at <> '2026-10-01'::timestamptz or (r.data ->> 'resolvedAt')::bigint <> 1790000000000 then raise exception 'FAIL: player undid the resolution %', row_to_json(r); end if;
  if r.user_id <> v_player then raise exception 'FAIL: report moved to another player'; end if;
  if r.data ->> 'reason' <> 'Upsert' or r.reason <> 'Upsert' then raise exception 'FAIL: player text not saved %', r.data; end if;
  if exists (select 1 from public.admin_audit where entity = 'report' and item_key = 'rep-ro-1' and action <> 'report.resolve') then raise exception 'FAIL: player edit logged as admin action'; end if;
  report := report || 'resolution kept; ';

  -- The admin can still reopen it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.reports set resolved_at = null where id = 'rep-ro-1';
  execute 'reset role';
  if (select resolved_at from public.reports where id = 'rep-ro-1') is not null then raise exception 'FAIL: admin could not reopen'; end if;
  report := report || 'admin reopens; ';

  -- The admin deletes it; the player's old copy can't file it again.
  execute 'set local role authenticated';
  delete from public.reports where id = 'rep-ro-1';
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.reports (id, data) values ('rep-ro-1', '{"id":"rep-ro-1","reason":"Again"}')
    on conflict (id) do update set data = excluded.data;
  get diagnostics n = row_count;
  insert into public.reports (id, data) values ('rep-ro-2', '{"id":"rep-ro-2","reason":"New one"}');
  execute 'reset role';
  if n <> 0 or exists (select 1 from public.reports where id = 'rep-ro-1') then raise exception 'FAIL: deleted report came back'; end if;
  if not exists (select 1 from public.reports where id = 'rep-ro-2' and user_id = v_player) then raise exception 'FAIL: new report refused'; end if;
  report := report || 'deleted stays deleted; ';

  -- Players can't read the tombstones.
  execute 'set local role authenticated';
  select count(*) into n from public.report_tombstones;
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL: player reads tombstones'; end if;
  report := report || 'tombstones private';

  raise exception 'REPORT OWNERSHIP TESTS PASSED: %', report;
end;
$$;
