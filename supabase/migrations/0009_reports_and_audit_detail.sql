-- 1) Reports keep every detail in real columns: the question, its options
--    and right answers, what the player answered, the reason and note, the
--    round it came from, who filed it and when. The game sends them in
--    `data`; a trigger copies them out so they can be filtered and queried.
-- 2) The activity log records every change with who, when, which item and
--    the value of each changed field before and after. Triggers write it,
--    so nothing that changes data can skip the log.

-- --------------------------------------------------------------- reports
alter table public.reports
  add column reported_at timestamptz,
  add column reason text,
  add column note text,
  add column question_mode text,
  add column question_type text,
  add column question_prompt text,
  add column question_options jsonb,
  add column correct_answers jsonb,
  add column player_answer text,
  add column player_was_correct boolean,
  add column target_words text[],
  add column session_title text,
  add column session_kind text;

create or replace function public.reports_fill_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d jsonb := coalesce(new.data, '{}'::jsonb);
  q jsonb := coalesce(d -> 'question', '{}'::jsonb);
  a jsonb := d -> 'learnerAnswer';
begin
  new.reported_at := coalesce(
    case when (d ->> 'at') ~ '^[0-9]+(\.[0-9]+)?$' then to_timestamp((d ->> 'at')::double precision / 1000) end,
    new.created_at, now());
  new.reason := nullif(d ->> 'reason', '');
  new.note := nullif(d ->> 'details', '');
  new.question_mode := coalesce(q ->> 'mode', d ->> 'mode');
  new.question_type := coalesce(q ->> 'type', d ->> 'type');
  new.question_prompt := coalesce(q ->> 'prompt', d ->> 'prompt');
  new.question_options := coalesce(q -> 'options', d -> 'options');
  new.correct_answers := coalesce(q -> 'answers', d -> 'answers');
  new.player_answer := coalesce(d ->> 'learnerAnswerText',
    case jsonb_typeof(a)
      when 'array' then (select string_agg(x, ' + ') from jsonb_array_elements_text(a) x)
      when 'string' then a #>> '{}'
      when 'null' then null
      else a::text end);
  new.player_was_correct := case when jsonb_typeof(d -> 'wasCorrect') = 'boolean' then (d ->> 'wasCorrect')::boolean end;
  new.target_words := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(coalesce(q -> 'targets', d -> 'targetWords')) = 'array' then coalesce(q -> 'targets', d -> 'targetWords') else '[]'::jsonb end) x), '{}');
  new.session_title := d #>> '{session,title}';
  new.session_kind := d #>> '{session,kind}';
  return new;
end;
$$;
create trigger reports_fill_columns before insert or update of data on public.reports
  for each row execute function public.reports_fill_columns();
update public.reports set data = data; -- fill existing rows
create index reports_reported_at_idx on public.reports (reported_at desc);

-- ------------------------------------------------------------ audit log
alter table public.admin_audit
  add column entity text,     -- words, grammar, stories…, categories, report, player, live, settings
  add column item_key text,   -- the word, rule id, report id, username…
  add column batch_id uuid,   -- one save of many items
  add column changes jsonb,   -- { field: { "before": …, "after": … } } for edits
  add column before jsonb,    -- the whole item, for deletions
  add column after jsonb;     -- the whole item, for additions
create index admin_audit_batch_idx on public.admin_audit (batch_id) where batch_id is not null;
create index admin_audit_entity_idx on public.admin_audit (entity, item_key);
create index admin_audit_action_idx on public.admin_audit (action, at desc);

-- Top-level fields whose value differs.
create or replace function public.jsonb_changes(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('before', p_before -> k, 'after', p_after -> k)), '{}'::jsonb)
  from (
    select jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) as k
    union
    select jsonb_object_keys(coalesce(p_after, '{}'::jsonb))
  ) keys
  where (p_before -> k) is distinct from (p_after -> k);
$$;

-- A save groups its rows: apply_content_changes sets app.audit_batch.
create or replace function public.audit_batch()
returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('app.audit_batch', true), '')::uuid; $$;

