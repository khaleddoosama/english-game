-- A renamed word is still the same word (review of the library).
--
-- content_save_v2 renames a word in every player's progress (0017) and
-- remembers it in item_key_aliases. The library tables key a word by its old
-- name (senses.legacy_key), so the next dictionary sync saw "the old word is
-- gone" and "a new word appeared": the old sense was flagged deleted, a new
-- one was made, and every library entry and view that held the old one was
-- left holding a deleted word.
--
-- Now the sync first moves the sense to its new name, so its id (and with it
-- the library entries, the views, the player's own wording) stays. Only when
-- the new name is in the content, the old one is not, and no sense has the
-- new name yet; otherwise nothing is renamed and the sync works as before.

create or replace function public.dictionary_follow_renames()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with pick as (
    select distinct on (a.to_key) a.to_key, s.id
    from public.item_key_aliases a
    join public.senses s on s.legacy_key = a.from_key and s.deleted_at is null
    where a.kind = 'word'
      and exists (select 1 from public.content_items c where c.kind = 'words' and not c.deleted and c.data ->> 'word' = a.to_key)
      and not exists (select 1 from public.content_items c where c.kind = 'words' and not c.deleted and c.data ->> 'word' = a.from_key)
      and not exists (select 1 from public.senses t where t.legacy_key = a.to_key)
    order by a.to_key, s.updated_at desc
  ), moved as (
    update public.senses s set legacy_key = p.to_key, rev = s.rev + 1, updated_at = now()
    from pick p where s.id = p.id
    returning 1
  )
  select count(*) into n from moved;
  return n;
end;
$$;

create or replace function public.dictionary_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  perform public.dictionary_follow_renames();
  return public.dictionary_sync_core();
end;
$$;

revoke execute on function public.dictionary_follow_renames() from public, anon, authenticated;
revoke execute on function public.dictionary_sync() from public, anon;
grant execute on function public.dictionary_sync() to authenticated;
notify pgrst, 'reload schema';
