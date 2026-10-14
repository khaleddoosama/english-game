-- The library (migration 0026): views inside views, words in several views,
-- the library and a player's own changes, what each player can see, limits
-- (begin; <this>; rollback;).
create function pg_temp.act(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;
-- Runs a statement as the signed-in player and says whether it failed.
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
  a uuid; b uuid;
  h_cast uuid; h_shrink uuid;
  s_cast1 uuid; s_cast2 uuid; s_shrink uuid; s_private uuid; s_pending uuid; s_hidden uuid;
  r1 uuid; r2 uuid;
  v_top uuid; v_movies uuid; v_horror uuid; v_deep uuid; v_other uuid; v_course uuid;
  n integer; j jsonb; i integer; t text;
begin
  perform public.register_player('lib_a', 'secret1');
  perform public.register_player('lib_b', 'secret1');
  select id into a from public.profiles where username = 'lib_a';
  select id into b from public.profiles where username = 'lib_b';

  -- the dictionary (written here as the owner of the database)
  insert into public.headwords (text) values ('Cast') returning id into h_cast;
  insert into public.headwords (text) values ('Shrink') returning id into h_shrink;
  insert into public.senses (headword_id, label, meaning, course_level) values (h_cast, 'to throw', 'To throw something', 'A1.1') returning id into s_cast1;
  insert into public.senses (headword_id, label, meaning, course_level) values (h_cast, 'actors', 'To choose actors for a play', 'A1.1') returning id into s_cast2;
  insert into public.senses (headword_id, meaning) values (h_shrink, 'To become smaller') returning id into s_shrink;
  insert into public.senses (headword_id, label, meaning, visibility, owner_id, source) values (h_shrink, 'mine', 'My own meaning', 'private', a, 'user') returning id into s_private;
  insert into public.senses (headword_id, label, meaning, source, review_status) values (h_shrink, 'ai', 'Written by AI', 'ai', 'pending') returning id into s_pending;
  insert into public.senses (headword_id, label, meaning, review_status) values (h_shrink, 'bad', 'Rejected', 'rejected') returning id into s_hidden;
  insert into public.grammar_rules (rule) values ('Used to') returning id into r1;
  insert into public.grammar_rules (rule) values ('Zero conditional') returning id into r2;
  insert into public.collections (owner_id, kind, name, path, course_level) values (null, 'course', 'A1.1', 'A1.1', 'A1.1') returning id into v_course;

  -- two meanings of a word can't share a label
  perform pg_temp.must(pg_temp.fails($q$insert into public.senses (headword_id, label, meaning) values ('$q$ || h_cast || $q$', 'To Throw', 'again')$q$), 'a repeated label is refused');
  -- a private word needs an owner
  perform pg_temp.must(pg_temp.fails($q$insert into public.senses (headword_id, label, meaning, visibility) values ('$q$ || h_cast || $q$', 'x', 'y', 'private')$q$), 'a private word without an owner is refused');

  -- ----------------------------------------------------- who sees which words
  perform pg_temp.act(a);
  set local role authenticated;
  select count(*) into n from public.senses where headword_id in (h_cast, h_shrink);
  perform pg_temp.must(n = 5, 'a sees the public words, the AI one waiting for review, and their own (' || n || ')');
  perform pg_temp.must(not exists (select 1 from public.senses where id = s_hidden), 'a rejected word is hidden');
  reset role;
  perform pg_temp.act(b);
  set local role authenticated;
  perform pg_temp.must(not exists (select 1 from public.senses where id = s_private), 'b does not see a''s private word');
  perform pg_temp.must(exists (select 1 from public.senses where id = s_pending), 'b sees the AI word that waits for review');
  perform pg_temp.must(pg_temp.fails($q$insert into public.senses (headword_id, meaning) values ('$q$ || h_cast || $q$', 'sneaky')$q$), 'players cannot write to the dictionary');
  perform pg_temp.must(pg_temp.fails($q$update public.senses set meaning = 'changed' where id = '$q$ || s_cast1 || $q$'$q$), 'players cannot edit the dictionary');
  reset role;
  perform pg_temp.must((select meaning from public.senses where id = s_cast1) = 'To throw something', 'the dictionary is unchanged');

  -- ----------------------------------------------------- library
  perform pg_temp.act(a);
  set local role authenticated;
  select count(*) into n from public.library_add(array[s_cast1, s_cast2, s_private, s_hidden]);
  perform pg_temp.must(n = 3, 'three of the four can be added; the rejected one cannot (' || n || ')');
  perform pg_temp.must((select count(*) from public.library_entries) = 3, 'a has 3 in the library');
  reset role;
  perform pg_temp.act(b);
  set local role authenticated;
  select count(*) into n from public.library_add(array[s_private]);
  perform pg_temp.must(n = 0, 'b cannot add a''s private word');
  perform pg_temp.must((select count(*) from public.library_entries) = 0, 'b''s library is its own');
  reset role;

  -- ----------------------------------------------------- views inside views
  perform pg_temp.act(a);
  set local role authenticated;
  v_top := public.view_create('A1.1');
  v_movies := public.view_create('movies', v_top);
  v_horror := public.view_create('horror', v_movies);
  perform pg_temp.must((select path from public.collections where id = v_horror) = 'A1.1::movies::horror', 'the path follows the nesting');
  perform pg_temp.must(pg_temp.fails($q$select public.view_create('movies', '$q$ || v_top || $q$')$q$), 'a repeated name in the same place is refused');
  perform pg_temp.must(pg_temp.fails($q$select public.view_create('a::b')$q$), 'a name with :: is refused');
  perform pg_temp.must(public.view_create('movies') is not null, 'the same name at the top is a different place');
  v_deep := public.view_create('level4', v_horror);
  perform pg_temp.must(pg_temp.fails($q$select public.view_create('level5', '$q$ || v_deep || $q$')$q$), 'a fifth level is refused');
  perform pg_temp.must(pg_temp.fails($q$select public.view_create('x', '$q$ || v_course || $q$')$q$), 'a view cannot sit under the official course');
  v_other := public.view_create('from the course', null, v_course);
  perform pg_temp.must((select course_level from public.collections where id = v_other) = 'A1.1', 'a view made from a course view keeps its level');

  -- a word in two views at once, with one record of progress
  perform public.view_add(v_horror, array[s_cast1]);
  perform public.view_add(v_other, array[s_cast1, s_cast2]);
  select count(*) into n from public.view_contents(v_top, true) where kind = 'sense';
  perform pg_temp.must(n = 1, 'the top view holds the horror view''s word (' || n || ')');
  select count(*) into n from public.view_contents(v_top, false) where kind = 'sense';
  perform pg_temp.must(n = 0, 'without the views inside, nothing sits directly in the top view (' || n || ')');
  select count(*) into n from public.view_contents(v_other, true) where kind = 'sense';
  perform pg_temp.must(n = 2, 'the other view holds its two words');
  perform pg_temp.must((select count(*) from public.library_entries where sense_id = s_cast1) = 1, 'one library entry for a word in two views');
  perform pg_temp.must(public.view_add(v_horror, array[s_cast1]) = 0, 'adding the same word again changes nothing');

  -- a word added to a view that was not yet in the library joins the library
  perform public.view_add(v_movies, array[s_shrink]);
  perform pg_temp.must(exists (select 1 from public.library_entries where sense_id = s_shrink), 'adding to a view adds to the library');
  perform pg_temp.must(public.view_add(v_movies, array[s_hidden]) = 0, 'a hidden word cannot be put in a view');

  -- rules sit in views too
  perform public.view_add_rules(v_horror, array[r1, r2]);
  select count(*) into n from public.view_contents(v_top, true) where kind = 'rule';
  perform pg_temp.must(n = 2, 'rules inside nested views count');

  -- taking a word out of a view keeps it in the library
  perform public.view_drop(v_horror, s_cast1);
  select count(*) into n from public.view_contents(v_horror, true) where kind = 'sense';
  perform pg_temp.must(n = 0, 'dropped from the view');
  perform pg_temp.must(exists (select 1 from public.library_entries where sense_id = s_cast1 and removed_at is null), '…but still in the library');
  perform public.view_add(v_horror, array[s_cast1]);
  select count(*) into n from public.view_contents(v_horror, true) where kind = 'sense';
  perform pg_temp.must(n = 1, 'and it can be put back');

  -- the tree
  j := public.view_tree();
  perform pg_temp.must(jsonb_array_length(j) = 6, 'six views in the tree (' || jsonb_array_length(j) || ')');
  perform pg_temp.must((select (e->>'words')::int from jsonb_array_elements(j) e where e->>'path' = 'A1.1::movies::horror') = 1, 'the tree counts the words in each view');
  -- …and, for each view, everything in it and the views inside it (each word once)
  perform pg_temp.must((select (e->>'deep_words')::int from jsonb_array_elements(j) e where e->>'path' = 'A1.1') = (select count(distinct id) from public.view_contents(v_top, true) where kind = 'sense'), 'deep word count of a view with views inside');
  perform pg_temp.must((select (e->>'deep_rules')::int from jsonb_array_elements(j) e where e->>'path' = 'A1.1') = (select count(distinct id) from public.view_contents(v_top, true) where kind = 'rule'), 'deep rule count of a view with views inside');
  perform pg_temp.must((select (e->>'deep_words')::int from jsonb_array_elements(j) e where e->>'path' = 'A1.1') >= (select (e->>'words')::int from jsonb_array_elements(j) e where e->>'path' = 'A1.1'), 'deep is never less than direct');
  reset role;

  -- ----------------------------------------------------- b cannot touch a's views
  perform pg_temp.act(b);
  set local role authenticated;
  perform pg_temp.must(not exists (select 1 from public.collections where owner_id = a), 'b does not see a''s views');
  perform pg_temp.must(not exists (select 1 from public.collection_senses where collection_id = v_horror), 'b does not see what is in them');
  perform pg_temp.must(pg_temp.fails($q$select public.view_add('$q$ || v_horror || $q$', array['$q$ || s_cast2 || $q$']::uuid[])$q$), 'b cannot add to a''s view');
  perform pg_temp.must(pg_temp.fails($q$select public.view_edit('$q$ || v_horror || $q$', 'hacked')$q$), 'b cannot rename a''s view');
  select count(*) into n from public.view_contents(v_horror, true);
  perform pg_temp.must(n = 0, 'b cannot read a''s view through the function');
  select count(*) into n from public.view_contents(v_course, true);
  perform pg_temp.must(true, 'the course view can be read');
  reset role;

  -- ----------------------------------------------------- rename and move
  perform pg_temp.act(a);
  set local role authenticated;
  perform public.view_edit(v_movies, 'films');
  perform pg_temp.must((select path from public.collections where id = v_horror) = 'A1.1::films::horror', 'renaming changes the paths inside');
  perform pg_temp.must(pg_temp.fails($q$select public.view_edit('$q$ || v_top || $q$', null, true, '$q$ || v_horror || $q$')$q$), 'a view cannot go inside itself');
  perform pg_temp.must(pg_temp.fails($q$select public.view_edit('$q$ || v_movies || $q$', null, true, '$q$ || v_deep || $q$')$q$), 'a view cannot go inside one of its own');
  perform public.view_edit(v_horror, null, true, null);                  -- to the top
  perform pg_temp.must((select path from public.collections where id = v_deep) = 'horror::level4', 'moving takes what is inside along');
  perform pg_temp.must(pg_temp.fails($q$select public.view_edit('$q$ || v_horror || $q$', null, true, '$q$ || v_other || $q$')$q$) = false, 'a view moves under another with room');
  select path into t from public.collections where id = v_deep;
  perform pg_temp.must(t = 'from the course::horror::level4', 'three levels deep is fine (' || t || ')');
  reset role;

  -- ----------------------------------------------------- my changes to a word
  perform pg_temp.act(a);
  set local role authenticated;
  perform public.library_patch(s_cast1, '{"meaning":"My own wording"}', 'remember');
  perform pg_temp.must((select patch->>'meaning' from public.library_entries where sense_id = s_cast1) = 'My own wording', 'the patch is kept');
  reset role;
  perform pg_temp.must((select meaning from public.senses where id = s_cast1) = 'To throw something', 'the dictionary keeps its wording');
  perform pg_temp.act(b);
  set local role authenticated;
  perform pg_temp.must(pg_temp.fails($q$select public.library_patch('$q$ || s_cast1 || $q$', '{"meaning":"x"}')$q$), 'b cannot change a word that is not in their library');
  reset role;
  perform pg_temp.act(a);
  set local role authenticated;
  perform pg_temp.must(pg_temp.fails($q$select public.library_patch('$q$ || s_cast1 || $q$', '[]')$q$), 'a patch must be an object');
  perform public.library_patch(s_cast1, '{}');
  perform pg_temp.must((select patch from public.library_entries where sense_id = s_cast1) = '{}'::jsonb, 'an empty patch goes back to the dictionary');

  -- removing from the library takes the word out of my views, keeps the rest
  perform public.library_remove(s_cast1);
  perform pg_temp.must(not exists (select 1 from public.library_entries where sense_id = s_cast1 and removed_at is null), 'removed from the library');
  select count(*) into n from public.view_contents(v_other, true) where kind = 'sense';
  perform pg_temp.must(n = 1, 'and from the views, but not the other words (' || n || ')');
  perform public.library_add(array[s_cast1]);
  perform pg_temp.must((select removed_at from public.library_entries where sense_id = s_cast1) is null, 'a removed word can come back');

  -- removing a view takes the views inside it, not the words
  perform public.view_remove(v_horror);
  perform pg_temp.must(not exists (select 1 from public.collections where id in (v_horror, v_deep) and deleted_at is null), 'the view and the one inside it are gone');
  perform pg_temp.must(exists (select 1 from public.library_entries where sense_id = s_cast2 and removed_at is null), 'the words stay in the library');
  perform pg_temp.must(public.view_create('horror', v_top) is not null, 'the name is free again');
  reset role;

  -- ----------------------------------------------------- progress belongs to the word and to me
  insert into public.sense_progress (user_id, sense_id, correct, total) values (a, s_cast1, 3, 4);
  perform pg_temp.act(b);
  set local role authenticated;
  perform pg_temp.must((select count(*) from public.sense_progress) = 0, 'b does not see a''s progress');
  perform pg_temp.must(pg_temp.fails($q$insert into public.sense_progress (user_id, sense_id) values ('$q$ || b || $q$', '$q$ || s_cast1 || $q$')$q$), 'progress is written through functions only');
  reset role;
  perform pg_temp.act(a);
  set local role authenticated;
  perform pg_temp.must((select count(*) from public.sense_progress) = 1, 'a sees their own progress');
  reset role;

  -- ----------------------------------------------------- limits
  perform pg_temp.act(b);
  set local role authenticated;
  for i in 1..200 loop perform public.view_create('v' || i); end loop;
  perform pg_temp.must(pg_temp.fails($q$select public.view_create('one too many')$q$), 'at most 200 views');
  reset role;

  raise exception 'LIBRARY TESTS PASSED';
end $$;
