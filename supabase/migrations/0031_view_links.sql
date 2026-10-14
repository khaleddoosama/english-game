-- Sharing a view by link.
--  - the owner of a view makes a link; anyone who is signed in and opens it
--    sees what is offered and can take their own copy (the views inside it,
--    the words, the rules) into their library; the sender's private words are
--    not part of it. It needs no friendship: whoever has the link was given it;
--  - a link lasts 30 days, can be taken back at any time, and counts how many
--    took it; the same person taking it twice gets the copy they already have
--    (unless they removed it);
--  - the copying that "accept a friend's share" does is now one function both
--    ways of sharing use.

-- The copy itself: p_src (a view and what is inside it) becomes p_to's own, at
-- the top level of their views. p_seed makes the new ids, so one offer never
-- makes the same row twice. Not callable by players.
create or replace function public.view_copy_tree(p_src uuid, p_to uuid, p_seed text, p_from_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.collections;
  v_name text;
  v_try integer := 1;
  v_root uuid;
  v_count integer;
  v_words integer;
  v_rules integer;
  v_skipped integer;
begin
  select * into src from public.collections where id = p_src and deleted_at is null;
  if not found then raise exception 'The sender removed that view.' using errcode = 'P0002'; end if;
  select count(*) into v_count from public.collections where owner_id = src.owner_id and deleted_at is null and (id = src.id or path like src.path || '::%');
  if (select count(*) from public.collections where owner_id = p_to and deleted_at is null) + v_count > 200 then
    raise exception 'You do not have room for % more views (the most is 200).', v_count using errcode = '55000';
  end if;
  v_name := left(src.name, 30) || ' (from ' || left(p_from_name, 15) || ')';
  while exists (select 1 from public.collections where owner_id = p_to and parent_id is null and lower(name) = lower(v_name) and deleted_at is null) loop
    v_try := v_try + 1;
    v_name := left(src.name, 30) || ' (from ' || left(p_from_name, 15) || ') ' || v_try;
  end loop;

  v_root := md5(p_seed || src.id::text)::uuid;
  with recursive tree as (
    select c.id, c.parent_id, c.kind, v_name as name, v_name as path, 1 as pos, c.course_level, 0 as depth
    from public.collections c where c.id = src.id
    union all
    select c.id, c.parent_id, c.kind, c.name, tree.path || '::' || c.name, c.position, c.course_level, tree.depth + 1
    from public.collections c join tree on c.parent_id = tree.id
    where c.owner_id = src.owner_id and c.deleted_at is null
  )
  insert into public.collections (id, owner_id, parent_id, kind, name, path, position, course_level)
  select md5(p_seed || t.id::text)::uuid, p_to,
         case when t.depth = 0 then null else md5(p_seed || t.parent_id::text)::uuid end,
         'view', t.name, t.path, t.pos, t.course_level
  from tree t order by t.depth;

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
    select distinct p_to, sense_id from wanted
    on conflict (user_id, sense_id) do update set removed_at = null where public.library_entries.removed_at is not null
    returning 1
  )
  insert into public.collection_senses (collection_id, sense_id)
  select md5(p_seed || w.collection_id::text)::uuid, w.sense_id from wanted w;
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
    select distinct p_to, rule_id from wanted
    on conflict (user_id, rule_id) do update set removed_at = null where public.library_rules.removed_at is not null
    returning 1
  )
  insert into public.collection_rules (collection_id, rule_id)
  select md5(p_seed || w.collection_id::text)::uuid, w.rule_id from wanted w;
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

  return jsonb_build_object('view', v_root, 'name', v_name, 'views', v_count, 'words', v_words, 'rules', v_rules, 'skipped', v_skipped);
end;
$$;

-- Accepting a friend's offer, now through the shared copy.
create or replace function public.view_share_accept(p_share uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  s public.collection_shares;
  v_from text;
  res jsonb;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into s from public.collection_shares where id = p_share and to_user = v_me for update;
  if not found or s.status <> 'pending' then raise exception 'That share is no longer waiting.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.collections where id = s.collection_id and deleted_at is null) then
    raise exception 'The sender removed that view.' using errcode = 'P0002';
  end if;
  if not public.are_friends(v_me, s.from_user) then raise exception 'You are no longer friends.' using errcode = '42501'; end if;
  select username into v_from from public.profiles where id = s.from_user;
  res := public.view_copy_tree(s.collection_id, v_me, s.id::text, v_from);
  update public.collection_shares set status = 'accepted', copy_id = (res ->> 'view')::uuid, updated_at = now() where id = s.id;
  return res;
end;
$$;

-- ---------------------------------------------------------------- links
create table public.view_links (
  token text primary key,
  collection_id uuid not null references public.collections (id),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  uses integer not null default 0
);
create index view_links_owner_idx on public.view_links (owner_id, collection_id);
alter table public.view_links enable row level security;
create policy "owners read their own links" on public.view_links for select to authenticated using (owner_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.view_links from anon, authenticated;
revoke all on public.view_links from anon;

create table public.view_link_takes (
  token text not null references public.view_links (token),
  user_id uuid not null references public.profiles (id) on delete cascade,
  copy_id uuid not null,
  taken_at timestamptz not null default now(),
  primary key (token, user_id)
);
alter table public.view_link_takes enable row level security;
revoke insert, update, delete, truncate on public.view_link_takes from anon, authenticated;
revoke all on public.view_link_takes from anon;

-- A link for one of my views (the one I already made, while it is still good).
create or replace function public.view_link_create(p_view uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  l public.view_links;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.collections where id = p_view and owner_id = v_me and deleted_at is null) then
    raise exception 'That view does not exist.' using errcode = 'P0002';
  end if;
  select * into l from public.view_links where collection_id = p_view and owner_id = v_me and revoked_at is null and expires_at > now() order by created_at desc limit 1;
  if not found then
    if (select count(*) from public.view_links where owner_id = v_me and revoked_at is null and expires_at > now()) >= 50 then
      raise exception 'You have 50 links open. Take some back first.' using errcode = '55000';
    end if;
    insert into public.view_links (token, collection_id, owner_id)
    values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), p_view, v_me)
    returning * into l;
  end if;
  return jsonb_build_object('token', l.token, 'expires_at', l.expires_at, 'uses', l.uses);