create or replace function public.audit_content_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(new.kind, old.kind);
  v_key text := coalesce(new.key, old.key);
  v_action text;
begin
  if tg_op = 'INSERT' then
    if new.deleted then return null; end if;
    insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, after)
    values ((select auth.uid()), 'content.create', v_kind || ': ' || v_key, v_kind, v_key, public.audit_batch(), new.data);
  elsif tg_op = 'DELETE' then
    if old.deleted then return null; end if;
    insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, before)
    values ((select auth.uid()), 'content.delete', v_kind || ': ' || v_key, v_kind, v_key, public.audit_batch(), old.data);
  else
    if old.deleted = new.deleted and old.data = new.data then return null; end if; -- only its position moved
    if new.deleted then
      insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, before)
      values ((select auth.uid()), 'content.delete', v_kind || ': ' || v_key, v_kind, v_key, public.audit_batch(), old.data);
    elsif old.deleted then
      insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, after)
      values ((select auth.uid()), 'content.create', v_kind || ': ' || v_key, v_kind, v_key, public.audit_batch(), new.data);
    else
      insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, changes)
      values ((select auth.uid()), 'content.update', v_kind || ': ' || v_key, v_kind, v_key, public.audit_batch(), public.jsonb_changes(old.data, new.data));
    end if;
  end if;
  return null;
end;
$$;
create trigger audit_content_items after insert or update or delete on public.content_items
  for each row execute function public.audit_content_item();

create or replace function public.audit_content_meta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := public.jsonb_changes(jsonb_build_object('level_order', old.level_order, 'note', old.note), jsonb_build_object('level_order', new.level_order, 'note', new.note));
begin
  if v_changes = '{}'::jsonb then return null; end if;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, batch_id, changes)
  values ((select auth.uid()), 'categories.update', 'Category order and content note', 'categories', 'level_order', public.audit_batch(), v_changes);
  return null;
end;
$$;
create trigger audit_content_meta after update on public.content_meta
  for each row execute function public.audit_content_meta();

-- Report changes made by the admin (players' own edits aren't logged).
create or replace function public.audit_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := left(coalesce(coalesce(new.question_prompt, old.question_prompt), coalesce(new.id, old.id)), 120);
begin
  if not public.is_admin() then return null; end if;
  if tg_op = 'DELETE' then
    insert into public.admin_audit (admin_id, action, target, entity, item_key, before)
    values ((select auth.uid()), 'report.delete', v_label, 'report', old.id, old.data || jsonb_build_object('_reporter', (select username from public.profiles where id = old.user_id)));
  elsif new.user_id <> (select auth.uid()) or old.resolved_at is distinct from new.resolved_at then
    if old.resolved_at is distinct from new.resolved_at then
      insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
      values ((select auth.uid()), case when new.resolved_at is null then 'report.reopen' else 'report.resolve' end, v_label, 'report', new.id,
        jsonb_build_object('status', jsonb_build_object('before', case when old.resolved_at is null then 'open' else 'resolved' end, 'after', case when new.resolved_at is null then 'open' else 'resolved' end)));
    elsif old.data is distinct from new.data then
      insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
      values ((select auth.uid()), 'report.update', v_label, 'report', new.id, public.jsonb_changes(old.data, new.data));
    end if;
  end if;
  return null;
end;
$$;
create trigger audit_reports after update or delete on public.reports
  for each row execute function public.audit_report();

