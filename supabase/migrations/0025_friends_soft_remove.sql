-- Friends: ending a friendship, or taking back a request, now keeps the row.
--  - 'removed': a friendship someone ended (ended_by says who). The one who was
--    removed waits a week before asking again, like after a declined request;
--    the one who removed can ask again whenever they like.
--  - 'cancelled': a request its sender took back before an answer. No wait.
-- Nothing about the pair is lost, and friends_list, the limits, the badges and
-- the invitations only look at 'accepted' and 'pending', so they don't change.

-- ended_by is always one of the two players, so the row goes away with either account.
alter table public.friendships add column if not exists ended_by uuid;
alter table public.friendships drop constraint if exists friendships_ended_by_check;
alter table public.friendships add constraint friendships_ended_by_check check (ended_by is null or ended_by in (user_a, user_b));
alter table public.friendships drop constraint if exists friendships_status_check;
alter table public.friendships add constraint friendships_status_check
  check (status in ('pending', 'accepted', 'declined', 'removed', 'cancelled'));

create or replace function public.friend_request(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_name text := lower(btrim(coalesce(p_username, '')));
  t public.profiles;
  f public.friendships;
  v_a uuid;
  v_b uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from public.profiles where username = v_name;
  if not found then raise exception 'No player is called "%". Check the spelling.', v_name using errcode = 'P0002'; end if;
  if t.id = v_me then raise exception 'That is you.' using errcode = '22023'; end if;
  v_a := least(v_me, t.id);
  v_b := greatest(v_me, t.id);
  select * into f from public.friendships where user_a = v_a and user_b = v_b for update;
  if found then
    if f.status = 'accepted' then raise exception 'You are already friends with %.', t.username using errcode = '55000'; end if;
    if f.status = 'pending' then
      if f.requested_by = v_me then raise exception 'You already asked %. Waiting for them to answer.', t.username using errcode = '55000'; end if;
      -- They asked first, so asking back is a yes.
      if public.friend_count(v_me) >= 100 then raise exception 'You have 100 friends, the most there can be.' using errcode = '55000'; end if;
      if public.friend_count(t.id) >= 100 then raise exception '% has too many friends to add more.', t.username using errcode = '55000'; end if;
      update public.friendships set status = 'accepted', ended_by = null, updated_at = now() where user_a = v_a and user_b = v_b;
      return jsonb_build_object('status', 'accepted', 'id', t.id, 'username', t.username);
    end if;
    if f.status = 'declined' and f.requested_by = v_me and f.updated_at > now() - interval '7 days' then
      raise exception '% did not accept your request. You can ask again after a week.', t.username using errcode = '55000';
    end if;
    if f.status = 'removed' and f.ended_by is distinct from v_me and f.updated_at > now() - interval '7 days' then
      raise exception '% is not accepting requests from you right now. You can try again after a week.', t.username using errcode = '55000';
    end if;
  end if;
  if public.friend_count(v_me) >= 100 then raise exception 'You have 100 friends, the most there can be.' using errcode = '55000'; end if;
  if public.friend_count(t.id) >= 100 then raise exception '% has too many friends to add more.', t.username using errcode = '55000'; end if;
  if (select count(*) from public.friendships where status = 'pending' and requested_by = v_me) >= 20 then
    raise exception 'You have 20 requests waiting for an answer. Wait for some of them first.' using errcode = '55000';
  end if;
  insert into public.friendships (user_a, user_b, requested_by, status)
  values (v_a, v_b, v_me, 'pending')
  on conflict (user_a, user_b) do update
    set requested_by = v_me, status = 'pending', ended_by = null, created_at = now(), updated_at = now();
  return jsonb_build_object('status', 'pending', 'id', t.id, 'username', t.username);
end;
$$;

-- Ends a friendship, or takes back a request I sent. Nothing to end is fine.
create or replace function public.friend_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update public.friendships
    set status = case status when 'accepted' then 'removed' else 'cancelled' end,
        ended_by = v_me, updated_at = now()
    where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user)
      and (status = 'accepted' or (status = 'pending' and requested_by = v_me));
end;
$$;

revoke execute on function public.friend_remove(uuid) from public, anon;
grant execute on function public.friend_remove(uuid) to authenticated;
