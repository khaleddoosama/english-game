-- Ranks (Admin -> Settings -> Ranks). With the leaderboard turned off,
-- players can read only their own profile row, so the scores and ranks of
-- others can't be fetched at all, not just hidden in the app. The admin
-- always sees every profile. Live challenges and the admin pages read
-- usernames through security definer functions and aren't affected.

create or replace function public.leaderboard_visible()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (data ->> 'leaderboard')::boolean from public.app_settings where id = 1), true);
$$;
revoke execute on function public.leaderboard_visible() from public, anon;
grant execute on function public.leaderboard_visible() to authenticated;

drop policy if exists "profiles are visible to players" on public.profiles;
create policy "profiles are visible to players"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.leaderboard_visible()) or (select public.is_admin()));
