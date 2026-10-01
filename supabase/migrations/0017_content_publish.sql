-- Renaming moves every player's progress (review F03), and content is
-- published in one step (F08).
--
-- Renames: when the admin renames a word or a category, every player's
-- progress follows it in the same transaction as the content change:
-- mastery rows, practice pools, mix-ups, reports' target words, level
-- stats and cleared levels. A player who has both the old and new name
-- keeps the record with more answers. The rename is remembered as an
-- alias, so a device that was offline and still sends the old name is
-- mapped to the new one when it saves.
--
-- Publishing: a large import is sent in batches into a draft and applied
-- by one final call, so players never see half an import and a failure
-- leaves the published content as it was. The final call also checks the
-- content version the admin started from, so two tabs (or admins) can't
-- silently overwrite each other.

create table if not exists public.item_key_aliases (
  kind text not null check (kind in ('word', 'category')),
  from_key text not null,
  to_key text not null,
  at timestamptz not null default now(),
  primary key (kind, from_key)
);
alter table public.item_key_aliases enable row level security;
drop policy if exists "admin reads aliases" on public.item_key_aliases;
create policy "admin reads aliases" on public.item_key_aliases for select to authenticated using ((select public.is_admin()));

create table if not exists public.content_drafts (
  draft_id uuid not null,
  admin_id uuid not null,
  kind text not null,
  key text not null,
  item jsonb not null,
  created_at timestamptz not null default now(),
  primary key (draft_id, kind, key)
);
alter table public.content_drafts enable row level security;
-- No policies: drafts are written and read only by content_save_v2.

