-- Branch-only schema. Apply to an isolated preview database before testing.
create table public.personal_words (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null default 'words' check (kind = 'words'),
  word_key text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, word_key),
  foreign key (kind, word_key) references public.content_items(kind, key) on update cascade on delete cascade
);
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> recipient)
);
create unique index friendships_pair on public.friendships(least(requester, recipient), greatest(requester, recipient));
create index friendships_recipient on public.friendships(recipient);
create table public.friend_shares (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  word_keys text[] not null check (cardinality(word_keys) between 1 and 100),
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index friend_shares_recipient on public.friend_shares(recipient, created_at desc);
create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  code text not null references public.live_challenges(code) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recipient, code),
  check (sender <> recipient)
);
create index friend_invites_recipient on public.friend_invites(recipient, created_at desc);

alter table public.personal_words enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_shares enable row level security;
alter table public.friend_invites enable row level security;
revoke all on public.personal_words, public.friendships, public.friend_shares, public.friend_invites from anon, authenticated;
grant select, insert, delete on public.personal_words, public.friendships, public.friend_shares, public.friend_invites to authenticated;
grant all on public.personal_words, public.friendships, public.friend_shares, public.friend_invites to service_role;
grant select, insert, update on public.content_items to service_role;
grant select, update on public.content_meta to service_role;
grant select on public.profiles to service_role;
grant update(status) on public.friendships to authenticated;

create policy "own library read" on public.personal_words for select to authenticated using (user_id = (select auth.uid()));
create policy "choose published words" on public.personal_words for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.content_items c where c.kind = 'words' and c.key = word_key and not c.deleted));
create policy "own library remove" on public.personal_words for delete to authenticated using (user_id = (select auth.uid()));
create policy "friend participants read" on public.friendships for select to authenticated using ((select auth.uid()) in (requester, recipient));
create policy "send pending request" on public.friendships for insert to authenticated with check (requester = (select auth.uid()) and status = 'pending');
create policy "recipient accepts" on public.friendships for update to authenticated using (recipient = (select auth.uid()) and status = 'pending') with check (recipient = (select auth.uid()) and status = 'accepted');
create policy "remove or decline friend" on public.friendships for delete to authenticated using ((select auth.uid()) in (requester, recipient));
create policy "share participants read" on public.friend_shares for select to authenticated using ((select auth.uid()) in (sender, recipient));
create policy "share to accepted friend" on public.friend_shares for insert to authenticated with check (
  sender = (select auth.uid()) and exists (select 1 from public.friendships f where f.status = 'accepted' and least(f.requester,f.recipient) = least(sender,friend_shares.recipient) and greatest(f.requester,f.recipient) = greatest(sender,friend_shares.recipient))
  and not exists (select 1 from unnest(word_keys) k where not exists (select 1 from public.personal_words w where w.user_id = (select auth.uid()) and w.word_key = k))
);
create policy "dismiss share" on public.friend_shares for delete to authenticated using ((select auth.uid()) in (sender, recipient));
create policy "invite participants read" on public.friend_invites for select to authenticated using ((select auth.uid()) in (sender, recipient));
create policy "invite accepted friend to own open room" on public.friend_invites for insert to authenticated with check (
  sender = (select auth.uid()) and exists (select 1 from public.friendships f where f.status = 'accepted' and least(f.requester,f.recipient) = least(sender,friend_invites.recipient) and greatest(f.requester,f.recipient) = greatest(sender,friend_invites.recipient))
  and exists (select 1 from public.live_challenges c where c.code = friend_invites.code and c.host_id = (select auth.uid()) and c.state <> 'done' and c.expires_at > now())
);
create policy "dismiss invite" on public.friend_invites for delete to authenticated using ((select auth.uid()) in (sender, recipient));

-- Invoker: the caller's RLS always determines which personal words are returned.
create function public.my_library_content() returns jsonb language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select c.data, c.position, c.key from public.personal_words w join public.content_items c on c.kind = w.kind and c.key = w.word_key
    where w.user_id = (select auth.uid()) and not c.deleted
  ), units as (select distinct jsonb_array_elements_text(coalesce(data->'units','[]')) as unit from chosen)
  select jsonb_build_object(
    'words', coalesce((select jsonb_agg(data order by position,key) from chosen),'[]'),
    'grammar', coalesce((select jsonb_agg(c.data order by c.position,c.key) from public.content_items c where c.kind = 'grammar' and not c.deleted and exists (select 1 from units u where coalesce(c.data->'units','[]') ? u.unit)),'[]'),
    'challenges','[]'::jsonb, 'combos','[]'::jsonb, 'stories','[]'::jsonb, 'levelOrder','[]'::jsonb, 'note',''
  );
$$;
revoke all on function public.my_library_content() from public, anon;
grant execute on function public.my_library_content() to authenticated;

-- One server-only transaction rechecks the catalogue, inserts if still missing,
-- and attaches the shared record to the authenticated user's library.
create function public.store_generated_word(p_user uuid, p_word jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_key text; v_data jsonb;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then raise exception 'Unknown player' using errcode = '22023'; end if;
  v_key := btrim(p_word->>'word');
  if v_key is null or length(v_key) not between 1 and 80 or jsonb_typeof(p_word->'partsOfSpeech') <> 'array' or coalesce(jsonb_array_length(p_word->'partsOfSpeech'),0) = 0 or coalesce(p_word->>'meaning','') = '' then raise exception 'Incomplete word' using errcode = '22023'; end if;
  -- Serialize canonical spelling variants, including concurrent AI requests.
  perform pg_advisory_xact_lock(hashtextextended(lower(regexp_replace(v_key,'\s+',' ','g')), 0));
  select key,data into v_key,v_data from public.content_items where kind = 'words' and not deleted and lower(regexp_replace(btrim(key),'\s+',' ','g')) = lower(regexp_replace(btrim(p_word->>'word'),'\s+',' ','g')) order by position,key limit 1;
  if not found then
    v_key := btrim(p_word->>'word'); v_data := p_word;
    insert into public.content_items(kind,key,data,position) values ('words',v_key,v_data,2140000000)
      on conflict (kind,key) do update set data = excluded.data, deleted = false, updated_at = clock_timestamp();
    update public.content_meta set version = version + 1, updated_at = clock_timestamp(),
      level_order = case when coalesce(v_data->>'category','') = '' or level_order ? (v_data->>'category') then level_order else level_order || jsonb_build_array(v_data->>'category') end
      where id = 1;
  end if;
  insert into public.personal_words(user_id,word_key) values (p_user,v_key) on conflict do nothing;
  return v_data;
end;
$$;
revoke all on function public.store_generated_word(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.store_generated_word(uuid,jsonb) to service_role;

-- Keep library selections and pending shares when an admin renames a headword.
create function public.follow_library_word_rename() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'word' then
    insert into public.personal_words(user_id,word_key)
      select user_id,new.to_key from public.personal_words where word_key = new.from_key
      and exists (select 1 from public.content_items where kind = 'words' and key = new.to_key and not deleted)
      on conflict do nothing;
    delete from public.personal_words where word_key = new.from_key and exists (select 1 from public.content_items where kind = 'words' and key = new.to_key and not deleted);
    update public.friend_shares set word_keys = array_replace(word_keys,new.from_key,new.to_key) where new.from_key = any(word_keys);
  end if;
  return new;
end;
$$;
revoke all on function public.follow_library_word_rename() from public, anon, authenticated;
create trigger library_word_renamed after insert or update on public.item_key_aliases for each row execute function public.follow_library_word_rename();

notify pgrst, 'reload schema';
