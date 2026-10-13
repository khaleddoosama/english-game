-- The library: a shared dictionary, and a personal library on top of it.
--  - words are stored once (headwords -> senses; one row per meaning) and
--    shared by everyone; a player's own words are private rows of the same
--    table, and an AI-written word is public but waits for a review;
--  - a player's library points at dictionary rows and keeps only the fields
--    they changed (patch), so an admin fix reaches everyone else;
--  - "views" are folders a player makes (A1.1 > movies > horror): a view
--    holds words and rules, can sit inside another view, and a word can be in
--    any number of views. Progress belongs to the word, never to a view;
--  - nothing is ever physically removed by the app: removing is a flag, so
--    it can be undone and nobody's progress points at nothing;
--  - a player reads only what they may see; every write goes through a
--    function that checks who is asking.
-- Old tables (content_items, mastery, progress…) are untouched until the app
-- moves over.

-- ---------------------------------------------------------------- dictionary
create table public.headwords (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  ipa text,
  created_at timestamptz not null default now()
);
create unique index headwords_text_idx on public.headwords (lower(text));

create table public.senses (
  id uuid primary key default gen_random_uuid(),
  headword_id uuid not null references public.headwords (id),
  label text,                                   -- tells meanings apart: "to throw"
  type text not null default 'vocab' check (type in ('vocab', 'idiom', 'binomial', 'phrasal', 'fyi', 'pun')),
  pos text[] not null default '{}',
  course_level text,                            -- A1.1 … C2.3
  category text,
  meaning text not null,
  content jsonb not null default '{}'::jsonb,   -- examples, gaps, collocations, hints, mistakes, image
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  owner_id uuid references public.profiles (id) on delete cascade,
  source text not null default 'curated' check (source in ('curated', 'ai', 'user', 'import')),
  review_status text not null default 'approved' check (review_status in ('approved', 'pending', 'rejected')),
  legacy_key text,                              -- the old content_items key, while moving over
  rev integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visibility = 'public' or owner_id is not null),
  check (length(meaning) between 1 and 2000),
  check (pg_column_size(content) < 200000)
);
create index senses_headword_idx on public.senses (headword_id) where deleted_at is null;
create index senses_owner_idx on public.senses (owner_id) where owner_id is not null;
create index senses_level_idx on public.senses (course_level, category) where deleted_at is null;
create unique index senses_legacy_idx on public.senses (legacy_key) where legacy_key is not null;
create index senses_legacy_lower_idx on public.senses (lower(legacy_key)) where legacy_key is not null;
-- Two meanings of one word never share a label.
create unique index senses_label_idx on public.senses (headword_id, lower(coalesce(label, '')), coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)) where deleted_at is null;

create table public.sense_links (
  from_sense uuid not null references public.senses (id),
  to_sense uuid not null references public.senses (id),
  kind text not null check (kind in ('antonym', 'synonym', 'confusable', 'never_together')),
  origin text not null default 'sync',          -- 'sync' = derived from the old content; links made by hand never are
  removed_at timestamptz,
  primary key (from_sense, to_sense, kind),
  check (from_sense <> to_sense)
);
create index sense_links_to_idx on public.sense_links (to_sense);

create table public.grammar_rules (
  id uuid primary key default gen_random_uuid(),
  rule text not null,
  category text,
  course_level text,
  units text[] not null default '{}',
  explanation text,
  content jsonb not null default '{}'::jsonb,   -- examples, common mistakes
  legacy_key text,
  rev integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index grammar_rules_legacy_idx on public.grammar_rules (legacy_key) where legacy_key is not null;

create table public.grammar_questions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.grammar_rules (id),
  position integer not null default 0,
  type text not null default 'choose' check (type in ('choose', 'judge', 'fix')),
  data jsonb not null,                          -- prompt, options, answer, explanation…
  legacy_pos integer,                           -- the question's place in the old rule, while moving over
  deleted_at timestamptz
);
create unique index grammar_questions_legacy_idx on public.grammar_questions (rule_id, legacy_pos) where legacy_pos is not null;
create index grammar_questions_rule_idx on public.grammar_questions (rule_id, position) where deleted_at is null;

