-- Word Hunter schema: accounts, shared content, per-player progress,
-- live challenge results. Every table has RLS; the admin role is the only
-- one that writes content.

-- ---------------------------------------------------------------- accounts
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  role text not null default 'player' check (role in ('admin', 'player')),
  -- Leaderboard summary, refreshed by the player's own progress saves.
  score integer not null default 0,
  mastered_count integer not null default 0,
  study_streak integer not null default 0,
  best_study_streak integer not null default 0,
  week_start date,
  week_score integer not null default 0,
  live_wins integer not null default 0,
  live_played integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

-- New auth user -> profile. The username comes from sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles are visible to players"
  on public.profiles for select to authenticated using (true);
create policy "players update their own stats"
  on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Only the stat columns are writable; username and role are not.
revoke update on public.profiles from authenticated, anon;
grant update (score, mastered_count, study_streak, best_study_streak, week_start, week_score, updated_at)
  on public.profiles to authenticated;

-- ----------------------------------------------------------------- content
create table public.content_items (
  kind text not null check (kind in ('words', 'grammar', 'challenges', 'stories', 'combos')),
  key text not null,
  data jsonb not null,
  position integer not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
);
create index content_items_updated_at_idx on public.content_items (updated_at);
alter table public.content_items enable row level security;

create table public.content_meta (
  id smallint primary key default 1 check (id = 1),
  level_order jsonb not null default '[]'::jsonb,
  note text not null default '',
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.content_meta (id) values (1);
alter table public.content_meta enable row level security;

create policy "content is readable by players"
  on public.content_items for select to authenticated using (true);
create policy "admin writes content"
  on public.content_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "content meta is readable by players"
  on public.content_meta for select to authenticated using (true);
create policy "admin writes content meta"
  on public.content_meta for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- One round trip per content save: upsert changed items, tombstone removed
-- ones, bump the version clients compare their cache against.
create or replace function public.apply_content_changes(p_upserts jsonb, p_removes jsonb, p_level_order jsonb, p_note text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
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
  return v_version;
end;
$$;

-- ---------------------------------------------------------------- progress
-- Progress is stored in sections (core, session, pools, seen, ...) so a save
-- only rewrites the sections that changed.
create table public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  section text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, section)
);
alter table public.progress enable row level security;

create table public.mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_key text not null,
  stats jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table public.mastery enable row level security;

create policy "players own their progress"
  on public.progress for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "players own their mastery"
  on public.mastery for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- One round trip per progress save: changed sections, changed and removed
