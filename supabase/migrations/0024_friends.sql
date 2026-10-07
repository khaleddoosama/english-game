-- Friends, and invitations to Live challenges:
--  - a player asks another by username and the other accepts or declines.
--    A decline keeps the pair for a week, so the same person can't keep
--    asking; asking someone who already asked you means yes;
--  - friends see each other's summary numbers (the same ones the leaderboard
--    shows) and can invite each other to a Live challenge;
--  - a player reads only their own rows; everything is written through
--    functions that check who is asking.
-- Limits: 100 friends, 20 requests waiting for an answer, 20 invitations a call.

create table public.friendships (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b),                       -- one row per pair, whoever asked
  check (requested_by in (user_a, user_b))
);
create index friendships_b_idx on public.friendships (user_b, status);
alter table public.friendships enable row level security;
create policy "players read their own friendships" on public.friendships
  for select to authenticated using ((select auth.uid()) in (user_a, user_b));

create table public.live_invites (
  code text not null references public.live_challenges (code) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,   -- who is invited
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  dismissed boolean not null default false,
  primary key (code, user_id)
);
create index live_invites_user_idx on public.live_invites (user_id, created_at desc);
alter table public.live_invites enable row level security;
create policy "invitees and inviters read invitations" on public.live_invites
  for select to authenticated using ((select auth.uid()) in (user_id, invited_by));

-- ---------------------------------------------------------------- helpers
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.friendships where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b) and status = 'accepted');
$$;

create or replace function public.friend_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.friendships where status = 'accepted' and p_user in (user_a, user_b);
$$;

-- ---------------------------------------------------------------- friends
create or replace function public.friend_request(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text := lower(btrim(coalesce(p_username, '')));
  t public.profiles;
  f public.friendships;
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from public.profiles where username = v_name;
  if not found then raise exception 'No player is called "%". Check the spelling.', v_name using errcode = 'P0002'; end if;
  if t.id = v_me then raise exception 'That is you.' using errcode = '22023'; end if;
  v_a := least(v_me, t.id);
  v_b := greatest(v_me, t.id);
  select * into f from public.friendships where user_a = v_a and user_b = v_b for update;
  if found then
    if f.status = 'accepted' then raise exception 'You are already friends with %.', t.username using errcode = '55000'; end if;
    if f.status = 'pending' then
      if f.requested_by = v_me then raise exception 'You already asked %. Waiting for them to answer.', t.username using errcode = '55000'; end if;
      -- They asked first, so asking back is a yes.
      if public.friend_count(v_me) >= 100 then raise exception 'You have 100 friends, the most there can be.' using errcode = '55000'; end if;
      if public.friend_count(t.id) >= 100 then raise exception '% has too many friends to add more.', t.username using errcode = '55000'; end if;
      update public.friendships set status = 'accepted', updated_at = now() where user_a = v_a and user_b = v_b;
      return jsonb_build_object('status', 'accepted', 'id', t.id, 'username', t.username);
    end if;
    if f.requested_by = v_me and f.updated_at > now() - interval '7 days' then
      raise exception '% did not accept your request. You can ask again after a week.', t.username using errcode = '55000';
    end if;
  end if;
  if public.friend_count(v_me) >= 100 then raise exception 'You have 100 friends, the most there can be.' using errcode = '55000'; end if;
  if public.friend_count(t.id) >= 100 then raise exception '% has too many friends to add more.', t.username using errcode = '55000'; end if;
  if (select count(*) from public.friendships where status = 'pending' and requested_by = v_me) >= 20 then
    raise exception 'You have 20 requests waiting for an answer. Wait for some of them first.' using errcode = '55000';
  end if;
  insert into public.friendships (user_a, user_b, requested_by, status)
  values (v_a, v_b, v_me, 'pending')
  on conflict (user_a, user_b) do update set requested_by = v_me, status = 'pending', created_at = now(), updated_at = now();
  return jsonb_build_object('status', 'pending', 'id', t.id, 'username', t.username);
end;
$$;

create or replace function public.friend_respond(p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  f public.friendships;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into f from public.friendships
    where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) for update;
  if not found or f.status <> 'pending' or f.requested_by <> p_user then
    raise exception 'There is no request from this player.' using errcode = 'P0002';
  end if;
  if p_accept then
    if public.friend_count(v_me) >= 100 then raise exception 'You have 100 friends, the most there can be.' using errcode = '55000'; end if;
    if public.friend_count(p_user) >= 100 then raise exception 'This player has too many friends to add more.' using errcode = '55000'; end if;
    update public.friendships set status = 'accepted', updated_at = now() where user_a = f.user_a and user_b = f.user_b;
  else
    update public.friendships set status = 'declined', updated_at = now() where user_a = f.user_a and user_b = f.user_b;
  end if;
end;
$$;

-- Ends a friendship, or takes back a request I sent. Nothing to remove is fine.
create or replace function public.friend_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  delete from public.friendships
    where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user)
      and (status = 'accepted' or (status = 'pending' and requested_by = v_me));
end;
$$;

