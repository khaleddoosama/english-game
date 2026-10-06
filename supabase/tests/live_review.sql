-- Live Challenge results and rematch (migration 0023): every player's answers
-- once the challenge is over and never before, and the rematch link left on
-- the old challenge (begin; <this>; rollback;).
do $$
declare
  a uuid; b uuid; c uuid;
  v_code text; v_new text; v_other text; v jsonb; r jsonb;
  report text := '';
  qs jsonb := '[
    {"mode":"meaning","prompt":"p1","options":["Apple","Bread","Cheese"],"answer":"Apple","word":"apple"},
    {"mode":"gap","prompt":"p2","options":["Apple","Bread","Cheese"],"answer":"Bread","word":"bread"},
    {"mode":"reverse","prompt":"p3","options":["Apple","Bread","Cheese"],"answer":"Cheese","word":"cheese"}
  ]';
begin
  perform public.register_player('t_lr_host', 'secret1');
  perform public.register_player('t_lr_guest', 'secret1');
  perform public.register_player('t_lr_other', 'secret1');
  select id into a from public.profiles where username = 't_lr_host';
  select id into b from public.profiles where username = 't_lr_guest';
  select id into c from public.profiles where username = 't_lr_other';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_code := public.live_create('Review', 20, 2, 'together', '{"reveal":true,"lesson":"Health","kinds":["meaning"]}', qs);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.live_join(v_code);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_start(v_code);

  -- The guest answers first: one wrong, two right.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.live_begin(v_code);
  perform public.live_answer(v_code, 0, 'Bread', 5);
  perform public.live_answer(v_code, 1, 'Bread', 5);
  perform public.live_answer(v_code, 2, 'Cheese', 5);
  -- Mid-challenge nobody sees what an opponent chose, finished or not.
  if (public.live_view(v_code) -> 'all_answers') is distinct from 'null'::jsonb then raise exception 'FAIL: all_answers must be null before the challenge is over: %', public.live_view(v_code) -> 'all_answers'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  if (public.live_view(v_code) -> 'all_answers') is distinct from 'null'::jsonb then raise exception 'FAIL: the creator sees answers mid-challenge'; end if;
  report := report || 'nothing before the end; ';

  -- The creator finishes, so the challenge is over.
  perform public.live_begin(v_code);
  perform public.live_answer(v_code, 0, 'Apple', 5);
  perform public.live_answer(v_code, 1, 'Bread', 5);
  r := public.live_answer(v_code, 2, 'Cheese', 5);
  if not (r ->> 'done')::boolean then raise exception 'FAIL: not over'; end if;

  v := public.live_view(v_code) -> 'all_answers';
  if jsonb_array_length(v) is distinct from 6 then raise exception 'FAIL: expected 6 answers, got %', v; end if;
  if (select count(*) from jsonb_array_elements(v) e where e ->> 'user_id' = b::text) is distinct from 3 then raise exception 'FAIL: the guest''s answers: %', v; end if;
  if not exists (select 1 from jsonb_array_elements(v) e where e ->> 'user_id' = b::text and (e ->> 'idx')::int = 0 and e ->> 'choice' = 'Bread' and not (e ->> 'correct')::boolean)
    then raise exception 'FAIL: the guest''s wrong first answer is missing: %', v; end if;
  if (select count(*) from jsonb_array_elements(v) e where (e ->> 'correct')::boolean) is distinct from 5 then raise exception 'FAIL: right answers %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if jsonb_array_length(public.live_view(v_code) -> 'all_answers') is distinct from 6 then raise exception 'FAIL: the guest does not see everyone''s answers'; end if;
  report := report || 'everyone''s answers after the end; ';

  -- Someone who wasn't in it sees none of this.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  v := public.live_view(v_code);
  if (v -> 'all_answers') is distinct from 'null'::jsonb then raise exception 'FAIL: a stranger sees answers'; end if;
  if (v -> 'my_answers') is distinct from 'null'::jsonb or (v -> 'key') is distinct from 'null'::jsonb then raise exception 'FAIL: a stranger sees the key or answers'; end if;
  report := report || 'strangers see nothing; ';

  -- Rematch: only a member who made the new challenge can link it.
  begin perform public.live_set_next(v_code, v_code); raise exception 'FAIL: a challenge as its own rematch';
  exception when sqlstate '22023' then null; end;
  begin perform public.live_set_next(v_code, 'NOPE00'); raise exception 'FAIL: linked a challenge that does not exist';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v_new := public.live_create('Review again', 20, 2, 'together', '{"reveal":true}', qs);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin perform public.live_set_next(v_code, v_new); raise exception 'FAIL: a stranger linked a rematch';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform public.live_set_next(v_code, v_new); raise exception 'FAIL: linked a challenge someone else made';
  exception when sqlstate '42501' then null; end;
  if public.live_view(v_code) #>> '{settings,next_code}' is not null then raise exception 'FAIL: a rematch appeared too early'; end if;
  report := report || 'link checks; ';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.live_set_next(v_code, v_new);
  v := public.live_view(v_code) -> 'settings';
  if v ->> 'next_code' is distinct from v_new or v ->> 'next_by' is distinct from a::text then raise exception 'FAIL: the host does not see the rematch: %', v; end if;
  if v ->> 'lesson' is distinct from 'Health' then raise exception 'FAIL: settings were replaced, not merged: %', v; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if public.live_view(v_code) #>> '{settings,next_code}' is distinct from v_new then raise exception 'FAIL: the guest does not see the rematch'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  if (public.live_view(v_code) -> 'settings') ? 'next_code' or (public.live_view(v_code) -> 'settings') ? 'next_by' then raise exception 'FAIL: a stranger sees the rematch'; end if;
  report := report || 'rematch visible to players only; ';

  -- The first link wins; a second one doesn't change it (and isn't an error).
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  v_other := public.live_create('Guest rematch', 20, 2, 'together', '{}', qs);
  perform public.live_set_next(v_code, v_other);
  if public.live_view(v_code) #>> '{settings,next_code}' is distinct from v_new then raise exception 'FAIL: the first rematch was replaced'; end if;
  report := report || 'first one wins; ';

  -- A challenge that is still running has no rematch yet.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin perform public.live_set_next(v_new, v_other); raise exception 'FAIL: a running challenge got a rematch';
  exception when sqlstate '55000' then null; end;
  report := report || 'only after the end';

  raise exception 'LIVE REVIEW TESTS PASSED: %', report;
end;
$$;
