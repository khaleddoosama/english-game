-- App settings tests (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_player uuid;
  v jsonb;
  n integer;
  report text := '';
  qs jsonb := '[{"prompt":"p1","options":["A","B"],"answer":"A"},{"prompt":"p2","options":["A","B"],"answer":"B"},{"prompt":"p3","options":["A","B"],"answer":"A"}]';
begin
  perform public.register_player('t_set', 'secret1');
  select id into v_player from public.profiles where username = 't_set';

  -- Players can read settings but not save them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  begin perform public.admin_save_settings('{"signupsOpen":false}'); raise exception 'FAIL: player saved settings';
  exception when insufficient_privilege then report := report || 'admin-only save; '; end;

  -- The admin saves; values are clamped and audited.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v := public.admin_save_settings('{"signupsOpen":false,"aiForPlayers":false,"ttsForPlayers":true,"aiDailyLimit":99999,"liveCreate":"admin","liveMaxPlayers":4,"liveMaxHours":2,"liveDefaultSeconds":17,"announcement":"Hello","announcementTone":"loud","newPlayerDefaults":{"questionsPerRound":99,"dailyGoal":1}}');
  if (v ->> 'aiDailyLimit')::integer <> 2000 or (v ->> 'liveDefaultSeconds')::integer <> 20 or v ->> 'announcementTone' <> 'info'
     or (v #>> '{newPlayerDefaults,questionsPerRound}')::integer <> 30 or (v #>> '{newPlayerDefaults,dailyGoal}')::integer <> 5 then
    raise exception 'FAIL: values not clamped: %', v;
  end if;
  select count(*) into n from public.admin_audit where action = 'settings.update' and changes ? 'signupsOpen' and changes -> 'signupsOpen' ->> 'after' = 'false';
  if n <> 1 then raise exception 'FAIL: settings change not audited'; end if;
  execute 'set local role anon';
  select count(*) into n from public.app_settings where (data ->> 'signupsOpen')::boolean = false;
  execute 'reset role';
  if n <> 1 then raise exception 'FAIL: signed-out visitors can''t read settings'; end if;
  report := report || 'clamped, audited, readable; ';

  -- Sign-ups closed.
  begin perform public.register_player('t_new', 'secret1'); raise exception 'FAIL: sign-up while closed';
  exception when insufficient_privilege then report := report || 'sign-ups closed; '; end;

  -- AI off for players, voice still on; the admin is unaffected.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  if public.ai_gate(false, 150) ->> 'reason' <> 'off' then raise exception 'FAIL: AI not off for players'; end if;
  if not (public.ai_gate(false, 150, 'tts') ->> 'ok')::boolean then raise exception 'FAIL: voice should stay on'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  if not (public.ai_gate(false, 150) ->> 'ok')::boolean then raise exception 'FAIL: admin blocked'; end if;
  report := report || 'AI off for players only; ';

  -- Live: only the admin creates; caps for players.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  begin perform public.live_create('x', 20, 2, 'together', '{}', qs); raise exception 'FAIL: player created a challenge';
  exception when insufficient_privilege then report := report || 'live create admin-only; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings('{"liveCreate":"everyone","liveMaxPlayers":4,"liveMaxHours":2,"aiDailyLimit":1}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  begin perform public.live_create('x', 20, 5, 'together', '{}', qs); raise exception 'FAIL: player beat the player cap';
  exception when sqlstate '22023' then report := report || 'player cap; '; end;
  perform public.live_create('x', 20, 4, 'anytime', '{}', qs, 100);
  select count(*) into n from public.live_challenges where host_id = v_player and expires_at < now() + interval '2 hours 1 minute';
  if n <> 1 then raise exception 'FAIL: link lifetime not capped'; end if;
  report := report || 'lifetime cap; ';

  -- Daily limit from settings.
  delete from public.ai_usage where user_id = v_player;
  if not (public.ai_gate(false, 150) ->> 'ok')::boolean then raise exception 'FAIL: first call refused'; end if;
  if public.ai_gate(false, 150) ->> 'reason' <> 'quota' then raise exception 'FAIL: settings limit ignored'; end if;
  report := report || 'daily limit from settings; ';

  raise exception 'SETTINGS TESTS PASSED: %', report;
end $$;
