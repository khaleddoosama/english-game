-- Made-up data for supabase/ci/check-upgrade.sh: a database at migration 0036 with
-- players, friends, words (one renamed the old way), a library, views, offers and progress.
-- Nothing here is real.
select public.register_player('up_ann', 'secret1'), public.register_player('up_bob', 'secret1'), public.register_player('up_cat', 'secret1'), public.register_player('up_adm', 'secret1');
update public.profiles set role = 'admin' where username = 'up_adm';
create temp table ids as select username, id from public.profiles where username like 'up\_%';
create function pg_temp.as_user(n text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', (select id from ids where username = n), 'role', 'authenticated')::text, false); end; $$;

-- course words, one of them renamed the old way (content_save_v2 + sync), which leaves a deleted sense behind
insert into public.content_items (kind, key, data) values
  ('words', 'upOld', '{"word":"upOld","type":"vocab","category":"upLesson","meaning":"old"}'),
  ('words', 'upX', '{"word":"upX","type":"vocab","category":"upLesson","meaning":"x"}'),
  ('words', 'upY', '{"word":"upY","type":"vocab","category":"upLesson","meaning":"y"}');
select public.dictionary_sync_core();

select pg_temp.as_user('up_ann');
select public.library_add(array[(select id from public.senses where legacy_key = 'upOld'), (select id from public.senses where legacy_key = 'upX')]);
select public.view_add(public.view_create('up view'), array[(select id from public.senses where legacy_key = 'upOld')]);
select public.save_progress_v2('{"core":{"score":40}}'::jsonb, null, '{"upOld":{"total":3},"upX":{"total":1}}'::jsonb, '{}', null);
select public.friend_request('up_bob'), public.friend_request('up_cat');
select pg_temp.as_user('up_bob'); select public.friend_respond((select id from ids where username = 'up_ann'), true);
select pg_temp.as_user('up_cat'); select public.friend_respond((select id from ids where username = 'up_ann'), true);

-- offers: Ann -> Bob (friends, stays waiting); Ann -> Cat, then the friendship ends the old way (the offer stays waiting)
select pg_temp.as_user('up_ann');
select public.view_share((select id from public.collections where name = 'up view'), array[(select id from ids where username = 'up_bob')]);
select public.view_create('up view two');
select public.view_share((select id from public.collections where name = 'up view two'), array[(select id from ids where username = 'up_cat')]);
update public.friendships set status = 'removed' where user_a = least((select id from ids where username = 'up_ann'), (select id from ids where username = 'up_cat')) and user_b = greatest((select id from ids where username = 'up_ann'), (select id from ids where username = 'up_cat'));

-- a word of Bob's own in a view, so that deleting him has something to remove
select pg_temp.as_user('up_bob');
select public.view_add(public.view_create('bob view'), array[(public.sense_create('upOwn', 'vocab', '{}', null, 'mine', '{}'::jsonb, 'user') ->> 'id')::uuid]);

-- the rename, the old way: new content, the alias and progress move, the sync makes a new sense and deletes the old
select pg_temp.as_user('up_adm');
select public.content_save_v2(null,
  '[{"kind":"words","key":"upNew","data":{"word":"upNew","type":"vocab","category":"upLesson","meaning":"old"},"position":1}]'::jsonb,
  '[{"kind":"words","key":"upOld"}]'::jsonb, null, null, '[{"kind":"word","from":"upOld","to":"upNew"}]'::jsonb, null, true);
select public.dictionary_sync();