end;
$$;

-- What a link offers, for whoever opened it. A link that does not work says why.
create or replace function public.view_link_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.view_links;
  c public.collections;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into l from public.view_links where token = p_token;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if l.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'taken_back'); end if;
  if l.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select * into c from public.collections where id = l.collection_id and deleted_at is null;
  if not found then return jsonb_build_object('valid', false, 'reason', 'removed'); end if;
  return jsonb_build_object('valid', true, 'name', c.name,
    'from', (select username from public.profiles where id = l.owner_id), 'mine', l.owner_id = (select auth.uid()),
    'words', (select count(distinct cs.sense_id) from public.collection_senses cs
              join public.collections d on d.id = cs.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
              join public.senses se on se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected'
              where cs.removed_at is null),
    'rules', (select count(distinct cr.rule_id) from public.collection_rules cr
              join public.collections d on d.id = cr.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
              join public.grammar_rules r on r.id = cr.rule_id and r.deleted_at is null
              where cr.removed_at is null),
    'views', (select count(*) from public.collections d where d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')),
    'taken', exists (select 1 from public.view_link_takes t where t.token = p_token and t.user_id = (select auth.uid())));
end;
$$;

-- Take the offered view as my own copy.
create or replace function public.view_link_accept(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  l public.view_links;
  t public.view_link_takes;
  res jsonb;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into l from public.view_links where token = p_token for update;
  if not found or l.revoked_at is not null or l.expires_at <= now()
     or not exists (select 1 from public.collections where id = l.collection_id and deleted_at is null) then
    raise exception 'This link no longer works.' using errcode = 'P0002';
  end if;
  if l.owner_id = v_me then raise exception 'This is your own view.' using errcode = '22023'; end if;
  -- taking it twice gives the copy I already have, unless I removed it
  select * into t from public.view_link_takes where token = p_token and user_id = v_me;
  if found and exists (select 1 from public.collections where id = t.copy_id and deleted_at is null) then
    return jsonb_build_object('view', t.copy_id, 'name', (select name from public.collections where id = t.copy_id), 'already', true,
      'views', 0, 'words', 0, 'rules', 0, 'skipped', 0);
  end if;
  res := public.view_copy_tree(l.collection_id, v_me, md5(p_token || v_me::text || clock_timestamp()::text), (select username from public.profiles where id = l.owner_id));
  insert into public.view_link_takes (token, user_id, copy_id) values (p_token, v_me, (res ->> 'view')::uuid)
  on conflict (token, user_id) do update set copy_id = excluded.copy_id, taken_at = now();
  update public.view_links set uses = uses + 1 where token = p_token;
  return res;
end;
$$;

create or replace function public.view_link_revoke(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.view_links set revoked_at = now() where token = p_token and owner_id = (select auth.uid()) and revoked_at is null;
$$;

-- Everything in my library: my words (with how many of my views each is in)
-- and my rules.
create or replace function public.library_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'words', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.sense_id, 'note', e.note, 'patch', e.patch, 'added_at', e.added_at,
        'views', (select count(*) from public.collection_senses cs join public.collections c on c.id = cs.collection_id
                  where cs.sense_id = e.sense_id and cs.removed_at is null and c.owner_id = e.user_id and c.deleted_at is null)
      ) order by e.added_at desc)
      from public.library_entries e join public.senses s on s.id = e.sense_id and s.deleted_at is null
      where e.user_id = (select auth.uid()) and e.removed_at is null), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.rule_id, 'added_at', r.added_at) order by r.added_at desc)
      from public.library_rules r join public.grammar_rules g on g.id = r.rule_id and g.deleted_at is null
      where r.user_id = (select auth.uid()) and r.removed_at is null), '[]'::jsonb));
$$;

-- The friends' inbox says how much the whole offered view holds (what the
-- friend would get), not only its top level.
create or replace function public.view_shares_inbox()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', c.name, 'from', p.username, 'from_id', s.from_user, 'at', s.created_at,
    'words', (select count(distinct cs.sense_id) from public.collection_senses cs
              join public.collections d on d.id = cs.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
              join public.senses se on se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected'
              where cs.removed_at is null),
    'rules', (select count(distinct cr.rule_id) from public.collection_rules cr
              join public.collections d on d.id = cr.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
              join public.grammar_rules r on r.id = cr.rule_id and r.deleted_at is null
              where cr.removed_at is null),
    'views', (select count(*) from public.collections d where d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%'))
  ) order by s.created_at desc), '[]'::jsonb)
  from public.collection_shares s
  join public.collections c on c.id = s.collection_id and c.deleted_at is null
  join public.profiles p on p.id = s.from_user
  where s.to_user = (select auth.uid()) and s.status = 'pending';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.view_link_create(uuid)', 'public.view_link_info(text)', 'public.view_link_accept(text)', 'public.view_link_revoke(text)', 'public.library_list()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.view_copy_tree(uuid, uuid, text, text) from public, anon, authenticated;
