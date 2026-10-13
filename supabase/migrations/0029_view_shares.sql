-- Sharing a view with friends.
--  - only a friend can be sent a view, and only by its owner; the friend
--    sees it in their inbox and accepts or dismisses it;
--  - accepting makes the friend their own copy of the view and the views
--    inside it, with the words and rules in them; from then on the copy is
--    theirs and changes on either side don't reach the other;
--  - a word that is private to the sender is not copied (it is not the
--    friend's to see); everything else goes into the friend's library;
--  - limits: 20 friends a call, 50 shares waiting for one player, and a view
--    can be offered to the same friend again only after they answered.

create table public.collection_shares (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id),
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  copy_id uuid references public.collections (id),          -- what the friend got, once accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create unique index collection_shares_open_idx on public.collection_shares (collection_id, to_user) where status = 'pending';
create index collection_shares_to_idx on public.collection_shares (to_user, status);
alter table public.collection_shares enable row level security;
create policy "players read the shares they sent or got" on public.collection_shares
  for select to authenticated using ((select auth.uid()) in (from_user, to_user));
revoke insert, update, delete, truncate on public.collection_shares from anon, authenticated;
revoke all on public.collection_shares from anon;

-- Offers one of my views to some friends. Returns how many were sent.
create or replace function public.view_share(p_view uuid, p_users uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  u uuid;
  v_sent integer := 0;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.collections where id = p_view and owner_id = v_me and deleted_at is null) then
    raise exception 'That view does not exist.' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_users, 1), 0) = 0 then return 0; end if;
  if array_length(p_users, 1) > 20 then raise exception 'Share with up to 20 friends at a time.' using errcode = '22023'; end if;
  foreach u in array (select array_agg(distinct x) from unnest(p_users) x) loop
    if u = v_me then continue; end if;
    if not public.are_friends(v_me, u) then raise exception 'You can share only with your friends.' using errcode = '42501'; end if;
    if (select count(*) from public.collection_shares where to_user = u and status = 'pending') >= 50 then
      raise exception 'A friend has too many shares waiting. Try again later.' using errcode = '55000';
    end if;
    insert into public.collection_shares (collection_id, from_user, to_user)
    values (p_view, v_me, u)
    on conflict (collection_id, to_user) where status = 'pending' do nothing;
    if found then v_sent := v_sent + 1; end if;
  end loop;
  return v_sent;
end;
$$;

-- The views friends offered me that I haven't answered.
create or replace function public.view_shares_inbox()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', c.name, 'from', p.username, 'from_id', s.from_user, 'at', s.created_at,
    'words', (select count(*) from public.collection_senses cs where cs.collection_id = c.id and cs.removed_at is null),
    'rules', (select count(*) from public.collection_rules cr where cr.collection_id = c.id and cr.removed_at is null),
    'views', (select count(*) from public.collections d where d.owner_id = c.owner_id and d.deleted_at is null and d.path like c.path || '::%')
  ) order by s.created_at desc), '[]'::jsonb)
  from public.collection_shares s
  join public.collections c on c.id = s.collection_id and c.deleted_at is null
  join public.profiles p on p.id = s.from_user
  where s.to_user = (select auth.uid()) and s.status = 'pending';
$$;