-- ---------------------------------------------------------------- views
-- owner_id null = the official course (read only for players).
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles (id) on delete cascade,
  parent_id uuid references public.collections (id),
  source_id uuid references public.collections (id),   -- an official view this one was made from
  kind text not null default 'view' check (kind in ('course', 'session', 'category', 'view', 'pack')),
  name text not null check (length(btrim(name)) between 1 and 60 and name !~ '::'),
  path text not null,                                   -- "A1.1::movies"
  position integer not null default 0,
  course_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index collections_owner_idx on public.collections (owner_id, parent_id) where deleted_at is null;
create unique index collections_name_idx on public.collections (
  coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)) where deleted_at is null;

create table public.collection_senses (
  collection_id uuid not null references public.collections (id),
  sense_id uuid not null references public.senses (id),
  position integer not null default 0,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (collection_id, sense_id)
);
create index collection_senses_sense_idx on public.collection_senses (sense_id);

create table public.collection_rules (
  collection_id uuid not null references public.collections (id),
  rule_id uuid not null references public.grammar_rules (id),
  position integer not null default 0,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (collection_id, rule_id)
);

-- ---------------------------------------------------------------- library and progress
create table public.library_entries (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sense_id uuid not null references public.senses (id),
  patch jsonb not null default '{}'::jsonb check (jsonb_typeof(patch) = 'object' and pg_column_size(patch) < 8000),
  note text check (length(note) <= 1000),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (user_id, sense_id)
);

create table public.library_rules (
  user_id uuid not null references public.profiles (id) on delete cascade,
  rule_id uuid not null references public.grammar_rules (id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (user_id, rule_id)
);

create table public.sense_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sense_id uuid not null references public.senses (id),
  correct integer not null default 0,
  total integer not null default 0,
  review_step integer not null default 0,
  production_correct integer not null default 0,
  ever_mastered boolean not null default false,
  last_result text,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  modes jsonb not null default '{}'::jsonb,
  recent jsonb not null default '[]'::jsonb,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, sense_id)
);
create index sense_progress_due_idx on public.sense_progress (user_id, next_review_at);

create table public.rule_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  rule_id uuid not null references public.grammar_rules (id),
  correct integer not null default 0,
  total integer not null default 0,
  last_result text,
  last_reviewed_at timestamptz,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, rule_id)
);

-- ---------------------------------------------------------------- who reads what
alter table public.headwords enable row level security;
alter table public.senses enable row level security;
alter table public.sense_links enable row level security;
alter table public.grammar_rules enable row level security;
alter table public.grammar_questions enable row level security;
alter table public.collections enable row level security;
alter table public.collection_senses enable row level security;
alter table public.collection_rules enable row level security;
alter table public.library_entries enable row level security;
alter table public.library_rules enable row level security;
alter table public.sense_progress enable row level security;
alter table public.rule_progress enable row level security;

create policy "everyone reads headwords" on public.headwords for select to authenticated using (true);
create policy "players read public and their own senses" on public.senses for select to authenticated
  using (deleted_at is null and ((visibility = 'public' and review_status <> 'rejected') or owner_id = (select auth.uid())));
create policy "players read links between senses they can see" on public.sense_links for select to authenticated
  using (removed_at is null and exists (select 1 from public.senses s where s.id = from_sense) and exists (select 1 from public.senses s where s.id = to_sense));
create policy "everyone reads grammar rules" on public.grammar_rules for select to authenticated using (deleted_at is null);
create policy "everyone reads grammar questions" on public.grammar_questions for select to authenticated using (deleted_at is null);
create policy "players read the course and their own views" on public.collections for select to authenticated
  using (deleted_at is null and (owner_id is null or owner_id = (select auth.uid())));
create policy "players read what is in the views they can see" on public.collection_senses for select to authenticated
  using (removed_at is null and exists (select 1 from public.collections c where c.id = collection_id));
create policy "players read the rules in the views they can see" on public.collection_rules for select to authenticated
  using (removed_at is null and exists (select 1 from public.collections c where c.id = collection_id));
