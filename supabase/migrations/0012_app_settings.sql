-- App-wide settings the admin controls from Admin -> Settings. One row of
-- JSON that everyone can read (the sign-in page needs "sign-ups open" and
-- the maintenance message); only admin_save_settings writes it, and it
-- validates every value. The rules that matter are enforced here too:
-- sign-ups (register_player), AI and voice for players and the daily AI
-- limit (ai_gate), and who may create Live challenges and how big they
-- can be (live_create).

create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.app_settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
create policy "everyone reads app settings" on public.app_settings for select to anon, authenticated using (true);

create or replace function public.app_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select data -> p_key from public.app_settings where id = 1; $$;

create or replace function public.admin_save_settings(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb := coalesce(p_data, '{}'::jsonb);
  nd jsonb := coalesce(p_data -> 'newPlayerDefaults', '{}'::jsonb);
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
begin
  perform public.require_admin();
  select data into v_old from public.app_settings where id = 1 for update;
  v_new := jsonb_build_object(
    'signupsOpen', coalesce((d ->> 'signupsOpen')::boolean, true),
    'maintenance', coalesce((d ->> 'maintenance')::boolean, false),
    'maintenanceMessage', left(coalesce(d ->> 'maintenanceMessage', ''), 500),
    'announcement', left(coalesce(d ->> 'announcement', ''), 500),
    'announcementTone', case when d ->> 'announcementTone' in ('info', 'success', 'warning') then d ->> 'announcementTone' else 'info' end,
    'aiForPlayers', coalesce((d ->> 'aiForPlayers')::boolean, true),
    'aiDailyLimit', greatest(0, least(coalesce((d ->> 'aiDailyLimit')::integer, 150), 2000)),
    'ttsForPlayers', coalesce((d ->> 'ttsForPlayers')::boolean, true),
    'liveCreate', case when d ->> 'liveCreate' = 'admin' then 'admin' else 'everyone' end,
    'liveMaxPlayers', greatest(2, least(coalesce((d ->> 'liveMaxPlayers')::integer, 10), 10)),
    'liveDefaultQuestions', greatest(5, least(coalesce((d ->> 'liveDefaultQuestions')::integer, 10), 30)),
    'liveDefaultSeconds', case when (d ->> 'liveDefaultSeconds')::integer in (0, 10, 15, 20, 30, 45, 60) then (d ->> 'liveDefaultSeconds')::integer else 20 end,
    'liveMaxHours', greatest(1, least(coalesce((d ->> 'liveMaxHours')::integer, 168), 168)),
    'leaderboard', coalesce((d ->> 'leaderboard')::boolean, true),
    'newPlayerDefaults', jsonb_build_object(
      'questionsPerRound', greatest(4, least(coalesce((nd ->> 'questionsPerRound')::integer, 12), 30)),
      'newWordsPerRound', greatest(0, least(coalesce((nd ->> 'newWordsPerRound')::integer, 3), 10)),
      'dailyGoal', greatest(5, least(coalesce((nd ->> 'dailyGoal')::integer, 20), 100)),
      'sound', coalesce((nd ->> 'sound')::boolean, true),
      'enablePairModes', coalesce((nd ->> 'enablePairModes')::boolean, true)
    )
  );
  update public.app_settings set data = v_new, updated_at = now(), updated_by = (select auth.uid()) where id = 1;
  v_changes := public.jsonb_changes(v_old, v_new);
  if v_changes <> '{}'::jsonb then
    insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
    values ((select auth.uid()), 'settings.update', 'App settings', 'settings', 'app', v_changes);
  end if;
  return v_new;
end;
$$;

-- --------------------------------------------------------- enforcement
create or replace function public.register_player(p_username text, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(p_username));
  v_email text;
  v_id uuid := gen_random_uuid();
begin
  if not coalesce((public.app_setting('signupsOpen'))::boolean, true) then
    raise exception 'New accounts are closed right now. Ask the admin for an account.' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 letters, numbers or _' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then
    raise exception 'Password must be 6-72 characters' using errcode = '22023';
  end if;
  v_email := v_username || '@wordhunter.test';
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where email = v_email) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;
  if (select count(*) from auth.users where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Too many sign-ups right now, try again in a few minutes' using errcode = '54000';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', v_username), now(), now(),
    '', '', '', '');
  insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', v_id::text, now(), now(), now());
end;
$$;

