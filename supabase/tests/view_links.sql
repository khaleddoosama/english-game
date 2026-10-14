-- Sharing a view by link (migration 0031): who can make one, what it shows,
-- taking a copy (no friendship needed), taking it twice, taking it back,
-- expiry, and limits (begin; <this>; rollback;).
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
  h uuid; s1 uuid; s2 uuid; s_private uuid; r1 uuid;
  v_top uuid; v_sub uuid; v_other uuid;
  l1 jsonb; l2 jsonb; tok text; info jsonb; res jsonb; res2 jsonb; n integer; i integer;
begin
  perform public.register_player('lk_a', 'secret1');
  perform public.register_player('lk_b', 'secret1');
  perform public.register_player('lk_c', 'secret1');
  select id into a from public.profiles where username = 'lk_a';
  select id into b from public.profiles where username = 'lk_b';
  select id into c from public.profiles where username = 'lk_c';
  insert into public.headwords (text) values ('Lkword') returning id into h;
  insert into public.senses (headword_id, label, meaning) values (h, 'one', 'First') returning id into s1;
  insert into public.senses (headword_id, label, meaning) values (h, 'two', 'Second') returning id into s2;
  insert into public.senses (headword_id, label, meaning, visibility, owner_id, source) values (h, 'secret', 'Only a', 'private', a, 'user') returning id into s_private;
  insert into public.grammar_rules (rule) values ('Link rule') returning id into r1;

  perform pg_temp.act(a);
  v_top := public.view_create('A1.1 sports');
  v_sub := public.view_create('football', v_top);
  v_other := public.view_create('other');
  perform public.view_add(v_top, array[s1]);
  perform public.view_add(v_sub, array[s2, s_private]);
  perform public.view_add_rules(v_sub, array[r1]);

  -- ------------------------------------------------------ making a link
  l1 := public.view_link_create(v_top);
  tok := l1 ->> 'token';
  perform pg_temp.must(length(tok) >= 40, 'the token is long enough to not be guessed (' || length(tok) || ')');
  l2 := public.view_link_create(v_top);
  perform pg_temp.must(l2 ->> 'token' = tok, 'asking again gives the link that is still good');
  perform pg_temp.must((public.view_link_create(v_other) ->> 'token') <> tok, 'another view has its own link');
  perform pg_temp.act(b);
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_create('$q$ || v_top || $q$')$q$), 'only the owner can make a link');

  -- ------------------------------------------------------ what it shows
  perform pg_temp.act(c);
  info := public.view_link_info(tok);
  perform pg_temp.must((info ->> 'valid')::boolean and info ->> 'name' = 'A1.1 sports' and info ->> 'from' = 'lk_a', 'a stranger sees what is offered and from whom');
  perform pg_temp.must((info ->> 'views')::int = 2 and (info ->> 'words')::int = 2 and (info ->> 'rules')::int = 1, 'with what the whole view holds, without the private word (' || info::text || ')');
  perform pg_temp.must(not (info ->> 'mine')::boolean and not (info ->> 'taken')::boolean, 'not theirs, not taken yet');
  perform pg_temp.act(a);
  perform pg_temp.must((public.view_link_info(tok) ->> 'mine')::boolean, 'the owner is told it is theirs');
  perform pg_temp.act(c);
  perform pg_temp.must(not (public.view_link_info('nonsense') ->> 'valid')::boolean and public.view_link_info('nonsense') ->> 'reason' = 'not_found', 'an unknown link says so');
  perform set_config('request.jwt.claims', '{}', true);
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_info('x')$q$), 'nobody signed out can look');

  -- ------------------------------------------------------ taking it (c is not a friend of a)
  perform pg_temp.act(c);
  res := public.view_link_accept(tok);
  perform pg_temp.must(res ->> 'name' = 'A1.1 sports (from lk_a)', 'named after the sender: ' || (res ->> 'name'));
  perform pg_temp.must((res ->> 'views')::int = 2 and (res ->> 'words')::int = 2 and (res ->> 'rules')::int = 1, 'two views, two words, a rule: ' || res::text);
  perform pg_temp.must((res ->> 'skipped')::int = 1, 'the private word was left out and counted');
  select count(*) into n from public.view_contents((res ->> 'view')::uuid, true) where kind = 'sense';
  perform pg_temp.must(n = 2, 'c has the words in the copy');
  perform pg_temp.must(exists (select 1 from public.collections where owner_id = c and path = 'A1.1 sports (from lk_a)::football'), 'with the view inside');
  perform pg_temp.must(not exists (select 1 from public.library_entries where user_id = c and sense_id = s_private), 'the private word is not in c''s library');
  perform pg_temp.must((select count(*) from public.library_entries where user_id = c and removed_at is null) = 2, 'the others are');
  perform pg_temp.must((select uses from public.view_links where token = tok) = 1, 'the link counted one');
  perform pg_temp.must((public.view_link_info(tok) ->> 'taken')::boolean, 'and says c already took it');

  -- twice: the copy already there
  res2 := public.view_link_accept(tok);
  perform pg_temp.must((res2 ->> 'already')::boolean and res2 ->> 'view' = res ->> 'view', 'taking it again gives the same copy');
  perform pg_temp.must((select count(*) from public.collections where owner_id = c and deleted_at is null) = 2, 'and no second copy');
  perform pg_temp.must((select uses from public.view_links where token = tok) = 1, 'and no second count');

  -- the owner cannot take their own
  perform pg_temp.act(a);
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_accept('$q$ || tok || $q$')$q$), 'the owner cannot take their own view');

  -- removed the copy: it can be taken again, as a new one
  perform pg_temp.act(c);
  perform public.view_remove((res ->> 'view')::uuid);
  res2 := public.view_link_accept(tok);
  perform pg_temp.must(res2 ->> 'view' <> res ->> 'view' and not coalesce((res2 ->> 'already')::boolean, false), 'after removing it, taking it again makes a new copy');
  perform pg_temp.must(res2 ->> 'name' = 'A1.1 sports (from lk_a)', 'with the free name');

  -- independent of the original
  perform public.view_edit((res2 ->> 'view')::uuid, 'Mine now');
  perform pg_temp.act(a);
  perform pg_temp.must((select name from public.collections where id = v_top) = 'A1.1 sports', 'the original keeps its name');

  -- ------------------------------------------------------ b takes it too, counts add up
  perform pg_temp.act(b);
  perform public.view_link_accept(tok);
  perform pg_temp.act(a);
  perform pg_temp.must((select uses from public.view_links where token = tok) = 3, 'three takes counted');

  -- ------------------------------------------------------ my library as a list
  perform pg_temp.act(a);
  res := public.library_list();
  perform pg_temp.must(jsonb_array_length(res -> 'words') = 3 and jsonb_array_length(res -> 'rules') = 1, 'a''s library: three words (one private) and a rule: ' || res::text);
  perform pg_temp.must((select (e ->> 'views')::int from jsonb_array_elements(res -> 'words') e where e ->> 'id' = s1::text) = 1, 'each word says how many views it is in');
  perform public.library_remove(s2);
  perform pg_temp.must(jsonb_array_length(public.library_list() -> 'words') = 2, 'a removed word leaves the list');
  perform pg_temp.act(c);
  res := public.library_list();
  perform pg_temp.must(not exists (select 1 from jsonb_array_elements(res -> 'words') e where e ->> 'id' = s_private::text), 'c does not get a''s private word');
  perform pg_temp.act(a);
  perform public.library_add(array[s2]);

  -- ------------------------------------------------------ privacy of the table
  perform pg_temp.act(c);
  set local role authenticated;
  perform pg_temp.must((select count(*) from public.view_links) = 0, 'c cannot read the links table');
  perform pg_temp.must(pg_temp.fails($q$update public.view_links set expires_at = now() + interval '9 years'$q$), 'and cannot change it');
  reset role;
  perform pg_temp.act(a);
  set local role authenticated;
  perform pg_temp.must((select count(*) from public.view_links) = 2, 'the owner reads their own two');
  reset role;

  -- ------------------------------------------------------ taking it back
  perform pg_temp.act(c);
  perform public.view_link_revoke(tok);
  perform pg_temp.act(a);
  perform pg_temp.must((select revoked_at is null from public.view_links where token = tok), 'someone else cannot take it back');
  perform public.view_link_revoke(tok);
  perform pg_temp.act(c);
  perform pg_temp.must(public.view_link_info(tok) ->> 'reason' = 'taken_back', 'a link taken back says so');
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_accept('$q$ || tok || $q$')$q$), 'and cannot be taken');
  perform pg_temp.act(a);
  l2 := public.view_link_create(v_top);
  perform pg_temp.must(l2 ->> 'token' <> tok, 'a new link is a different one');

  -- ------------------------------------------------------ expiry and removal
  update public.view_links set expires_at = now() - interval '1 minute' where token = l2 ->> 'token';
  perform pg_temp.act(c);
  perform pg_temp.must(public.view_link_info(l2 ->> 'token') ->> 'reason' = 'expired', 'an old link says expired');
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_accept('$q$ || (l2 ->> 'token') || $q$')$q$), 'and cannot be taken');
  perform pg_temp.act(a);
  l2 := public.view_link_create(v_other);
  perform public.view_remove(v_other);
  perform pg_temp.act(c);
  perform pg_temp.must(public.view_link_info(l2 ->> 'token') ->> 'reason' = 'removed', 'a link to a removed view says so');

  -- ------------------------------------------------------ no room for the copy
  perform pg_temp.act(a);
  l1 := public.view_link_create(v_top);
  perform pg_temp.act(b);
  for i in 1..197 loop perform public.view_create('b' || i); end loop;
  perform pg_temp.must(pg_temp.fails($q$select public.view_link_accept('$q$ || (l1 ->> 'token') || $q$')$q$), 'no room for the copy: refused');

  -- ------------------------------------------------------ at most 50 links open
  perform pg_temp.act(a);
  for i in 1..60 loop
    begin
      perform public.view_create('lim' || i);
    exception when others then exit;
    end;
  end loop;
  for i in 1..60 loop
    begin
      perform public.view_link_create((select id from public.collections where owner_id = a and name = 'lim' || i and deleted_at is null));
    exception when sqlstate '55000' then exit;
    end;
  end loop;
  perform pg_temp.must((select count(*) from public.view_links where owner_id = a and revoked_at is null and expires_at > now()) = 50, 'at most 50 links open');

  raise exception 'VIEW LINKS TESTS PASSED';
end $$;
