-- What must be true after migrations 0037-0042 on the data of upgrade-seed.sql.
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'UPGRADE CHECK FAILED: %', msg; end if; end; $$;

-- offers: the one between friends still waits; the one between people who are no longer friends is ended
select pg_temp.must((select count(*) from public.collection_shares where status = 'pending') = 1, 'one offer still waits');
select pg_temp.must((select count(*) from public.collection_shares where status = 'expired') = 1, 'the offer between non-friends was ended');
select pg_temp.must((select to_user = (select id from public.profiles where username = 'up_bob') from public.collection_shares where status = 'pending'), 'it is the one to Bob');

-- the library of Ann: the rename made before 0037 is NOT repaired by it (the old entry is still on the deleted sense)
select pg_temp.must((select count(*) from public.library_entries e join public.senses s on s.id = e.sense_id where s.deleted_at is not null) = 1, 'the pre-0037 rename still leaves one library entry on a deleted word (documented, see the review)');
-- progress was moved by the old rename and is untouched
select pg_temp.must((select stats ->> 'total' from public.mastery where item_key = 'upNew') = '3', 'progress followed the rename');

-- the diagnostic query of the review finds exactly that entry
select pg_temp.must((select count(*) from public.library_entries e join public.senses s on s.id = e.sense_id join public.item_key_aliases a on a.kind = 'word' and a.from_key = s.legacy_key
   where s.deleted_at is not null and e.removed_at is null) = 1, 'the diagnostic query finds the entry');

-- 0041: the rename step is not callable through the API; the content save that uses it still is (below)
select pg_temp.must(not has_function_privilege('authenticated', 'public.apply_item_renames(jsonb)', 'execute') and not has_function_privilege('anon', 'public.apply_item_renames(jsonb)', 'execute'), 'apply_item_renames is not executable by players or visitors');

-- 0042: one save_progress_v2 (the seven-argument one), the record table is empty and closed, existing progress is untouched
select pg_temp.must((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_progress_v2') = 1, 'one save_progress_v2, no ambiguous overload');
select pg_temp.must((select count(*) from public.progress_ops) = 0, 'no operation recorded by the migration');
select pg_temp.must(not has_table_privilege('authenticated', 'public.progress_ops', 'select') and not has_table_privilege('anon', 'public.progress_ops', 'select'), 'progress_ops is closed to players and visitors');
select pg_temp.must((select (data ->> 'score')::int from public.progress where section = 'core' and user_id = (select id from public.profiles where username = 'up_ann')) = 40, 'the seeded progress is untouched');

-- the new rules work on this data
create temp table ids as select username, id from public.profiles where username like 'up\_%';
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where username = 'up_adm'), 'role', 'authenticated')::text, false);
do $$ begin
  begin
    perform public.content_save_v2(null, '[]'::jsonb, '[{"kind":"words","key":"upX"}]'::jsonb, null, null, '[{"kind":"word","from":"upX","to":"upY"}]'::jsonb, null, true);
    raise exception 'UPGRADE CHECK FAILED: a rename into an existing word was accepted';
  exception when unique_violation then null; end;
end $$;
select public.admin_delete_player((select id from ids where username = 'up_bob'));
select pg_temp.must(not exists (select 1 from public.profiles where username = 'up_bob'), 'a player with views and an own word can be deleted now');
select pg_temp.must((select count(*) from public.collection_shares where status = 'pending') = 0, 'and the offer to him went with him');

-- 0042 with the data of this database: an old-style save (no id) still works, a save with an id is applied once
create temp table ann as select id from public.profiles where username = 'up_ann';
select set_config('request.jwt.claims', json_build_object('sub', (select id from ann), 'role', 'authenticated')::text, false);
select public.save_progress_v2('{"core":{"score":55}}'::jsonb, null, '{}'::jsonb, '{}', null);
select pg_temp.must((select (data ->> 'score')::int from public.progress where section = 'core' and user_id = (select id from ann)) = 55, 'an old-style call (no operation id) saves');
create temp table op as select gen_random_uuid() as id;
create temp table first_call as select public.save_progress_v2('{"core":{"score":60}}'::jsonb, null, '{}'::jsonb, '{}', null, false, (select id from op)) as r;
create temp table second_call as select public.save_progress_v2('{"core":{"score":60}}'::jsonb, null, '{}'::jsonb, '{}', null, false, (select id from op)) as r;
select pg_temp.must((select r ->> 'duplicate' from second_call) = 'true' and (select r -> 'revs' from second_call) = (select r -> 'revs' from first_call), 'the same operation sent twice is answered, not applied again');
