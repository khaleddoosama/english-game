-- A view offered to a friend ends with the friendship (decision of the owner).
--
-- Before: when two players stopped being friends, the offers waiting between
-- them stayed in the inbox and in the badge, and failed with "You are no longer
-- friends." on accept. And if they became friends again the old offers were
-- back, though nobody had sent them again.
--
-- Now:
--  - friend_remove ends the offers waiting between the two, in both directions
--    (status 'expired'), in the same transaction;
--  - the inbox shows only offers between current friends, and ends on sight any
--    waiting offer whose friendship is no longer there (an ending that did not
--    go through friend_remove), so nothing comes back later;
--  - the accept still checks the friendship (unchanged), for an offer that is
--    still waiting;
--  - views already accepted are the receiver's own copies and stay;
--  - offers that were dismissed or accepted are not touched;
--  - the sender can offer the view again (the open-offer index looks at
--    'pending' only).
-- The badge on the app counts the length of the inbox, so it follows.
--
-- Existing data: waiting offers between players who are not friends now are
-- ended once, here.
--
-- Compatibility: a new status value, 'expired', that the app never reads
-- (it never lists or counts anything but 'pending'); an older app version works.

alter table public.collection_shares drop constraint collection_shares_status_check;
alter table public.collection_shares add constraint collection_shares_status_check
  check (status in ('pending', 'accepted', 'dismissed', 'expired'));

update public.collection_shares s set status = 'expired', updated_at = now()
where s.status = 'pending' and not public.are_friends(s.from_user, s.to_user);

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
  -- the offers waiting between the two end with the friendship
  update public.collection_shares set status = 'expired', updated_at = now()
    where status = 'pending' and ((from_user = v_me and to_user = p_user) or (from_user = p_user and to_user = v_me))
      and not public.are_friends(v_me, p_user);
end;
$$;

-- Now it writes (it ends offers on sight), so it is no longer a read-only function.
create or replace function public.view_shares_inbox()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  update public.collection_shares s set status = 'expired', updated_at = now()
    where s.to_user = v_me and s.status = 'pending' and not public.are_friends(s.from_user, s.to_user);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', c.name, 'from', p.username, 'from_id', s.from_user, 'at', s.created_at,
      'words', (select count(distinct cs.sense_id) from public.collection_senses cs
                join public.collections d on d.id = cs.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                join public.senses se on se.id = cs.sense_id and se.deleted_at is null and se.visibility = 'public' and se.review_status <> 'rejected'
                where cs.removed_at is null),
      'rules', (select count(distinct cr.rule_id) from public.collection_rules cr
                join public.collections d on d.id = cr.collection_id and d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%')
                join public.grammar_rules r on r.id = cr.rule_id and r.deleted_at is null
                where cr.removed_at is null),
      'views', (select count(*) from public.collections d where d.owner_id = c.owner_id and d.deleted_at is null and (d.id = c.id or d.path like c.path || '::%'))
    ) order by s.created_at desc), '[]'::jsonb)
    from public.collection_shares s
    join public.collections c on c.id = s.collection_id and c.deleted_at is null
    join public.profiles p on p.id = s.from_user
    where s.to_user = v_me and s.status = 'pending'
  );
end;
$$;

revoke execute on function public.view_shares_inbox() from public, anon;
grant execute on function public.view_shares_inbox() to authenticated;
revoke execute on function public.friend_remove(uuid) from public, anon;
grant execute on function public.friend_remove(uuid) to authenticated;
notify pgrst, 'reload schema';
