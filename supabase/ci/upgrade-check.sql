-- What must be true after migrations 0037-0040 on the data of upgrade-seed.sql.
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
