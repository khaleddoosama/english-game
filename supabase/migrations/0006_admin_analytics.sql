-- Admin panel backend: analytics read in one call per view, player
-- management actions, and an audit log of what the admin changed.
-- Every function here refuses anyone who isn't the admin.

create table public.admin_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb
);
create index admin_audit_at_idx on public.admin_audit (at desc);
alter table public.admin_audit enable row level security;
create policy "admin reads the audit log" on public.admin_audit for select to authenticated using ((select public.is_admin()));
create policy "admin writes the audit log" on public.admin_audit for insert to authenticated
  with check ((select public.is_admin()) and admin_id = (select auth.uid()));

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
end;
$$;

-- Session log entries ({kind, title, correct, total, at}) live in each
-- player's "history" progress section; this flattens them with a local day.
create or replace function public.session_log_rows(p_tz text default 'UTC')
returns table (user_id uuid, kind text, title text, correct integer, total integer, at timestamptz, day date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id,
         l ->> 'kind',
         l ->> 'title',
         coalesce((l ->> 'correct')::integer, 0),
         coalesce((l ->> 'total')::integer, 0),
         to_timestamp((l ->> 'at')::double precision / 1000),
         (to_timestamp((l ->> 'at')::double precision / 1000) at time zone p_tz)::date
  from public.progress p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.data -> 'sessionLogs') = 'array' then p.data -> 'sessionLogs' else '[]'::jsonb end) as l
  where p.section = 'history' and (l ->> 'at') ~ '^[0-9.]+$';
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'active_1d', (select count(distinct user_id) from public.progress where updated_at > now() - interval '1 day'),
    'active_7d', (select count(distinct user_id) from public.progress where updated_at > now() - interval '7 days'),
    'active_30d', (select count(distinct user_id) from public.progress where updated_at > now() - interval '30 days'),
    'content', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from public.content_items where not deleted group by kind) c),
    'content_version', (select version from public.content_meta where id = 1),
    'content_updated_at', (select updated_at from public.content_meta where id = 1),
    'open_reports', (select count(*) from public.reports where resolved_at is null),
    'reports', (select count(*) from public.reports),
    'ai_calls_today', (select coalesce(sum(calls), 0) from public.ai_usage where day = current_date),
    'ai_calls_7d', (select coalesce(sum(calls), 0) from public.ai_usage where day > current_date - 7),
    'live_matches_7d', (select count(distinct (room_code, date_trunc('hour', played_at))) from public.live_results where played_at > now() - interval '7 days'),
    'live_matches', (select count(distinct (room_code, date_trunc('hour', played_at))) from public.live_results),
    'mastered_total', (select coalesce(sum(mastered_count), 0) from public.profiles),
    'mastery_rows', (select count(*) from public.mastery),
    'storage', (select jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b)) from (
      select bucket_id, count(*) as n, coalesce(sum((metadata ->> 'size')::bigint), 0) as b
      from storage.objects where bucket_id in ('word-images', 'tts') group by bucket_id) s)
  ) into v;
  return v;
end;
$$;

-- One row per day for the last p_days days (local time zone p_tz).
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
    select * from public.session_log_rows(p_tz)
  )
  select days.d,
    (select count(*)::integer from logs where logs.day = days.d),
    (select coalesce(sum(logs.total), 0)::integer from logs where logs.day = days.d),
    (select coalesce(sum(logs.correct), 0)::integer from logs where logs.day = days.d),
    (select count(distinct logs.user_id)::integer from logs where logs.day = days.d),
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
  with logs as (select * from public.session_log_rows(p_tz) where at > now() - interval '30 days')
  select pr.id, pr.username, pr.role, pr.score, pr.week_score, pr.week_start, pr.mastered_count,
    pr.study_streak, pr.best_study_streak, pr.live_wins, pr.live_played, pr.created_at,
    (select max(g.updated_at) from public.progress g where g.user_id = pr.id),
    (select count(*)::integer from public.mastery m where m.user_id = pr.id),
    (select count(*)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(logs.total), 0)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(logs.correct), 0)::integer from logs where logs.user_id = pr.id),
    (select coalesce(sum(u.calls), 0)::integer from public.ai_usage u where u.user_id = pr.id and u.day = current_date),
    (select coalesce(sum(u.calls), 0)::integer from public.ai_usage u where u.user_id = pr.id),
    (select count(*)::integer from public.reports rp where rp.user_id = pr.id)
  from public.profiles pr
  order by pr.score desc;
end;
$$;

create or replace function public.admin_player_detail(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'profile', (select to_jsonb(pr) from public.profiles pr where pr.id = p_user),
    'sessions', coalesce((select data -> 'sessionLogs' from public.progress where user_id = p_user and section = 'history'), '[]'::jsonb),
    'core', coalesce((select data - 'settings' from public.progress where user_id = p_user and section = 'core'), '{}'::jsonb),
    'mastery', coalesce((select jsonb_object_agg(item_key, stats) from public.mastery where user_id = p_user), '{}'::jsonb),
    'live', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' order by r.played_at desc) from (select * from public.live_results where user_id = p_user order by played_at desc limit 20) r), '[]'::jsonb),
    'ai_days', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'calls', calls) order by day) from public.ai_usage where user_id = p_user and day > current_date - 30), '[]'::jsonb)
  );
