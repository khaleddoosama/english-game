-- Live Challenge server tests. Run inside a transaction that is thrown
-- away: the block always ends by raising, so nothing it creates is kept.
--   begin; <this file>; rollback;
-- The error message is the report: "LIVE TESTS PASSED: …" or "FAIL: …".
do $$
declare
  a uuid; b uuid; c uuid; d uuid;
  v_code text; v_any text; v jsonb; r jsonb; n integer; t text;
  report text := '';
  qs jsonb := '[
    {"mode":"meaning","prompt":"p1","options":["Apple","Bread","Cheese"],"answer":"Apple","word":"apple","explanation":"a fruit","sentences":["s1"]},
    {"mode":"gap","prompt":"p2","options":["Apple","Bread","Cheese"],"answer":"Bread","word":"bread"},
    {"mode":"reverse","prompt":"p3","options":["Apple","Bread","Cheese"],"answer":"Cheese","word":"cheese"}
  ]';
begin
  perform public.register_player('t_alice', 'secret1');
  perform public.register_player('t_bob', 'secret1');
  perform public.register_player('t_cara', 'secret1');
  perform public.register_player('t_dan', 'secret1');
  select id into a from public.profiles where username = 't_alice';
  select id into b from public.profiles where username = 't_bob';
  select id into c from public.profiles where username = 't_cara';
  select id into d from public.profiles where username = 't_dan';

  -- create (as alice)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin perform public.live_create('x', 20, 11, 'together', '{}', qs); raise exception 'FAIL: 11 players accepted';
  exception when sqlstate '22023' then report := report || 'max 10 players; '; end;
  begin perform public.live_create('x', 20, 1, 'together', '{}', qs); raise exception 'FAIL: 1 player accepted';
  exception when sqlstate '22023' then report := report || 'min 2 players; '; end;
  begin perform public.live_create('x', 20, 3, 'together', '{}', '[{"prompt":"p","options":["A","B"],"answer":"Z"}, {"prompt":"p","options":["A","B"],"answer":"A"}, {"prompt":"p","options":["A","B"],"answer":"A"}]');
    raise exception 'FAIL: answer outside options accepted';
  exception when sqlstate '22023' then report := report || 'answer must be an option; '; end;
  v_code := public.live_create('Food', 20, 3, 'together', '{"lesson":"Food"}', qs);
  if v_code !~ '^[A-Z0-9]{6}$' then raise exception 'FAIL: bad code %', v_code; end if;
  v := public.live_view(v_code);
  if v ->> 'state' <> 'lobby' or not (v ->> 'member')::boolean or jsonb_array_length(v -> 'players') <> 1 then raise exception 'FAIL: host view %', v; end if;
  if (v -> 'questions')::text like '%answer%' or (v -> 'questions') ::text like '%a fruit%' then raise exception 'FAIL: answers leak to players: %', v -> 'questions'; end if;
  if v -> 'key' <> 'null'::jsonb then raise exception 'FAIL: key shown before the end'; end if;
  report := report || 'created ' || v_code || ', no answers in questions; ';

  -- preview and join (bob, cara), dan finds it full
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  v := public.live_view(lower(v_code));
  if (v ->> 'member')::boolean or v -> 'questions' <> 'null'::jsonb then raise exception 'FAIL: preview shows questions'; end if;
  begin perform public.live_start(v_code); raise exception 'FAIL: non-host started';
  exception when sqlstate '42501' then report := report || 'only host starts; '; end;
  v := public.live_join(v_code);
  if jsonb_array_length(v -> 'players') <> 2 or jsonb_array_length(v -> 'questions') <> 3 then raise exception 'FAIL: join %', v; end if;
  perform public.live_join(v_code); -- joining twice is harmless
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.live_join(v_code);
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  begin perform public.live_join(v_code); raise exception 'FAIL: joined a full challenge';
  exception when sqlstate '55000' then report := report || 'full at 3/3; '; end;
  begin perform public.live_join('ZZZZZZ'); raise exception 'FAIL: joined a missing challenge';
  exception when sqlstate 'P0002' then report := report || 'unknown code; '; end;

  -- RLS: dan sees nothing of it, nobody reads the key
  execute 'set local role authenticated';
  select count(*) into n from public.live_challenges where code = v_code;
  if n <> 0 then raise exception 'FAIL: outsider sees the challenge'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_answer_keys;
  if n <> 0 then raise exception 'FAIL: player reads answer keys'; end if;
  select count(*) into n from public.live_players where code = v_code;
  if n <> 3 then raise exception 'FAIL: member sees % players', n; end if;
  begin perform public.live_finalize(v_code); raise exception 'FAIL: player called live_finalize';
  exception when insufficient_privilege then report := report || 'internals locked; '; end;
  execute 'reset role';
  report := report || 'RLS ok; ';

  -- answering before the start fails; host starts
  begin perform public.live_answer(v_code, 0, 'Apple', 1000); raise exception 'FAIL: answered in the lobby';
  exception when sqlstate '55000' then report := report || 'no answers in lobby; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_start(v_code);
  begin perform public.live_join(v_code); exception when others then raise exception 'FAIL: member rejoin after start: %', sqlerrm; end;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  begin perform public.live_join(v_code); raise exception 'FAIL: joined after the start';
  exception when sqlstate '55000' then report := report || 'closed after start; '; end;

  -- alice: 3/3, slow. bob: 2/3. cara: 2/3 but faster than bob.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_begin(v_code);
  perform pg_sleep(0.3);
  r := public.live_answer(v_code, 0, 'apple', 250);
  if not (r ->> 'correct')::boolean or r ->> 'answer' <> 'Apple' or r ->> 'explanation' <> 'a fruit' then raise exception 'FAIL: answer result %', r; end if;
  begin perform public.live_answer(v_code, 2, 'Cheese', 100); raise exception 'FAIL: skipped a question';
  exception when sqlstate '22023' then report := report || 'in order; '; end;
  r := public.live_answer(v_code, 0, 'Bread', 1);
  if not (r ->> 'correct')::boolean then raise exception 'FAIL: retry changed the result'; end if;
  perform pg_sleep(0.2);
  r := public.live_answer(v_code, 1, 'Bread', 999999);
  if (r ->> 'ms')::integer > 400 then raise exception 'FAIL: claimed time not capped by elapsed time: %', r ->> 'ms'; end if;
  r := public.live_answer(v_code, 2, 'Cheese', 300);
  if (r -> 'me' ->> 'correct')::integer <> 3 or r -> 'me' ->> 'finished_at' is null then raise exception 'FAIL: alice finish %', r; end if;
  if (r ->> 'done')::boolean then raise exception 'FAIL: ended while others play'; end if;
  begin perform public.live_answer(v_code, 3, 'Cheese', 300); raise exception 'FAIL: answered past the end';
  exception when sqlstate '55000' then report := report || 'stops at the last question; '; end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.live_begin(v_code);
  perform pg_sleep(0.2);
  perform public.live_answer(v_code, 0, 'Apple', 200);
  perform pg_sleep(0.2);
  perform public.live_answer(v_code, 1, 'Cheese', 200);
  perform pg_sleep(0.2);
  perform public.live_answer(v_code, 2, 'Cheese', 200);

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.live_begin(v_code);
  perform public.live_answer(v_code, 0, 'Apple', 10);
  perform public.live_answer(v_code, 1, 'Apple', 10);
  r := public.live_answer(v_code, 2, 'Cheese', 10);
  if not (r ->> 'done')::boolean then raise exception 'FAIL: not over after everyone finished: %', r; end if;

  v := public.live_view(v_code);
  if v ->> 'state' <> 'done' or v -> 'key' = 'null'::jsonb then raise exception 'FAIL: final view %', v; end if;
  select string_agg(p.username || '#' || r2.rank || '(' || r2.correct || ')', ' ' order by r2.rank) into t
  from public.live_results r2 join public.profiles p on p.id = r2.user_id where r2.room_code = v_code;
  if t <> 't_alice#1(3) t_cara#2(2) t_bob#3(2)' then raise exception 'FAIL: ranking %', t; end if;
  report := report || 'ranking ' || t || '; ';
  select live_wins || '/' || live_played into t from public.profiles where id = a;
  if t <> '1/1' then raise exception 'FAIL: winner counters %', t; end if;
  r := public.live_mine();
  if (r -> 0 ->> 'rank')::integer <> 2 or r -> 0 ->> 'state' <> 'done' then raise exception 'FAIL: live_mine %', r; end if;

  -- anytime mode: open at once, people join later, ends when full
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_any := public.live_create('Any', 0, 2, 'anytime', '{}', qs, 2);
  v := public.live_view(v_any);
  if v ->> 'state' <> 'playing' then raise exception 'FAIL: anytime not open: %', v ->> 'state'; end if;
  perform public.live_answer(v_any, 0, 'Apple', 100);
  perform public.live_answer(v_any, 1, 'Bread', 100);
  r := public.live_answer(v_any, 2, 'Cheese', 100);
  if (r ->> 'done')::boolean then raise exception 'FAIL: anytime ended before others joined'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform public.live_join(v_any);
  perform public.live_answer(v_any, 0, 'Apple', 100);
  perform public.live_answer(v_any, 1, 'Bread', 100);
  r := public.live_answer(v_any, 2, 'Cheese', 100);
  if not (r ->> 'done')::boolean then raise exception 'FAIL: anytime not over when full and finished'; end if;
  report := report || 'anytime mode; ';

  -- leaving: a player leaves the lobby, the host's leaving cancels it
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_code := public.live_create('Leave', 20, 4, 'together', '{}', qs);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.live_join(v_code);
  perform public.live_leave(v_code);
  select count(*) into n from public.live_players where code = v_code;
  if n <> 1 then raise exception 'FAIL: leave left % players', n; end if;
  perform public.live_join(v_code);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_remove_player(v_code, b);
  select count(*) into n from public.live_players where code = v_code;
  if n <> 1 then raise exception 'FAIL: remove left % players', n; end if;
  perform public.live_leave(v_code);
  if exists (select 1 from public.live_challenges where code = v_code) then raise exception 'FAIL: host leaving did not cancel'; end if;
  report := report || 'leave/remove/cancel; ';

  -- the creator can end early; unfinished players still get a result
  v_code := public.live_create('End', 20, 3, 'together', '{}', qs);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.live_join(v_code);
  begin perform public.live_end(v_code); raise exception 'FAIL: player ended it';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_start(v_code);
  perform public.live_answer(v_code, 0, 'Apple', 100);
  perform public.live_end(v_code);
  select count(*) into n from public.live_results where room_code = v_code;
  if n <> 1 then raise exception 'FAIL: early end recorded % results (only alice started)', n; end if;
  report := report || 'early end; ';

  raise exception 'LIVE TESTS PASSED: %', report;
end $$;