-- Friends with their summary numbers, then the requests to me and from me.
create or replace function public.friends_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'username', p.username, 'score', p.score, 'week_score', p.week_score, 'week_start', p.week_start,
        'mastered_count', p.mastered_count, 'study_streak', p.study_streak, 'live_wins', p.live_wins, 'live_played', p.live_played,
        'since', f.updated_at) order by p.username)
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_me then f.user_b else f.user_a end
      where f.status = 'accepted' and v_me in (f.user_a, f.user_b)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f
      join public.profiles p on p.id = f.requested_by
      where f.status = 'pending' and f.requested_by <> v_me and v_me in (f.user_a, f.user_b)), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_me then f.user_b else f.user_a end
      where f.status = 'pending' and f.requested_by = v_me), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------ invitations
-- A member of a challenge that can still be joined invites friends to it.
create or replace function public.live_invite_friends(p_code text, p_users uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_me uuid := (select auth.uid());
  c public.live_challenges;
  v_user uuid;
  v_invited integer := 0;
  v_rows integer;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform public.live_settle(v_code);
  select * into c from public.live_challenges where code = v_code;
  if not found then raise exception 'No challenge with this code.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.live_players where code = v_code and user_id = v_me) then
    raise exception 'Join the challenge first.' using errcode = '42501';
  end if;
  if c.state = 'done' then raise exception 'This challenge has already ended.' using errcode = '55000'; end if;
  if c.start_mode = 'together' and c.state <> 'lobby' then raise exception 'This challenge has already started.' using errcode = '55000'; end if;
  if coalesce(array_length(p_users, 1), 0) > 20 then raise exception 'Invite up to 20 friends at a time.' using errcode = '22023'; end if;
  foreach v_user in array coalesce(p_users, '{}'::uuid[]) loop
    if v_user = v_me then
      v_skipped := v_skipped || jsonb_build_object('id', v_user, 'reason', 'you');
    elsif not public.are_friends(v_me, v_user) then
      v_skipped := v_skipped || jsonb_build_object('id', v_user, 'reason', 'not a friend');
    elsif exists (select 1 from public.live_players where code = v_code and user_id = v_user) then
      v_skipped := v_skipped || jsonb_build_object('id', v_user, 'reason', 'already in');
    else
      insert into public.live_invites (code, user_id, invited_by) values (v_code, v_user, v_me)
      on conflict (code, user_id) do update set invited_by = v_me, dismissed = false, created_at = now()
        where public.live_invites.dismissed;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_invited := v_invited + 1;
      else v_skipped := v_skipped || jsonb_build_object('id', v_user, 'reason', 'already invited');
      end if;
    end if;
  end loop;
  return jsonb_build_object('invited', v_invited, 'skipped', v_skipped);
end;
$$;

-- My open invitations: from a friend, to a challenge I can still join.
create or replace function public.live_my_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'title', c.title, 'from', pr.username, 'from_id', i.invited_by,
      'question_count', c.question_count, 'seconds', c.seconds, 'max_players', c.max_players,
      'players', (select count(*) from public.live_players q where q.code = c.code),
      'start_mode', c.start_mode, 'state', c.state, 'invited_at', i.created_at, 'expires_at', c.expires_at) order by i.created_at desc)
    from public.live_invites i
    join public.live_challenges c on c.code = i.code
    join public.profiles pr on pr.id = i.invited_by
    where i.user_id = v_me and not i.dismissed
      and c.state <> 'done' and c.expires_at > now()
      and (c.start_mode = 'anytime' or c.state = 'lobby')
      and (select count(*) from public.live_players q where q.code = c.code) < c.max_players
      and not exists (select 1 from public.live_players q where q.code = c.code and q.user_id = v_me)
      and public.are_friends(i.invited_by, v_me)), '[]'::jsonb);
end;
$$;

create or replace function public.live_invite_dismiss(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update public.live_invites set dismissed = true where code = upper(btrim(coalesce(p_code, ''))) and user_id = v_me;
end;
$$;

-- Who has been invited to this challenge (for the members, to show "Invited").
create or replace function public.live_invites_sent(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.live_players where code = v_code and user_id = v_me) then
    raise exception 'Join the challenge first.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(user_id) from public.live_invites where code = v_code and not dismissed), '[]'::jsonb);
end;
$$;

-- Two numbers for the navigation badges.
create or replace function public.social_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'requests', (select count(*) from public.friendships where status = 'pending' and requested_by <> v_me and v_me in (user_a, user_b)),
    'invites', jsonb_array_length(public.live_my_invites()));
end;
$$;

-- Players call these; the helpers stay inside the database.
do $$
declare f text;
begin
  foreach f in array array[
    'public.friend_request(text)', 'public.friend_respond(uuid, boolean)', 'public.friend_remove(uuid)', 'public.friends_list()',
    'public.live_invite_friends(text, uuid[])', 'public.live_my_invites()', 'public.live_invite_dismiss(text)',
    'public.live_invites_sent(text)', 'public.social_counts()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.are_friends(uuid, uuid)', 'public.friend_count(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
