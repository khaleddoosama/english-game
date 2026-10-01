-- Live Challenge, link edition. The creator sets everything up front
-- (questions, time per question, 2-10 players, start mode) and shares a
-- link (/live/CODE). Everyone answers the same questions at their own pace;
-- nobody waits for anybody. Answers are checked here against a key players
-- can't read, and the winner has the most right answers, ties going to the
-- fastest total time. Realtime only carries "something changed" events.

drop table if exists public.live_rooms;

create table public.live_challenges (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  question_count integer not null check (question_count between 3 and 50),
  seconds integer not null default 20 check (seconds = 0 or seconds between 5 and 120), -- 0: no time limit
  max_players integer not null default 10 check (max_players between 2 and 10),
  start_mode text not null default 'together' check (start_mode in ('together', 'anytime')),
  settings jsonb not null default '{}'::jsonb, -- lesson, unit, question kinds, show answers…
  questions jsonb not null, -- what players see: prompts and options, no answers
  state text not null default 'lobby' check (state in ('lobby', 'playing', 'done')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null
);
create index live_challenges_host_idx on public.live_challenges (host_id, created_at desc);
create index live_challenges_open_idx on public.live_challenges (expires_at) where state <> 'done';

-- Answers (and the word/explanation shown after answering). No policies:
-- only the functions below read it.
create table public.live_answer_keys (
  code text primary key references public.live_challenges (code) on delete cascade,
  answers jsonb not null
);

create table public.live_players (
  code text not null references public.live_challenges (code) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  started_at timestamptz,
  last_at timestamptz, -- server time of the start or the last answer
  answered integer not null default 0,
  correct integer not null default 0,
  total_ms bigint not null default 0,
  finished_at timestamptz,
  primary key (code, user_id)
);
create index live_players_user_idx on public.live_players (user_id, joined_at desc);

create table public.live_answers (
  code text not null,
  user_id uuid not null,
  idx integer not null,
  choice text,
  correct boolean not null,
  ms integer not null,
  answered_at timestamptz not null default now(),
  primary key (code, user_id, idx),
  foreign key (code, user_id) references public.live_players (code, user_id) on delete cascade
);

alter table public.live_results add column total_ms bigint not null default 0;
alter table public.live_results add column finished boolean not null default true;
-- Results are written by the server when a challenge ends.
drop policy if exists "players record their own result" on public.live_results;

create or replace function public.is_live_member(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.live_players where code = p_code and user_id = (select auth.uid()));
$$;

alter table public.live_challenges enable row level security;
alter table public.live_answer_keys enable row level security;
alter table public.live_players enable row level security;
alter table public.live_answers enable row level security;
create policy "members and the admin see challenges" on public.live_challenges for select to authenticated
  using (host_id = (select auth.uid()) or (select public.is_live_member(code)) or (select public.is_admin()));
create policy "admin removes challenges" on public.live_challenges for delete to authenticated using ((select public.is_admin()));
create policy "members see who plays" on public.live_players for select to authenticated
  using ((select public.is_live_member(code)) or (select public.is_admin()));
create policy "players see their answers" on public.live_answers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Realtime: only a challenge's players use its channel.
drop policy if exists "players use live channels" on realtime.messages;
drop policy if exists "players send on live channels" on realtime.messages;
create policy "members use live channels" on realtime.messages for select to authenticated
  using (realtime.topic() like 'live:%' and (select public.is_live_member(substr(realtime.topic(), 6))));
create policy "members send on live channels" on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'live:%' and (select public.is_live_member(substr(realtime.topic(), 6))));

-- ------------------------------------------------------------ internals

