-- Renaming a word to a name another word already has is refused, and nothing
-- changes (migration 0039). begin; <this>; rollback;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;

do $$
declare
  v_admin uuid; v_user uuid; v_v1 bigint; v_msg text; v_code text; v_before jsonb; v_sense_a uuid;
begin
  perform public.register_player('rc_user', 'secret1');
  select id into v_admin from public.profiles where username = 'ci_admin';
  select id into v_user from public.profiles where username = 'rc_user';
  insert into public.content_items (kind, key, data) values
    ('words', 'zzrcA', '{"word":"zzrcA","type":"vocab","category":"zzrcL","meaning":"a"}'),
    ('words', 'zzrcB', '{"word":"zzrcB","type":"vocab","category":"zzrcL","meaning":"b"}'),
    ('words', 'zzrcCast', '{"word":"zzrcCast","type":"vocab","category":"zzrcL","meaning":"actors"}');
  perform public.dictionary_sync_core();
  select id into v_sense_a from public.senses where legacy_key = 'zzrcA';
  insert into public.mastery (user_id, item_key, stats) values (v_user, 'zzrcA', '{"total":5}'), (v_user, 'zzrcB', '{"total":2}');
  select version into v_v1 from public.content_meta where id = 1;
  v_before := (select jsonb_agg(to_jsonb(c) order by key) from public.content_items c where key like 'zzrc%');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- A -> B, where B is another word: refused, with a message, and nothing moved
  begin
    perform public.content_save_v2(null,
      '[{"kind":"words","key":"zzrcB","data":{"word":"zzrcB","type":"vocab","category":"zzrcL","meaning":"merged"},"position":1}]'::jsonb,
      '[{"kind":"words","key":"zzrcA"}]'::jsonb, null, null, '[{"kind":"word","from":"zzrcA","to":"zzrcB"}]'::jsonb, null, true);
    raise exception 'FAIL: the rename into an existing word was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    v_msg := sqlerrm; v_code := sqlstate;
  end;
  perform pg_temp.must(v_code = '23505', 'the refusal is a "name taken" error, not ' || v_code);
  perform pg_temp.must(v_msg like 'There is already a word called "zzrcB"%', 'the message names the word: ' || v_msg);
  perform pg_temp.must((select jsonb_agg(to_jsonb(c) order by key) from public.content_items c where key like 'zzrc%') = v_before, 'both content rows are as they were');
  perform pg_temp.must((select stats ->> 'total' from public.mastery where user_id = v_user and item_key = 'zzrcA') = '5', 'progress under the old name is kept');
  perform pg_temp.must((select stats ->> 'total' from public.mastery where user_id = v_user and item_key = 'zzrcB') = '2', 'progress under the other name is kept');
  perform pg_temp.must(not exists (select 1 from public.item_key_aliases where from_key = 'zzrcA'), 'no alias was made');
  perform pg_temp.must((select version from public.content_meta where id = 1) = v_v1, 'the content version did not move');
  perform pg_temp.must((select deleted_at is null from public.senses where id = v_sense_a), 'the old word is still there in the library tables');

  -- case and spacing do not hide the clash
  begin
    perform public.content_save_v2(null, '[]'::jsonb, '[]'::jsonb, null, null, '[{"kind":"word","from":"zzrcA","to":"  ZZRCb "}]'::jsonb, null, true);
    raise exception 'FAIL: a rename into an existing word, written in other case, was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    perform pg_temp.must(sqlstate = '23505', 'refused whatever the case');
  end;

  -- a free name works, and so does a change of case only
  perform public.content_save_v2(null,
    '[{"kind":"words","key":"zzrcC","data":{"word":"zzrcC","type":"vocab","category":"zzrcL","meaning":"a"},"position":1}]'::jsonb,
    '[{"kind":"words","key":"zzrcA"}]'::jsonb, null, null, '[{"kind":"word","from":"zzrcA","to":"zzrcC"}]'::jsonb, null, true);
  perform pg_temp.must((select stats ->> 'total' from public.mastery where user_id = v_user and item_key = 'zzrcC') = '5', 'a rename to a free name moves the progress');
  perform public.content_save_v2(null,
    '[{"kind":"words","key":"zzrcCAST","data":{"word":"zzrcCAST","type":"vocab","category":"zzrcL","meaning":"actors"},"position":1}]'::jsonb,
    '[{"kind":"words","key":"zzrcCast"}]'::jsonb, null, null, '[{"kind":"word","from":"zzrcCast","to":"zzrcCAST"}]'::jsonb, null, true);
  perform pg_temp.must(exists (select 1 from public.content_items where key = 'zzrcCAST' and not deleted), 'a change of case only is the same word renamed');

  -- the same rename sent again (the answer was lost) is not a clash with itself
  perform public.content_save_v2(null,
    '[{"kind":"words","key":"zzrcC","data":{"word":"zzrcC","type":"vocab","category":"zzrcL","meaning":"a"},"position":1}]'::jsonb,
    '[{"kind":"words","key":"zzrcA"}]'::jsonb, null, null, '[{"kind":"word","from":"zzrcA","to":"zzrcC"}]'::jsonb, null, true);

  -- renames of categories, and saves without renames, are not affected
  perform public.content_save_v2(null, '[]'::jsonb, '[]'::jsonb, null, null, '[{"kind":"category","from":"zzrcL","to":"zzrcL"}]'::jsonb, null, true);
  perform public.content_save_v2(null, '[]'::jsonb, '[]'::jsonb, null, 'a note', null, null, true);

  raise exception 'RENAME CONFLICT TESTS PASSED';
end $$;
