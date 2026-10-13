-- Moving the dictionary into the library tables (migration 0027):
-- headwords and senses, links, official collections, grammar questions,
-- and running it again (begin; <this>; rollback;).
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;

do $$
declare
  r jsonb; n integer; rev1 integer; rev2 integer;
  s_cast uuid; s_throw uuid; s_a uuid; s_b uuid; s_c uuid;
begin
  -- start from a clean slate for the words this test makes
  insert into public.content_items (kind, key, data) values
    ('words', 'zz cast', '{"word":"zzCast","type":"vocab","category":"Movies","meaning":"A group of actors","level":"A1.1","units":["Film-Night"],"opposite":"zzNone"}'),
    ('words', 'zz cast (to throw)', '{"word":"zzCast (to throw)","type":"phrasal","category":"Movies","meaning":"To throw","level":"B1","partsOfSpeech":["verb"]}'),
    ('words', 'zz a', '{"word":"zzCalm","type":"vocab","category":"Feelings","meaning":"Relaxed","level":"A1.1","units":["Film-Night","Home"],"relations":{"antonyms":["zzAnxious","zzCast (to throw)"],"synonyms":["zzCast"],"confusableWords":["zzAnxious"]},"excludeFromSameOptionsWith":["zzCast"]}'),
    ('words', 'zz b', '{"word":"zzAnxious","type":"idiom","category":"Feelings","meaning":"Worried","_aiAdded":true,"opposite":"zzCalm"}'),
    ('words', 'zz gone', '{"word":"zzGone","type":"weird","category":"Feelings","meaning":"Removed one"}');
  update public.content_items set deleted = true where key = 'zz gone';
  insert into public.content_items (kind, key, data) values
    ('grammar', 'g-zz-one', '{"id":"g-zz-one","rule":"Pronouns","category":"General Grammar","level":"A1.1","units":["Pronouns"],"prompt":"I ______ here.","options":["am","is"],"answer":"am","explanation":"I am.","ruleFamily":"be"}'),
    ('grammar', 'g-zz-many', '{"id":"g-zz-many","rule":"Used to","category":"Feelings","explanation":"x","questions":[{"type":"choose","prompt":"p1","options":["a","b"],"answer":"a"},{"type":"judge","sentence":"s","correct":true,"alternative":"t"},{"type":"strange","prompt":"p3"}]}');

  r := public.dictionary_sync_core();
  select id into s_cast from public.senses where legacy_key = 'zzCast';
  select id into s_throw from public.senses where legacy_key = 'zzCast (to throw)';
  select id into s_a from public.senses where legacy_key = 'zzCalm';
  select id into s_b from public.senses where legacy_key = 'zzAnxious';

  -- headwords and senses
  perform pg_temp.must((select count(*) from public.headwords where lower(text) like 'zz%') = 4, 'one headword for the two Cast meanings, plus Calm, Anxious, Gone (' || (select count(*) from public.headwords where lower(text) like 'zz%') || ')');
  perform pg_temp.must((select headword_id from public.senses where id = s_cast) = (select headword_id from public.senses where id = s_throw), 'both Cast meanings share one headword');
  perform pg_temp.must((select label from public.senses where id = s_throw) = 'to throw' and (select label from public.senses where id = s_cast) is null, 'the sense label is what was in the brackets');
  perform pg_temp.must((select type from public.senses where legacy_key = 'zzGone') = 'vocab', 'an unknown type becomes vocab');
  perform pg_temp.must((select deleted_at is not null from public.senses where legacy_key = 'zzGone'), 'a deleted word stays deleted');
  perform pg_temp.must((select pos from public.senses where id = s_throw) = array['verb'], 'parts of speech come over');
  perform pg_temp.must((select course_level from public.senses where id = s_cast) = 'A1.1' and (select course_level from public.senses where id = s_throw) is null, 'only a course level is kept as one (B1 is a band)');
  perform pg_temp.must((select content ->> 'level' from public.senses where id = s_throw) = 'B1', 'the band stays in the content');
  perform pg_temp.must((select source from public.senses where id = s_b) = 'ai' and (select source from public.senses where id = s_a) = 'curated', 'the AI-added word is marked');
  perform pg_temp.must(not ((select content from public.senses where id = s_a) ? 'word'), 'the columns are not repeated in the content');

  -- links
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_b and kind = 'antonym' and removed_at is null), 'antonym by key');
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_throw and kind = 'antonym'), 'a named sense links to that sense');
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_cast and kind = 'synonym'), 'synonym');
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_b and kind = 'confusable'), 'confusable');
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_cast and kind = 'never_together'), 'never together');
  perform pg_temp.must(exists (select 1 from public.sense_links where from_sense = s_b and to_sense = s_a and kind = 'antonym'), 'opposite');
  perform pg_temp.must(not exists (select 1 from public.sense_links where from_sense = s_cast), 'a link to a word that is not there is dropped');

  -- grammar
  perform pg_temp.must((select count(*) from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-one') = 1, 'a single-question rule has one question');
  perform pg_temp.must((select data ->> 'answer' from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-one') = 'am', 'its question has the answer');
  perform pg_temp.must((select content ->> 'ruleFamily' from public.grammar_rules where legacy_key = 'g-zz-one') = 'be', 'extra fields are kept');
  perform pg_temp.must(not ((select content from public.grammar_rules where legacy_key = 'g-zz-one') ? 'prompt'), 'the question fields moved to the question');
  perform pg_temp.must((select count(*) from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-many') = 3, 'a rule with questions keeps each');
  perform pg_temp.must((select type from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-many' and q.legacy_pos = 2) = 'choose', 'an unknown question type becomes choose');

  -- official collections
  perform pg_temp.must(exists (select 1 from public.collections where owner_id is null and kind = 'course' and name = 'A1.1'), 'the course level exists');
  perform pg_temp.must(exists (select 1 from public.collections where owner_id is null and kind = 'session' and path = 'A1.1::Film-Night'), 'the session is under its level');
  perform pg_temp.must((select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.path = 'A1.1::Film-Night' and cs.removed_at is null) = 2, 'two words in that session (' || (select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.path = 'A1.1::Film-Night' and cs.removed_at is null) || ')');
  perform pg_temp.must((select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.path = 'A1.1::Home' and cs.removed_at is null) = 1, 'a word in two sessions is in both');
  perform pg_temp.must((select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.kind = 'category' and c.name = 'Movies' and cs.removed_at is null) = 2, 'the lesson holds its words');
  perform pg_temp.must((select count(*) from public.collection_rules cr join public.collections c on c.id = cr.collection_id where c.path = 'A1.1' and cr.removed_at is null) = 1, 'the rule is in its level');
  perform pg_temp.must((select count(*) from public.collection_rules cr join public.collections c on c.id = cr.collection_id where c.kind = 'session' and c.name = 'Pronouns') = 1, 'and in its session');

  -- run again: nothing changes
  select rev into rev1 from public.senses where id = s_a;
  r := public.dictionary_sync_core();
  select rev into rev2 from public.senses where id = s_a;
  perform pg_temp.must(rev1 = rev2, 'a second run changes nothing (rev stays ' || rev1 || ')');
  perform pg_temp.must((select count(*) from public.headwords where lower(text) like 'zz%') = 4, 'and adds no duplicates');
  perform pg_temp.must((select count(*) from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-many') = 3, 'questions are not duplicated');

  -- a change in the old content comes over
  update public.content_items set data = jsonb_set(data, '{meaning}', '"Very relaxed"') where key = 'zz a';
  update public.content_items set data = (data || '{"relations":{"antonyms":["zzAnxious"]}}'::jsonb) - 'excludeFromSameOptionsWith' where key = 'zz a';
  update public.content_items set data = jsonb_set(data, '{questions}', '[{"type":"choose","prompt":"p1","options":["a","b"],"answer":"a"}]') where key = 'g-zz-many';
  update public.content_items set deleted = true where key = 'zz b';
  r := public.dictionary_sync_core();
  perform pg_temp.must((select meaning from public.senses where id = s_a) = 'Very relaxed' and (select rev from public.senses where id = s_a) = rev1 + 1, 'an edited word is updated');
  perform pg_temp.must(not exists (select 1 from public.sense_links where from_sense = s_a and to_sense = s_throw and removed_at is null), 'a link that is no longer there is marked removed');
  perform pg_temp.must(not exists (select 1 from public.sense_links where from_sense = s_a and kind = 'never_together' and removed_at is null), '…and so is a never-together word');
  perform pg_temp.must((select deleted_at is not null from public.senses where id = s_b), 'a word deleted in the old content is deleted here');
  perform pg_temp.must(not exists (select 1 from public.sense_links where to_sense = s_b and removed_at is null), 'links to it are gone');
  perform pg_temp.must((select count(*) from public.grammar_questions q join public.grammar_rules g on g.id = q.rule_id where g.legacy_key = 'g-zz-many' and q.deleted_at is null) = 1, 'questions taken out of a rule are marked removed');
  update public.content_items set data = jsonb_set(data, '{level}', '"A1.2"') where key = 'zz a';
  r := public.dictionary_sync_core();
  perform pg_temp.must((select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.path = 'A1.1::Home' and cs.removed_at is null) = 0, 'a word that moved level leaves the old session');
  perform pg_temp.must((select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id where c.path = 'A1.2::Home' and cs.removed_at is null) = 1, '…and is in the new one');

  -- a player's own link or word is left alone
  perform public.register_player('sync_a', 'secret1');
  insert into public.senses (headword_id, label, meaning, visibility, owner_id, source) select id, 'mine', 'x', 'private', (select id from public.profiles where username = 'sync_a'), 'user' from public.headwords where lower(text) = 'zzcalm';
  r := public.dictionary_sync_core();
  perform pg_temp.must((select count(*) from public.senses where label = 'mine' and deleted_at is null) = 1, 'a player''s own word is not touched');

  -- only an admin can run it by hand
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where username = 'sync_a'), 'role', 'authenticated')::text, true);
  begin
    perform public.dictionary_sync();
    raise exception 'FAIL: a player could run the sync';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise exception 'DICTIONARY SYNC TESTS PASSED';
end $$;