-- Ends a challenge: ranks everyone who started (most right answers, then
-- finished before unfinished, then fastest) and records the results.
create or replace function public.live_finalize(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.live_challenges set state = 'done', ended_at = now() where code = p_code and state <> 'done';
  if not found then return; end if;
  insert into public.live_results (room_code, user_id, title, points, correct, total, rank, players, total_ms, finished, played_at)
  select p.code, p.user_id, c.title, p.correct, p.correct, c.question_count,
         rank() over (order by p.correct desc, (p.finished_at is not null) desc, p.total_ms asc),
         count(*) over (), p.total_ms, p.finished_at is not null, now()
  from public.live_players p join public.live_challenges c on c.code = p.code
  where p.code = p_code and p.started_at is not null;
end;
$$;

-- Ends a challenge whose time is up or whose players have all finished.
create or replace function public.live_settle(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.live_challenges;
  v_players integer;
  v_open integer;
begin
  select * into c from public.live_challenges where code = p_code;
  if not found or c.state = 'done' then return; end if;
  if c.expires_at < now() then perform public.live_finalize(p_code); return; end if;
  if c.state <> 'playing' then return; end if;
  select count(*), count(*) filter (where finished_at is null) into v_players, v_open from public.live_players where code = p_code;
  if v_players > 0 and v_open = 0 and (c.start_mode = 'together' or v_players >= c.max_players) then
    perform public.live_finalize(p_code);
  end if;
end;
$$;

-- What a player sees: settings, players and progress; the questions once
-- they've joined; the answers once the challenge is over.
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
  v_member boolean;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform public.live_settle(v_code);
  select * into c from public.live_challenges where code = v_code;
  if not found then raise exception 'No challenge with this code. Check the link or the code.' using errcode = 'P0002'; end if;
  v_member := exists (select 1 from public.live_players where code = c.code and user_id = v_me);
  return jsonb_build_object(
    'code', c.code, 'title', c.title, 'host_id', c.host_id,
    'host', (select username from public.profiles where id = c.host_id),
    'question_count', c.question_count, 'seconds', c.seconds, 'max_players', c.max_players,
    'start_mode', c.start_mode, 'settings', c.settings, 'state', c.state,
    'created_at', c.created_at, 'started_at', c.started_at, 'ended_at', c.ended_at, 'expires_at', c.expires_at,
    'now', now(), 'member', v_member,
    'questions', case when v_member then c.questions end,
    'key', case when v_member and c.state = 'done' then (select answers from public.live_answer_keys where code = c.code) end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'username', pr.username, 'joined_at', p.joined_at, 'started_at', p.started_at,
        'answered', p.answered, 'correct', p.correct, 'total_ms', p.total_ms, 'finished_at', p.finished_at,
        'rank', (select r.rank from public.live_results r where r.room_code = c.code and r.user_id = p.user_id limit 1)
      ) order by p.joined_at)
      from public.live_players p join public.profiles pr on pr.id = p.user_id
      where p.code = c.code), '[]'::jsonb),
    'my_answers', case when v_member then coalesce((
      select jsonb_agg(jsonb_build_object('idx', a.idx, 'choice', a.choice, 'correct', a.correct, 'ms', a.ms) order by a.idx)
      from public.live_answers a where a.code = c.code and a.user_id = v_me), '[]'::jsonb) end
  );
end;
$$;

-- --------------------------------------------------------------- actions

-- p_questions: [{ mode, prompt, options[], answer, word, explanation, picture, photo, sentences[] }]
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
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if v_n < 3 or v_n > 50 then raise exception 'A challenge needs 3 to 50 questions.' using errcode = '22023'; end if;
  if p_max_players is null or p_max_players < 2 or p_max_players > 10 then raise exception 'A challenge is for 2 to 10 players.' using errcode = '22023'; end if;
  if p_start_mode not in ('together', 'anytime') then raise exception 'Unknown start mode.' using errcode = '22023'; end if;
  if length(p_questions::text) > 400000 then raise exception 'These questions are too large.' using errcode = '22023'; end if;
  select count(*) into v_bad from jsonb_array_elements(p_questions) q
  where jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') < 2 or jsonb_array_length(q -> 'options') > 8
     or coalesce(q ->> 'prompt', '') = '' or coalesce(q ->> 'answer', '') = ''
     or not exists (select 1 from jsonb_array_elements_text(q -> 'options') o where lower(btrim(o)) = lower(btrim(q ->> 'answer')));
  if v_bad > 0 then raise exception 'Every question needs a prompt, 2-8 options and its answer among them.' using errcode = '22023'; end if;
  -- My challenges from over a month ago make room (their results stay).
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
    now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 168)))
  );
  insert into public.live_answer_keys (code, answers)
  values (v_code, (select jsonb_agg(jsonb_build_object('answer', q -> 'answer', 'word', q -> 'word', 'explanation', q -> 'explanation', 'sentences', coalesce(q -> 'sentences', '[]'::jsonb)) order by n)
                    from jsonb_array_elements(p_questions) with ordinality as t(q, n)));
  insert into public.live_players (code, user_id) values (v_code, v_me);
  return v_code;
end;
$$;

