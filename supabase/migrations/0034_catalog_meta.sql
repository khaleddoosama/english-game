-- Catalog entries remember when they were last edited, their owner can edit
-- the title and description (catalog_edit), and the list gives an owner the id
-- of the view behind their own entry so it can be opened in their library.
alter table public.catalog_entries add column updated_at timestamptz not null default now();

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
    update public.catalog_entries set title = v_title, description = v_desc, updated_at = now() where id = e.id returning * into e;
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

-- Change the title and description of an entry. Its owner can, and so can an admin.
create or replace function public.catalog_edit(p_entry uuid, p_title text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  e public.catalog_entries;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if char_length(v_title) not between 1 and 60 then raise exception 'Give it a title of up to 60 characters.' using errcode = '22023'; end if;
  if char_length(v_desc) > 300 then raise exception 'The description is up to 300 characters.' using errcode = '22023'; end if;
  update public.catalog_entries set title = v_title, description = v_desc, updated_at = now()
  where id = p_entry and unpublished_at is null and (owner_id = (select auth.uid()) or (select public.is_admin()))
  returning * into e;
  if not found then raise exception 'That view is not in the catalog, or it is not yours.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'updated_at', e.updated_at);
end;
$$;

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
        'at', e.created_at, 'updated_at', e.updated_at, 'takes', e.takes, 'view', case when e.owner_id = v_me then e.collection_id end,
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

revoke execute on function public.catalog_edit(uuid, text, text) from public, anon;
grant execute on function public.catalog_edit(uuid, text, text) to authenticated;
