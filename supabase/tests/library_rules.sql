-- Grammar rules in the library and in views (migration 0035): add to the
-- library, take out of a view, take out of the library, and only my own
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
  a uuid; b uuid; r1 uuid; r2 uuid; r3 uuid; v1 uuid; v2 uuid; res jsonb;
begin
  perform public.register_player('lr_a', 'secret1');
  perform public.register_player('lr_b', 'secret1');
  select id into a from public.profiles where username = 'lr_a';
  select id into b from public.profiles where username = 'lr_b';
  insert into public.grammar_rules (rule) values ('Rule one') returning id into r1;
  insert into public.grammar_rules (rule) values ('Rule two') returning id into r2;
  insert into public.grammar_rules (rule, deleted_at) values ('Rule gone', now()) returning id into r3;

  perform pg_temp.act(a);
  perform pg_temp.must(public.library_add_rules(array[r1, r2, r3]) = 2, 'two rules go in; a removed one does not');
  perform pg_temp.must(public.library_add_rules(array[r1]) = 0, 'adding again changes nothing');
  perform pg_temp.must(jsonb_array_length(public.library_list() -> 'rules') = 2, 'the library lists two rules');
  v1 := public.view_create('Grammar');
  v2 := public.view_create('Inner', v1);
  perform public.view_add_rules(v1, array[r1, r2]);
  perform public.view_add_rules(v2, array[r1]);
  perform pg_temp.must((select count(*) from public.view_contents(v1, true) where kind = 'rule') = 2, 'two rules in the view and the view inside it');

  -- out of one view
  perform public.view_drop_rule(v2, r1);
  perform pg_temp.must((select count(*) from public.view_contents(v2, false) where kind = 'rule') = 0, 'taken out of the inner view');
  perform pg_temp.must((select count(*) from public.view_contents(v1, false) where kind = 'rule') = 2, 'but still in the other');
  perform pg_temp.must(jsonb_array_length(public.library_list() -> 'rules') = 2, 'and still in the library');
  -- it can be put back
  perform public.view_add_rules(v2, array[r1]);
  perform pg_temp.must((select count(*) from public.view_contents(v2, false) where kind = 'rule') = 1, 'put back');

  -- out of the library: out of every view of mine too
  perform public.library_remove_rule(r1);
  perform pg_temp.must(jsonb_array_length(public.library_list() -> 'rules') = 1, 'the library has one rule left');
  perform pg_temp.must((select count(*) from public.view_contents(v1, true) where kind = 'rule') = 1, 'it left every view too');
  perform pg_temp.must((select count(*) from public.grammar_rules where id = r1 and deleted_at is null) = 1, 'the rule itself is untouched');
  perform pg_temp.must(public.library_add_rules(array[r1]) = 1, 'it can come back to the library');

  -- someone else's views and library are not touched
  perform pg_temp.act(b);
  perform public.library_add_rules(array[r1]);
  perform public.view_drop_rule(v1, r2);                       -- not b's view: nothing happens
  perform public.library_remove_rule(r2);                      -- b never had it
  perform pg_temp.act(a);
  perform pg_temp.must((select count(*) from public.view_contents(v1, false) where kind = 'rule') = 1, 'b could not take a rule out of a''s view');
  perform pg_temp.must(jsonb_array_length(public.library_list() -> 'rules') = 2, 'or out of a''s library');

  -- limits and signing in
  perform pg_temp.must(pg_temp.fails($q$select public.library_add_rules(array(select gen_random_uuid() from generate_series(1, 201)))$q$), 'at most 200 rules at a time');
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.must(pg_temp.fails('select public.library_add_rules(array[]::uuid[])'), 'signed out cannot add');
  raise exception 'LIBRARY RULES TESTS PASSED';
end $$;