create or replace function public.live_join(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_me uuid := (select auth.uid());
  c public.live_challenges;
  v_count integer;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform public.live_settle(v_code);
  select * into c from public.live_challenges where code = v_code for update;
  if not found then raise exception 'No challenge with this code. Check the link or the code.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.live_players where code = v_code and user_id = v_me) then
    if c.state = 'done' then raise exception 'This challenge has already ended.' using errcode = '55000'; end if;
    if c.start_mode = 'together' and c.state <> 'lobby' then raise exception 'This challenge has already started.' using errcode = '55000'; end if;
    select count(*) into v_count from public.live_players where code = v_code;
    if v_count >= c.max_players then raise exception 'This challenge is full (% players).', c.max_players using errcode = '55000'; end if;
    insert into public.live_players (code, user_id) values (v_code, v_me);
  end if;
  return public.live_view(v_code);
end;
$$;

-- The creator starts a "together" challenge (2+ players needed).
create or replace function public.live_start(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.live_challenges;
begin
  select * into c from public.live_challenges where code = upper(p_code) for update;
  if not found or c.host_id <> (select auth.uid()) then raise exception 'Only the creator can start this challenge.' using errcode = '42501'; end if;
  if c.state <> 'lobby' then return; end if;
  if (select count(*) from public.live_players where code = c.code) < 2 then raise exception 'Wait for at least one more player.' using errcode = '55000'; end if;
  update public.live_challenges set state = 'playing', started_at = now(), expires_at = least(expires_at, now() + interval '3 hours') where code = c.code;
end;
$$;

-- A player begins their run; their clock starts now.
create or replace function public.live_begin(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(p_code);
  v_me uuid := (select auth.uid());
begin
  perform public.live_settle(v_code);
  if not exists (select 1 from public.live_challenges where code = v_code and state = 'playing') then
    raise exception 'This challenge isn''t running.' using errcode = '55000';
  end if;
  update public.live_players set started_at = coalesce(started_at, clock_timestamp()), last_at = coalesce(last_at, clock_timestamp())
  where code = v_code and user_id = v_me;
  if not found then raise exception 'Join the challenge first.' using errcode = '42501'; end if;
  return public.live_view(v_code);
end;
$$;

-- One answer, in order. p_ms is the time the player's device measured;
-- the server keeps it honest: never more than the time since the previous
-- answer, never less than that minus feedback and network time.
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
  v_elapsed integer;
  v_ms integer;
  v_choice text := nullif(btrim(coalesce(p_choice, '')), '');
  v_correct boolean;
  v_prev public.live_answers;
begin
  select * into c from public.live_challenges where code = v_code;
  if not found then raise exception 'No challenge with this code.' using errcode = 'P0002'; end if;
  select * into p from public.live_players where code = v_code and user_id = v_me for update;
  if not found then raise exception 'Join the challenge first.' using errcode = '42501'; end if;
  select answers -> p_idx into v_key from public.live_answer_keys where code = v_code;
  -- A retry of an answer already counted gets the same result back.
  select * into v_prev from public.live_answers where code = v_code and user_id = v_me and idx = p_idx;
  if found then
    return jsonb_build_object('idx', p_idx, 'correct', v_prev.correct, 'ms', v_prev.ms, 'choice', v_prev.choice, 'answer', v_key -> 'answer',
      'word', v_key -> 'word', 'explanation', v_key -> 'explanation', 'sentences', v_key -> 'sentences', 'me', to_jsonb(p) - 'last_at');
  end if;
  if c.state <> 'playing' or c.expires_at < now() then
    perform public.live_settle(v_code);
    raise exception 'This challenge has ended.' using errcode = '55000';
  end if;
  if p.finished_at is not null then raise exception 'You''ve answered every question.' using errcode = '55000'; end if;
  if p_idx is distinct from p.answered then raise exception 'Answer the questions in order.' using errcode = '22023'; end if;
  if p.started_at is null then
    update public.live_players set started_at = clock_timestamp(), last_at = clock_timestamp() where code = v_code and user_id = v_me returning * into p;
  end if;
  -- clock_timestamp, not now(): the time this answer arrived.
  v_elapsed := greatest(0, floor(extract(epoch from (clock_timestamp() - p.last_at)) * 1000))::integer;
  v_ms := least(greatest(coalesce(p_ms, v_elapsed), 0, v_elapsed - 4000), v_elapsed);
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
    'me', to_jsonb(p) - 'last_at',
    'done', (select state = 'done' from public.live_challenges where code = v_code));
end;
$$;

-- The creator (or the admin) ends a challenge now.
create or replace function public.live_end(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.live_challenges where code = upper(p_code) and (host_id = (select auth.uid()) or public.is_admin())) then
    raise exception 'Only the creator can end this challenge.' using errcode = '42501';
  end if;
  update public.live_challenges set state = 'playing', started_at = coalesce(started_at, now()) where code = upper(p_code) and state = 'lobby';
  perform public.live_finalize(upper(p_code));
end;
$$;

-- Leave before starting. The creator leaving an unstarted challenge
-- cancels it.
create or replace function public.live_leave(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(p_code);
  v_me uuid := (select auth.uid());
begin
  if exists (select 1 from public.live_challenges where code = v_code and host_id = v_me and state = 'lobby') then
    delete from public.live_challenges where code = v_code;
    return;
  end if;
  delete from public.live_players where code = v_code and user_id = v_me and started_at is null;
  perform public.live_settle(v_code);
end;
$$;

-- The creator removes someone who hasn't started yet.
create or replace function public.live_remove_player(p_code text, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.live_challenges where code = upper(p_code) and host_id = (select auth.uid())) then
    raise exception 'Only the creator can remove players.' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) then raise exception 'You can''t remove yourself.' using errcode = '22023'; end if;
  delete from public.live_players where code = upper(p_code) and user_id = p_user and started_at is null;
end;
$$;

-- My challenges from the last two weeks (open ones first).
create or replace function public.live_mine()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'state') = 'done', x ->> 'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'code', c.code, 'title', c.title, 'state', case when c.state <> 'done' and c.expires_at < now() then 'done' else c.state end,
      'start_mode', c.start_mode, 'question_count', c.question_count, 'max_players', c.max_players,
      'created_at', c.created_at, 'expires_at', c.expires_at, 'host', c.host_id = (select auth.uid()),
      'players', (select count(*) from public.live_players q where q.code = c.code),
      'answered', p.answered, 'correct', p.correct, 'finished', p.finished_at is not null,
      'rank', (select r.rank from public.live_results r where r.room_code = c.code and r.user_id = p.user_id limit 1)
    ) as x
    from public.live_players p join public.live_challenges c on c.code = p.code
    where p.user_id = (select auth.uid()) and c.created_at > now() - interval '14 days'
    limit 30
  ) s;