create policy "players read their own library" on public.library_entries for select to authenticated using (user_id = (select auth.uid()));
create policy "players read their own rules" on public.library_rules for select to authenticated using (user_id = (select auth.uid()));
create policy "players read their own progress" on public.sense_progress for select to authenticated using (user_id = (select auth.uid()));
create policy "players read their own rule progress" on public.rule_progress for select to authenticated using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on
  public.headwords, public.senses, public.sense_links, public.grammar_rules, public.grammar_questions,
  public.collections, public.collection_senses, public.collection_rules,
  public.library_entries, public.library_rules, public.sense_progress, public.rule_progress
  from anon, authenticated;
revoke all on
  public.headwords, public.senses, public.sense_links, public.grammar_rules, public.grammar_questions,
  public.collections, public.collection_senses, public.collection_rules,
  public.library_entries, public.library_rules, public.sense_progress, public.rule_progress
  from anon;

-- ---------------------------------------------------------------- views
-- Limits: 200 views a player, 4 levels deep, 200 words or rules a call,
-- 5000 words in a library.
create or replace function public.view_depth(p_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select id, parent_id, 1 as d from public.collections where id = p_id
    union all
    select c.id, c.parent_id, up.d + 1 from public.collections c join up on c.id = up.parent_id
  )
  select coalesce(max(d), 0)::integer from up;
$$;

-- How many levels sit under a view (0 for a view with no views inside it).
create or replace function public.view_height(p_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with recursive down as (
    select id, 0 as d from public.collections where id = p_id and deleted_at is null
    union all
    select c.id, down.d + 1 from public.collections c join down on c.parent_id = down.id where c.deleted_at is null
  )
  select coalesce(max(d), 0)::integer from down;
$$;

create or replace function public.view_create(p_name text, p_parent uuid default null, p_source uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  par public.collections;
  src public.collections;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if length(v_name) not between 1 and 60 or v_name ~ '::' then
    raise exception 'A view name is 1 to 60 characters and has no "::" in it.' using errcode = '22023';
  end if;
  if (select count(*) from public.collections where owner_id = v_me and deleted_at is null) >= 200 then
    raise exception 'You have 200 views, the most there can be.' using errcode = '55000';
  end if;
  if p_parent is not null then
    select * into par from public.collections where id = p_parent and owner_id = v_me and deleted_at is null;
    if not found then raise exception 'That view does not exist.' using errcode = 'P0002'; end if;
    if public.view_depth(p_parent) >= 4 then raise exception 'Views can be 4 levels deep, no more.' using errcode = '55000'; end if;
  end if;
  if p_source is not null then
    select * into src from public.collections where id = p_source and owner_id is null and deleted_at is null;
    if not found then raise exception 'That course view does not exist.' using errcode = 'P0002'; end if;
  end if;
  if exists (select 1 from public.collections where owner_id = v_me and parent_id is not distinct from p_parent and lower(name) = lower(v_name) and deleted_at is null) then
    raise exception 'There is already a view called "%" here.', v_name using errcode = '23505';
  end if;
  insert into public.collections (owner_id, parent_id, source_id, kind, name, path, course_level, position)
  values (v_me, p_parent, p_source, 'view', v_name, case when par.id is null then v_name else par.path || '::' || v_name end,
          coalesce(src.course_level, par.course_level),
          (select coalesce(max(position), 0) + 1 from public.collections where owner_id = v_me and parent_id is not distinct from p_parent))
  returning id into v_id;
  return v_id;
end;
$$;

-- Renames or moves a view (p_parent null = to the top). The names of
-- everything inside follow.
create or replace function public.view_edit(p_id uuid, p_name text default null, p_move boolean default false, p_parent uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v public.collections;
  par public.collections;
  v_name text;
  v_parent uuid;
  v_path text;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.collections where id = p_id and owner_id = v_me and deleted_at is null for update;
  if not found then raise exception 'That view does not exist.' using errcode = 'P0002'; end if;
  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v.name);
  v_parent := case when p_move then p_parent else v.parent_id end;
  if length(v_name) > 60 or v_name ~ '::' then raise exception 'A view name is 1 to 60 characters and has no "::" in it.' using errcode = '22023'; end if;
  if v_parent is not null then
    select * into par from public.collections where id = v_parent and owner_id = v_me and deleted_at is null;
    if not found then raise exception 'That view does not exist.' using errcode = 'P0002'; end if;
    -- Not into itself or anything inside it.
    if v_parent = p_id or exists (
      with recursive down as (
        select id from public.collections where parent_id = p_id and deleted_at is null
        union all select c.id from public.collections c join down on c.parent_id = down.id where c.deleted_at is null)
      select 1 from down where id = v_parent) then
      raise exception 'A view cannot go inside itself.' using errcode = '22023';
    end if;
    if public.view_depth(v_parent) + public.view_height(p_id) + 1 > 4 then
      raise exception 'Views can be 4 levels deep, no more.' using errcode = '55000';
    end if;
  end if;
  if exists (select 1 from public.collections where owner_id = v_me and parent_id is not distinct from v_parent and lower(name) = lower(v_name) and deleted_at is null and id <> p_id) then
    raise exception 'There is already a view called "%" here.', v_name using errcode = '23505';
  end if;
  v_path := case when par.id is null then v_name else par.path || '::' || v_name end;
  update public.collections set name = v_name, parent_id = v_parent, path = v_path, updated_at = now() where id = p_id;
  -- everything inside takes the new front of the path
  update public.collections c set path = v_path || substr(c.path, length(v.path) + 1), updated_at = now()
  where c.owner_id = v_me and c.deleted_at is null and c.id <> p_id and c.path like v.path || '::%';
end;
$$;

-- Takes a view and the views inside it away. The words stay in the library.
create or replace function public.view_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v public.collections;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into v from public.collections where id = p_id and owner_id = v_me and deleted_at is null;
  if not found then return; end if;
  update public.collections set deleted_at = now()
  where owner_id = v_me and deleted_at is null and (id = p_id or path like v.path || '::%');
end;
$$;

-- Puts words in a view, and in the library if they are not there yet.
create or replace function public.view_add(p_view uuid, p_senses uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  n integer;
  v_new integer;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.collections where id = p_view and owner_id = v_me and deleted_at is null) then
    raise exception 'That view does not exist.' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_senses, 1), 0) > 200 then raise exception 'Add up to 200 words at a time.' using errcode = '22023'; end if;
  select count(*) into n from public.library_add(p_senses) as t;
  insert into public.collection_senses (collection_id, sense_id, position)
  select p_view, s.id, (select coalesce(max(position), 0) from public.collection_senses where collection_id = p_view) + row_number() over ()
  from public.senses s join public.library_entries le on le.sense_id = s.id and le.user_id = v_me and le.removed_at is null
  where s.id = any (p_senses)
  on conflict (collection_id, sense_id) do update set removed_at = null, added_at = now()
  where public.collection_senses.removed_at is not null;
  get diagnostics v_new = row_count;
  return v_new;
