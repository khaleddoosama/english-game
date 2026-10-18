-- Deleting a player works for players who used the library (review of the library).
--
-- admin_delete_player (0009) deletes the account and lets the database follow
-- the player's rows. The library tables (0026-0032) point at views, words and
-- rules without "on delete cascade", so deleting a player who had a view, a
-- word of their own, a share, a link or a catalog entry stopped with a
-- foreign key error and nothing was deleted.
--
-- Now their library data goes first, in the same transaction: what they
-- shared, linked or published is taken down; their own words and views are
-- deleted; what other players copied from them is theirs and stays.

create or replace function public.admin_delete_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  v_views uuid[];
  v_senses uuid[];
begin
  perform public.require_admin();
  if p_user = (select auth.uid()) then raise exception 'you cannot delete your own account here' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;

  v_views := coalesce(array(select id from public.collections where owner_id = p_user), '{}');
  v_senses := coalesce(array(select id from public.senses where owner_id = p_user), '{}');
  delete from public.catalog_takes where user_id = p_user or entry_id in (select id from public.catalog_entries where collection_id = any (v_views) or owner_id = p_user);
  delete from public.catalog_entries where collection_id = any (v_views) or owner_id = p_user;
  delete from public.view_link_takes where user_id = p_user or token in (select token from public.view_links where collection_id = any (v_views) or owner_id = p_user);
  delete from public.view_links where collection_id = any (v_views) or owner_id = p_user;
  delete from public.collection_shares where from_user = p_user or to_user = p_user or collection_id = any (v_views) or copy_id = any (v_views);
  delete from public.collection_senses where collection_id = any (v_views) or sense_id = any (v_senses);
  delete from public.collection_rules where collection_id = any (v_views);
  delete from public.collections where id = any (v_views);
  delete from public.sense_links where from_sense = any (v_senses) or to_sense = any (v_senses);
  delete from public.library_entries where sense_id = any (v_senses);
  delete from public.sense_progress where sense_id = any (v_senses);
  delete from public.senses where id = any (v_senses);

  delete from auth.users where id = p_user;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, before)
  values ((select auth.uid()), 'player.delete', p.username, 'player', p.username,
    jsonb_build_object('username', p.username, 'role', p.role, 'score', p.score, 'mastered_count', p.mastered_count, 'study_streak', p.study_streak,
      'live_wins', p.live_wins, 'live_played', p.live_played, 'joined', p.created_at));
end;
$$;

revoke execute on function public.admin_delete_player(uuid) from public, anon;
grant execute on function public.admin_delete_player(uuid) to authenticated;
notify pgrst, 'reload schema';
