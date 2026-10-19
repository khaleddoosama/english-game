-- Signals the database sends through Realtime (migration 0043): on a challenge's private topic live:<code>,
-- "joined", "left", "progress" (the player's numbers), "start", "end" and "rematch"; on a player's own private topic
-- user:<id>, "friends" (a request, an answer, a removal) and "invite". Who may read which topic. Made-up players
-- (begin; <this>; rollback;).
create function pg_temp.act(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;
-- The events sent on a topic since message id `after`, in order, as "event payload" lines.
create function pg_temp.sent(t text, after bigint) returns text language sql as $$
  select coalesce(string_agg(event || ' ' || payload::text, ' | ' order by id), '') from realtime.messages
  where topic = t and id > after and extension = 'broadcast' and private;
$$;
create function pg_temp.last_id() returns bigint language sql as $$ select coalesce(max(id), 0) from realtime.messages $$;

do $$
declare
  a uuid; b uuid; c uuid; v_code text; v_next text; mark bigint; s text; n integer; r jsonb;
  report text := '';
  qs jsonb := '[
    {"mode":"meaning","prompt":"p1","options":["Apple","Bread","Cheese"],"answer":"Apple","word":"apple"},
    {"mode":"gap","prompt":"p2","options":["Apple","Bread","Cheese"],"answer":"Bread","word":"bread"},
    {"mode":"reverse","prompt":"p3","options":["Apple","Bread","Cheese"],"answer":"Cheese","word":"cheese"}
  ]';
begin
  perform public.register_player('rt_a', 'secret1');
  perform public.register_player('rt_b', 'secret1');
  perform public.register_player('rt_c', 'secret1');
  select id into a from public.profiles where username = 'rt_a';
  select id into b from public.profiles where username = 'rt_b';
  select id into c from public.profiles where username = 'rt_c';

  -- A challenge: joining and leaving
  perform pg_temp.act(a);
  v_code := public.live_create('Food', 20, 3, 'together', '{}', qs);
  mark := pg_temp.last_id();
  perform pg_temp.act(b);
  perform public.live_join(v_code);
  perform pg_temp.act(c);
  perform public.live_join(v_code);
  perform public.live_join(v_code); -- joining twice sends nothing more
  s := pg_temp.sent('live:' || v_code, mark);
  perform pg_temp.must(s = format('joined {"user_id": "%s"} | joined {"user_id": "%s"}', b, c), 'joined, once per player: ' || s);
  mark := pg_temp.last_id();
  perform public.live_leave(v_code);
  s := pg_temp.sent('live:' || v_code, mark);
  perform pg_temp.must(s = format('left {"user_id": "%s"}', c), 'left: ' || s);
  report := report || 'joined and left; ';

  -- Start, each player's progress, the end
  perform pg_temp.act(a);
  mark := pg_temp.last_id();
  perform public.live_start(v_code);
  perform pg_temp.must(pg_temp.sent('live:' || v_code, mark) = 'start {}', 'start: ' || pg_temp.sent('live:' || v_code, mark));
  mark := pg_temp.last_id();
  perform public.live_begin(v_code);
  perform pg_sleep(0.2);
  r := public.live_answer(v_code, 0, 'Apple', 150);
  select count(*) into n from realtime.messages where id > mark and topic = 'live:' || v_code and event = 'progress';
  perform pg_temp.must(n = 2, format('a progress for the begin and one for the answer (%s)', n));
  select count(*) into n from realtime.messages m where m.id > mark and m.topic = 'live:' || v_code and m.event = 'progress'
    and m.payload ->> 'user_id' = a::text and (m.payload ->> 'answered')::int = 1 and (m.payload ->> 'correct')::int = 1
    and (m.payload ->> 'total_ms')::int = (r -> 'me' ->> 'total_ms')::int and m.payload ? 'started_at' and m.payload ? 'finished_at';
  perform pg_temp.must(n = 1, 'the progress carries the player''s numbers');
  select count(*) into n from realtime.messages where id > mark and payload::text ~* 'apple|bread|cheese';
  perform pg_temp.must(n = 0, 'no question, option or answer in a signal');
  mark := pg_temp.last_id();
  update public.live_players set joined_at = joined_at, last_at = last_at where code = v_code and user_id = a;
  update public.live_challenges set settings = settings where code = v_code;
  perform pg_temp.must(pg_temp.sent('live:' || v_code, mark) = '', 'a change that moves no number and no state sends nothing: ' || pg_temp.sent('live:' || v_code, mark));
  r := public.live_answer(v_code, 0, 'Apple', 150); -- a retried answer changes nothing
  perform pg_temp.must(pg_temp.sent('live:' || v_code, mark) = '', 'a retried answer sends nothing: ' || pg_temp.sent('live:' || v_code, mark));
  mark := pg_temp.last_id();
  perform public.live_end(v_code);
  s := pg_temp.sent('live:' || v_code, mark);
  perform pg_temp.must(s like '%end {}%' and (length(s) - length(replace(s, 'end {}', ''))) / length('end {}') = 1, 'one end: ' || s);
  report := report || 'start, progress, end; ';

  -- A rematch
  v_next := public.live_create('Food again', 20, 3, 'together', '{}', qs);
  mark := pg_temp.last_id();
  perform public.live_set_next(v_code, v_next);
  s := pg_temp.sent('live:' || v_code, mark);
  perform pg_temp.must(s = format('rematch {"next_code": "%s"}', v_next), 'rematch: ' || s);
  mark := pg_temp.last_id();
  update public.live_challenges set settings = settings - 'next_code' where code = v_code;
  perform pg_temp.must(pg_temp.sent('live:' || v_code, mark) = '', 'a rematch link taken away sends nothing');
  report := report || 'rematch; ';

  -- Friends: a request, an answer and a removal reach both players' own topics
  perform pg_temp.act(a);
  mark := pg_temp.last_id();
  perform public.friend_request('rt_b');
  perform pg_temp.must(pg_temp.sent('user:' || a, mark) = 'friends {}' and pg_temp.sent('user:' || b, mark) = 'friends {}', 'a request reaches both');
  perform pg_temp.must(pg_temp.sent('user:' || c, mark) = '', 'not a third player');
  perform pg_temp.act(b);
  mark := pg_temp.last_id();
  perform public.friend_respond(a, true);
  perform pg_temp.must(pg_temp.sent('user:' || a, mark) = 'friends {}' and pg_temp.sent('user:' || b, mark) = 'friends {}', 'an answer reaches both');
  report := report || 'friends; ';

  -- An invitation reaches the invited player only
  perform pg_temp.act(a);
  v_code := public.live_create('Invite', 20, 3, 'together', '{}', qs);
  mark := pg_temp.last_id();
  r := public.live_invite_friends(v_code, array[b]);
  perform pg_temp.must(pg_temp.sent('user:' || b, mark) = 'invite {}' and pg_temp.sent('user:' || a, mark) = '', 'invite: ' || pg_temp.sent('user:' || b, mark));
  mark := pg_temp.last_id();
  perform public.live_invite_friends(v_code, array[b]); -- already invited: nothing new
  update public.live_invites set created_at = created_at where code = v_code;
  perform pg_temp.must(pg_temp.sent('user:' || b, mark) = '', 'inviting again sends nothing');
  perform pg_temp.act(b);
  perform public.live_invite_dismiss(v_code);
  perform pg_temp.must(pg_temp.sent('user:' || b, mark) = '', 'dismissing sends nothing');
  perform pg_temp.act(a);
  perform public.live_invite_friends(v_code, array[b]);
  perform pg_temp.must(pg_temp.sent('user:' || b, mark) = 'invite {}', 'invited again after a dismissal: ' || pg_temp.sent('user:' || b, mark));
  mark := pg_temp.last_id();
  perform pg_temp.act(a);
  perform public.friend_remove(b);
  perform pg_temp.must(pg_temp.sent('user:' || a, mark) = 'friends {}' and pg_temp.sent('user:' || b, mark) = 'friends {}', 'a removal reaches both');
  report := report || 'invitations; ';

  -- Who may read which topic: a player only their own user:<id>; a challenge's members only its live:<code>
  execute 'set local role authenticated';
  perform pg_temp.act(b);
  perform set_config('realtime.topic', 'user:' || b, true);
  select count(*) into n from realtime.messages;
  perform pg_temp.must(n > 0, 'a player reads their own topic');
  perform set_config('realtime.topic', 'user:' || a, true);
  select count(*) into n from realtime.messages;
  perform pg_temp.must(n = 0, 'a player cannot read another player''s topic');
  perform pg_temp.act(a);
  perform set_config('realtime.topic', 'live:' || v_code, true);
  insert into realtime.messages (topic, extension, payload, event, private) values ('live:' || v_code, 'broadcast', '{}', 'joined', true);
  perform pg_temp.act(b);
  perform set_config('realtime.topic', 'user:' || b, true);
  begin
    insert into realtime.messages (topic, extension, payload, event, private) values ('user:' || b, 'broadcast', '{}', 'invite', true);
    raise exception 'FAIL: a player sent on a personal topic';
  exception when insufficient_privilege then null; end;
  perform set_config('realtime.topic', 'live:' || v_code, true);
  select count(*) into n from realtime.messages;
  perform pg_temp.must(n = 0, 'an invited player who has not joined cannot read the challenge''s topic');
  execute 'reset role';
  report := report || 'who reads what; ';

  raise exception 'REALTIME SIGNALS TESTS PASSED: %', report;
end $$;
