-- Progress revisions, conflicts and leaderboard numbers (begin; <this>; rollback;).
do $$
declare
  v_a uuid;
  v_b uuid;
  v jsonb;
  n integer;
  report text := '';
  week text := to_char(date_trunc('week', now()), 'YYYY-MM-DD');
begin
  perform public.register_player('t_pm_a', 'secret1');
  perform public.register_player('t_pm_b', 'secret1');
  select id into v_a from public.profiles where username = 't_pm_a';
  select id into v_b from public.profiles where username = 't_pm_b';
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- First save: revision 1, profile from the saved core.
  v := public.save_progress_v2('{"core":{"score":100,"studyStreak":3,"bestStudyStreak":5},"history":{"sessionLogs":[{"id":"a"}]}}', '{}', '{"Fork":{"total":4,"correct":3}}', null, json_build_object('week_start', week, 'mastered_count', 2)::jsonb, false);
  if (v #>> '{revs,core}')::int <> 1 or (v #>> '{revs,history}')::int <> 1 then raise exception 'FAIL: first revs %', v; end if;
  if (select score from public.profiles where id = v_a) <> 100 or (select week_score from public.profiles where id = v_a) <> 100
     or (select study_streak from public.profiles where id = v_a) <> 3 or (select mastered_count from public.profiles where id = v_a) <> 2 then
    raise exception 'FAIL: profile after first save %', (select row_to_json(p) from public.profiles p where id = v_a);
  end if;
  report := report || 'first save; ';

  -- A device that saw revision 1 writes core: revision 2, week points add up.
  v := public.save_progress_v2('{"core":{"score":130}}', '{"core":1}', '{}', null, json_build_object('week_start', week)::jsonb, false);
  if (v #>> '{revs,core}')::int <> 2 or (select week_score from public.profiles where id = v_a) <> 130 then raise exception 'FAIL: second save %', v; end if;
  report := report || 'rev bump + week gain; ';

  -- A stale device (still on revision 1) gets the conflict and the server copy, nothing written.
  v := public.save_progress_v2('{"core":{"score":999}}', '{"core":1}', '{}', null, json_build_object('week_start', week)::jsonb, false);
  if v -> 'conflict' <> '["core"]'::jsonb or (v #>> '{sections,core,rev}')::int <> 2 or (v #>> '{sections,core,data,score}')::int <> 130 then raise exception 'FAIL: conflict %', v; end if;
  if (select score from public.profiles where id = v_a) <> 130 then raise exception 'FAIL: conflict wrote the score'; end if;
  -- A section the device thinks is new but exists: conflict too.
  v := public.save_progress_v2('{"history":{"sessionLogs":[]}}', '{}', '{}', null, null, false);
  if v -> 'conflict' <> '["history"]'::jsonb then raise exception 'FAIL: unseen section not a conflict %', v; end if;
  report := report || 'conflicts; ';

  -- Mastery: fewer answers don't overwrite more; a restore does.
  perform public.save_progress_v2('{}', '{}', '{"Fork":{"total":2,"correct":2}}', null, null, false);
  if (select (stats ->> 'total')::int from public.mastery where user_id = v_a and item_key = 'Fork') <> 4 then raise exception 'FAIL: fewer answers overwrote'; end if;
  perform public.save_progress_v2('{"core":{"score":5000}}', null, '{"Fork":{"total":1,"correct":1}}', null, json_build_object('week_start', week)::jsonb, true);
  if (select (stats ->> 'total')::int from public.mastery where user_id = v_a and item_key = 'Fork') <> 1 then raise exception 'FAIL: restore did not replace'; end if;
  if (select score from public.profiles where id = v_a) <> 5000 or (select week_score from public.profiles where id = v_a) <> 130 then raise exception 'FAIL: restore counted as week points'; end if;
  report := report || 'mastery rule + restore; ';

  -- The old save_progress still works (no conflict check) and ignores a sent score.
  perform public.save_progress('{"core":{"score":5010}}', '{}', null, '{"score":999999,"week_score":999999}');
  if (select score from public.profiles where id = v_a) <> 5010 or (select week_score from public.profiles where id = v_a) <> 130 then
    raise exception 'FAIL: old save_progress %', (select row_to_json(p) from public.profiles p where id = v_a);
  end if;
  report := report || 'old function; ';

  -- Players can't write their profile directly any more.
  execute 'set local role authenticated';
  begin
    update public.profiles set score = 999999 where id = v_a;
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := -1; end;
  execute 'reset role';
  if n > 0 or (select score from public.profiles where id = v_a) <> 5010 then raise exception 'FAIL: direct profile write (%)', n; end if;
  report := report || 'no direct profile write; ';

  -- Another player's progress is untouched, and reset clears only mine.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.save_progress_v2('{"core":{"score":7}}', '{}', '{}', null, null, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.reset_my_progress();
  if exists (select 1 from public.progress where user_id = v_a) or (select score from public.profiles where id = v_a) <> 0 then raise exception 'FAIL: reset'; end if;
  if (select score from public.profiles where id = v_b) <> 7 then raise exception 'FAIL: reset touched another player'; end if;
  report := report || 'reset';

  raise exception 'PROGRESS MERGE TESTS PASSED: %', report;
end;
$$;