end;
$$;

create or replace function public.view_drop(p_view uuid, p_sense uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.collection_senses cs set removed_at = now()
  where cs.collection_id = p_view and cs.sense_id = p_sense and cs.removed_at is null
    and exists (select 1 from public.collections c where c.id = p_view and c.owner_id = (select auth.uid()));
$$;

create or replace function public.view_add_rules(p_view uuid, p_rules uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_new integer;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.collections where id = p_view and owner_id = v_me and deleted_at is null) then
    raise exception 'That view does not exist.' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_rules, 1), 0) > 200 then raise exception 'Add up to 200 rules at a time.' using errcode = '22023'; end if;
  insert into public.library_rules (user_id, rule_id)
  select v_me, r.id from public.grammar_rules r where r.id = any (p_rules) and r.deleted_at is null
  on conflict (user_id, rule_id) do update set removed_at = null where public.library_rules.removed_at is not null;
  insert into public.collection_rules (collection_id, rule_id, position)
  select p_view, r.id, (select coalesce(max(position), 0) from public.collection_rules where collection_id = p_view) + row_number() over ()
  from public.grammar_rules r where r.id = any (p_rules) and r.deleted_at is null
  on conflict (collection_id, rule_id) do update set removed_at = null, added_at = now()
  where public.collection_rules.removed_at is not null;
  get diagnostics v_new = row_count;
  return v_new;
