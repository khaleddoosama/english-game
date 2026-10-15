-- Rollback of migrations 0037-0040: puts the five functions they replaced back as they were
-- before (generated from a database at migration 0036) and removes what they added.
-- Run in one transaction:  psql "$URL" -1 -f supabase/rollback/0037_0040_down.sql
--
-- What it cannot undo (data the migrations changed):
--  0037  senses renamed in place keep their new legacy_key (harmless: it is the right key).
--  0038  players deleted with the new function stay deleted (that is what delete means).
--  0040  offers that were ended ('expired') become 'dismissed': they are not brought back
--        as waiting offers, because many were between players who are not friends.
-- Nothing else is changed by the migrations.

-- 0040
update public.collection_shares set status = 'dismissed', updated_at = now() where status = 'expired';
alter table public.collection_shares drop constraint collection_shares_status_check;
alter table public.collection_shares add constraint collection_shares_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'dismissed'::text])));

-- 0040: friend_remove as it was
CREATE OR REPLACE FUNCTION public.friend_remove(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

-- 0040: view_shares_inbox as it was
CREATE OR REPLACE FUNCTION public.view_shares_inbox()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  where s.to_user = (select auth.uid()) and s.status = 'pending';
$function$

;

-- 0039: content_save_v2 as it was
CREATE OR REPLACE FUNCTION public.content_save_v2(p_draft uuid, p_upserts jsonb, p_removes jsonb, p_level_order jsonb, p_note text, p_renames jsonb, p_expected_version bigint, p_publish boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current bigint;
  v_all jsonb;
  v_version bigint;
  v_renamed integer;
begin
  perform public.require_admin();
  if jsonb_typeof(coalesce(p_upserts, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_removes, '[]'::jsonb)) <> 'array' then
    raise exception 'upserts and removes must be lists' using errcode = '22023';
  end if;
  if not coalesce(p_publish, false) then
    if p_draft is null then raise exception 'a draft id is needed' using errcode = '22023'; end if;
    delete from public.content_drafts where created_at < now() - interval '1 day';
    insert into public.content_drafts (draft_id, admin_id, kind, key, item)
    select p_draft, (select auth.uid()), u ->> 'kind', u ->> 'key', u from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) as u
    on conflict (draft_id, kind, key) do update set item = excluded.item;
    return jsonb_build_object('staged', (select count(*) from public.content_drafts where draft_id = p_draft));
  end if;
  perform pg_advisory_xact_lock(hashtext('content-publish'));
  select version into v_current from public.content_meta where id = 1 for update;
  if p_expected_version is not null and v_current is distinct from p_expected_version then
    raise exception 'The content was changed in another tab or by another admin (version % there, % here). Reload the page to get the latest, then redo your last change.', v_current, p_expected_version
      using errcode = '40001';
  end if;
  select coalesce(jsonb_agg(item order by created_at, kind, key), '[]'::jsonb) into v_all
  from public.content_drafts where draft_id = p_draft and admin_id = (select auth.uid());
  v_all := v_all || coalesce(p_upserts, '[]'::jsonb);
  v_version := public.apply_content_changes(v_all, p_removes, p_level_order, p_note);
  v_renamed := public.apply_item_renames(p_renames);
  delete from public.content_drafts where draft_id = p_draft;
  return jsonb_build_object('version', v_version, 'renamed', v_renamed);
end;
$function$

;
drop function if exists public.word_key_norm(text);

-- 0038: admin_delete_player as it was
CREATE OR REPLACE FUNCTION public.admin_delete_player(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.profiles;
begin
  perform public.require_admin();
  if p_user = (select auth.uid()) then raise exception 'you cannot delete your own account here' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  delete from auth.users where id = p_user;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, before)
  values ((select auth.uid()), 'player.delete', p.username, 'player', p.username,
    jsonb_build_object('username', p.username, 'role', p.role, 'score', p.score, 'mastered_count', p.mastered_count, 'study_streak', p.study_streak,
      'live_wins', p.live_wins, 'live_played', p.live_played, 'joined', p.created_at));
end;
$function$

;

-- 0037: dictionary_sync as it was
CREATE OR REPLACE FUNCTION public.dictionary_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_admin();
  return public.dictionary_sync_core();
end;
$function$

;
drop function if exists public.dictionary_follow_renames();

notify pgrst, 'reload schema';
