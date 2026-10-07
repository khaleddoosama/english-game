-- Friends and invitations to Live challenges (migration 0024):
-- asking by username, accepting, declining with a one-week wait, removing,
-- limits, who can see what, and invitations that only friends can send
-- (begin; <this>; rollback;).
create function pg_temp.act(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;

do $$
declare
  a uuid; b uuid; c uuid; d uuid; e uuid; x uuid;
  v jsonb; v_code text; v_code2 text; n integer; i integer;
  report text := '';
  qs jsonb := '[
    {"mode":"meaning","prompt":"p1","options":["Apple","Bread","Cheese"],"answer":"Apple","word":"apple"},
    {"mode":"gap","prompt":"p2","options":["Apple","Bread","Cheese"],"answer":"Bread","word":"bread"},
    {"mode":"reverse","prompt":"p3","options":["Apple","Bread","Cheese"],"answer":"Cheese","word":"cheese"}
  ]';
begin
  perform public.register_player('fr_a', 'secret1');
  perform public.register_player('fr_b', 'secret1');
  perform public.register_player('fr_c', 'secret1');
  perform public.register_player('fr_d', 'secret1');
  perform public.register_player('fr_e', 'secret1');
  select id into a from public.profiles where username = 'fr_a';
  select id into b from public.profiles where username = 'fr_b';
  select id into c from public.profiles where username = 'fr_c';
  select id into d from public.profiles where username = 'fr_d';
  select id into e from public.profiles where username = 'fr_e';

  -- Asking by username (any case, any spaces around it).
  perform pg_temp.act(a);
  v := public.friend_request(' FR_B ');
  perform pg_temp.must(v ->> 'status' = 'pending' and v ->> 'username' = 'fr_b', 'asking by username: ' || v::text);
  begin perform public.friend_request('fr_b'); raise exception 'FAIL: asked the same player twice';
  exception when sqlstate '55000' then null; end;
  begin perform public.friend_request('nobody_here'); raise exception 'FAIL: asked a player who does not exist';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.friend_request('fr_a'); raise exception 'FAIL: asked yourself';
  exception when sqlstate '22023' then null; end;
  perform pg_temp.must(jsonb_array_length(public.friends_list() -> 'outgoing') = 1, 'my sent request is listed');
  report := report || 'ask by username; ';

  -- The other side sees it, and only they can answer.
  perform pg_temp.act(b);
  v := public.friends_list();
  perform pg_temp.must(jsonb_array_length(v -> 'incoming') = 1 and v #>> '{incoming,0,username}' = 'fr_a', 'the request reaches fr_b');
  perform pg_temp.must((public.social_counts() ->> 'requests')::integer = 1, 'the badge counts one request');
  perform pg_temp.act(a);
  begin perform public.friend_respond(b, true); raise exception 'FAIL: answered my own request';
  exception when sqlstate 'P0002' then null; end;
  perform pg_temp.act(c);
  begin perform public.friend_respond(a, true); raise exception 'FAIL: a stranger answered';
  exception when sqlstate 'P0002' then null; end;
  report := report || 'only the receiver answers; ';

  perform pg_temp.act(b);
  perform public.friend_respond(a, true);
  v := public.friends_list();
  perform pg_temp.must(jsonb_array_length(v -> 'friends') = 1 and v #>> '{friends,0,username}' = 'fr_a' and v -> 'friends' -> 0 ? 'live_wins', 'fr_b lists fr_a with their numbers');
  perform pg_temp.must((public.social_counts() ->> 'requests')::integer = 0, 'the badge clears');
  perform pg_temp.act(a);
  perform pg_temp.must(public.friends_list() #>> '{friends,0,username}' = 'fr_b', 'fr_a lists fr_b');
  begin perform public.friend_request('fr_b'); raise exception 'FAIL: asked a friend';
  exception when sqlstate '55000' then null; end;
  report := report || 'accept; ';

  -- Asking someone who already asked you means yes.
  perform pg_temp.act(c);
  perform public.friend_request('fr_d');
  perform pg_temp.act(d);
  v := public.friend_request('fr_c');
  perform pg_temp.must(v ->> 'status' = 'accepted', 'asking back accepts: ' || v::text);
  perform pg_temp.must(public.friend_count(c) = 1 and public.friend_count(d) = 1, 'both have one friend');
  report := report || 'mutual ask; ';

  -- Declined: the asker waits a week; the other side may ask instead.
  perform pg_temp.act(a);
  perform public.friend_request('fr_e');
  perform pg_temp.act(e);
  perform public.friend_respond(a, false);
  perform pg_temp.must(jsonb_array_length(public.friends_list() -> 'incoming') = 0 and jsonb_array_length(public.friends_list() -> 'friends') = 0, 'a declined request is gone from the list');
  perform pg_temp.act(a);
  begin perform public.friend_request('fr_e'); raise exception 'FAIL: asked again right after a decline';
  exception when sqlstate '55000' then null; end;
  update public.friendships set updated_at = now() - interval '8 days' where user_a = least(a, e) and user_b = greatest(a, e);
  v := public.friend_request('fr_e');
  perform pg_temp.must(v ->> 'status' = 'pending', 'asking again after a week works');
  perform pg_temp.act(e);
  perform public.friend_respond(a, false);
  perform public.friend_request('fr_a');                       -- the one who declined may ask
  perform pg_temp.act(a);
  perform public.friend_respond(e, true);
  perform pg_temp.must(public.friend_count(a) = 2, 'fr_a now has two friends');
  report := report || 'decline and a week; ';

  -- Removing, taking back a request, removing twice.
  perform pg_temp.act(a);
  perform public.friend_remove(e);
  perform public.friend_remove(e);
  perform pg_temp.must(public.friend_count(a) = 1 and public.friend_count(e) = 0, 'removed on both sides');
  perform public.friend_request('fr_e');
  perform public.friend_remove(e);
  perform pg_temp.act(e);
  perform pg_temp.must(jsonb_array_length(public.friends_list() -> 'incoming') = 0, 'a request taken back disappears');
  report := report || 'remove; ';

  -- Invitations: friends of a challenge's members, to a challenge that can still be joined.
  perform pg_temp.act(a);
  perform public.friend_request('fr_c');
  perform pg_temp.act(c);
  perform public.friend_respond(a, true);                      -- a is friends with b and c
  perform pg_temp.act(a);
  v_code := public.live_create('Invite', 20, 3, 'together', '{}', qs);
  v := public.live_invite_friends(v_code, array[b, e, a]);
  perform pg_temp.must((v ->> 'invited')::integer = 1 and jsonb_array_length(v -> 'skipped') = 2, 'one invited, a stranger and yourself skipped: ' || v::text);
  perform pg_temp.must((v -> 'skipped') @> jsonb_build_array(jsonb_build_object('id', e, 'reason', 'not a friend')), 'a non-friend is refused');
  perform pg_temp.must(public.live_invites_sent(v_code) = jsonb_build_array(b), 'the members see who was invited');
  perform pg_temp.act(b);
  v := public.live_my_invites();
  perform pg_temp.must(jsonb_array_length(v) = 1 and v #>> '{0,code}' = v_code and v #>> '{0,from}' = 'fr_a' and v #>> '{0,title}' = 'Invite', 'fr_b sees the invitation: ' || v::text);
  perform pg_temp.must((public.social_counts() ->> 'invites')::integer = 1, 'the badge counts the invitation');
  begin perform public.live_invite_friends(v_code, array[c]); raise exception 'FAIL: someone outside the challenge invited';
  exception when sqlstate '42501' then null; end;
  perform pg_temp.act(c);
  perform pg_temp.must(jsonb_array_length(public.live_my_invites()) = 0, 'someone not invited sees nothing');
  perform pg_temp.act(e);
  perform pg_temp.must(jsonb_array_length(public.live_my_invites()) = 0, 'the refused stranger sees nothing');
  report := report || 'invite; ';

  -- Dismiss, invite again, invite twice.
  perform pg_temp.act(b);
  perform public.live_invite_dismiss(v_code);
  perform pg_temp.must(jsonb_array_length(public.live_my_invites()) = 0, 'a dismissed invitation is gone');
  perform pg_temp.act(a);
  v := public.live_invite_friends(v_code, array[b]);
  perform pg_temp.must((v ->> 'invited')::integer = 1, 're-inviting after a dismiss works');
  v := public.live_invite_friends(v_code, array[b]);
  perform pg_temp.must((v ->> 'invited')::integer = 0 and v #>> '{skipped,0,reason}' = 'already invited', 'inviting twice is a no-op: ' || v::text);
  report := report || 'dismiss and repeat; ';

  -- Joining clears the invitation; ending the friendship hides it.
  perform pg_temp.act(b);
  perform public.live_join(v_code);
  perform pg_temp.must(jsonb_array_length(public.live_my_invites()) = 0, 'joining clears the invitation');
  perform pg_temp.act(a);
  v := public.live_invite_friends(v_code, array[c]);
  perform pg_temp.must((v ->> 'invited')::integer = 1, 'fr_c invited');
  perform public.friend_remove(c);
  perform pg_temp.act(c);
  perform pg_temp.must(jsonb_array_length(public.live_my_invites()) = 0, 'no invitation from someone who is no longer a friend');
  report := report || 'join and unfriend; ';

  -- A challenge that is over, or already started, takes no invitations; a full one isn't offered.
  perform pg_temp.act(a);
  perform public.friend_request('fr_c');
  perform pg_temp.act(c);
  perform public.friend_respond(a, true);
  perform pg_temp.act(a);
  v_code2 := public.live_create('Small', 20, 2, 'together', '{}', qs);
  perform public.live_invite_friends(v_code2, array[c]);
  perform pg_temp.act(b);
  perform public.live_join(v_code2);                           -- now 2 of 2
  perform pg_temp.act(c);
  perform pg_temp.must(not exists (select 1 from jsonb_array_elements(public.live_my_invites()) j where j ->> 'code' = v_code2), 'a full challenge is not offered');
  perform pg_temp.act(a);
  update public.live_challenges set state = 'done', ended_at = now() where code = v_code;
  begin perform public.live_invite_friends(v_code, array[c]); raise exception 'FAIL: invited to a finished challenge';
  exception when sqlstate '55000' then null; end;
  report := report || 'ended and full; ';

  -- Rows: a player reads only their own, and can't write any directly.
  perform pg_temp.act(e);
  set local role authenticated;
  select count(*) into n from public.friendships;
  perform pg_temp.must(n = 0, 'a stranger reads friendships: ' || n);
  select count(*) into n from public.live_invites;
  perform pg_temp.must(n = 0, 'a stranger reads invitations: ' || n);
  reset role;
  perform pg_temp.act(a);
  set local role authenticated;
  select count(*) into n from public.friendships;
  perform pg_temp.must(n >= 2, 'a player reads their own friendships: ' || n);
  begin
    insert into public.friendships (user_a, user_b, requested_by, status) values (least(a, e), greatest(a, e), a, 'accepted');
    raise exception 'FAIL: a player wrote a friendship directly';
  exception when insufficient_privilege then null; end;
  reset role;
  report := report || 'rows are private; ';

  -- Twenty requests waiting is the most.
  perform pg_temp.act(d);
  for i in 1..20 loop
    perform public.register_player('fr_x' || lpad(i::text, 2, '0'), 'secret1');
    perform public.friend_request('fr_x' || lpad(i::text, 2, '0'));
  end loop;
  begin perform public.friend_request('fr_e'); raise exception 'FAIL: a 21st waiting request';
  exception when sqlstate '55000' then null; end;
  select id into x from public.profiles where username = 'fr_x01';
  perform pg_temp.act(x);
  perform public.friend_respond(d, true);
  perform pg_temp.act(d);
  v := public.friend_request('fr_e');
  perform pg_temp.must(v ->> 'status' = 'pending', 'an answered request frees a place');
  report := report || 'twenty waiting';

  raise exception 'FRIENDS TESTS PASSED: %', report;
end;
$$;
