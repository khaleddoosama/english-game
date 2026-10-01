-- Renames for every player, staged publishing and the version check
-- (begin; <this>; rollback;).
do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_p1 uuid;
  v_p2 uuid;
  v_version bigint;
  v jsonb;
  v_draft uuid := gen_random_uuid();
  report text := '';
begin
  perform public.register_player('t_cp_one', 'secret1');
  perform public.register_player('t_cp_two', 'secret1');
  select id into v_p1 from public.profiles where username = 't_cp_one';
  select id into v_p2 from public.profiles where username = 't_cp_two';
  insert into public.mastery (user_id, item_key, stats) values
    (v_p1, 'zz_old_word', '{"total":4,"correct":3}'),
    (v_p2, 'zz_old_word', '{"total":2}'), (v_p2, 'zz_new_word', '{"total":5}');
  insert into public.progress (user_id, section, data) values
    (v_p1, 'pools', '{"pools":{"zz_old_word":{"gap":[1]}}}'),
    (v_p1, 'confusions', '{"confusions":{"zz_old_word|Bread":2}}'),
    (v_p1, 'levels', '{"levelStats":{"cat-zz_old_cat":{"stars":3}},"levelsCleared":["cat-zz_old_cat"]}');

  -- Players can't publish or rename.
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  begin perform public.content_save_v2(null, '[]', '[]', null, null, null, null, true); raise exception 'FAIL: player published';
  exception when insufficient_privilege then report := report || 'admin only; '; end;
  begin perform public.apply_item_renames('[{"kind":"word","from":"a","to":"b"}]'); raise exception 'FAIL: player renamed';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select version into v_version from public.content_meta where id = 1;

  -- Staged batches change nothing until the publish.
  perform public.content_save_v2(v_draft, '[{"kind":"words","key":"zz_new_word","data":{"word":"zz_new_word"},"position":999999}]', '[]', null, null, null, null, false);
  if exists (select 1 from public.content_items where key = 'zz_new_word') or (select version from public.content_meta where id = 1) <> v_version then
    raise exception 'FAIL: staging published something';
  end if;
  report := report || 'staging invisible; ';

  -- A stale version is refused and leaves everything as it was.
  begin
    perform public.content_save_v2(v_draft, '[]', '[]', null, null, null, v_version - 1, true);
    raise exception 'FAIL: stale version accepted';
  exception when serialization_failure then null; end;
  if exists (select 1 from public.content_items where key = 'zz_new_word') then raise exception 'FAIL: refused publish wrote'; end if;
  report := report || 'version check; ';

  -- Publish: the draft plus the renames, in one go.
  v := public.content_save_v2(v_draft, '[]', '[]', null, null,
    '[{"kind":"word","from":"zz_old_word","to":"zz_new_word"},{"kind":"category","from":"zz_old_cat","to":"zz_new_cat"}]', v_version, true);
  if (v ->> 'version')::bigint <> v_version + 1 or (v ->> 'renamed')::int <> 2 then raise exception 'FAIL: publish result %', v; end if;
  if not exists (select 1 from public.content_items where key = 'zz_new_word' and not deleted) then raise exception 'FAIL: draft not published'; end if;
  if exists (select 1 from public.content_drafts where draft_id = v_draft) then raise exception 'FAIL: draft left behind'; end if;
  report := report || 'publish; ';

  -- Every player's progress followed the rename.
  if (select string_agg(item_key || '=' || (stats ->> 'total'), ',') from public.mastery where user_id = v_p1) <> 'zz_new_word=4' then raise exception 'FAIL: p1 mastery'; end if;
  if (select string_agg(item_key || '=' || (stats ->> 'total'), ',') from public.mastery where user_id = v_p2) <> 'zz_new_word=5' then raise exception 'FAIL: p2 kept the wrong record'; end if;
  if (select data -> 'pools' from public.progress where user_id = v_p1 and section = 'pools') <> '{"zz_new_word":{"gap":[1]}}' then raise exception 'FAIL: pools'; end if;
  if (select data -> 'confusions' from public.progress where user_id = v_p1 and section = 'confusions') <> '{"zz_new_word|Bread":2}' then raise exception 'FAIL: confusions'; end if;
  if (select data -> 'levelStats' from public.progress where user_id = v_p1 and section = 'levels') <> '{"cat-zz_new_cat":{"stars":3}}'
     or (select data -> 'levelsCleared' from public.progress where user_id = v_p1 and section = 'levels') <> '["cat-zz_new_cat"]' then raise exception 'FAIL: level stats'; end if;
  if not exists (select 1 from public.admin_audit where action = 'content.rename' and item_key = 'zz_new_word') then raise exception 'FAIL: rename not logged'; end if;
  report := report || 'progress followed; ';

  -- An offline device still sending the old name saves under the new one.
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  perform public.save_progress_v2('{}', null, '{"zz_old_word":{"total":9}}', null, null, false);
  if (select string_agg(item_key || '=' || (stats ->> 'total'), ',') from public.mastery where user_id = v_p1) <> 'zz_new_word=9' then raise exception 'FAIL: alias not applied'; end if;
  report := report || 'alias';

  raise exception 'CONTENT PUBLISH TESTS PASSED: %', report;
end;
$$;
