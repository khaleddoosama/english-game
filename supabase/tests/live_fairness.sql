-- Live Challenge between friends (review F06, migration 0020): no early
-- look at the questions, no answer before Start, honest times, and the
-- creator's result not counted as a win (begin; <this>; rollback;).
do $$
declare
  a uuid; b uuid;
  v_code text; v jsonb; r jsonb; t text;
  report text := '';
  qs jsonb := '[
    {"mode":"meaning","prompt":"p1","options":["Apple","Bread","Cheese"],"answer":"Apple","word":"apple"},
    {"mode":"gap","prompt":"p2","options":["Apple","Bread","Cheese"],"answer":"Bread","word":"bread"},
    {"mode":"reverse","prompt":"p3","options":["Apple","Bread","Cheese"],"answer":"Cheese","word":"cheese"}
  ]';
begin
  perform public.register_player('t_lf_host', 'secret1');
  perform public.register_player('t_lf_guest', 'secret1');
  select id into a from public.profiles where username = 't_lf_host';
  select id into b from public.profiles where username = 't_lf_guest';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_code := public.live_create('Fair', 20, 2, 'together', '{"reveal":true}', qs);
  if public.live_view(v_code) -> 'questions' <> 'null'::jsonb then raise exception 'FAIL: the creator''s waiting room shows questions'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  v := public.live_join(v_code);
  if v -> 'questions' <> 'null'::jsonb then raise exception 'FAIL: the waiting room shows questions'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_start(v_code);
  report := report || 'no questions in the waiting room; ';

  -- Started, but this player hasn't pressed Start: nothing to see or answer.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if public.live_view(v_code) -> 'questions' <> 'null'::jsonb then raise exception 'FAIL: questions before Start'; end if;
  begin perform public.live_answer(v_code, 0, 'Apple', 1); raise exception 'FAIL: answered without Start';
  exception when sqlstate '55000' then null; end;
  report := report || 'no answer before Start; ';

  -- Start shows the first question; each answer brings the next.
  v := public.live_begin(v_code);
  if jsonb_array_length(v -> 'questions') <> 1 or v #>> '{questions,0,prompt}' <> 'p1' then raise exception 'FAIL: Start shows %', v -> 'questions'; end if;
  perform pg_sleep(2);
  r := public.live_answer(v_code, 0, 'Bread', 1); -- claims 1 ms after 2 s
  if (r ->> 'ms')::integer < 450 then raise exception 'FAIL: claimed time beyond the 1.5 s slack: %', r ->> 'ms'; end if;
  if r #>> '{next,prompt}' <> 'p2' or (r -> 'next') ? 'answer' then raise exception 'FAIL: next question %', r -> 'next'; end if;
  if jsonb_array_length(public.live_view(v_code) -> 'questions') <> 2 then raise exception 'FAIL: view after one answer'; end if;
  -- A retry returns the same result and the same next question.
  r := public.live_answer(v_code, 0, 'Apple', 1);
  if (r ->> 'correct')::boolean or r #>> '{next,prompt}' <> 'p2' then raise exception 'FAIL: retry %', r; end if;
  report := report || 'one question at a time, 1.5 s slack; ';

  -- After a wrong answer the card shows longer: that's allowed for.
  perform pg_sleep(3);
  r := public.live_answer(v_code, 1, 'Bread', 1000); -- 3 s since the last answer, 1.8 s of card + 1.5 s
  if (r ->> 'ms')::integer <> 1000 then raise exception 'FAIL: honest time after a wrong answer was changed: %', r ->> 'ms'; end if;
  r := public.live_answer(v_code, 2, 'Cheese', 100);
  if r -> 'next' <> 'null'::jsonb then raise exception 'FAIL: a next question after the last'; end if;
  report := report || 'card time allowed; ';

  -- The creator plays perfectly and fast, the guest wins the Live win.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_begin(v_code);
  perform public.live_answer(v_code, 0, 'Apple', 10);
  perform public.live_answer(v_code, 1, 'Bread', 10);
  r := public.live_answer(v_code, 2, 'Cheese', 10);
  if not (r ->> 'done')::boolean then raise exception 'FAIL: not over'; end if;
  if jsonb_array_length(public.live_view(v_code) -> 'questions') <> 3 then raise exception 'FAIL: all questions after the end'; end if;
  select string_agg(p.username || '#' || x.rank || case when x.is_host then '(host)' else '' end, ' ' order by x.rank) into t
  from public.live_results x join public.profiles p on p.id = x.user_id where x.room_code = v_code;
  if t <> 't_lf_host#1(host) t_lf_guest#2' then raise exception 'FAIL: results %', t; end if;
  if (select live_wins from public.profiles where id = a) <> 0 then raise exception 'FAIL: the creator got a Live win'; end if;
  report := report || 'creator marked, no win';

  raise exception 'LIVE FAIRNESS TESTS PASSED: %', report;
end;
$$;
