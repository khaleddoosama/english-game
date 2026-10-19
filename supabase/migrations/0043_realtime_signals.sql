-- Live and social signals sent by the database (Supabase Realtime, "Broadcast from the database").
--
-- Why: the signals that tell other players "something changed" were sent by the players' browsers only. A signal
-- lost with a browser (closed, offline at that moment) was not sent again, and the others waited for their next
-- poll (up to 20 s in a challenge). Friend requests and Live invitations had no signal at all: they waited for the
-- 30-45 s checks.
--
-- What: triggers send small signals with realtime.send() on private topics, after the change is written:
--  * live_players, on live:<code>: a row added -> "joined" {user_id}; removed -> "left" {user_id}; a change of
--    started_at, answered, correct, total_ms or finished_at -> "progress" (those numbers and the user_id).
--  * live_challenges, on live:<code>: lobby -> playing "start"; -> done "end"; a rematch linked (settings.next_code)
--    -> "rematch" {next_code}.
--  * friendships, on user:<id> of both players: a new row or a change of status or asker -> "friends" {}.
--  * live_invites, on user:<id> of the invited player: a new invitation (or one sent again after a dismissal)
--    -> "invite" {}.
-- Signals carry no question, option, answer or username. The topics are private: live:<code> is read only by the
-- challenge's members (policy "members use live channels", migration 0008); user:<id> only by that player (policy
-- below). Nobody may send on user:<id> (no insert policy), so only these triggers do.
--
-- Compatibility: the names and payloads are the ones the browsers already send, so a client that still sends its
-- own signals gets duplicates, which are harmless (a "progress" older than the row is ignored; any other signal makes
-- the screen ask the server again). A client without the personal channel keeps polling as before. realtime.send()
-- never fails the caller (an error is a warning), so a signal cannot break an answer, a join or a request.
-- Cost: each broadcast counts as 1 message plus 1 per player receiving it (Supabase pricing).
-- Rollback: supabase/rollback/0043_down.sql.

create or replace function public.live_player_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(jsonb_build_object('user_id', new.user_id), 'joined', 'live:' || new.code, true);
  elsif tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('user_id', old.user_id), 'left', 'live:' || old.code, true);
  elsif (new.started_at, new.answered, new.correct, new.total_ms, new.finished_at)
        is distinct from (old.started_at, old.answered, old.correct, old.total_ms, old.finished_at) then
    perform realtime.send(jsonb_build_object('user_id', new.user_id, 'answered', new.answered, 'correct', new.correct,
      'total_ms', new.total_ms, 'started_at', new.started_at, 'finished_at', new.finished_at), 'progress', 'live:' || new.code, true);
  end if;
  return null;
end;
$$;
revoke all on function public.live_player_signal() from public, anon, authenticated;
drop trigger if exists live_players_signal on public.live_players;
create trigger live_players_signal after insert or update or delete on public.live_players
  for each row execute function public.live_player_signal();

create or replace function public.live_challenge_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'lobby' and new.state = 'playing' then
    perform realtime.send('{}'::jsonb, 'start', 'live:' || new.code, true);
  end if;
  if old.state <> 'done' and new.state = 'done' then
    perform realtime.send('{}'::jsonb, 'end', 'live:' || new.code, true);
  end if;
  if new.settings ->> 'next_code' is not null and new.settings ->> 'next_code' is distinct from old.settings ->> 'next_code' then
    perform realtime.send(jsonb_build_object('next_code', new.settings ->> 'next_code'), 'rematch', 'live:' || new.code, true);
  end if;
  return null;
end;
$$;
revoke all on function public.live_challenge_signal() from public, anon, authenticated;
drop trigger if exists live_challenges_signal on public.live_challenges;
create trigger live_challenges_signal after update on public.live_challenges
  for each row execute function public.live_challenge_signal();

create or replace function public.friendship_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.status, new.requested_by) is distinct from (old.status, old.requested_by) then
    perform realtime.send('{}'::jsonb, 'friends', 'user:' || new.user_a, true);
    perform realtime.send('{}'::jsonb, 'friends', 'user:' || new.user_b, true);
  end if;
  return null;
end;
$$;
revoke all on function public.friendship_signal() from public, anon, authenticated;
drop trigger if exists friendships_signal on public.friendships;
create trigger friendships_signal after insert or update on public.friendships
  for each row execute function public.friendship_signal();

create or replace function public.live_invite_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.dismissed and (tg_op = 'INSERT' or old.dismissed) then
    perform realtime.send('{}'::jsonb, 'invite', 'user:' || new.user_id, true);
  end if;
  return null;
end;
$$;
revoke all on function public.live_invite_signal() from public, anon, authenticated;
drop trigger if exists live_invites_signal on public.live_invites;
create trigger live_invites_signal after insert or update on public.live_invites
  for each row execute function public.live_invite_signal();

-- A player reads only their own personal topic (and sends on none).
drop policy if exists "players read their own signals" on realtime.messages;
create policy "players read their own signals" on realtime.messages for select to authenticated
  using (realtime.topic() = 'user:' || (select auth.uid())::text);
