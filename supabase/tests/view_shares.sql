-- Sharing a view with friends (migration 0029): only friends, the inbox,
-- accepting makes the friend their own copy (nested views, words, rules; the
-- sender's private words stay private), dismissing, and the limits
-- (begin; <this>; rollback;).
create function pg_temp.act(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end;
$$;

do $$
declare
  a uuid; b uuid; c uuid;
  h uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; s_private uuid; r1 uuid;
  v_top uuid; v_sub uuid; v_empty uuid;
  sh uuid; sh2 uuid; res jsonb; inbox jsonb; n integer; v_copy uuid; i integer;
begin
  perform public.register_player('sh_a', 'secret1');
  perform public.register_player('sh_b', 'secret1');
  perform public.register_player('sh_c', 'secret1');
  select id into a from public.profiles where username = 'sh_a';
  select id into b from public.profiles where username = 'sh_b';
  select id into c from public.profiles where username = 'sh_c';

  insert into public.headwords (text) values ('Shword') returning id into h;
  insert into public.senses (headword_id, label, meaning) values (h, 'one', 'First') returning id into s1;
  insert into public.senses (headword_id, label, meaning) values (h, 'two', 'Second') returning id into s2;
  insert into public.senses (headword_id, label, meaning) values (h, 'three', 'Third') returning id into s3;
  insert into public.senses (headword_id, label, meaning) values (h, 'four', 'Fourth') returning id into s4;
  insert into public.senses (headword_id, label, meaning, visibility, owner_id, source) values (h, 'secret', 'Only a', 'private', a, 'user') returning id into s_private;
  insert into public.grammar_rules (rule) values ('Shared rule') returning id into r1;

  -- a and b are friends; c is not
  perform pg_temp.act(a); perform public.friend_request('sh_b');
  perform pg_temp.act(b); perform public.friend_respond(a, true);

  -- a builds A1.1 > movies with words, a private word and a rule
  perform pg_temp.act(a);
  v_top := public.view_create('A1.1');
  v_sub := public.view_create('movies', v_top);
  v_empty := public.view_create('elsewhere');
  perform public.view_add(v_top, array[s1]);
  perform public.view_add(v_sub, array[s2, s3, s_private]);
  perform public.view_add_rules(v_sub, array[r1]);

  -- ------------------------------------------------------ who can be sent a view
  perform pg_temp.must(pg_temp.fails($q$select public.view_share('$q$ || v_top || $q$', array['$q$ || c || $q$']::uuid[])$q$), 'a view cannot be sent to someone who is not a friend');
  perform pg_temp.act(b);
  perform pg_temp.must(pg_temp.fails($q$select public.view_share('$q$ || v_top || $q$', array['$q$ || a || $q$']::uuid[])$q$), 'only the owner can share a view');
  perform pg_temp.act(a);
  perform pg_temp.must(public.view_share(v_top, array[a]) = 0, 'sending to yourself does nothing');
  perform pg_temp.must(public.view_share(v_top, array[b, b]) = 1, 'a friend gets it once');
  perform pg_temp.must(public.view_share(v_top, array[b]) = 0, 'and not a second time while it waits');
  perform pg_temp.must(public.view_share(v_empty, '{}') = 0, 'nobody to send to');
  perform pg_temp.must(pg_temp.fails($q$select public.view_share('$q$ || v_top || $q$', (select array_agg(gen_random_uuid()) from generate_series(1, 21)))$q$), 'at most 20 friends at a time');

  -- ------------------------------------------------------ the inbox
  perform pg_temp.act(a);
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 0, 'the sender has nothing in their inbox');
  perform pg_temp.act(c);
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 0, 'a stranger has nothing in their inbox');
  perform pg_temp.must((select count(*) from public.collection_shares) = 1, 'the table is visible to the superuser here');
  perform pg_temp.act(b);
  inbox := public.view_shares_inbox();
  perform pg_temp.must(jsonb_array_length(inbox) = 1, 'b sees the offer');
  perform pg_temp.must(inbox #>> '{0,name}' = 'A1.1' and inbox #>> '{0,from}' = 'sh_a', 'with its name and who sent it');
  perform pg_temp.must((inbox #>> '{0,views}')::int = 1, 'and how many views are inside it');
  sh := (inbox #>> '{0,id}')::uuid;

  -- a stranger can neither accept nor dismiss it
  perform pg_temp.act(c);
  perform pg_temp.must(pg_temp.fails($q$select public.view_share_accept('$q$ || sh || $q$')$q$), 'a stranger cannot accept it');
  perform public.view_share_dismiss(sh);
  perform pg_temp.must((select status from public.collection_shares where id = sh) = 'pending', 'a stranger cannot dismiss it');

  -- ------------------------------------------------------ accepting
  perform pg_temp.act(b);
  res := public.view_share_accept(sh);
  perform pg_temp.must(res ->> 'name' = 'A1.1 (from sh_a)', 'the copy is named after the sender: ' || (res ->> 'name'));
  perform pg_temp.must((res ->> 'views')::int = 2 and (res ->> 'words')::int = 3 and (res ->> 'rules')::int = 1, 'two views, three words, one rule: ' || res::text);
  perform pg_temp.must((res ->> 'skipped')::int = 1, 'the private word was left out and counted');
  v_copy := (res ->> 'view')::uuid;
  perform pg_temp.must((select owner_id from public.collections where id = v_copy) = b, 'the copy belongs to b');
  perform pg_temp.must((select parent_id from public.collections where id = v_copy) is null, 'at the top level');
  perform pg_temp.must(exists (select 1 from public.collections where owner_id = b and path = 'A1.1 (from sh_a)::movies'), 'the view inside came too');
  select count(*) into n from public.view_contents(v_copy, true) where kind = 'sense';
  perform pg_temp.must(n = 3, 'b has the three words in the copy (' || n || ')');
  select count(*) into n from public.view_contents(v_copy, true) where kind = 'rule';
  perform pg_temp.must(n = 1, 'and the rule');
  perform pg_temp.must((select count(*) from public.library_entries where user_id = b and removed_at is null) = 3, 'the words are in b''s library');
  perform pg_temp.must(not exists (select 1 from public.library_entries where user_id = b and sense_id = s_private), 'but not the private one');
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 0, 'the inbox is empty again');
  perform pg_temp.must((select status from public.collection_shares where id = sh) = 'accepted' and (select s.copy_id from public.collection_shares s where s.id = sh) = v_copy, 'the share records the copy');
  perform pg_temp.must(pg_temp.fails($q$select public.view_share_accept('$q$ || sh || $q$')$q$), 'it cannot be accepted twice');

  -- the copy is b's own: changes on either side don't cross
  perform public.view_edit(v_copy, 'My copy');
  perform pg_temp.act(a);
  perform pg_temp.must((select name from public.collections where id = v_top) = 'A1.1', 'a''s view keeps its name');
  perform public.view_add(v_top, array[s4]);
  perform pg_temp.act(b);
  select count(*) into n from public.view_contents(v_copy, true) where kind = 'sense';
  perform pg_temp.must(n = 3, 'a word a adds later does not appear in b''s copy (' || n || ')');
  perform pg_temp.must((select name from public.collections where id = v_copy) = 'My copy', 'and b''s rename is b''s own');

  -- ------------------------------------------------------ share again, name taken, dismiss
  perform pg_temp.act(a);
  perform pg_temp.must(public.view_share(v_top, array[b]) = 1, 'it can be offered again after it was answered');
  perform pg_temp.act(b);
  sh2 := (public.view_shares_inbox() #>> '{0,id}')::uuid;
  res := public.view_share_accept(sh2);
  perform pg_temp.must(res ->> 'name' = 'A1.1 (from sh_a)', 'the first copy was renamed, so the name is free again: ' || (res ->> 'name'));
  perform pg_temp.act(a);
  perform public.view_share(v_top, array[b]);
  perform pg_temp.act(b);
  res := public.view_share_accept((public.view_shares_inbox() #>> '{0,id}')::uuid);
  perform pg_temp.must(res ->> 'name' = 'A1.1 (from sh_a) 2', 'a taken name gets a number: ' || (res ->> 'name'));

  perform pg_temp.act(a);
  perform public.view_share(v_empty, array[b]);
  perform pg_temp.act(b);
  sh := (public.view_shares_inbox() #>> '{0,id}')::uuid;
  perform public.view_share_dismiss(sh);
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 0, 'a dismissed offer leaves the inbox');
  perform pg_temp.must(pg_temp.fails($q$select public.view_share_accept('$q$ || sh || $q$')$q$), 'and cannot be accepted');

  -- ------------------------------------------------------ the sender removes it, or the friendship ends
  perform pg_temp.act(a);
  perform public.view_share(v_empty, array[b]);
  perform public.view_remove(v_empty);
  perform pg_temp.act(b);
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 0, 'an offer of a view the sender removed is not listed');
  perform pg_temp.act(a);
  v_empty := public.view_create('again');
  perform public.view_share(v_empty, array[b]);
  perform public.friend_remove(b);
  perform pg_temp.act(b);
  sh2 := (select id from public.collection_shares where status = 'pending' and to_user = b limit 1);
  perform pg_temp.must(sh2 is not null, 'the offer is still waiting');
  perform pg_temp.must(pg_temp.fails($q$select public.view_share_accept('$q$ || sh2 || $q$')$q$), 'after unfriending the offer cannot be accepted');

  -- ------------------------------------------------------ room
  perform pg_temp.act(c);
  perform public.friend_request('sh_a');
  perform pg_temp.act(a); perform public.friend_respond(c, true);
  perform pg_temp.act(c);
  for i in 1..199 loop perform public.view_create('c' || i); end loop;
  perform pg_temp.act(a);
  perform public.view_share(v_top, array[c]);
  perform pg_temp.act(c);
  perform pg_temp.must(pg_temp.fails($q$select public.view_share_accept('$q$ || (public.view_shares_inbox() #>> '{0,id}') || $q$')$q$), 'no room for the copy: refused (2 views needed, 199 already)');

  raise exception 'VIEW SHARES TESTS PASSED';
end $$;
