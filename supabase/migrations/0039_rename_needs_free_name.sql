-- Renaming a word to a name another word already has is refused (decision of
-- the owner). Merging two words is a separate feature that needs a preview.
--
-- Until now content_save_v2 accepted such a rename and apply_item_renames
-- "merged" the two words' progress (keeping the record with more answers) and
-- left the library and views of the old word on a deleted word. Now the save
-- is refused before anything is written: no content row, no progress, no alias,
-- no library entry or view changes.
--
-- A word is identified by its text compared without case and with spaces
-- collapsed (the same rule as the app, src/engine/wordIdentity.js). Two meanings
-- of one headword ("Cast", "Cast (to throw)") are different words. A rename that
-- only changes the case or spacing of the word's own name is allowed. The same
-- rename sent again after its answer was lost (the alias already exists) is not
-- a clash with itself. Renames of categories are not affected.
--
-- apply_item_renames, the low-level step, is unchanged: it still only moves
-- progress and is meant to run inside content_save_v2.

create or replace function public.word_key_norm(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_key, '')), '\s+', ' ', 'g')) $$;

revoke execute on function public.word_key_norm(text) from public, anon, authenticated;

create or replace function public.content_save_v2(
  p_draft uuid, p_upserts jsonb, p_removes jsonb, p_level_order jsonb, p_note text,
  p_renames jsonb, p_expected_version bigint, p_publish boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current bigint;
  v_all jsonb;
  v_version bigint;
  v_renamed integer;
  r jsonb;
  v_from text;
  v_to text;
  v_taken text;
begin
  perform public.require_admin();
  if jsonb_typeof(coalesce(p_upserts, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_removes, '[]'::jsonb)) <> 'array' then
    raise exception 'upserts and removes must be lists' using errcode = '22023';
  end if;
  if not coalesce(p_publish, false) then
    if p_draft is null then raise exception 'a draft id is needed' using errcode = '22023'; end if;
    delete from public.content_drafts where created_at < now() - interval '1 day';
    insert into public.content_drafts (draft_id, admin_id, kind, key, item)
    select p_draft, (select auth.uid()), u ->> 'kind', u ->> 'key', u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) as u
    on conflict (draft_id, kind, key) do update set item = excluded.item;
    return jsonb_build_object('staged', (select count(*) from public.content_drafts where draft_id = p_draft));
  end if;
  perform pg_advisory_xact_lock(hashtext('content-publish'));
  select version into v_current from public.content_meta where id = 1 for update;
  if p_expected_version is not null and v_current is distinct from p_expected_version then
    raise exception 'The content was changed in another tab or by another admin (version % there, % here). Reload the page to get the latest, then redo your last change.', v_current, p_expected_version
      using errcode = '40001';
  end if;

  -- a word cannot be renamed to a name another word has (checked before anything is written)
  if jsonb_typeof(p_renames) = 'array' then
    for r in select * from jsonb_array_elements(p_renames) loop
      continue when r ->> 'kind' is distinct from 'word';
      v_from := public.word_key_norm(r ->> 'from');
      v_to := public.word_key_norm(r ->> 'to');
      continue when v_from = '' or v_to = '' or v_from = v_to;
      -- the same rename again, after its answer was lost: the alias is there already
      continue when exists (select 1 from public.item_key_aliases a where a.kind = 'word' and public.word_key_norm(a.from_key) = v_from and public.word_key_norm(a.to_key) = v_to);
      select c.key into v_taken from public.content_items c
        where c.kind = 'words' and not c.deleted and public.word_key_norm(c.key) = v_to limit 1;
      if found then
        raise exception 'There is already a word called "%". Choose another name, or edit that word.', v_taken using errcode = '23505';
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(item order by created_at, kind, key), '[]'::jsonb) into v_all
  from public.content_drafts where draft_id = p_draft and admin_id = (select auth.uid());
  v_all := v_all || coalesce(p_upserts, '[]'::jsonb);
  v_version := public.apply_content_changes(v_all, p_removes, p_level_order, p_note);
  v_renamed := public.apply_item_renames(p_renames);
  delete from public.content_drafts where draft_id = p_draft;
  return jsonb_build_object('version', v_version, 'renamed', v_renamed);
end;
$$;

revoke execute on function public.content_save_v2(uuid, jsonb, jsonb, jsonb, text, jsonb, bigint, boolean) from public, anon;
grant execute on function public.content_save_v2(uuid, jsonb, jsonb, jsonb, text, jsonb, bigint, boolean) to authenticated;
notify pgrst, 'reload schema';
