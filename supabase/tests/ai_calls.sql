-- AI call log tests (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_a uuid;
  v_b uuid;
  v jsonb;
  v_id bigint;
  r record;
  n integer;
  report text := '';
begin
  perform public.register_player('t_ai_a', 'secret1');
  perform public.register_player('t_ai_b', 'secret1');
  select id into v_a from public.profiles where username = 't_ai_a';
  select id into v_b from public.profiles where username = 't_ai_b';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings('{"aiForPlayers":true,"ttsForPlayers":true,"aiDailyLimit":2}');

  -- An allowed call: the gate logs it as started, with the feature.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v := public.ai_gate(false, 150, 'ai', 'Ask AI about a word', '{"term":"fork"}', 1234);
  v_id := (v ->> 'call')::bigint;
  if not (v ->> 'ok')::boolean or v_id is null then raise exception 'FAIL: gate %', v; end if;
  select * into r from public.ai_calls where id = v_id;
  if r.status <> 'started' or r.task <> 'Ask AI about a word' or r.user_id <> v_a or r.prompt_chars <> 1234 or r.preview <> '{"term":"fork"}' then raise exception 'FAIL: logged row %', row_to_json(r); end if;
  report := report || 'gate logs; ';

  -- Someone else can't finish it; the owner can, once.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.ai_call_finish(v_id, false, 'x', 1, 500, 'forged');
  if (select status from public.ai_calls where id = v_id) <> 'started' then raise exception 'FAIL: another player finished the call'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.ai_call_finish(v_id, true, 'gemini-x', 850, 200, null, 400, 300, 120);
  perform public.ai_call_finish(v_id, false, 'other', 1, 500, 'again');
  select * into r from public.ai_calls where id = v_id;
  if r.status <> 'ok' or r.model <> 'gemini-x' or r.ms <> 850 or r.input_tokens <> 300 or r.output_tokens <> 120 or r.finished_at is null then raise exception 'FAIL: finish %', row_to_json(r); end if;
  report := report || 'finish own row once; ';

  -- A failed call keeps its error.
  v := public.ai_gate(false, 150, 'tts', 'Pronunciation', 'see you later', 13);
  perform public.ai_call_finish((v ->> 'call')::bigint, false, 'gemini-tts', 40000, 503, 'The AI is very busy right now.');
  if not exists (select 1 from public.ai_calls where id = (v ->> 'call')::bigint and status = 'error' and kind = 'tts' and http_status = 503 and reason like 'The AI is very busy%') then raise exception 'FAIL: error not kept'; end if;
  report := report || 'errors kept; ';

  -- Refusals are logged with their reason: admin-only, quota, AI off.
  v := public.ai_gate(true, 150, 'ai', 'Write a story');
  if v ->> 'reason' <> 'admin' or not exists (select 1 from public.ai_calls where id = (v ->> 'call')::bigint and status = 'denied' and reason = 'admin') then raise exception 'FAIL: admin-only refusal %', v; end if;
  v := public.ai_gate(false, 150, 'ai', 'Check a written answer');
  if v ->> 'reason' <> 'quota' or not exists (select 1 from public.ai_calls where id = (v ->> 'call')::bigint and status = 'denied' and reason = 'quota') then raise exception 'FAIL: quota refusal %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_save_settings('{"aiForPlayers":false,"aiDailyLimit":150}');
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v := public.ai_gate(false, 150, 'ai', 'Ask AI about a word');
  if v ->> 'reason' <> 'off' or not exists (select 1 from public.ai_calls where id = (v ->> 'call')::bigint and status = 'denied' and reason = 'off' and user_id = v_b) then raise exception 'FAIL: off refusal %', v; end if;
  report := report || 'refusals logged; ';

  -- Long input is cut; players can't read the log or the summary.
  v := public.ai_gate(false, 150, 'tts', repeat('x', 200), repeat('y', 1000));
  if (select length(task) from public.ai_calls where id = (v ->> 'call')::bigint) <> 80 or (select length(preview) from public.ai_calls where id = (v ->> 'call')::bigint) <> 300 then raise exception 'FAIL: not cut'; end if;
  execute 'set local role authenticated';
  select count(*) into n from public.ai_calls;
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL: a player reads % AI calls', n; end if;
  begin perform public.admin_ai_summary(30); raise exception 'FAIL: player read the summary';
  exception when insufficient_privilege then null; end;
  report := report || 'admin only; ';

  -- The summary adds up.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v := public.admin_ai_summary(1);
  if (v #>> '{totals,ok}')::integer < 1 or (v #>> '{totals,errors}')::integer < 1 or (v #>> '{totals,denied}')::integer < 3
     or not exists (select 1 from jsonb_array_elements(v -> 'by_task') t where t ->> 'task' = 'Ask AI about a word' and (t ->> 'ok')::integer >= 1 and (t ->> 'denied')::integer >= 1)
     or not exists (select 1 from jsonb_array_elements(v -> 'by_user') u where u ->> 'username' = 't_ai_a')
     or not exists (select 1 from jsonb_array_elements(v -> 'by_reason') x where x ->> 'reason' = 'quota') then
    raise exception 'FAIL: summary %', v;
  end if;
  report := report || 'summary';

  raise exception 'AI CALL TESTS PASSED: %', report;
end;
$$;
