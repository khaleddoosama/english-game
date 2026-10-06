-- Live Challenge results and rematch:
--  - live_view returns every player's answers (all_answers) once the
--    challenge is done, and never before, so a player can see what each
--    opponent chose without anyone seeing it mid-game;
--  - live_set_next lets a player who made a new challenge from the results
--    ("Retry challenge") leave its code on the old one, so the others get a
--    "Join the new challenge" button instead of being sent a link again.
--    The first one to do it wins; only members of the old challenge see it.

create or replace function public.live_view(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_me uuid := (select auth.uid());
  c public.live_challenges;
  p public.live_players;
  v_member boolean;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform public.live_settle(v_code);
  select * into c from public.live_challenges where code = v_code;
  if not found then raise exception 'No challenge with this code. Check the link or the code.' using errcode = 'P0002'; end if;
  select * into p from public.live_players where code = c.code and user_id = v_me;
  v_member := found;
  return jsonb_build_object(
    'code', c.code, 'title', c.title, 'host_id', c.host_id,
    'host', (select username from public.profiles where id = c.host_id),
    'question_count', c.question_count, 'seconds', c.seconds, 'max_players', c.max_players,
    'start_mode', c.start_mode, 'state', c.state,
    -- The rematch link is for the people who played, not for anyone with the code.
    'settings', case when v_member then c.settings else c.settings - 'next_code' - 'next_by' end,
    'created_at', c.created_at, 'started_at', c.started_at, 'ended_at', c.ended_at, 'expires_at', c.expires_at,
    'now', now(), 'member', v_member,
    'questions', case
      when not v_member then null
      when c.state = 'done' then c.questions
      when p.started_at is null then null
      else (select coalesce(jsonb_agg(q order by n), '[]'::jsonb) from jsonb_array_elements(c.questions) with ordinality as t(q, n) where n <= p.answered + 1)
    end,
    'key', case when v_member and c.state = 'done' then (select answers from public.live_answer_keys where code = c.code) end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', lp.user_id, 'username', pr.username, 'joined_at', lp.joined_at, 'started_at', lp.started_at,
        'answered', lp.answered, 'correct', lp.correct, 'total_ms', lp.total_ms, 'finished_at', lp.finished_at,
        'rank', (select r.rank from public.live_results r where r.room_code = c.code and r.user_id = lp.user_id limit 1)
      ) order by lp.joined_at)
      from public.live_players lp join public.profiles pr on pr.id = lp.user_id
      where lp.code = c.code), '[]'::jsonb),
    -- Everyone's answers, only once the challenge is over: until then nobody
    -- can see what an opponent chose.
    'all_answers', case when v_member and c.state = 'done' then coalesce((
      select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'idx', a.idx, 'choice', a.choice, 'correct', a.correct, 'ms', a.ms) order by a.idx, a.user_id)
      from public.live_answers a where a.code = c.code), '[]'::jsonb) end,
    'my_answers', case when v_member then coalesce((
      select jsonb_agg(jsonb_build_object('idx', a.idx, 'choice', a.choice, 'correct', a.correct, 'ms', a.ms) order by a.idx)
      from public.live_answers a where a.code = c.code and a.user_id = v_me), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.live_set_next(p_code text, p_next text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text := upper(btrim(coalesce(p_code, '')));
  v_new text := upper(btrim(coalesce(p_next, '')));
  v_me uuid := (select auth.uid());
  o public.live_challenges;
  n public.live_challenges;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_new = v_old then raise exception 'A challenge can''t be its own rematch.' using errcode = '22023'; end if;
  select * into o from public.live_challenges where code = v_old for update;
  if not found then raise exception 'No challenge with this code.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.live_players where code = v_old and user_id = v_me) then
    raise exception 'You weren''t in this challenge.' using errcode = '42501';
  end if;
  if o.state <> 'done' then raise exception 'This challenge is still running.' using errcode = '55000'; end if;
  select * into n from public.live_challenges where code = v_new;
  if not found or n.host_id <> v_me then raise exception 'Create the new challenge first.' using errcode = '42501'; end if;
  if o.settings ->> 'next_code' is not null then return; end if;
  update public.live_challenges
    set settings = settings || jsonb_build_object('next_code', v_new, 'next_by', v_me)
    where code = v_old;
end;
$$;

revoke execute on function public.live_set_next(text, text) from public, anon;
grant execute on function public.live_set_next(text, text) to authenticated;
