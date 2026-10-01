-- analytics.* tests: plant broken content and check every view sees it.
-- Run inside a transaction that is thrown away (begin; <this>; rollback;).
do $$
declare
  n integer;
  report text := '';
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  r record;
begin
  insert into public.content_items (kind, key, data, position) values
    ('words', 'zz-stub', '{"word":"zz-stub","category":"Nowhere","_autoStub":true}', 1),
    ('words', 'zz-gap', '{"word":"zz-gap","meaning":"m","situation":"s","gap":"no blank here","hints":["h"],"category":"Nowhere","image":"https://example.com/p.png"}', 2),
    ('words', 'ZZ-GAP', '{"word":"ZZ-GAP","meaning":"m","situation":"s","gap":"a ___ b","hints":["h"],"category":"Nowhere"}', 3),
    ('grammar', 'zz-g1', '{"id":"zz-g1","rule":"r","explanation":"e","questions":[{"type":"choose","prompt":"p","options":["a","b"],"answer":"c"},{"type":"fix","sentence":"He go.","answer":"he go."}]}', 4),
    ('grammar', 'zz-g2', '{"id":"zz-g2","rule":"r","prompt":"p","options":["a","b"],"answer":"a"}', 5),
    ('stories', 'zz-s1', '{"id":"zz-s1","title":"t","targetWords":["zz-gap","no-such-word"]}', 6);
  update public.content_meta set level_order = level_order || '["zz-empty-category"]'::jsonb where id = 1;

  select count(*) into n from analytics.data_issues where item = 'zz-stub' and issue like 'Stub%';
  if n <> 1 then raise exception 'FAIL: stub word not flagged'; end if;
  select count(*) into n from analytics.data_issues where item in ('zz-stub', 'zz-gap', 'ZZ-GAP') and issue like 'Category "Nowhere"%';
  if n <> 3 then raise exception 'FAIL: unlisted category flagged % times', n; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-gap' and issue = 'Gap sentence has no ___ blank';
  if n <> 1 then raise exception 'FAIL: gap without blank'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-gap' and issue = 'Picture is an outside link';
  if n <> 1 then raise exception 'FAIL: outside picture link'; end if;
  select count(*) into n from analytics.data_issues where issue like 'Duplicate word (2 copies)' and lower(item) = 'zz-gap';
  if n <> 1 then raise exception 'FAIL: duplicate words'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-g1 #1' and issue like 'Question 1: the answer is not one of the options';
  if n <> 1 then raise exception 'FAIL: grammar choose answer'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-g1 #2' and issue like '%corrected sentence is the same%';
  if n <> 1 then raise exception 'FAIL: grammar fix sentence'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-g2' and severity = 'high';
  if n <> 0 then raise exception 'FAIL: a valid old-style grammar rule was flagged'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-s1' and issue like '%no-such-word%' and issue not like '%zz-gap%';
  if n <> 1 then raise exception 'FAIL: story with missing word'; end if;
  select count(*) into n from analytics.data_issues where item = 'zz-empty-category' and issue = 'Category has no words';
  if n <> 1 then raise exception 'FAIL: empty category'; end if;
  report := report || 'data_issues catches 10 kinds of problems; ';

  select * into r from analytics.word_quality where word = 'zz-stub';
  if not ('no meaning' = any (r.problems)) or r.quality_score >= 50 then raise exception 'FAIL: word_quality for a stub: % %', r.problems, r.quality_score; end if;
  select * into r from analytics.word_quality where word = 'ZZ-GAP';
  if r.quality_score < 50 or 'no meaning' = any (r.problems) then raise exception 'FAIL: word_quality for a good word: % %', r.problems, r.quality_score; end if;
  report := report || 'word_quality scores; ';

  select count(*) into n from analytics.category_summary where category = 'Nowhere' and words = 3 and level_position is null;
  if n <> 1 then raise exception 'FAIL: category_summary'; end if;
  report := report || 'category_summary; ';

  -- The admin-only function refuses players.
  perform public.register_player('t_ana', 'secret1');
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 't_ana'), 'role', 'authenticated')::text, true);
  begin perform public.admin_data_issues(); raise exception 'FAIL: player read data issues';
  exception when insufficient_privilege then report := report || 'admin-only; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_data_issues();
  if n < 10 then raise exception 'FAIL: admin_data_issues returned %', n; end if;
  select count(*) into n from public.admin_analytics('word_quality');
  if n < 3 then raise exception 'FAIL: admin_analytics'; end if;
  report := report || 'admin functions; ';

  -- Players can't reach the analytics schema directly.
  execute 'set local role authenticated';
  begin perform 1 from analytics.data_issues limit 1; raise exception 'FAIL: player read analytics';
  exception when insufficient_privilege then report := report || 'schema closed to players; '; end;
  execute 'reset role';

  raise exception 'ANALYTICS TESTS PASSED: %', report;
end $$;
