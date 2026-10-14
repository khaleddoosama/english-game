-- A renamed word keeps its sense, so the library entries and views that hold it
-- keep holding it (migration 0037). begin; <this>; rollback;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;

do $$
declare
  v_admin uuid; v_user uuid; v_sense uuid; v_view uuid; v_other uuid; v_after uuid;
begin
  perform public.register_player('rn_user', 'secret1');
  select id into v_admin from public.profiles where username = 'ci_admin';
  select id into v_user from public.profiles where username = 'rn_user';

  insert into public.content_items (kind, key, data) values
    ('words', 'zzrnOld', '{"word":"zzrnOld","type":"vocab","category":"zzrnLesson","meaning":"old meaning"}'),
    ('words', 'zzrnOther', '{"word":"zzrnOther","type":"vocab","category":"zzrnLesson","meaning":"other"}');
  perform public.dictionary_sync_core();
  select id into v_sense from public.senses where legacy_key = 'zzrnOld';
  select id into v_other from public.senses where legacy_key = 'zzrnOther';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform public.library_add(array[v_sense, v_other]);
  v_view := public.view_create('rn view');
  perform public.view_add(v_view, array[v_sense]);

  -- the admin renames the word: new content, the alias, then the sync
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.content_save_v2(null,
    '[{"kind":"words","key":"zzrnNew","data":{"word":"zzrnNew","type":"vocab","category":"zzrnLesson","meaning":"new meaning"},"position":1}]'::jsonb,
    '[{"kind":"words","key":"zzrnOld"}]'::jsonb, null, null,
    '[{"kind":"word","from":"zzrnOld","to":"zzrnNew"}]'::jsonb, null, true);
  perform public.dictionary_sync();

  select id into v_after from public.senses where legacy_key = 'zzrnNew' and deleted_at is null;
  perform pg_temp.must(v_after = v_sense, 'the renamed word is the same sense (same id)');
  perform pg_temp.must(not exists (select 1 from public.senses where legacy_key = 'zzrnOld'), 'no sense is left under the old name');
  perform pg_temp.must((select meaning from public.senses where id = v_sense) = 'new meaning', 'the new content reached the sense');
  perform pg_temp.must((select label from public.senses where id = v_sense) is null and (select h.text from public.senses s join public.headwords h on h.id = s.headword_id where s.id = v_sense) = 'zzrnNew', 'the headword follows the new name');
  perform pg_temp.must(exists (select 1 from public.library_entries where user_id = v_user and sense_id = v_sense and removed_at is null), 'the library entry is kept');
  perform pg_temp.must(exists (select 1 from public.collection_senses where collection_id = v_view and sense_id = v_sense and removed_at is null), 'the view still holds it');

  -- running it again changes nothing
  perform public.dictionary_sync();
  perform pg_temp.must((select count(*) from public.senses where legacy_key like 'zzrn%' and deleted_at is null) = 2, 'a second sync adds or removes nothing');

  -- a rename into a name that already has its own sense is left alone: nothing is merged by guesswork
  insert into public.content_items (kind, key, data) values ('words', 'zzrnA', '{"word":"zzrnA","type":"vocab","category":"zzrnLesson","meaning":"a"}'), ('words', 'zzrnB', '{"word":"zzrnB","type":"vocab","category":"zzrnLesson","meaning":"b"}');
  perform public.dictionary_sync();
  perform public.content_save_v2(null, '[]'::jsonb, '[{"kind":"words","key":"zzrnA"}]'::jsonb, null, null, '[{"kind":"word","from":"zzrnA","to":"zzrnB"}]'::jsonb, null, true);
  perform public.dictionary_sync();
  perform pg_temp.must((select deleted_at is not null from public.senses where legacy_key = 'zzrnA'), 'the old word is gone when the new name already had a sense');
  perform pg_temp.must((select deleted_at is null from public.senses where legacy_key = 'zzrnB'), 'the word that already had the name is kept');

  -- only an admin can run the sync (the rename step is not granted to anyone but the sync)
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.dictionary_sync();
    raise exception 'FAIL: a player could run the sync';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise exception 'DICTIONARY RENAME TESTS PASSED';
end $$;