end;
$$;

-- How every player is doing on each word: the hardest words for the class.
create or replace function public.admin_word_stats()
returns table (item_key text, players integer, attempts integer, correct integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select m.item_key, count(*)::integer,
    coalesce(sum(case when (m.stats ->> 'total') ~ '^[0-9]+$' then (m.stats ->> 'total')::integer end), 0)::integer,
    coalesce(sum(case when (m.stats ->> 'correct') ~ '^[0-9]+$' then (m.stats ->> 'correct')::integer end), 0)::integer
  from public.mastery m
  group by m.item_key;
end;
$$;

create or replace function public.admin_live_matches(p_limit integer default 200)
returns table (room_code text, title text, played_at timestamptz, players integer, results jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select r.room_code, max(r.title), min(r.played_at), count(*)::integer,
    jsonb_agg(jsonb_build_object('username', p.username, 'rank', r.rank, 'points', r.points, 'correct', r.correct, 'total', r.total) order by r.rank)
  from public.live_results r
  join public.profiles p on p.id = r.user_id
  group by r.room_code, date_trunc('hour', r.played_at)
  order by min(r.played_at) desc
  limit greatest(1, least(p_limit, 1000));
end;
$$;

create or replace function public.admin_ai_usage(p_days integer default 30)
returns table (day date, username text, calls integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select u.day, p.username, u.calls
  from public.ai_usage u join public.profiles p on p.id = u.user_id
  where u.day > current_date - greatest(1, least(p_days, 366))
  order by u.day, p.username;
end;
$$;

-- ------------------------------------------------------------- actions
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_role not in ('admin', 'player') then raise exception 'role must be admin or player' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) and p_role <> 'admin' then raise exception 'you cannot remove your own admin role' using errcode = '42501'; end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target, details)
  values ((select auth.uid()), 'player.role', (select username from public.profiles where id = p_user), jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'Password must be 6-72 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target)
  values ((select auth.uid()), 'player.password', (select username from public.profiles where id = p_user));
end;
$$;

create or replace function public.admin_reset_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.progress where user_id = p_user;
  delete from public.mastery where user_id = p_user;
  update public.profiles set score = 0, week_score = 0, mastered_count = 0, study_streak = 0, updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target)
  values ((select auth.uid()), 'player.reset', (select username from public.profiles where id = p_user));
end;
$$;

create or replace function public.admin_delete_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := (select username from public.profiles where id = p_user);
begin
  perform public.require_admin();
  if p_user = (select auth.uid()) then raise exception 'you cannot delete your own account here' using errcode = '42501'; end if;
  delete from auth.users where id = p_user;
  insert into public.admin_audit (admin_id, action, target) values ((select auth.uid()), 'player.delete', v_name);
end;
$$;

-- Content saves leave a trail too.
create or replace function public.apply_content_changes(p_upserts jsonb, p_removes jsonb, p_level_order jsonb, p_note text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
  v_up integer := jsonb_array_length(coalesce(p_upserts, '[]'::jsonb));
  v_rm integer := jsonb_array_length(coalesce(p_removes, '[]'::jsonb));
begin
  if not public.is_admin() then
    raise exception 'only the admin can change content' using errcode = '42501';
  end if;
  insert into public.content_items (kind, key, data, position, deleted, updated_at)
  select u ->> 'kind', u ->> 'key', u -> 'data', coalesce((u ->> 'position')::integer, 0), false, now()
  from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) as u
  on conflict (kind, key) do update
    set data = excluded.data, position = excluded.position, deleted = false, updated_at = now();
  update public.content_items c
    set deleted = true, data = '{}'::jsonb, updated_at = now()
  from jsonb_array_elements(coalesce(p_removes, '[]'::jsonb)) as r
  where c.kind = r ->> 'kind' and c.key = r ->> 'key' and not c.deleted;
  update public.content_meta
    set level_order = coalesce(p_level_order, level_order),
        note = coalesce(p_note, note),
        version = version + 1,
        updated_at = now()
  where id = 1
  returning version into v_version;
  if v_up > 0 or v_rm > 0 then
    insert into public.admin_audit (admin_id, action, target, details)
    values ((select auth.uid()), 'content.save', null, jsonb_build_object(
      'changed', v_up, 'removed', v_rm, 'version', v_version,
      'sample', (select coalesce(jsonb_agg(e.value ->> 'key'), '[]'::jsonb) from (select value from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) limit 5) e)));
  end if;
  return v_version;
end;
$$;

-- Only signed-in callers reach these; each one checks for the admin itself.
do $$
declare f text;
begin
  foreach f in array array[
    'public.require_admin()', 'public.session_log_rows(text)', 'public.admin_overview()', 'public.admin_activity(integer, text)',
    'public.admin_players(text)', 'public.admin_player_detail(uuid)', 'public.admin_word_stats()', 'public.admin_live_matches(integer)',
    'public.admin_ai_usage(integer)', 'public.admin_set_role(uuid, text)', 'public.admin_set_password(uuid, text)',
    'public.admin_reset_player(uuid)', 'public.admin_delete_player(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- The raw session-log helper is internal: not callable over the API.
revoke execute on function public.session_log_rows(text) from authenticated;