create or replace function public.apply_item_renames(p_renames jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_kind text;
  v_from text;
  v_to text;
  n integer := 0;
begin
  perform public.require_admin();
  if p_renames is null or jsonb_typeof(p_renames) <> 'array' then return 0; end if;
  for r in select * from jsonb_array_elements(p_renames) loop
    v_kind := r ->> 'kind';
    v_from := btrim(coalesce(r ->> 'from', ''));
    v_to := btrim(coalesce(r ->> 'to', ''));
    continue when v_from = '' or v_to = '' or v_from = v_to or v_kind is null or v_kind not in ('word', 'category');
    n := n + 1;
    if v_kind = 'word' then
      -- A player with both names keeps the record with more answers.
      update public.mastery t set stats = f.stats, updated_at = now()
        from public.mastery f
        where f.item_key = v_from and t.item_key = v_to and t.user_id = f.user_id
          and coalesce(public.json_int(f.stats -> 'total'), 0) > coalesce(public.json_int(t.stats -> 'total'), 0);
      delete from public.mastery f
        where f.item_key = v_from and exists (select 1 from public.mastery t where t.user_id = f.user_id and t.item_key = v_to);
      update public.mastery set item_key = v_to, updated_at = now() where item_key = v_from;
      update public.progress
        set data = jsonb_set(data, '{pools}', ((data -> 'pools') - v_from)
          || case when (data -> 'pools') ? v_to then '{}'::jsonb else jsonb_build_object(v_to, data -> 'pools' -> v_from) end)
        where section = 'pools' and jsonb_typeof(data -> 'pools') = 'object' and (data -> 'pools') ? v_from;
      update public.progress
        set data = jsonb_set(data, '{confusions}', (
          select coalesce(jsonb_object_agg(x.k, x.v), '{}'::jsonb) from (
            select concat_ws('|',
                     case when split_part(e.key, '|', 1) = v_from then v_to else split_part(e.key, '|', 1) end,
                     case when split_part(e.key, '|', 2) = v_from then v_to else split_part(e.key, '|', 2) end) as k,
                   e.value as v
            from jsonb_each(data -> 'confusions') as e) as x))
        where section = 'confusions' and jsonb_typeof(data -> 'confusions') = 'object'
          and exists (select 1 from jsonb_object_keys(data -> 'confusions') as k where split_part(k, '|', 1) = v_from or split_part(k, '|', 2) = v_from);
      update public.reports
        set data = jsonb_set(data, '{targetWords}', (
          select jsonb_agg(case when x #>> '{}' = v_from then to_jsonb(v_to) else x end) from jsonb_array_elements(data -> 'targetWords') as x))
        where jsonb_typeof(data -> 'targetWords') = 'array' and (data -> 'targetWords') ? v_from;
    else
      update public.progress
        set data = jsonb_set(data, '{levelStats}', ((data -> 'levelStats') - ('cat-' || v_from))
          || case when (data -> 'levelStats') ? ('cat-' || v_to) then '{}'::jsonb
                  else jsonb_build_object('cat-' || v_to, data -> 'levelStats' -> ('cat-' || v_from)) end)
        where section = 'levels' and jsonb_typeof(data -> 'levelStats') = 'object' and (data -> 'levelStats') ? ('cat-' || v_from);
      update public.progress
        set data = jsonb_set(data, '{levelsCleared}', (
          select coalesce(jsonb_agg(distinct case when x #>> '{}' = 'cat-' || v_from then to_jsonb('cat-' || v_to) else x end), '[]'::jsonb)
          from jsonb_array_elements(data -> 'levelsCleared') as x))
        where section = 'levels' and jsonb_typeof(data -> 'levelsCleared') = 'array' and (data -> 'levelsCleared') ? ('cat-' || v_from);
    end if;
    -- Aliases chain (a -> b -> c resolves to c) and renaming back undoes one.
    update public.item_key_aliases set to_key = v_to, at = now() where kind = v_kind and to_key = v_from;
    delete from public.item_key_aliases where kind = v_kind and from_key = v_to;
    insert into public.item_key_aliases (kind, from_key, to_key) values (v_kind, v_from, v_to)
      on conflict (kind, from_key) do update set to_key = excluded.to_key, at = now();
    insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
    values ((select auth.uid()), 'content.rename', format('%s: %s → %s', v_kind, v_from, v_to), case when v_kind = 'word' then 'words' else 'categories' end, v_to,
            jsonb_build_object('name', jsonb_build_object('before', v_from, 'after', v_to)));
  end loop;
  return n;
end;
$$;

-- p_publish false: add p_upserts to the draft p_draft.
-- p_publish true: apply the draft plus p_upserts, the removes, the level
-- order, the note and the renames in one transaction; refused when the
-- content version isn't p_expected_version any more.
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
  select coalesce(jsonb_agg(item order by created_at, kind, key), '[]'::jsonb) into v_all
  from public.content_drafts where draft_id = p_draft and admin_id = (select auth.uid());
  v_all := v_all || coalesce(p_upserts, '[]'::jsonb);
  v_version := public.apply_content_changes(v_all, p_removes, p_level_order, p_note);
  v_renamed := public.apply_item_renames(p_renames);
  delete from public.content_drafts where draft_id = p_draft;
  return jsonb_build_object('version', v_version, 'renamed', v_renamed);
end;
$$;

-- save_progress_v2, now mapping renamed words: a device that still sends
-- an old word name saves under the new one.
create or replace function public.save_progress_v2(
  p_sections jsonb, p_expected jsonb, p_mastery jsonb, p_mastery_removes text[], p_profile jsonb, p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_sections jsonb := coalesce(p_sections, '{}'::jsonb);
  v_replace boolean := coalesce(p_replace, false);
  v_conflicts text[];
  v_old_score integer;
  v_new_score integer;
  v_gain integer;
  v_week date;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(v_sections) <> 'object' or jsonb_typeof(coalesce(p_mastery, '{}'::jsonb)) <> 'object' then
    raise exception 'sections and mastery must be objects' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('progress:' || v_user::text));

  if not v_replace and p_expected is not null then
    select array_agg(p.section order by p.section) into v_conflicts
    from public.progress p
    where p.user_id = v_user and v_sections ? p.section
      and p.rev is distinct from public.json_int(p_expected -> p.section);
    if v_conflicts is not null then
      return jsonb_build_object(
        'conflict', to_jsonb(v_conflicts),
        'sections', (select jsonb_object_agg(section, jsonb_build_object('data', data, 'rev', rev))
                     from public.progress where user_id = v_user and section = any (v_conflicts)));
    end if;
  end if;

  select public.json_int(data -> 'score') into v_old_score from public.progress where user_id = v_user and section = 'core';

  insert into public.progress (user_id, section, data, updated_at)
  select v_user, s.key, s.value, now() from jsonb_each(v_sections) as s
  on conflict (user_id, section) do update set data = excluded.data;

  insert into public.mastery (user_id, item_key, stats, updated_at)
  select distinct on (x.k) v_user, x.k, x.value, now()
  from (
    select coalesce(a.to_key, m.key) as k, m.value, (a.to_key is null) as direct
    from jsonb_each(coalesce(p_mastery, '{}'::jsonb)) as m
    left join public.item_key_aliases a on a.kind = 'word' and a.from_key = m.key
  ) as x
  order by x.k, x.direct desc
  on conflict (user_id, item_key) do update set
    stats = case when v_replace or coalesce(public.json_int(excluded.stats -> 'total'), 0) >= coalesce(public.json_int(public.mastery.stats -> 'total'), 0)
                 then excluded.stats else public.mastery.stats end,
    updated_at = now();
  if p_mastery_removes is not null and cardinality(p_mastery_removes) > 0 then
    delete from public.mastery where user_id = v_user and item_key = any (p_mastery_removes);
  end if;

  if v_sections ? 'core' then
    v_new_score := greatest(coalesce(public.json_int(v_sections #> '{core,score}'), 0), 0);
    v_gain := case when v_replace then 0 else greatest(v_new_score - coalesce(v_old_score, 0), 0) end;
    v_week := case when (p_profile ->> 'week_start') ~ '^\d{4}-\d{2}-\d{2}$' then (p_profile ->> 'week_start')::date end;
    update public.profiles set
      score = v_new_score,
      study_streak = greatest(coalesce(public.json_int(v_sections #> '{core,studyStreak}'), study_streak), 0),
      best_study_streak = greatest(coalesce(public.json_int(v_sections #> '{core,bestStudyStreak}'), best_study_streak), 0),
      week_score = case when v_week is null or v_replace then week_score
                        when week_start is distinct from v_week then v_gain
                        else week_score + v_gain end,
      week_start = case when v_week is null or v_replace then week_start else v_week end,
      updated_at = now()
    where id = v_user;
  end if;
  if public.json_int(p_profile -> 'mastered_count') is not null then
    update public.profiles set mastered_count = greatest(public.json_int(p_profile -> 'mastered_count'), 0) where id = v_user;
  end if;

  return jsonb_build_object('revs', coalesce((select jsonb_object_agg(section, rev) from public.progress where user_id = v_user and v_sections ? section), '{}'::jsonb));
end;
$$;

revoke execute on function public.apply_item_renames(jsonb) from public, anon;
grant execute on function public.apply_item_renames(jsonb) to authenticated;
revoke execute on function public.content_save_v2(uuid, jsonb, jsonb, jsonb, text, jsonb, bigint, boolean) from public, anon;
grant execute on function public.content_save_v2(uuid, jsonb, jsonb, jsonb, text, jsonb, bigint, boolean) to authenticated;
notify pgrst, 'reload schema';
