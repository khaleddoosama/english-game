-- Sign-ups (review F13). A limit per network the admin can change (Admin
-- -> Settings -> New accounts per network, default 30 in 10 minutes, so a
-- class on one school network isn't stopped), a fixed overall limit of 200
-- in 10 minutes, and one sign-up at a time so neither can be raced past.
-- A new account is always a player: the role never comes from the request.
-- The network is told apart by the address the request came from, kept
-- only as a hash and only for a day.

create table if not exists public.signup_log (
  at timestamptz not null default now(),
  ip_hash text
);
create index if not exists signup_log_ip_idx on public.signup_log (ip_hash, at);
alter table public.signup_log enable row level security;
-- No policies: only register_player uses it.

-- The caller's address, as the API gateway passed it on (best effort).
create or replace function public.request_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb;
begin
  h := nullif(current_setting('request.headers', true), '')::jsonb;
  return coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''), nullif(btrim(h ->> 'x-real-ip'), ''), nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''));
exception when others then
  return null;
end;
$$;
revoke execute on function public.request_ip() from public, anon, authenticated;

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
  v_ip text := public.request_ip();
  v_per_network integer := greatest(5, least(coalesce((public.app_setting('signupsPer10Min'))::integer, 30), 200));
begin
  -- One sign-up at a time, so the limits below can't be raced past.
  perform pg_advisory_xact_lock(hashtext('public.register_player'));
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
  if v_ip is not null and (select count(*) from public.signup_log where ip_hash = md5(v_ip) and at > now() - interval '10 minutes') >= v_per_network then
    raise exception 'Too many new accounts from this network. Try again in a few minutes, or ask the admin.' using errcode = '54000';
  end if;
  if (select count(*) from auth.users where created_at > now() - interval '10 minutes') >= 200 then
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
  delete from public.signup_log where at < now() - interval '1 day';
  if v_ip is not null then insert into public.signup_log (ip_hash) values (md5(v_ip)); end if;
end;
$$;

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
    'signupsPer10Min', greatest(5, least(coalesce((d ->> 'signupsPer10Min')::integer, 30), 200)),
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
