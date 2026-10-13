-- Moves the dictionary from the old content table into the library tables
-- (migration 0026), and keeps them in step until the app reads the new ones.
--  - a word becomes a sense under a headword ("Cast (to throw)" is the sense
--    "to throw" of "Cast"); its old key stays in legacy_key, which is how a
--    player's progress finds it;
--  - the lists the old words carried (opposites, synonyms, confusable and
--    never-together words) become sense_links, by key when a key is named,
--    else the plain entry of that headword;
--  - course levels, sessions (units) and lessons (categories) become the
--    official collections, with the words and rules in them;
--  - a grammar rule keeps its questions, one row each;
--  - it can be run again at any time: it adds, updates what changed and
--    marks what is gone, and touches nothing a player made.
-- The old tables are not changed.

create or replace function public.json_texts(j jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'array'
    then coalesce(array(select btrim(t) from jsonb_array_elements_text(j) t where btrim(t) <> ''), '{}'::text[])
    when jsonb_typeof(j) = 'string' and btrim(j #>> '{}') <> '' then array[btrim(j #>> '{}')]
    else '{}'::text[] end;
$$;

create or replace function public.dictionary_sync_core()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_words integer; v_rules integer; v_links integer; v_cols integer;
begin
  -- ------------------------------------------------------------ headwords and senses
  insert into public.headwords (text)
  select distinct on (lower(h)) h
  from (select btrim(regexp_replace(c.data ->> 'word', '\s*\([^)]*\)\s*$', '')) as h
        from public.content_items c where c.kind = 'words' and btrim(coalesce(c.data ->> 'word', '')) <> '') x
  where h <> ''
  on conflict (lower(text)) do nothing;

  with src as (
    select c.data ->> 'word' as legacy_key, c.deleted, c.data,
           btrim(regexp_replace(c.data ->> 'word', '\s*\([^)]*\)\s*$', '')) as hw,
           nullif(btrim(coalesce(substring(c.data ->> 'word' from '\(([^)]*)\)\s*$'), '')), '') as label0
    from public.content_items c where c.kind = 'words' and btrim(coalesce(c.data ->> 'word', '')) <> ''
  ), lab as (
    select src.*, case when count(*) over (partition by lower(hw), lower(coalesce(label0, ''))) > 1 then legacy_key else label0 end as label
    from src
  )
  insert into public.senses (headword_id, label, type, pos, course_level, category, meaning, content, source, review_status, legacy_key, deleted_at)
  select h.id, lab.label,
         case when lab.data ->> 'type' in ('vocab', 'idiom', 'binomial', 'phrasal', 'fyi', 'pun') then lab.data ->> 'type' else 'vocab' end,
         case when jsonb_typeof(lab.data -> 'partsOfSpeech') = 'array' then public.json_texts(lab.data -> 'partsOfSpeech')
              when jsonb_typeof(lab.data -> 'pos') = 'array' then public.json_texts(lab.data -> 'pos')
              else public.json_texts(coalesce(lab.data -> 'partOfSpeech', lab.data -> 'pos')) end,
         case when lab.data ->> 'level' ~ '^[A-C][1-2]\.[1-3]$' then lab.data ->> 'level' end,
         nullif(lab.data ->> 'category', ''),
         left(coalesce(nullif(lab.data ->> 'meaning', ''), '(no meaning yet)'), 2000),
         lab.data - 'word' - 'type' - 'category' - 'meaning',
         case when lab.data ? '_aiAdded' then 'ai' else 'curated' end,
         'approved', lab.legacy_key,
         case when lab.deleted then now() end
  from lab join public.headwords h on lower(h.text) = lower(lab.hw)
  on conflict (legacy_key) where legacy_key is not null do update set
    headword_id = excluded.headword_id, label = excluded.label, type = excluded.type, pos = excluded.pos,
    course_level = excluded.course_level, category = excluded.category, meaning = excluded.meaning,
    content = excluded.content, source = excluded.source,
    deleted_at = case when excluded.deleted_at is null then null else coalesce(public.senses.deleted_at, excluded.deleted_at) end,
    rev = public.senses.rev + 1, updated_at = now()
  where (public.senses.headword_id, public.senses.label, public.senses.type, public.senses.pos, public.senses.course_level, public.senses.category, public.senses.meaning, public.senses.content, public.senses.source, public.senses.deleted_at is null)
        is distinct from (excluded.headword_id, excluded.label, excluded.type, excluded.pos, excluded.course_level, excluded.category, excluded.meaning, excluded.content, excluded.source, excluded.deleted_at is null);

  -- a word that is no longer in the old content is gone here too
  update public.senses s set deleted_at = now(), rev = s.rev + 1, updated_at = now()
  where s.legacy_key is not null and s.deleted_at is null
    and not exists (select 1 from public.content_items c where c.kind = 'words' and not c.deleted and c.data ->> 'word' = s.legacy_key);
  select count(*) into v_words from public.senses where legacy_key is not null and deleted_at is null;

  -- ------------------------------------------------------------ links
  drop table if exists pg_temp.sync_links;
  create temporary table sync_links on commit drop as
  select * from (
  with w as (
    select s.id as sid, c.data from public.senses s
    join public.content_items c on c.kind = 'words' and not c.deleted and c.data ->> 'word' = s.legacy_key
    where s.legacy_key is not null and s.deleted_at is null
  ), refs as (
    select sid, 'antonym'::text as kind, t as ref from w, unnest(public.json_texts(data -> 'relations' -> 'antonyms') || public.json_texts(data -> 'opposite')) t
    union all select sid, 'synonym', t from w, unnest(public.json_texts(data -> 'relations' -> 'synonyms') || public.json_texts(data -> 'synonyms')) t
    union all select sid, 'confusable', t from w, unnest(public.json_texts(data -> 'relations' -> 'confusableWords')) t
    union all select sid, 'never_together', t from w, unnest(public.json_texts(data -> 'excludeFromSameOptionsWith')) t
  )
  select distinct r.sid as from_sense, r.kind,
         coalesce(
           (select s2.id from public.senses s2 where s2.deleted_at is null and s2.legacy_key is not null and lower(s2.legacy_key) = lower(r.ref) limit 1),
           (select s3.id from public.senses s3 where s3.deleted_at is null and s3.legacy_key is not null
              and lower(s3.legacy_key) = lower(btrim(regexp_replace(r.ref, '\s*\([^)]*\)\s*$', ''))) limit 1)
         ) as to_sense
  from refs r) l
  where to_sense is not null and to_sense <> from_sense;

  insert into public.sense_links (from_sense, to_sense, kind, origin)
  select from_sense, to_sense, kind, 'sync' from pg_temp.sync_links
  on conflict (from_sense, to_sense, kind) do update set removed_at = null where public.sense_links.removed_at is not null;
  update public.sense_links l set removed_at = now()
  where l.origin = 'sync' and l.removed_at is null
    and not exists (select 1 from pg_temp.sync_links d where d.from_sense = l.from_sense and d.to_sense = l.to_sense and d.kind = l.kind);
  select count(*) into v_links from public.sense_links where removed_at is null;

  -- ------------------------------------------------------------ grammar
  insert into public.grammar_rules (legacy_key, rule, category, course_level, units, explanation, content, deleted_at)
  select c.data ->> 'id',
         left(coalesce(nullif(c.data ->> 'rule', ''), c.data ->> 'id'), 300),
         nullif(c.data ->> 'category', ''),
         case when c.data ->> 'level' ~ '^[A-C][1-2]\.[1-3]$' then c.data ->> 'level' end,
         public.json_texts(c.data -> 'units'),
         c.data ->> 'explanation',
         case when jsonb_typeof(c.data -> 'questions') = 'array'
              then c.data - 'id' - 'rule' - 'category' - 'level' - 'units' - 'explanation' - 'questions'
              else c.data - 'id' - 'rule' - 'category' - 'level' - 'units' - 'explanation' - 'prompt' - 'options' - 'answer' end,
         case when c.deleted then now() end
  from public.content_items c where c.kind = 'grammar' and btrim(coalesce(c.data ->> 'id', '')) <> ''
  on conflict (legacy_key) where legacy_key is not null do update set
    rule = excluded.rule, category = excluded.category, course_level = excluded.course_level, units = excluded.units,
    explanation = excluded.explanation, content = excluded.content,
    deleted_at = case when excluded.deleted_at is null then null else coalesce(public.grammar_rules.deleted_at, excluded.deleted_at) end,
    rev = public.grammar_rules.rev + 1, updated_at = now()
  where (public.grammar_rules.rule, public.grammar_rules.category, public.grammar_rules.course_level, public.grammar_rules.units, public.grammar_rules.explanation, public.grammar_rules.content, public.grammar_rules.deleted_at is null)
        is distinct from (excluded.rule, excluded.category, excluded.course_level, excluded.units, excluded.explanation, excluded.content, excluded.deleted_at is null);
  update public.grammar_rules g set deleted_at = now(), rev = g.rev + 1, updated_at = now()
  where g.legacy_key is not null and g.deleted_at is null
    and not exists (select 1 from public.content_items c where c.kind = 'grammar' and not c.deleted and c.data ->> 'id' = g.legacy_key);
  select count(*) into v_rules from public.grammar_rules where legacy_key is not null and deleted_at is null;

  drop table if exists pg_temp.sync_questions;
  create temporary table sync_questions on commit drop as
  select g.id as rule_id, 0 as pos,
         case when jsonb_typeof(c.data -> 'questions') = 'array' then null
              else jsonb_strip_nulls(jsonb_build_object('prompt', c.data -> 'prompt', 'options', c.data -> 'options', 'answer', c.data -> 'answer', 'explanation', c.data -> 'explanation')) end as data,
         'choose'::text as type
  from public.grammar_rules g join public.content_items c on c.kind = 'grammar' and not c.deleted and c.data ->> 'id' = g.legacy_key
  where g.deleted_at is null and jsonb_typeof(c.data -> 'questions') is distinct from 'array'
    and c.data ? 'prompt' and jsonb_typeof(c.data -> 'options') = 'array' and c.data ? 'answer'
  union all
  select g.id, (q.ord - 1)::int, q.item,
         case when q.item ->> 'type' in ('choose', 'judge', 'fix') then q.item ->> 'type' else 'choose' end
  from public.grammar_rules g
  join public.content_items c on c.kind = 'grammar' and not c.deleted and c.data ->> 'id' = g.legacy_key
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data -> 'questions') = 'array' then c.data -> 'questions' else '[]'::jsonb end) with ordinality as q(item, ord)
  where g.deleted_at is null and jsonb_typeof(q.item) = 'object';

  insert into public.grammar_questions (rule_id, position, type, data, legacy_pos)
  select rule_id, pos, type, data, pos from pg_temp.sync_questions
  on conflict (rule_id, legacy_pos) where legacy_pos is not null do update set
    type = excluded.type, data = excluded.data, position = excluded.position, deleted_at = null
  where (public.grammar_questions.type, public.grammar_questions.data, public.grammar_questions.deleted_at is null) is distinct from (excluded.type, excluded.data, true);
  update public.grammar_questions q set deleted_at = now()
  where q.legacy_pos is not null and q.deleted_at is null
    and not exists (select 1 from pg_temp.sync_questions d where d.rule_id = q.rule_id and d.pos = q.legacy_pos);

  -- ------------------------------------------------------------ the official collections
  -- course levels, then their sessions, then lessons (categories)
  insert into public.collections (owner_id, kind, name, path, course_level)
  select null, 'course', lvl, lvl, lvl from (
    select course_level as lvl from public.senses where legacy_key is not null and deleted_at is null and course_level is not null
    union select course_level from public.grammar_rules where legacy_key is not null and deleted_at is null and course_level is not null) l
  on conflict (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null do nothing;

  insert into public.collections (owner_id, parent_id, kind, name, path, course_level)
  select null, p.id, 'session', u.unit, p.path || '::' || u.unit, p.name
  from (
    select s.course_level as lvl, replace(btrim(x), '::', ':') as unit
      from public.senses s, unnest(public.json_texts(s.content -> 'units')) x
      where s.legacy_key is not null and s.deleted_at is null and s.course_level is not null
    union
    select g.course_level, replace(btrim(x), '::', ':')
      from public.grammar_rules g, unnest(g.units) x
      where g.legacy_key is not null and g.deleted_at is null and g.course_level is not null) u
  join public.collections p on p.owner_id is null and p.kind = 'course' and p.name = u.lvl and p.deleted_at is null
  where u.unit <> '' and length(u.unit) <= 60
  on conflict (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null do nothing;

  insert into public.collections (owner_id, kind, name, path)
  select null, 'category', cat, cat from (
    select replace(btrim(category), '::', ':') as cat from public.senses where legacy_key is not null and deleted_at is null and category is not null
    union select replace(btrim(category), '::', ':') from public.grammar_rules where legacy_key is not null and deleted_at is null and category is not null) c
  where cat <> '' and length(cat) <= 60
  on conflict (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null do nothing;

  -- who is in which
  drop table if exists pg_temp.sync_members;
  create temporary table sync_members on commit drop as
  select col.id as collection_id, s.id as sense_id, null::uuid as rule_id
  from public.senses s
  join public.collections col on col.owner_id is null and col.deleted_at is null and (
       (col.kind = 'course' and col.name = s.course_level)
    or (col.kind = 'category' and lower(col.name) = lower(replace(btrim(s.category), '::', ':')))
    or (col.kind = 'session' and s.course_level is not null and col.course_level = s.course_level
        and exists (select 1 from unnest(public.json_texts(s.content -> 'units')) x where lower(replace(btrim(x), '::', ':')) = lower(col.name))))
  where s.legacy_key is not null and s.deleted_at is null
  union all
  select col.id, null, g.id
  from public.grammar_rules g
  join public.collections col on col.owner_id is null and col.deleted_at is null and (
       (col.kind = 'course' and col.name = g.course_level)
    or (col.kind = 'category' and lower(col.name) = lower(replace(btrim(g.category), '::', ':')))
    or (col.kind = 'session' and g.course_level is not null and col.course_level = g.course_level
        and exists (select 1 from unnest(g.units) x where lower(replace(btrim(x), '::', ':')) = lower(col.name))))
  where g.legacy_key is not null and g.deleted_at is null;

  insert into public.collection_senses (collection_id, sense_id)
  select collection_id, sense_id from pg_temp.sync_members where sense_id is not null
  on conflict (collection_id, sense_id) do update set removed_at = null where public.collection_senses.removed_at is not null;
  update public.collection_senses cs set removed_at = now()
  where cs.removed_at is null
    and exists (select 1 from public.collections c where c.id = cs.collection_id and c.owner_id is null)
    and not exists (select 1 from pg_temp.sync_members m where m.collection_id = cs.collection_id and m.sense_id = cs.sense_id);
  insert into public.collection_rules (collection_id, rule_id)
  select collection_id, rule_id from pg_temp.sync_members where rule_id is not null
  on conflict (collection_id, rule_id) do update set removed_at = null where public.collection_rules.removed_at is not null;
  update public.collection_rules cr set removed_at = now()
  where cr.removed_at is null
    and exists (select 1 from public.collections c where c.id = cr.collection_id and c.owner_id is null)
    and not exists (select 1 from pg_temp.sync_members m where m.collection_id = cr.collection_id and m.rule_id = cr.rule_id);
  select count(*) into v_cols from public.collections where owner_id is null and deleted_at is null;

  return jsonb_build_object('words', v_words, 'rules', v_rules, 'links', v_links, 'collections', v_cols);
end;
$$;

-- For an admin to run again, e.g. after importing new content, until the app
-- reads the new tables itself.
create or replace function public.dictionary_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.dictionary_sync_core();
end;
$$;

revoke execute on function public.json_texts(jsonb) from public, anon, authenticated;
revoke execute on function public.dictionary_sync_core() from public, anon, authenticated;
revoke execute on function public.dictionary_sync() from public, anon;
grant execute on function public.dictionary_sync() to authenticated;

select public.dictionary_sync_core();
