-- Ranks visibility tests (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_a uuid;
  v_b uuid;
  n integer;
  report text := '';
begin
  perform public.register_player('t_rank_a', 'secret1');
  perform public.register_player('t_rank_b', 'secret1');
  select id into v_a from public.profiles where username = 't_rank_a';
  select id into v_b from public.profiles where username = 't_rank_b';

  -- On (the default): a player sees everyone.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings('{"leaderboard":true}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles where id in (v_a, v_b, v_admin);
  execute 'reset role';
  if n <> 3 then raise exception 'FAIL: ranks on, player sees % of 3 profiles', n; end if;
  report := report || 'on: everyone visible; ';

  -- Off: a player sees only their own row.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings('{"leaderboard":false}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles;
  execute 'reset role';
  if n <> 1 then raise exception 'FAIL: ranks off, player sees % profiles', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles where id = v_a;
  execute 'reset role';
  if n <> 1 then raise exception 'FAIL: player lost their own profile'; end if;
  report := report || 'off: only own row; ';

  -- Off: the admin still sees everyone.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.profiles where id in (v_a, v_b, v_admin);
  execute 'reset role';
  if n <> 3 then raise exception 'FAIL: admin sees % of 3 profiles with ranks off', n; end if;
  report := report || 'admin unaffected; ';

  -- Signed-out visitors never see profiles.
  execute 'set local role anon';
  select count(*) into n from public.profiles;
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL: anon sees profiles'; end if;
  report := report || 'anon none';

  raise exception 'RANKS TESTS PASSED: %', report;
end;
$$;
