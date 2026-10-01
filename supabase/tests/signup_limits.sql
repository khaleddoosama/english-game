-- Sign-up limits (review F13, migration 0022): per network, adjustable by
-- the admin; a new account is always a player (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  n integer := 0;
  report text := '';
begin
  -- A request from one network (the gateway passes its address on).
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings((select data from public.app_settings where id = 1) || '{"signupsPer10Min":5}');
  if (select data ->> 'signupsPer10Min' from public.app_settings where id = 1) <> '5' then raise exception 'FAIL: setting not saved'; end if;
  perform set_config('request.jwt.claims', '', true);

  for i in 1..5 loop perform public.register_player('t_sl_' || i, 'secret1'); end loop;
  begin
    perform public.register_player('t_sl_6', 'secret1');
    raise exception 'FAIL: a sixth account from the same network';
  exception when sqlstate '54000' then n := 1; end;
  report := report || 'per network; ';

  -- Another network still can.
  perform set_config('request.headers', '{"cf-connecting-ip":"198.51.100.20"}', true);
  perform public.register_player('t_sl_other', 'secret1');
  report := report || 'other networks unaffected; ';

  -- Whatever the name, the account is a player; the address is kept only as a hash.
  perform public.register_player('t_sl_admin', 'secret1');
  if (select role from public.profiles where username = 't_sl_admin') <> 'player' then raise exception 'FAIL: new account not a player'; end if;
  if exists (select 1 from public.signup_log where ip_hash in ('203.0.113.7', '198.51.100.20')) then raise exception 'FAIL: address stored in clear'; end if;
  report := report || 'always a player, address hashed; ';

  -- Players and visitors can't read the log.
  execute 'set local role anon';
  begin
    select count(*) into n from public.signup_log;
    if n > 0 then raise exception 'FAIL: visitors read the sign-up log'; end if;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  report := report || 'log private';

  raise exception 'SIGNUP LIMIT TESTS PASSED: %', report;
end;
$$;