$$;

-- ---------------------------------------------------------------- admin
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
    jsonb_agg(jsonb_build_object('username', p.username, 'rank', r.rank, 'points', r.points, 'correct', r.correct, 'total', r.total,
      'total_ms', r.total_ms, 'finished', r.finished) order by r.rank, r.total_ms)
  from public.live_results r
  join public.profiles p on p.id = r.user_id
  group by r.room_code, date_trunc('hour', r.played_at)
  order by min(r.played_at) desc
  limit greatest(1, least(p_limit, 1000));
end;
$$;

create or replace function public.admin_live_challenges(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object(
        'code', c.code, 'title', c.title, 'host', h.username, 'state', c.state, 'start_mode', c.start_mode,
        'question_count', c.question_count, 'seconds', c.seconds, 'max_players', c.max_players,
        'created_at', c.created_at, 'started_at', c.started_at, 'ended_at', c.ended_at, 'expires_at', c.expires_at,
        'players', (select count(*) from public.live_players p where p.code = c.code),
        'finished', (select count(*) from public.live_players p where p.code = c.code and p.finished_at is not null)
      ) as x
      from public.live_challenges c join public.profiles h on h.id = c.host_id
      order by c.created_at desc
      limit greatest(1, least(p_limit, 1000))
    ) s), '[]'::jsonb);
end;
$$;

-- Signed-in callers only; the internals are for the functions above.
do $$
declare f text;
begin
  foreach f in array array[
    'public.is_live_member(text)', 'public.live_view(text)', 'public.live_create(text, integer, integer, text, jsonb, jsonb, integer)',
    'public.live_join(text)', 'public.live_start(text)', 'public.live_begin(text)', 'public.live_answer(text, integer, text, integer)',
    'public.live_end(text)', 'public.live_leave(text)', 'public.live_remove_player(text, uuid)', 'public.live_mine()',
    'public.admin_live_matches(integer)', 'public.admin_live_challenges(integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.live_finalize(text)', 'public.live_settle(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
