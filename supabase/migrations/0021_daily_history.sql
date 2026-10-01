-- The admin's activity numbers from each player's daily totals (review
-- F12): the same numbers the player's Study Dashboard shows. The round log
-- keeps only the newest 50 rounds; the history section's dailyHistory
-- keeps every day for 120 days ({"2026-10-01": {rounds, answered,
-- correct}}, by the player's own date). A player whose game hasn't saved
-- daily totals yet is counted from the round log, as before.

-- A day key from a player's data, or null when it isn't a real date (so a
-- bad key can't break the admin's pages).
create or replace function public.try_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end;
$$;
revoke execute on function public.try_date(text) from public, anon;

create or replace function public.activity_day_rows(p_tz text default 'UTC')
returns table (user_id uuid, day date, rounds integer, answered integer, correct integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, public.try_date(d.key),
         coalesce(public.json_int(d.value -> 'rounds'), 0), coalesce(public.json_int(d.value -> 'answered'), 0), coalesce(public.json_int(d.value -> 'correct'), 0)
  from public.progress p
  cross join lateral jsonb_each(case when jsonb_typeof(p.data -> 'dailyHistory') = 'object' then p.data -> 'dailyHistory' else '{}'::jsonb end) as d
  where p.section = 'history' and public.try_date(d.key) is not null and jsonb_typeof(d.value) = 'object'
  union all
  select l.user_id, l.day, count(*)::integer, coalesce(sum(l.total), 0)::integer, coalesce(sum(l.correct), 0)::integer
  from public.session_log_rows(p_tz) l
  where not exists (select 1 from public.progress h where h.user_id = l.user_id and h.section = 'history' and jsonb_typeof(h.data -> 'dailyHistory') = 'object')
  group by l.user_id, l.day;
$$;
revoke execute on function public.activity_day_rows(text) from public, anon, authenticated;

create or replace function public.admin_activity(p_days integer default 30, p_tz text default 'UTC')
returns table (day date, sessions integer, answers integer, correct integer, active_players integer, new_players integer, ai_calls integer, live_matches integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  with days as (
    select generate_series((now() at time zone p_tz)::date - (greatest(1, least(p_days, 366)) - 1), (now() at time zone p_tz)::date, interval '1 day')::date as d
  ), logs as (
    select * from public.activity_day_rows(p_tz)
  )
  select days.d,
    (select coalesce(sum(logs.rounds), 0)::integer from logs where logs.day = days.d),
    (select coalesce(sum(logs.answered), 0)::integer from logs where logs.day = days.d),
    (select coalesce(sum(logs.correct), 0)::integer from logs where logs.day = days.d),
    (select count(distinct logs.user_id)::integer from logs where logs.day = days.d and logs.rounds > 0),
    (select count(*)::integer from public.profiles pr where (pr.created_at at time zone p_tz)::date = days.d),
    (select coalesce(sum(u.calls), 0)::integer from public.ai_usage u where u.day = days.d),
    (select count(distinct (r.room_code, date_trunc('hour', r.played_at)))::integer from public.live_results r where (r.played_at at time zone p_tz)::date = days.d)
  from days
  order by days.d;
end;
$$;

create or replace function public.admin_players(p_tz text default 'UTC')
returns table (
  id uuid, username text, role text, score integer, week_score integer, week_start date, mastered_count integer,
  study_streak integer, best_study_streak integer, live_wins integer, live_played integer, created_at timestamptz,
  last_active timestamptz, words_seen integer, sessions_30d integer, answers_30d integer, correct_30d integer,
  ai_today integer, ai_total integer, reports integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  with logs as (select * from public.activity_day_rows(p_tz) where day > (now() at time zone p_tz)::date - 30)
  select pr.id, pr.username, pr.role, pr.score, pr.week_score, pr.week_start, pr.mastered_count,
    pr.study_streak, pr.best_study_streak, pr.live_wins, pr.live_played, pr.created_at,
    (select max(g.updated_at) from public.progress g where g.user_id = pr.id),
    (select count(*)::integer from public.mastery m where m.user_id = pr.id),
    (select coalesce(sum(logs.rounds), 0)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(logs.answered), 0)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(logs.correct), 0)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(u.calls), 0)::integer from public.ai_usage u where u.user_id = pr.id and u.day = current_date),
    (select coalesce(sum(u.calls), 0)::integer from public.ai_usage u where u.user_id = pr.id),
    (select count(*)::integer from public.reports rp where rp.user_id = pr.id)
  from public.profiles pr
  order by pr.score desc;
end;
$$;

create or replace view analytics.player_summary with (security_invoker = on) as
with rounds as (
  select user_id, sum(rounds)::integer as sessions from public.activity_day_rows('UTC') group by user_id
), last_round as (
  select user_id, max(at) as last_session from public.session_log_rows('UTC') group by user_id
), sessions as (
  select coalesce(r.user_id, l.user_id) as user_id, coalesce(r.sessions, 0) as sessions, l.last_session
  from rounds r full join last_round l on l.user_id = r.user_id
), play as (
  select user_id, count(*)::integer as words_seen, coalesce(sum((stats ->> 'total')::numeric), 0)::integer as answers,
         coalesce(sum((stats ->> 'correct')::numeric), 0)::integer as correct, max(updated_at) as last_answer
  from public.mastery group by user_id
), ai as (
  select user_id, sum(calls)::integer as ai_calls, sum(calls) filter (where day > current_date - 30)::integer as ai_calls_30d from public.ai_usage group by user_id
), rep as (
  select user_id, count(*)::integer as reports, count(*) filter (where resolved_at is null)::integer as open_reports from public.reports group by user_id
)
select
  p.username, p.role, p.created_at as joined_at,
  greatest(play.last_answer, s.last_session, (select max(updated_at) from public.progress pr where pr.user_id = p.id)) as last_active,
  extract(day from now() - greatest(play.last_answer, s.last_session, p.created_at))::integer as days_since_active,
  p.score, p.week_score, p.mastered_count, p.study_streak, p.best_study_streak,
  coalesce(play.words_seen, 0) as words_seen, coalesce(play.answers, 0) as answers, coalesce(play.correct, 0) as correct,
  case when play.answers > 0 then round(100.0 * play.correct / play.answers, 1) end as accuracy_pct,
  coalesce(s.sessions, 0) as sessions,
  coalesce(ai.ai_calls, 0) as ai_calls, coalesce(ai.ai_calls_30d, 0) as ai_calls_30d,
  p.live_played, p.live_wins,
  coalesce(rep.reports, 0) as reports_filed, coalesce(rep.open_reports, 0) as open_reports_filed
from public.profiles p
left join sessions s on s.user_id = p.id
left join play on play.user_id = p.id
left join ai on ai.user_id = p.id
left join rep on rep.user_id = p.id;
comment on view analytics.player_summary is 'One row per player: activity, accuracy, AI use, Live results and reports filed. Rounds come from the daily totals (0021).';

create or replace view analytics.daily_activity with (security_invoker = on) as
with days as (
  select generate_series(current_date - 89, current_date, interval '1 day')::date as day
), s as (
  select day, sum(rounds) as sessions, sum(answered) as answers, sum(correct) as correct, count(distinct user_id) filter (where rounds > 0) as players
  from public.activity_day_rows('UTC') group by day
)
select
  d.day,
  coalesce(s.players, 0)::integer as active_players,
  coalesce(s.sessions, 0)::integer as sessions,
  coalesce(s.answers, 0)::integer as answers,
  case when s.answers > 0 then round(100.0 * s.correct / s.answers, 1) end as accuracy_pct,
  (select count(*) from public.profiles p where p.created_at::date = d.day)::integer as new_players,
  (select coalesce(sum(calls), 0) from public.ai_usage a where a.day = d.day)::integer as ai_calls,
  (select count(*) from public.reports r where r.reported_at::date = d.day)::integer as reports_filed,
  (select count(*) from public.live_challenges c where c.created_at::date = d.day)::integer as live_created,
  (select count(*) from public.admin_audit a where a.at::date = d.day and a.action in ('content.create', 'content.update', 'content.delete'))::integer as content_changes
from days d left join s on s.day = d.day;