-- Takes the offered view: my own copy, at the top level. Returns the new view.
create or replace function public.view_share_accept(p_share uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  s public.collection_shares;
  src public.collections;
  v_from text;
  v_name text;
  v_try integer := 1;
  v_root uuid;
  v_count integer;
  v_words integer;
  v_rules integer;
  v_skipped integer;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into s from public.collection_shares where id = p_share and to_user = v_me for update;
  if not found or s.status <> 'pending' then raise exception 'That share is no longer waiting.' using errcode = 'P0002'; end if;
  select * into src from public.collections where id = s.collection_id and deleted_at is null;
  if not found then raise exception 'The sender removed that view.' using errcode = 'P0002'; end if;
  if not public.are_friends(v_me, s.from_user) then raise exception 'You are no longer friends.' using errcode = '42501'; end if;
  select username into v_from from public.profiles where id = s.from_user;

  -- how many views the copy needs, and whether I have room
  select count(*) into v_count from public.collections where owner_id = src.owner_id and deleted_at is null and (id = src.id or path like src.path || '::%');
  if (select count(*) from public.collections where owner_id = v_me and deleted_at is null) + v_count > 200 then
    raise exception 'You do not have room for % more views (the most is 200).', v_count using errcode = '55000';
  end if;

  v_name := left(src.name, 30) || ' (from ' || left(v_from, 15) || ')';
  while exists (select 1 from public.collections where owner_id = v_me and parent_id is null and lower(name) = lower(v_name) and deleted_at is null) loop
    v_try := v_try + 1;
    v_name := left(src.name, 30) || ' (from ' || left(v_from, 15) || ') ' || v_try;
  end loop;

  v_root := md5(s.id::text || src.id::text)::uuid;
  with recursive tree as (
    select c.id, c.parent_id, c.kind, v_name as name, v_name as path, 1 as pos, c.course_level, 0 as depth
    from public.collections c where c.id = src.id
    union all
    select c.id, c.parent_id, c.kind, c.name, tree.path || '::' || c.name, c.position, c.course_level, tree.depth + 1
    from public.collections c join tree on c.parent_id = tree.id
    where c.owner_id = src.owner_id and c.deleted_at is null
  )
  insert into public.collections (id, owner_id, parent_id, kind, name, path, position, course_level)
  select md5(s.id::text || t.id::text)::uuid, v_me,
         case when t.depth = 0 then null else md5(s.id::text || t.parent_id::text)::uuid end,
         'view', t.name, t.path, t.pos, t.course_level
  from tree t order by t.depth;

  -- the words I may have (not the sender's private ones) go into my library and the copy
  with recursive tree as (
    select c.id from public.collections c where c.id = src.id
    union all
    select c.id from public.collections c join tree on c.parent_id = tree.id where c.owner_id = src.owner_id and c.deleted_at is null
  ), wanted as (
    select distinct on (cs.collection_id, cs.sense_id) cs.collection_id, cs.sense_id
    from public.collection_senses cs join tree on tree.id = cs.collection_id
    join public.senses se on se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected'
    where cs.removed_at is null
  ), lib as (
    insert into public.library_entries (user_id, sense_id)
    select distinct v_me, sense_id from wanted
    on conflict (user_id, sense_id) do update set removed_at = null where public.library_entries.removed_at is not null
    returning 1
  )
  insert into public.collection_senses (collection_id, sense_id)
  select md5(s.id::text || w.collection_id::text)::uuid, w.sense_id from wanted w;
  get diagnostics v_words = row_count;

  with recursive tree as (
    select c.id from public.collections c where c.id = src.id
    union all
    select c.id from public.collections c join tree on c.parent_id = tree.id where c.owner_id = src.owner_id and c.deleted_at is null
  ), wanted as (
    select distinct cr.collection_id, cr.rule_id
    from public.collection_rules cr join tree on tree.id = cr.collection_id
    join public.grammar_rules r on r.id = cr.rule_id and r.deleted_at is null
    where cr.removed_at is null
  ), lib as (
    insert into public.library_rules (user_id, rule_id)
    select distinct v_me, rule_id from wanted
    on conflict (user_id, rule_id) do update set removed_at = null where public.library_rules.removed_at is not null
    returning 1
  )
  insert into public.collection_rules (collection_id, rule_id)
  select md5(s.id::text || w.collection_id::text)::uuid, w.rule_id from wanted w;
  get diagnostics v_rules = row_count;

  select count(*) into v_skipped
  from public.collection_senses cs
  where cs.removed_at is null and cs.collection_id in (
      with recursive tree as (
        select c.id from public.collections c where c.id = src.id
        union all
        select c.id from public.collections c join tree on c.parent_id = tree.id where c.owner_id = src.owner_id and c.deleted_at is null)
      select id from tree)
    and not exists (select 1 from public.senses se where se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected');

  update public.collection_shares set status = 'accepted', copy_id = v_root, updated_at = now() where id = s.id;
  return jsonb_build_object('view', v_root, 'name', v_name, 'views', v_count, 'words', v_words, 'rules', v_rules, 'skipped', v_skipped);
end;
$$;

create or replace function public.view_share_dismiss(p_share uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.collection_shares set status = 'dismissed', updated_at = now()
  where id = p_share and to_user = (select auth.uid()) and status = 'pending';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.view_share(uuid, uuid[])', 'public.view_shares_inbox()', 'public.view_share_accept(uuid)', 'public.view_share_dismiss(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