-- Content saves: one summary row per save, linked to its item rows.
create or replace function public.apply_content_changes(p_upserts jsonb, p_removes jsonb, p_level_order jsonb, p_note text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
  v_up integer := jsonb_array_length(coalesce(p_upserts, '[]'::jsonb));
  v_rm integer := jsonb_array_length(coalesce(p_removes, '[]'::jsonb));
  v_batch uuid := gen_random_uuid();
begin
  if not public.is_admin() then
    raise exception 'only the admin can change content' using errcode = '42501';
  end if;
  perform set_config('app.audit_batch', v_batch::text, true);
  insert into public.content_items (kind, key, data, position, deleted, updated_at)
  select u ->> 'kind', u ->> 'key', u -> 'data', coalesce((u ->> 'position')::integer, 0), false, now()
  from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) as u
  on conflict (kind, key) do update
    set data = excluded.data, position = excluded.position, deleted = false, updated_at = now();
  update public.content_items c
    set deleted = true, data = '{}'::jsonb, updated_at = now()
  from jsonb_array_elements(coalesce(p_removes, '[]'::jsonb)) as r
  where c.kind = r ->> 'kind' and c.key = r ->> 'key' and not c.deleted;
  update public.content_meta
    set level_order = coalesce(p_level_order, level_order),
        note = coalesce(p_note, note),
        version = version + 1,
        updated_at = now()
  where id = 1
  returning version into v_version;
  if v_up > 0 or v_rm > 0 then
    insert into public.admin_audit (admin_id, action, target, entity, batch_id, details)
    values ((select auth.uid()), 'content.save', null, 'content', v_batch, jsonb_build_object(
      'sent', v_up, 'removed', v_rm, 'version', v_version,
      'changed', (select count(*) from public.admin_audit a where a.batch_id = v_batch and a.action <> 'content.save')));
  end if;
  perform set_config('app.audit_batch', '', true);
  return v_version;
end;
$$;

-- Player actions now say what they changed.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_name text;
begin
  perform public.require_admin();
  if p_role not in ('admin', 'player') then raise exception 'role must be admin or player' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) and p_role <> 'admin' then raise exception 'you cannot remove your own admin role' using errcode = '42501'; end if;
  select role, username into v_old, v_name from public.profiles where id = p_user;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, details, changes)
  values ((select auth.uid()), 'player.role', v_name, 'player', v_name, jsonb_build_object('role', p_role),
    jsonb_build_object('role', jsonb_build_object('before', v_old, 'after', p_role)));
end;
$$;

create or replace function public.admin_set_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := (select username from public.profiles where id = p_user);
begin
  perform public.require_admin();
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then raise exception 'Password must be 6-72 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
  values ((select auth.uid()), 'player.password', v_name, 'player', v_name, jsonb_build_object('password', jsonb_build_object('before', '••••••', 'after', 'changed')));
end;
$$;

create or replace function public.admin_reset_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  v_words integer := (select count(*) from public.mastery where user_id = p_user);
begin
  perform public.require_admin();
  select * into p from public.profiles where id = p_user;
  delete from public.progress where user_id = p_user;
  delete from public.mastery where user_id = p_user;
  update public.profiles set score = 0, week_score = 0, mastered_count = 0, study_streak = 0, updated_at = now() where id = p_user;
  insert into public.admin_audit (admin_id, action, target, entity, item_key, changes)
  values ((select auth.uid()), 'player.reset', p.username, 'player', p.username, jsonb_build_object(
    'score', jsonb_build_object('before', p.score, 'after', 0),
    'week_score', jsonb_build_object('before', p.week_score, 'after', 0),
    'mastered_count', jsonb_build_object('before', p.mastered_count, 'after', 0),
    'study_streak', jsonb_build_object('before', p.study_streak, 'after', 0),
    'words_with_progress', jsonb_build_object('before', v_words, 'after', 0)));
end;
$$;

create or replace function public.admin_delete_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- The admin ending someone else's challenge is logged too.
create or replace function public.live_end(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.live_challenges;
begin
  select * into c from public.live_challenges where code = upper(p_code);
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

-- Internal helpers: not part of the API.
revoke execute on function public.reports_fill_columns() from public, anon, authenticated;
revoke execute on function public.audit_content_item() from public, anon, authenticated;
revoke execute on function public.audit_content_meta() from public, anon, authenticated;
revoke execute on function public.audit_report() from public, anon, authenticated;
revoke execute on function public.jsonb_changes(jsonb, jsonb) from public, anon;
revoke execute on function public.audit_batch() from public, anon;
grant execute on function public.jsonb_changes(jsonb, jsonb) to authenticated;
grant execute on function public.audit_batch() to authenticated;
notify pgrst, 'reload schema';
