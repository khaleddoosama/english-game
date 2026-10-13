-- A player's own word: made in the app (typed in, or written by the AI helper
-- and kept), it is a private sense of the shared dictionary — only its owner
-- sees it, and it can be put in views like any other word. Making the same
-- word again (same headword and label) gives back the one that exists.
-- Limit: 500 words of one's own.

create or replace function public.sense_create(
  p_word text, p_type text default 'vocab', p_pos text[] default '{}', p_category text default null,
  p_meaning text default null, p_content jsonb default '{}'::jsonb, p_source text default 'user')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_word text := btrim(coalesce(p_word, ''));
  v_head text;
  v_label text;
  v_hid uuid;
  v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if length(v_word) not between 1 and 120 then raise exception 'A word is 1 to 120 characters.' using errcode = '22023'; end if;
  if btrim(coalesce(p_meaning, '')) = '' or length(p_meaning) > 2000 then raise exception 'Give the word a meaning (up to 2000 characters).' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_content, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_content, '{}'::jsonb)) > 60000 then
    raise exception 'That word card is too big.' using errcode = '22023';
  end if;
  v_head := btrim(regexp_replace(v_word, '\s*\([^)]*\)\s*$', ''));
  v_label := nullif(btrim(coalesce(substring(v_word from '\(([^)]*)\)\s*$'), '')), '');
  if v_head = '' then raise exception 'A word is 1 to 120 characters.' using errcode = '22023'; end if;

  -- the one I already made
  select s.id into v_id from public.senses s join public.headwords h on h.id = s.headword_id
  where s.owner_id = v_me and s.deleted_at is null and lower(h.text) = lower(v_head) and lower(coalesce(s.label, '')) = lower(coalesce(v_label, ''));
  if found then
    insert into public.library_entries (user_id, sense_id) values (v_me, v_id)
    on conflict (user_id, sense_id) do update set removed_at = null where public.library_entries.removed_at is not null;
    return jsonb_build_object('id', v_id, 'existing', true);
  end if;

  if (select count(*) from public.senses where owner_id = v_me and deleted_at is null) >= 500 then
    raise exception 'You have 500 words of your own, the most there can be.' using errcode = '55000';
  end if;
  insert into public.headwords (text) values (v_head) on conflict (lower(text)) do nothing;
  select id into v_hid from public.headwords where lower(text) = lower(v_head);
  insert into public.senses (headword_id, label, type, pos, category, meaning, content, visibility, owner_id, source)
  values (v_hid, v_label,
          case when p_type in ('vocab', 'idiom', 'binomial', 'phrasal', 'fyi', 'pun') then p_type else 'vocab' end,
          coalesce(p_pos, '{}'::text[]), nullif(btrim(coalesce(p_category, '')), ''), btrim(p_meaning), coalesce(p_content, '{}'::jsonb),
          'private', v_me, case when p_source = 'ai' then 'ai' else 'user' end)
  returning id into v_id;
  insert into public.library_entries (user_id, sense_id) values (v_me, v_id);
  return jsonb_build_object('id', v_id, 'existing', false);
end;
$$;

revoke execute on function public.sense_create(text, text, text[], text, text, jsonb, text) from public, anon;
grant execute on function public.sense_create(text, text, text[], text, text, jsonb, text) to authenticated;