end;
$$;

-- The words of a view, and with p_deep the words of the views inside it.
-- My own views or the course; p_with_rules also returns rule ids.
create or replace function public.view_contents(p_view uuid, p_deep boolean default true)
returns table (kind text, id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive tree as (
    select c.id from public.collections c
    where c.id = p_view and c.deleted_at is null and (c.owner_id is null or c.owner_id = (select auth.uid()))
    union all
    select c.id from public.collections c join tree on c.parent_id = tree.id
    where p_deep and c.deleted_at is null and (c.owner_id is null or c.owner_id = (select auth.uid()))
  )
  select 'sense'::text, cs.sense_id from public.collection_senses cs join tree on tree.id = cs.collection_id where cs.removed_at is null
  union
  select 'rule'::text, cr.rule_id from public.collection_rules cr join tree on tree.id = cr.collection_id where cr.removed_at is null;
$$;

-- My views with how many words and rules sit directly in each.
create or replace function public.view_tree()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'parent', c.parent_id, 'name', c.name, 'path', c.path, 'position', c.position, 'source', c.source_id,
    'words', (select count(*) from public.collection_senses cs where cs.collection_id = c.id and cs.removed_at is null),
    'rules', (select count(*) from public.collection_rules cr where cr.collection_id = c.id and cr.removed_at is null)
  ) order by c.path), '[]'::jsonb)
  from public.collections c where c.owner_id = (select auth.uid()) and c.deleted_at is null;
$$;

-- ---------------------------------------------------------------- library
create or replace function public.library_add(p_senses uuid[])
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce(array_length(p_senses, 1), 0) > 200 then raise exception 'Add up to 200 words at a time.' using errcode = '22023'; end if;
  if (select count(*) from public.library_entries where user_id = v_me and removed_at is null) + coalesce(array_length(p_senses, 1), 0) > 5000 then
    raise exception 'A library holds up to 5000 words.' using errcode = '55000';
  end if;
  return query
  with ok as (
    select s.id from public.senses s
    where s.id = any (p_senses) and s.deleted_at is null
      and ((s.visibility = 'public' and s.review_status <> 'rejected') or s.owner_id = v_me)
  ), ins as (
    insert into public.library_entries (user_id, sense_id)
    select v_me, ok.id from ok
    on conflict (user_id, sense_id) do update set removed_at = null, added_at = now()
    where public.library_entries.removed_at is not null
    returning public.library_entries.sense_id
  )
  select ok.id from ok;
end;
$$;

create or replace function public.library_remove(p_sense uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.library_entries set removed_at = now() where user_id = (select auth.uid()) and sense_id = p_sense and removed_at is null;
  update public.collection_senses cs set removed_at = now()
  where cs.sense_id = p_sense and cs.removed_at is null
    and exists (select 1 from public.collections c where c.id = cs.collection_id and c.owner_id = (select auth.uid()));
$$;

-- My own changes to a word: only the fields I changed are kept ('{}' = back
-- to the dictionary's version).
create or replace function public.library_patch(p_sense uuid, p_patch jsonb, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then raise exception 'A patch is an object.' using errcode = '22023'; end if;
  if length(coalesce(p_patch, '{}'::jsonb)::text) > 7000 then raise exception 'That change is too big.' using errcode = '22023'; end if;
  update public.library_entries set patch = coalesce(p_patch, '{}'::jsonb), note = nullif(btrim(coalesce(p_note, '')), '')
  where user_id = v_me and sense_id = p_sense and removed_at is null;
  if not found then raise exception 'That word is not in your library.' using errcode = 'P0002'; end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.view_depth(uuid)', 'public.view_height(uuid)',
    'public.view_create(text, uuid, uuid)', 'public.view_edit(uuid, text, boolean, uuid)', 'public.view_remove(uuid)',
    'public.view_add(uuid, uuid[])', 'public.view_drop(uuid, uuid)', 'public.view_add_rules(uuid, uuid[])',
    'public.view_contents(uuid, boolean)', 'public.view_tree()',
    'public.library_add(uuid[])', 'public.library_remove(uuid)', 'public.library_patch(uuid, jsonb, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
