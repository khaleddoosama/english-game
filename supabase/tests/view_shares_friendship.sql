-- A view offered to a friend, when the friendship ends (migration 0040): the
-- offer leaves the inbox for good, is not brought back by a new friendship, the
-- accept still checks the friendship, and copies already taken stay.
-- begin; <this>; rollback;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

do $$
declare
  ann uuid; bob uuid; v1 uuid; v2 uuid; v3 uuid; v4 uuid; inbox jsonb; first_id uuid; second_id uuid; got jsonb;
  msg text; code text;
begin
  perform public.register_player('fs_ann', 'secret1');
  perform public.register_player('fs_bob', 'secret1');
  select id into ann from public.profiles where username = 'fs_ann';
  select id into bob from public.profiles where username = 'fs_bob';
  perform pg_temp.as_user(ann); perform public.friend_request('fs_bob');
  perform pg_temp.as_user(bob); perform public.friend_respond(ann, true);

  perform pg_temp.as_user(ann);
  v1 := public.view_create('fs one'); v2 := public.view_create('fs two'); v3 := public.view_create('fs three');
  perform public.view_share(v1, array[bob]);
  perform public.view_share(v2, array[bob]);
  v4 := public.view_create('fs four');
  perform public.view_share(v4, array[bob]);
  perform pg_temp.as_user(bob);
  perform public.view_share_dismiss((select id from public.collection_shares where collection_id = v4));         -- Bob said no to this one

  perform public.view_create('fs bobs');
  v3 := (select id from public.collections where owner_id = bob and name = 'fs bobs');
  perform public.view_share(v3, array[ann]);                                    -- an offer the other way
  perform pg_temp.must(jsonb_array_length(public.view_shares_inbox()) = 2, 'two offers wait for Bob (the third was dismissed)');
  inbox := public.view_shares_inbox();
  first_id := (inbox -> 0 ->> 'id')::uuid;

  -- Bob takes one of them; it will stay when the friendship ends
  got := public.view_share_accept((select (e ->> 'id')::uuid from jsonb_array_elements(inbox) e where e ->> 'name' = 'fs one'));
  perform pg_temp.must((select count(*) from public.collections where owner_id = bob and name like 'fs one%') = 1, 'the copy is Bob''s');

  -- the friendship ends
  perform pg_temp.as_user(ann); perform public.friend_remove(bob);

  perform pg_temp.as_user(bob);
  perform pg_temp.must(public.view_shares_inbox() = '[]'::jsonb, 'the waiting offer is gone from the inbox');
  perform pg_temp.must((select status from public.collection_shares where collection_id = v2) = 'expired', 'it was ended, not just hidden');
  perform pg_temp.must((select status from public.collection_shares where collection_id = v3) = 'expired', 'the offer the other way too');
  perform pg_temp.must((select status from public.collection_shares where collection_id = (select id from public.collections where owner_id = ann and name = 'fs one')) = 'accepted', 'a share already taken stays taken');
  perform pg_temp.must((select count(*) from public.collections where owner_id = bob and name like 'fs one%') = 1, 'and so does the copy');
  begin
    perform public.view_share_accept((select id from public.collection_shares where collection_id = v2));
    raise exception 'FAIL: an ended offer was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    code := sqlstate;
  end;
  perform pg_temp.must(code = 'P0002', 'accepting an ended offer says it is no longer waiting');

  -- friends again: the old offers do not come back
  perform pg_temp.as_user(ann); perform public.friend_request('fs_bob');
  perform pg_temp.as_user(bob); perform public.friend_respond(ann, true);
  perform pg_temp.must(public.view_shares_inbox() = '[]'::jsonb, 'a new friendship does not bring the old offers back');
  -- but the sender can offer again
  perform pg_temp.as_user(ann);
  perform pg_temp.must(public.view_share(v2, array[bob]) = 1, 'the view can be offered again');
  perform pg_temp.as_user(bob);
  inbox := public.view_shares_inbox();
  perform pg_temp.must(jsonb_array_length(inbox) = 1 and (inbox -> 0 ->> 'name') = 'fs two', 'the new offer is in the inbox');
  perform pg_temp.must((inbox -> 0 ->> 'id')::uuid <> (select id from public.collection_shares where collection_id = v2 and status = 'expired'), 'it is a new offer');

  -- an ended friendship that did not go through friend_remove: still hidden, ended on sight, and the accept would refuse anyway
  perform pg_temp.must((select status from public.collection_shares where id = (inbox -> 0 ->> 'id')::uuid) = 'pending', 'the new offer waits');
  update public.friendships set status = 'removed' where user_a = least(ann, bob) and user_b = greatest(ann, bob);
  perform pg_temp.must(public.view_shares_inbox() = '[]'::jsonb, 'hidden when the friendship ended another way');
  update public.friendships set status = 'accepted' where user_a = least(ann, bob) and user_b = greatest(ann, bob);
  perform pg_temp.must(public.view_shares_inbox() = '[]'::jsonb, 'and it does not return when the friendship does');

  -- the accept itself still checks the friendship for an offer still waiting
  perform pg_temp.as_user(ann); perform public.view_share(v1, array[bob]);
  update public.friendships set status = 'removed' where user_a = least(ann, bob) and user_b = greatest(ann, bob);
  perform pg_temp.as_user(bob);
  begin
    perform public.view_share_accept((select id from public.collection_shares where collection_id = v1 and status = 'pending'));
    raise exception 'FAIL: accepted without a friendship';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    msg := sqlerrm; code := sqlstate;
  end;
  perform pg_temp.must(code = '42501' and msg like '%no longer friends%', 'the friendship is checked when accepting: ' || coalesce(msg, ''));

  perform pg_temp.must((select status from public.collection_shares where collection_id = v4) = 'dismissed', 'a dismissed offer is not turned into an ended one');
  raise exception 'FRIENDSHIP SHARE TESTS PASSED';
end $$;