-- mastery records, and the leaderboard summary.
create or replace function public.save_progress(p_sections jsonb, p_mastery jsonb, p_mastery_removes text[], p_profile jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.progress (user_id, section, data, updated_at)
  select v_user, s.key, s.value, now()
  from jsonb_each(coalesce(p_sections, '{}'::jsonb)) as s
  on conflict (user_id, section) do update set data = excluded.data, updated_at = now();
  insert into public.mastery (user_id, item_key, stats, updated_at)
  select v_user, m.key, m.value, now()
  from jsonb_each(coalesce(p_mastery, '{}'::jsonb)) as m
  on conflict (user_id, item_key) do update set stats = excluded.stats, updated_at = now();
  if p_mastery_removes is not null and array_length(p_mastery_removes, 1) > 0 then
    delete from public.mastery where user_id = v_user and item_key = any (p_mastery_removes);
  end if;
  if p_profile is not null then
    update public.profiles set
      score = coalesce((p_profile ->> 'score')::integer, score),
      mastered_count = coalesce((p_profile ->> 'mastered_count')::integer, mastered_count),
      study_streak = coalesce((p_profile ->> 'study_streak')::integer, study_streak),
      best_study_streak = coalesce((p_profile ->> 'best_study_streak')::integer, best_study_streak),
      week_start = coalesce((p_profile ->> 'week_start')::date, week_start),
      week_score = coalesce((p_profile ->> 'week_score')::integer, week_score),
      updated_at = now()
    where id = v_user;
  end if;
end;
$$;

-- Wipes the caller's own progress (Reset progress in Admin / Profile).
create or replace function public.reset_my_progress()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.progress where user_id = (select auth.uid());
  delete from public.mastery where user_id = (select auth.uid());
  update public.profiles set score = 0, mastered_count = 0, study_streak = 0, week_score = 0, updated_at = now()
  where id = (select auth.uid());
$$;

-- ------------------------------------------------------------------ reports
-- Question reports from every player, so the admin sees them all.
create table public.reports (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy "players file reports"
  on public.reports for insert to authenticated with check (user_id = (select auth.uid()));
create policy "players see their reports, admin sees all"
  on public.reports for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "players withdraw their reports, admin manages all"
  on public.reports for delete to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "admin updates reports"
  on public.reports for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- -------------------------------------------------------------------- live
create table public.live_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{4}$'),
  host_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  seconds integer not null check (seconds between 5 and 60),
  questions jsonb not null,
  state text not null default 'lobby' check (state in ('lobby', 'playing', 'done')),
  created_at timestamptz not null default now()
);
alter table public.live_rooms enable row level security;
create policy "players see rooms" on public.live_rooms for select to authenticated using (true);
create policy "hosts create rooms" on public.live_rooms for insert to authenticated with check (host_id = (select auth.uid()));
create policy "hosts update rooms" on public.live_rooms for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy "hosts delete rooms" on public.live_rooms for delete to authenticated using (host_id = (select auth.uid()));

create table public.live_results (
  room_code text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  points integer not null,
  correct integer not null,
  total integer not null,
  rank integer not null,
  players integer not null,
  played_at timestamptz not null default now(),
  primary key (room_code, user_id, played_at)
);
create index live_results_user_idx on public.live_results (user_id, played_at desc);
alter table public.live_results enable row level security;
create policy "players see live results" on public.live_results for select to authenticated using (true);
create policy "players record their own result" on public.live_results for insert to authenticated
  with check (user_id = (select auth.uid()));

-- A finished match bumps the player's live counters.
create or replace function public.bump_live_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set live_played = live_played + 1,
        live_wins = live_wins + case when new.rank = 1 and new.players > 1 then 1 else 0 end
  where id = new.user_id;
  return new;
end;
$$;
create trigger on_live_result
  after insert on public.live_results
  for each row execute function public.bump_live_counters();

-- Live rooms talk over private Realtime channels: signed-in players only.
create policy "players use live channels"
  on realtime.messages for select to authenticated
  using (realtime.topic() like 'live:%');
create policy "players send on live channels"
  on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'live:%');

-- ----------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('word-images', 'word-images', true, 2097152, array['image/webp', 'image/jpeg', 'image/png', 'image/gif']),
  ('tts', 'tts', true, 4194304, array['audio/wav', 'audio/mpeg', 'audio/ogg'])
on conflict (id) do nothing;

create policy "admin uploads word images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'word-images' and (select public.is_admin()));
create policy "admin replaces word images"
  on storage.objects for update to authenticated
  using (bucket_id = 'word-images' and (select public.is_admin()));
create policy "admin deletes word images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'word-images' and (select public.is_admin()));
-- Pronunciation audio is generated server-side on a player's request and
-- cached; players may add files but never replace or delete them.
create policy "players cache pronunciation audio"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'tts' and name like 'v1/%');

-- Signed-out visitors call nothing.
revoke execute on function public.is_admin() from anon, public;
revoke execute on function public.apply_content_changes(jsonb, jsonb, jsonb, text) from anon, public;
revoke execute on function public.save_progress(jsonb, jsonb, text[], jsonb) from anon, public;
revoke execute on function public.reset_my_progress() from anon, public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.apply_content_changes(jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.save_progress(jsonb, jsonb, text[], jsonb) to authenticated;
grant execute on function public.reset_my_progress() to authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.bump_live_counters() from anon, authenticated, public;
