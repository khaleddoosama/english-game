-- Progress from two devices (review F02) and trustworthy leaderboard
-- numbers (F04, lightly).
--
-- Every saved section now has a revision that goes up on each write. A
-- device sends the revision it last saw with each section it writes; if
-- another device wrote that section since, nothing is written and the
-- server's copy comes back so the device can merge and try again.
--
-- The leaderboard numbers are no longer sent by the app: score and the
-- study streak come from the saved progress itself, and this week's points
-- are what the score went up by. Restoring a backup (p_replace) sets the
-- score without counting it as this week's points. Players can no longer
-- write their profile row directly.

alter table public.progress add column if not exists rev bigint not null default 1;

create or replace function public.progress_bump_rev()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists progress_bump_rev on public.progress;
create trigger progress_bump_rev before update on public.progress
  for each row execute function public.progress_bump_rev();

-- A whole number from a JSON value, or null.
create or replace function public.json_int(p jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' then least(greatest(floor((p #>> '{}')::numeric), -2147483648), 2147483647)::integer end;
$$;

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
  -- One save at a time per player, so two tabs can't interleave.
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

  -- Per word: the record with more answers wins, unless restoring a backup.
  insert into public.mastery (user_id, item_key, stats, updated_at)
  select v_user, m.key, m.value, now() from jsonb_each(coalesce(p_mastery, '{}'::jsonb)) as m
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

-- Older app versions still call save_progress: same rules, no conflict check.
create or replace function public.save_progress(p_sections jsonb, p_mastery jsonb, p_mastery_removes text[], p_profile jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.save_progress_v2(p_sections, null, p_mastery, p_mastery_removes, p_profile, false);
end;
$$;

-- Reset stays the player's own; it no longer needs to write profiles directly.
create or replace function public.reset_my_progress()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- Waits for a save in flight, so it can't land after the reset.
  perform pg_advisory_xact_lock(hashtext('progress:' || v_user::text));
  delete from public.progress where user_id = v_user;
  delete from public.mastery where user_id = v_user;
  update public.profiles set score = 0, mastered_count = 0, study_streak = 0, week_score = 0, updated_at = now() where id = v_user;
end;
$$;

-- The leaderboard numbers change only through the functions above.
revoke update on public.profiles from authenticated, anon;
drop policy if exists "players update their own stats" on public.profiles;

revoke execute on function public.json_int(jsonb) from public, anon;
revoke execute on function public.progress_bump_rev() from public, anon, authenticated;
revoke execute on function public.save_progress_v2(jsonb, jsonb, jsonb, text[], jsonb, boolean) from public, anon;
grant execute on function public.save_progress_v2(jsonb, jsonb, jsonb, text[], jsonb, boolean) to authenticated;
revoke execute on function public.save_progress(jsonb, jsonb, text[], jsonb) from public, anon;
grant execute on function public.save_progress(jsonb, jsonb, text[], jsonb) to authenticated;
revoke execute on function public.reset_my_progress() from public, anon;
grant execute on function public.reset_my_progress() to authenticated;
notify pgrst, 'reload schema';
