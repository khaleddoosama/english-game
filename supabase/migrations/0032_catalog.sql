-- The catalog: views their owners chose to publish for everyone.
--  - any signed-in player can publish one of their views with a title and a
--    short description, and take it back (unpublish) at any time; the admin
--    can unpublish any entry;
--  - everyone signed in can browse and search the catalog and take an entry
--    into their own library with one call: the same copy as sharing by link
--    (the views inside it, the words, the rules; never the owner's private
--    words), so what they get is theirs and nothing flows back;
--  - an entry points at the live view, so a person who takes it later gets
--    the owner's current words; earlier copies are not touched;
--  - limits: 20 entries open per player, title 60 and description 300
--    characters, 100 results a call.

create table public.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  created_at timestamptz not null default now(),
  unpublished_at timestamptz,
  takes integer not null default 0
);
create unique index catalog_entries_open_idx on public.catalog_entries (collection_id) where unpublished_at is null;
create index catalog_entries_owner_idx on public.catalog_entries (owner_id) where unpublished_at is null;
alter table public.catalog_entries enable row level security;
create policy "signed-in players read the open catalog" on public.catalog_entries
  for select to authenticated using (unpublished_at is null or owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.catalog_entries from anon, authenticated;
revoke all on public.catalog_entries from anon;

create table public.catalog_takes (
  entry_id uuid not null references public.catalog_entries (id),
  user_id uuid not null references public.profiles (id) on delete cascade,
  copy_id uuid not null,
  taken_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);
alter table public.catalog_takes enable row level security;
revoke insert, update, delete, truncate on public.catalog_takes from anon, authenticated;
revoke all on public.catalog_takes from anon;

-- Publish one of my views (or change the title and description of the one
-- I already published). Returns the entry.
create or replace function public.catalog_publish(p_view uuid, p_title text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  e public.catalog_entries;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.collections where id = p_view and owner_id = v_me and deleted_at is null) then
    raise exception 'That view does not exist.' using errcode = 'P0002';
  end if;
  if char_length(v_title) not between 1 and 60 then raise exception 'Give it a title of up to 60 characters.' using errcode = '22023'; end if;
  if char_length(v_desc) > 300 then raise exception 'The description is up to 300 characters.' using errcode = '22023'; end if;
  select * into e from public.catalog_entries where collection_id = p_view and unpublished_at is null;
  if found then
    update public.catalog_entries set title = v_title, description = v_desc where id = e.id returning * into e;
  else
    if (select count(*) from public.catalog_entries ce join public.collections cc on cc.id = ce.collection_id and cc.deleted_at is null
        where ce.owner_id = v_me and ce.unpublished_at is null) >= 20 then
      raise exception 'You have 20 views in the catalog. Take some down first.' using errcode = '55000';
    end if;
    insert into public.catalog_entries (collection_id, owner_id, title, description) values (p_view, v_me, v_title, v_desc) returning * into e;
  end if;
  return jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description);
end;
$$;

-- Take an entry down. Its owner can, and so can an admin.
create or replace function public.catalog_unpublish(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update public.catalog_entries set unpublished_at = now()
  where id = p_entry and unpublished_at is null and (owner_id = (select auth.uid()) or (select public.is_admin()));
end;
$$;

-- Browse: newest first, or the best match for a search of the title,
-- description and owner. Each entry says what it holds and whether I took it.
create or replace function public.catalog_list(p_query text default '', p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.at desc) from (
      select e.created_at as at, jsonb_build_object(
        'id', e.id, 'title', e.title, 'description', e.description, 'from', p.username, 'mine', e.owner_id = v_me,
        'at', e.created_at, 'takes', e.takes,
        'words', (select count(distinct cs.sense_id) from public.collection_senses cs
                  join public.collections d on d.id = cs.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                  join public.senses se on se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected'
                  where cs.removed_at is null),
        'rules', (select count(distinct cr.rule_id) from public.collection_rules cr
                  join public.collections d on d.id = cr.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                  join public.grammar_rules r on r.id = cr.rule_id and r.deleted_at is null
                  where cr.removed_at is null),
        'views', (select count(*) from public.collections d where d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')),
        'taken', exists (select 1 from public.catalog_takes t where t.entry_id = e.id and t.user_id = v_me)
      ) as j
      from public.catalog_entries e
      join public.collections c on c.id = e.collection_id and c.deleted_at is null
      join public.profiles p on p.id = e.owner_id
      where e.unpublished_at is null
        and (v_q = '' or strpos(lower(e.title), lower(v_q)) > 0
             or strpos(lower(e.description), lower(v_q)) > 0
             or strpos(lower(p.username), lower(v_q)) > 0)
      order by e.created_at desc
      limit v_limit
    ) x), '[]'::jsonb);
end;
$$;

-- Take an entry as my own copy. Taking it twice gives the copy I already
-- have, unless I removed it.
create or replace function public.catalog_take(p_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  e public.catalog_entries;
  t public.catalog_takes;
  res jsonb;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into e from public.catalog_entries where id = p_entry for update;
  if not found or e.unpublished_at is not null
     or not exists (select 1 from public.collections where id = e.collection_id and deleted_at is null) then
    raise exception 'That view is no longer in the catalog.' using errcode = 'P0002';
  end if;
  if e.owner_id = v_me then raise exception 'This is your own view.' using errcode = '22023'; end if;
  select * into t from public.catalog_takes where entry_id = p_entry and user_id = v_me;
  if found and exists (select 1 from public.collections where id = t.copy_id and deleted_at is null) then
    return jsonb_build_object('view', t.copy_id, 'name', (select name from public.collections where id = t.copy_id), 'already', true,
      'views', 0, 'words', 0, 'rules', 0, 'skipped', 0);
  end if;
  res := public.view_copy_tree(e.collection_id, v_me, md5(p_entry::text || v_me::text || clock_timestamp()::text), (select username from public.profiles where id = e.owner_id));
  insert into public.catalog_takes (entry_id, user_id, copy_id) values (p_entry, v_me, (res ->> 'view')::uuid)
  on conflict (entry_id, user_id) do update set copy_id = excluded.copy_id, taken_at = now();
  update public.catalog_entries set takes = takes + 1 where id = p_entry;
  return res;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.catalog_publish(uuid, text, text)', 'public.catalog_unpublish(uuid)', 'public.catalog_list(text, integer)', 'public.catalog_take(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