-- p_kind: 'ai' (text tasks) or 'tts' (pronunciation). The admin's daily
-- limit from settings wins over the server's default.
drop function if exists public.ai_gate(boolean, integer);
create or replace function public.ai_gate(p_admin_only boolean default false, p_daily_limit integer default 150, p_kind text default 'ai')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_calls integer;
  v_limit integer := coalesce((public.app_setting('aiDailyLimit'))::integer, p_daily_limit);
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  select role = 'admin' into v_admin from public.profiles where id = v_user;
  v_admin := coalesce(v_admin, false);
  if p_admin_only and not v_admin then
    return jsonb_build_object('ok', false, 'reason', 'admin', 'admin', false);
  end if;
  if not v_admin and not coalesce((public.app_setting(case when p_kind = 'tts' then 'ttsForPlayers' else 'aiForPlayers' end))::boolean, true) then
    return jsonb_build_object('ok', false, 'reason', 'off', 'kind', p_kind, 'admin', false);
  end if;
  insert into public.ai_usage (user_id, day, calls) values (v_user, current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into v_calls;
  if not v_admin and v_calls > v_limit then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'admin', false, 'calls', v_calls, 'limit', v_limit);
  end if;
  return jsonb_build_object('ok', true, 'admin', v_admin, 'calls', v_calls, 'limit', v_limit);
end;
$$;

create or replace function public.live_create(
  p_title text, p_seconds integer, p_max_players integer, p_start_mode text,
  p_settings jsonb, p_questions jsonb, p_hours integer default 24
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_n integer := jsonb_array_length(coalesce(p_questions, '[]'::jsonb));
  v_chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_bad integer;
  v_admin boolean := public.is_admin();
  v_cap integer := coalesce((public.app_setting('liveMaxPlayers'))::integer, 10);
  v_max_hours integer := coalesce((public.app_setting('liveMaxHours'))::integer, 168);
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not v_admin and coalesce(public.app_setting('liveCreate') #>> '{}', 'everyone') = 'admin' then
    raise exception 'Only the admin can create challenges right now. You can still join one.' using errcode = '42501';
  end if;
  if v_n < 3 or v_n > 50 then raise exception 'A challenge needs 3 to 50 questions.' using errcode = '22023'; end if;
  if p_max_players is null or p_max_players < 2 or p_max_players > 10 then raise exception 'A challenge is for 2 to 10 players.' using errcode = '22023'; end if;
  if not v_admin and p_max_players > v_cap then raise exception 'Challenges are limited to % players.', v_cap using errcode = '22023'; end if;
  if p_start_mode not in ('together', 'anytime') then raise exception 'Unknown start mode.' using errcode = '22023'; end if;
  if length(p_questions::text) > 400000 then raise exception 'These questions are too large.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_questions) q
  where jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') < 2 or jsonb_array_length(q -> 'options') > 8
     or coalesce(q ->> 'prompt', '') = '' or coalesce(q ->> 'answer', '') = ''
     or not exists (select 1 from jsonb_array_elements_text(q -> 'options') o where lower(btrim(o)) = lower(btrim(q ->> 'answer')));
  if v_bad > 0 then raise exception 'Every question needs a prompt, 2-8 options and its answer among them.' using errcode = '22023'; end if;
  delete from public.live_challenges where host_id = v_me and created_at < now() - interval '30 days';
  for i in 1..10 loop
    v_code := (select string_agg(substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.live_challenges where code = v_code);
    v_code := null;
  end loop;
  if v_code is null then raise exception 'Couldn''t find a free code. Try again.'; end if;
  insert into public.live_challenges (code, host_id, title, question_count, seconds, max_players, start_mode, settings, questions, state, started_at, expires_at)
  values (
    v_code, v_me, left(coalesce(nullif(btrim(p_title), ''), 'Live Challenge'), 120), v_n, coalesce(p_seconds, 0), p_max_players, p_start_mode,
    coalesce(p_settings, '{}'::jsonb),
    (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('mode', q -> 'mode', 'prompt', q -> 'prompt', 'options', q -> 'options', 'picture', q -> 'picture', 'photo', q -> 'photo')) order by n)
       from jsonb_array_elements(p_questions) with ordinality as t(q, n)),
    case when p_start_mode = 'anytime' then 'playing' else 'lobby' end,
    case when p_start_mode = 'anytime' then now() end,
    now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), case when v_admin then 168 else v_max_hours end)))
  );
  insert into public.live_answer_keys (code, answers)
  values (v_code, (select jsonb_agg(jsonb_build_object('answer', q -> 'answer', 'word', q -> 'word', 'explanation', q -> 'explanation', 'sentences', coalesce(q -> 'sentences', '[]'::jsonb)) order by n)
                    from jsonb_array_elements(p_questions) with ordinality as t(q, n)));
  insert into public.live_players (code, user_id) values (v_code, v_me);
  return v_code;
end;
$$;

revoke execute on function public.app_setting(text) from public, anon, authenticated;
revoke execute on function public.admin_save_settings(jsonb) from public, anon;
grant execute on function public.admin_save_settings(jsonb) to authenticated;
revoke execute on function public.ai_gate(boolean, integer, text) from public, anon;
grant execute on function public.ai_gate(boolean, integer, text) to authenticated;
revoke execute on function public.register_player(text, text) from public, authenticated;
grant execute on function public.register_player(text, text) to anon;
revoke execute on function public.live_create(text, integer, integer, text, jsonb, jsonb, integer) from public, anon;
grant execute on function public.live_create(text, integer, integer, text, jsonb, jsonb, integer) to authenticated;
notify pgrst, 'reload schema';
