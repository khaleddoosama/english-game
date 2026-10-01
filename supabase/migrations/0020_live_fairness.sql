-- Live Challenge between friends, fairer (review F06):
--  - no questions before a player presses Start, then one at a time (the
--    answer to one brings the next); all of them once the challenge is over;
--  - an answer needs Start first, so the clock can't begin at the answer;
--  - the device's time may be shorter than the server's by the card shown
--    after the previous answer plus 1.5 s for the network (was 4 s);
--  - answers and ending the challenge take turns on the challenge row, so
--    a last answer and "End now" can't cross;
--  - the creator wrote the questions and knows the answers: their result
--    is marked, and doesn't count toward Live wins.

alter table public.live_results add column if not exists is_host boolean not null default false;

create or replace function public.live_finalize(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.live_challenges set state = 'done', ended_at = now() where code = p_code and state <> 'done';
  if not found then return; end if;
  insert into public.live_results (room_code, user_id, title, points, correct, total, rank, players, total_ms, finished, is_host, played_at)
  select p.code, p.user_id, c.title, p.correct, p.correct, c.question_count,
         rank() over (order by p.correct desc, (p.finished_at is not null) desc, p.total_ms asc),
         count(*) over (), p.total_ms, p.finished_at is not null, p.user_id = c.host_id, now()
  from public.live_players p join public.live_challenges c on c.code = p.code
  where p.code = p_code and p.started_at is not null;
end;
$$;

create or replace function public.bump_live_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set live_played = live_played + 1,
        live_wins = live_wins + case when new.rank = 1 and new.players > 1 and not new.is_host then 1 else 0 end
  where id = new.user_id;
  return new;
end;
$$;

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
    'start_mode', c.start_mode, 'settings', c.settings, 'state', c.state,
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
    'my_answers', case when v_member then coalesce((
      select jsonb_agg(jsonb_build_object('idx', a.idx, 'choice', a.choice, 'correct', a.correct, 'ms', a.ms) order by a.idx)
      from public.live_answers a where a.code = c.code and a.user_id = v_me), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.live_answer(p_code text, p_idx integer, p_choice text, p_ms integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(p_code);
  v_me uuid := (select auth.uid());
  c public.live_challenges;
  p public.live_players;
  v_key jsonb;
  v_next jsonb;
  v_elapsed integer;
  v_slack integer := 1500;
  v_ms integer;
  v_choice text := nullif(btrim(coalesce(p_choice, '')), '');
  v_correct boolean;
  v_prev public.live_answers;
begin
  -- The challenge row first: answers and "End now" take turns.
  select * into c from public.live_challenges where code = v_code for update;
  if not found then raise exception 'No challenge with this code.' using errcode = 'P0002'; end if;
  select * into p from public.live_players where code = v_code and user_id = v_me for update;
  if not found then raise exception 'Join the challenge first.' using errcode = '42501'; end if;
  select answers -> p_idx into v_key from public.live_answer_keys where code = v_code;
  v_next := case when p_idx + 1 < c.question_count then c.questions -> (p_idx + 1) end;
  -- A retry of an answer already counted gets the same result back.
  select * into v_prev from public.live_answers where code = v_code and user_id = v_me and idx = p_idx;
  if found then
    return jsonb_build_object('idx', p_idx, 'correct', v_prev.correct, 'ms', v_prev.ms, 'choice', v_prev.choice, 'answer', v_key -> 'answer',
      'word', v_key -> 'word', 'explanation', v_key -> 'explanation', 'sentences', v_key -> 'sentences', 'me', to_jsonb(p) - 'last_at', 'next', v_next);
  end if;
  if c.state <> 'playing' or c.expires_at < now() then
    perform public.live_settle(v_code);
    raise exception 'This challenge has ended.' using errcode = '55000';
  end if;
  if p.finished_at is not null then raise exception 'You''ve answered every question.' using errcode = '55000'; end if;
  if p_idx is distinct from p.answered then raise exception 'Answer the questions in order.' using errcode = '22023'; end if;
  if p.started_at is null then raise exception 'Press Start first.' using errcode = '55000'; end if;
  -- The time since the previous answer also covers its right/wrong card.
  if p_idx > 0 then
    select v_slack + case when a.correct or coalesce(c.settings ->> 'reveal', '') = 'false' then 900 else 1800 end into v_slack
    from public.live_answers a where a.code = v_code and a.user_id = v_me and a.idx = p_idx - 1;
  end if;
  -- clock_timestamp, not now(): the time this answer arrived.
  v_elapsed := greatest(0, floor(extract(epoch from (clock_timestamp() - p.last_at)) * 1000))::integer;
  v_ms := least(greatest(coalesce(p_ms, v_elapsed), 0, v_elapsed - v_slack), v_elapsed);
  v_correct := v_choice is not null and lower(v_choice) = lower(btrim(v_key ->> 'answer'));
  if c.seconds > 0 and v_ms > c.seconds * 1000 then
    v_ms := c.seconds * 1000; v_correct := false; v_choice := null; -- time ran out
  end if;
  insert into public.live_answers (code, user_id, idx, choice, correct, ms) values (v_code, v_me, p_idx, v_choice, v_correct, v_ms);
  update public.live_players
    set answered = answered + 1, correct = correct + v_correct::integer, total_ms = total_ms + v_ms, last_at = clock_timestamp(),
        finished_at = case when answered + 1 >= c.question_count then now() end
  where code = v_code and user_id = v_me
  returning * into p;
  if p.finished_at is not null then perform public.live_settle(v_code); end if;
  return jsonb_build_object('idx', p_idx, 'correct', v_correct, 'ms', v_ms, 'choice', v_choice, 'answer', v_key -> 'answer',
    'word', v_key -> 'word', 'explanation', v_key -> 'explanation', 'sentences', v_key -> 'sentences',
    'me', to_jsonb(p) - 'last_at', 'next', v_next,
    'done', (select state = 'done' from public.live_challenges where code = v_code));
end;
$$;

-- Ending takes its turn on the challenge row too (otherwise as in 0009,
-- which logs the admin ending someone else's challenge).
create or replace function public.live_end(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.live_challenges;
begin
  select * into c from public.live_challenges where code = upper(p_code) for update;
  if not found or (c.host_id <> (select auth.uid()) and not public.is_admin()) then
    raise exception 'Only the creator can end this challenge.' using errcode = '42501';
  end if;
  update public.live_challenges set state = 'playing', started_at = coalesce(started_at, now()) where code = c.code and state = 'lobby';
  perform public.live_finalize(c.code);
  if c.host_id <> (select auth.uid()) then
    insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
    values ((select auth.uid()), 'live.end', c.title, 'live', c.code, jsonb_build_object('state', jsonb_build_object('before', c.state, 'after', 'done')));
  end if;
end;
$$;
