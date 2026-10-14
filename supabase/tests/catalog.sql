-- The catalog (migration 0032): publishing, browsing, taking, taking down,
-- limits (begin; <this>; rollback;).
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
  a uuid; b uuid; adm uuid; h uuid; s1 uuid; s_private uuid; r1 uuid;
  v_top uuid; v_sub uuid; v_x uuid; e jsonb; eid uuid; list jsonb; res jsonb; res2 jsonb; i integer; vv uuid;
begin
  perform public.register_player('ct_a', 'secret1');
  perform public.register_player('ct_b', 'secret1');
  select id into a from public.profiles where username = 'ct_a';
  select id into b from public.profiles where username = 'ct_b';
  select id into adm from public.profiles where username = 'ci_admin';
  insert into public.headwords (text) values ('Ctword') returning id into h;
  insert into public.senses (headword_id, label, meaning) values (h, 'one', 'First') returning id into s1;
  insert into public.senses (headword_id, label, meaning, visibility, owner_id, source) values (h, 'secret', 'Only a', 'private', a, 'user') returning id into s_private;
  insert into public.grammar_rules (rule) values ('Catalog rule') returning id into r1;

  perform pg_temp.act(a);
  v_top := public.view_create('Movies');
  v_sub := public.view_create('Horror', v_top);
  perform public.view_add(v_top, array[s1]);
  perform public.view_add(v_sub, array[s_private]);
  perform public.view_add_rules(v_top, array[r1]);

  -- only the owner publishes, with a title
  perform pg_temp.act(b);
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, ''x'', '''')', v_top)), 'someone else cannot publish my view');
  perform pg_temp.act(a);
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, '''', '''')', v_top)), 'a title is needed');
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, %L, '''')', v_top, repeat('x', 61))), 'a title is up to 60');
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, ''t'', %L)', v_top, repeat('x', 301))), 'a description is up to 300');
  e := public.catalog_publish(v_top, '  Movie night  ', 'Scary and fun');
  eid := (e ->> 'id')::uuid;
  perform pg_temp.must(e ->> 'title' = 'Movie night', 'the title is trimmed');
  -- publishing again changes the same entry
  e := public.catalog_publish(v_top, 'Movie night 2', 'Scary and fun');
  perform pg_temp.must((e ->> 'id')::uuid = eid, 'the same entry is updated, not doubled');
  perform pg_temp.must((select count(*) from public.catalog_entries where collection_id = v_top and unpublished_at is null) = 1, 'one open entry per view');

  -- everyone signed in can browse; counts leave the private word out
  perform pg_temp.act(b);
  list := public.catalog_list('', 50);
  perform pg_temp.must(jsonb_array_length(list) = 1, 'b sees the entry');
  perform pg_temp.must((list -> 0 ->> 'words')::int = 1 and (list -> 0 ->> 'rules')::int = 1 and (list -> 0 ->> 'views')::int = 2, 'counts: 1 public word, 1 rule, 2 views');
  perform pg_temp.must((list -> 0 ->> 'from') = 'ct_a' and (list -> 0 ->> 'taken') = 'false' and (list -> 0 ->> 'mine') = 'false', 'who and not taken yet');
  perform pg_temp.must(jsonb_array_length(public.catalog_list('movie', 50)) = 1, 'search by title');
  perform pg_temp.must(jsonb_array_length(public.catalog_list('SCARY', 50)) = 1, 'search by description, any case');
  perform pg_temp.must(jsonb_array_length(public.catalog_list('ct_a', 50)) = 1, 'search by owner');
  perform pg_temp.must(jsonb_array_length(public.catalog_list('zzz', 50)) = 0, 'no match');
  perform pg_temp.must(jsonb_array_length(public.catalog_list('%', 50)) = 0, 'a % is not a wildcard');

  -- take: my own copy, without the private word
  res := public.catalog_take(eid);
  perform pg_temp.must((res ->> 'views')::int = 2 and (res ->> 'words')::int = 1 and (res ->> 'rules')::int = 1 and (res ->> 'skipped')::int = 1, 'the copy has what it may: 2 views, 1 word, 1 rule, 1 skipped');
  perform pg_temp.must(exists (select 1 from public.collections where id = (res ->> 'view')::uuid and owner_id = b), 'the copy is b''s');
  perform pg_temp.must(not exists (select 1 from public.library_entries where user_id = b and sense_id = s_private), 'the private word did not reach b');
  perform pg_temp.must((public.catalog_list('', 50) -> 0 ->> 'taken') = 'true', 'it now says taken');
  perform pg_temp.must((select takes from public.catalog_entries where id = eid) = 1, 'takes counted');
  -- twice gives the same copy
  res2 := public.catalog_take(eid);
  perform pg_temp.must((res2 ->> 'view') = (res ->> 'view') and (res2 ->> 'already') = 'true', 'taking twice gives the copy already had');
  perform pg_temp.must((select takes from public.catalog_entries where id = eid) = 1, 'and is not counted again');
  -- own view cannot be taken
  perform pg_temp.act(a);
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_take(%L)', eid)), 'the owner cannot take their own');
  perform pg_temp.must((public.catalog_list('', 50) -> 0 ->> 'mine') = 'true', 'the owner sees it as theirs');

  -- b cannot take it down; the admin and the owner can
  perform pg_temp.act(b);
  perform public.catalog_unpublish(eid);
  perform pg_temp.must((select unpublished_at from public.catalog_entries where id = eid) is null, 'another player cannot take it down');
  perform pg_temp.act(adm);
  perform public.catalog_unpublish(eid);
  perform pg_temp.must((select unpublished_at from public.catalog_entries where id = eid) is not null, 'the admin can take it down');
  perform pg_temp.act(b);
  perform pg_temp.must(jsonb_array_length(public.catalog_list('', 50)) = 0, 'a taken-down entry is not listed');
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_take(%L)', eid)), 'and cannot be taken');
  -- my copy stays mine
  perform pg_temp.must(exists (select 1 from public.collections where id = (res ->> 'view')::uuid and deleted_at is null), 'b keeps the copy');
  -- it can be published again
  perform pg_temp.act(a);
  e := public.catalog_publish(v_top, 'Again', '');
  perform pg_temp.must((e ->> 'id')::uuid <> eid, 'publishing again after taking down makes a new entry');
  -- a removed view drops out of the catalog
  perform public.view_remove(v_top);
  perform pg_temp.act(b);
  perform pg_temp.must(jsonb_array_length(public.catalog_list('', 50)) = 0, 'a removed view is not listed');

  -- 20 open entries is the most
  perform pg_temp.act(a);
  for i in 1..20 loop
    vv := public.view_create('V' || i);
    perform public.catalog_publish(vv, 'T' || i, '');
  end loop;
  vv := public.view_create('V21');
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, ''T21'', '''')', vv)), 'the 21st entry is refused');
  perform pg_temp.must((select jsonb_array_length(public.catalog_list('', 10))) = 10, 'a call returns up to what was asked');

  -- signed out gets nothing
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.must(pg_temp.fails('select public.catalog_list()'), 'signed out cannot browse');
  perform pg_temp.must(pg_temp.fails(format('select public.catalog_publish(%L, ''x'', '''')', vv)), 'signed out cannot publish');
  raise exception 'CATALOG TESTS PASSED';
end $$;
