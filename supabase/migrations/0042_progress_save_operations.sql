-- Progress saves that can be sent twice (review of the save path).
--
-- Why: a save is stored as whole sections, and the client merges two devices by adding what each
-- one changed since the copy it started from. When a save reached the database but its answer
-- was lost, the device sent it again; by then another device may have saved, and the second
-- delivery was merged on top of a result that already held it: the score and counters were
-- counted twice. Only the client's own guard (the server holds exactly this copy) covered the
-- simplest case.
--
-- What: the client gives every logical save an id (`p_op`) and keeps it for as long as it is
-- unanswered, also across a closed page. The database records the id with the revisions the save
-- produced; the same id again changes nothing and answers `{duplicate: true, revs}`. The check,
-- the writes and the record are one transaction under the player's lock.
--  * a save that was refused (stale revision) or failed records nothing, so the same id may be
--    sent again;
--  * the same id with different content is an error (22023);
--  * records older than 90 days are deleted when the player saves.
--
-- Compatibility: `p_op` has a default (null), so a client that does not send it works as before
-- (no protection). The old six-argument function is dropped and replaced by this one: two
-- overloads would be ambiguous for named arguments. A new client talking to a database without
-- this migration gets "function not found" and falls back to sending no id.
-- Rollback: supabase/rollback/0037_0042_down.sql.

create table public.progress_ops (
  user_id uuid not null references public.profiles (id) on delete cascade,
  op_id uuid not null,
  revs jsonb not null,
  digest text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
create index progress_ops_age_idx on public.progress_ops (user_id, created_at);
alter table public.progress_ops enable row level security;   -- no policy: only the function reads and writes it
revoke all on public.progress_ops from public, anon, authenticated;

drop function public.save_progress_v2(jsonb, jsonb, jsonb, text[], jsonb, boolean);
create or replace function public.save_progress_v2(
  p_sections jsonb, p_expected jsonb, p_mastery jsonb, p_mastery_removes text[], p_profile jsonb, p_replace boolean default false,
  p_op uuid default null
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
  v_digest text;
  v_done record;
  v_revs jsonb;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(v_sections) <> 'object' or jsonb_typeof(coalesce(p_mastery, '{}'::jsonb)) <> 'object' then
    raise exception 'sections and mastery must be objects' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('progress:' || v_user::text));

  -- One logical save is applied once. The same operation id sent again (the answer was lost, the
  -- page was closed and opened again) is answered from what was recorded, and changes nothing.
  -- Checking, writing and recording happen under the lock above, in one transaction.
  if p_op is not null then
    v_digest := md5(concat_ws('|', v_sections::text, coalesce(p_expected::text, ''), coalesce(p_mastery::text, ''),
                              coalesce(array_to_string(p_mastery_removes, ','), ''), coalesce(p_profile::text, ''), v_replace::text));
    select o.revs, o.digest into v_done from public.progress_ops o where o.user_id = v_user and o.op_id = p_op;
    if found then
      if v_done.digest <> v_digest then
        raise exception 'this operation id was already used for a different save' using errcode = '22023';
      end if;
      return jsonb_build_object('duplicate', true, 'revs', v_done.revs);
    end if;
  end if;

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

  v_revs := coalesce((select jsonb_object_agg(section, rev) from public.progress where user_id = v_user and v_sections ? section), '{}'::jsonb);
  if p_op is not null then
    delete from public.progress_ops where user_id = v_user and created_at < now() - interval '90 days';
    insert into public.progress_ops (user_id, op_id, revs, digest) values (v_user, p_op, v_revs, v_digest);
  end if;
  return jsonb_build_object('revs', v_revs);
end;
$$;

revoke execute on function public.save_progress_v2(jsonb, jsonb, jsonb, text[], jsonb, boolean, uuid) from public, anon;
grant execute on function public.save_progress_v2(jsonb, jsonb, jsonb, text[], jsonb, boolean, uuid) to authenticated;
notify pgrst, 'reload schema';
