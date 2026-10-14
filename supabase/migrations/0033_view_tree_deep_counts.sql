-- The list of my views also says what each holds together with the views
-- inside it (each word and rule counted once), so a view that only has
-- views inside it does not read "0 words".
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
    'rules', (select count(*) from public.collection_rules cr where cr.collection_id = c.id and cr.removed_at is null),
    'deep_words', (select count(distinct cs.sense_id) from public.collection_senses cs
                   join public.collections d on d.id = cs.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                   where cs.removed_at is null),
    'deep_rules', (select count(distinct cr.rule_id) from public.collection_rules cr
                   join public.collections d on d.id = cr.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                   where cr.removed_at is null)
  ) order by c.path), '[]'::jsonb)
  from public.collections c where c.owner_id = (select auth.uid()) and c.deleted_at is null;
$$;
