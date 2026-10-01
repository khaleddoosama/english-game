-- Reports and activity-log tests. Run inside a transaction that is thrown
-- away (begin; <this file>; rollback;). The block always ends by raising:
-- "AUDIT TESTS PASSED: …" or "FAIL: …". Every check looks only at the rows
-- this test made, so earlier activity in the log doesn't matter.
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_player uuid;
  r record;
  n integer;
  report text := '';
begin
  perform public.register_player('t_rita', 'secret1');
  select id into v_player from public.profiles where username = 't_rita';

  -- A player files a report with every detail.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.reports (id, data) values ('rep-test-1', jsonb_build_object(
    'id', 'rep-test-1', 'at', 1790000000000, 'reason', 'Wrong or missing correct answer', 'details', 'Both fit',
    'learnerAnswer', jsonb_build_array('Bread', 'Cheese'), 'learnerAnswerText', 'Bread + Cheese', 'wasCorrect', false,
    'question', jsonb_build_object('id', 'q1', 'mode', 'selecttwo', 'type', 'multi', 'prompt', 'Pick two foods', 'options', jsonb_build_array('Bread', 'Cheese', 'Chair'), 'answers', jsonb_build_array('Bread', 'Cheese'), 'targets', jsonb_build_array('bread')),
    'session', jsonb_build_object('id', 's1', 'title', 'Food · Practice', 'kind', 'practice', 'index', 3, 'total', 12),
    'reporter', jsonb_build_object('id', v_player, 'username', 't_rita')));
  execute 'reset role';
  select * into r from public.reports where id = 'rep-test-1';
  if r.user_id <> v_player then raise exception 'FAIL: reporter not recorded'; end if;
  if r.reason <> 'Wrong or missing correct answer' or r.note <> 'Both fit' then raise exception 'FAIL: reason/note %, %', r.reason, r.note; end if;
  if r.question_prompt <> 'Pick two foods' or r.question_mode <> 'selecttwo' or jsonb_array_length(r.question_options) <> 3 then raise exception 'FAIL: question columns'; end if;
  if r.correct_answers <> '["Bread", "Cheese"]'::jsonb or r.player_answer <> 'Bread + Cheese' or r.player_was_correct then raise exception 'FAIL: answers % / %', r.correct_answers, r.player_answer; end if;
  if r.target_words <> array['bread'] or r.session_title <> 'Food · Practice' then raise exception 'FAIL: targets/session'; end if;
  if r.reported_at <> to_timestamp(1790000000) then raise exception 'FAIL: reported_at %', r.reported_at; end if;
  report := report || 'report columns filled; ';

  -- Old-style report (flat fields) still fills the columns.
  insert into public.reports (id, user_id, data) values ('rep-test-2', v_player, '{"prompt":"Old","mode":"gap","options":["a","b"],"answers":["a"],"learnerAnswer":"b","targetWords":["x"],"reason":"Typo"}');
  select * into r from public.reports where id = 'rep-test-2';
  if r.question_prompt <> 'Old' or r.player_answer <> 'b' or r.target_words <> array['x'] then raise exception 'FAIL: old report columns'; end if;
  report := report || 'old reports too; ';

  -- The admin edits content: create, update, move (no log), delete.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.apply_content_changes('[{"kind":"words","key":"zz-test","position":1,"data":{"word":"zz-test","meaning":"old meaning","hints":["a"]}}]', '[]', null, null);
  select * into r from public.admin_audit where item_key = 'zz-test' and action = 'content.create';
  if not found or r.after ->> 'meaning' <> 'old meaning' or r.admin_id <> v_admin or r.batch_id is null then raise exception 'FAIL: create not logged'; end if;
  select count(*) into n from public.admin_audit where batch_id = r.batch_id and action = 'content.save' and (details ->> 'changed')::integer = 1;
  if n <> 1 then raise exception 'FAIL: save summary missing'; end if;
  perform public.apply_content_changes('[{"kind":"words","key":"zz-test","position":1,"data":{"word":"zz-test","meaning":"new meaning","hints":["a"],"gap":"___"}}]', '[]', null, null);
  select * into r from public.admin_audit where item_key = 'zz-test' and action = 'content.update';
  if not found then raise exception 'FAIL: update not logged'; end if;
  if r.changes -> 'meaning' <> '{"before": "old meaning", "after": "new meaning"}'::jsonb then raise exception 'FAIL: meaning diff %', r.changes; end if;
  if r.changes -> 'gap' <> '{"before": null, "after": "___"}'::jsonb or r.changes ? 'hints' or r.changes ? 'word' then raise exception 'FAIL: diff fields %', r.changes; end if;
  report := report || 'field diff ' || (select string_agg(k, ',') from jsonb_object_keys(r.changes) k) || '; ';
  perform public.apply_content_changes('[{"kind":"words","key":"zz-test","position":7,"data":{"word":"zz-test","meaning":"new meaning","hints":["a"],"gap":"___"}}]', '[]', null, null);
  select count(*) into n from public.admin_audit where item_key = 'zz-test';
  if n <> 2 then raise exception 'FAIL: position-only change logged (% rows)', n; end if;
  perform public.apply_content_changes('[]', '[{"kind":"words","key":"zz-test"}]', null, null);
  select * into r from public.admin_audit where item_key = 'zz-test' and action = 'content.delete';
  if not found or r.before ->> 'meaning' <> 'new meaning' then raise exception 'FAIL: delete not logged with the old item'; end if;
  report := report || 'create/update/delete logged, moves skipped; ';

  -- Category order.
  perform public.apply_content_changes('[]', '[]', '["Z-first", "A-second"]', null);
  select * into r from public.admin_audit where action = 'categories.update' and admin_id = v_admin order by id desc limit 1;
  if not found or r.changes -> 'level_order' -> 'after' <> '["Z-first", "A-second"]'::jsonb then raise exception 'FAIL: category order not logged'; end if;
  report := report || 'category order; ';

  -- The admin resolves, reopens and deletes a report.
  execute 'set local role authenticated';
  update public.reports set resolved_at = now() where id = 'rep-test-1';
  update public.reports set resolved_at = null where id = 'rep-test-1';
  delete from public.reports where id = 'rep-test-2';
  execute 'reset role';
  if (select string_agg(action, ',' order by id) from public.admin_audit where entity = 'report' and item_key in ('rep-test-1', 'rep-test-2')) <> 'report.resolve,report.reopen,report.delete' then
    raise exception 'FAIL: report actions %', (select string_agg(action, ',' order by id) from public.admin_audit where entity = 'report' and item_key in ('rep-test-1', 'rep-test-2'));
  end if;
  if (select before ->> '_reporter' from public.admin_audit where action = 'report.delete' and item_key = 'rep-test-2') <> 't_rita' then raise exception 'FAIL: deleted report keeps its reporter'; end if;
  report := report || 'report resolve/reopen/delete; ';

  -- A player's own edits to their report aren't admin actions.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.reports set data = data || '{"aiReview":{"verdict":"fine"}}' where id = 'rep-test-1';
  execute 'reset role';
  select count(*) into n from public.admin_audit where action = 'report.update' and item_key = 'rep-test-1';
  if n <> 0 then raise exception 'FAIL: player edit logged as admin action'; end if;

  -- Player management records before/after.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_set_role(v_player, 'admin');
  select * into r from public.admin_audit where action = 'player.role' and item_key = 't_rita';
  if r.changes -> 'role' <> '{"before": "player", "after": "admin"}'::jsonb then raise exception 'FAIL: role change %', r.changes; end if;
  perform public.admin_reset_player(v_player);
  select count(*) into n from public.admin_audit where action = 'player.reset' and item_key = 't_rita' and changes ? 'score';
  if n <> 1 then raise exception 'FAIL: reset not detailed'; end if;
  report := report || 'player changes; ';

  -- Players can't read the log.
  perform set_config('request.jwt.claims', json_build_object('sub', v_player, 'role', 'authenticated')::text, true);
  update public.profiles set role = 'player' where id = v_player;
  execute 'set local role authenticated';
  select count(*) into n from public.admin_audit;
  execute 'reset role';
  if n <> 0 then raise exception 'FAIL: player reads the activity log'; end if;
  report := report || 'log is admin-only; ';

  raise exception 'AUDIT TESTS PASSED: %', report;
end $$;
