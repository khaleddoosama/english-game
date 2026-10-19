-- Rollback of migration 0043 (signals sent by the database): removes its triggers, their functions and the policy
-- for personal topics. Run in one transaction:  psql "$URL" -1 -f supabase/rollback/0043_down.sql
--
-- What it cannot undo: signals already sent stay in realtime.messages until Supabase deletes them (after 3 days);
-- nobody can read the personal ones any more. The browsers keep sending their own Live signals, and friend requests
-- and invitations go back to the 30-45 s checks.
drop trigger if exists live_players_signal on public.live_players;
drop trigger if exists live_challenges_signal on public.live_challenges;
drop trigger if exists friendships_signal on public.friendships;
drop trigger if exists live_invites_signal on public.live_invites;
drop function if exists public.live_player_signal();
drop function if exists public.live_challenge_signal();
drop function if exists public.friendship_signal();
drop function if exists public.live_invite_signal();
drop policy if exists "players read their own signals" on realtime.messages;
