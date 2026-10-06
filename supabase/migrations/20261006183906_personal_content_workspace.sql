-- Private authoring/overrides never update the shared catalogue.
create table public.personal_content_items (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('words','grammar')),
  key text not null check (length(key) between 1 and 200),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id,kind,key),
  check (data->>(case when kind='words' then 'word' else 'id' end) = key)
);
create unique index personal_content_spelling on public.personal_content_items(user_id,kind,lower(key));
alter table public.personal_content_items enable row level security;
revoke all on public.personal_content_items from anon, authenticated;
grant select,insert,update,delete on public.personal_content_items to authenticated;
grant all on public.personal_content_items to service_role;
create policy "private content owner" on public.personal_content_items to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create or replace function public.my_library_content() returns jsonb language sql stable security invoker set search_path='' as $$
  with chosen as (
    select c.data,c.position,c.key from public.personal_words w join public.content_items c on c.kind=w.kind and c.key=w.word_key
    where w.user_id=(select auth.uid()) and not c.deleted
  ), units as (select distinct jsonb_array_elements_text(coalesce(data->'units','[]')) as unit from chosen),
  base as (
    select 'words' as kind,key,data,position from chosen
    union all
    select c.kind,c.key,c.data,c.position from public.content_items c where c.kind='grammar' and not c.deleted
      and exists (select 1 from units u where coalesce(c.data->'units','[]') ? u.unit)
  ), effective as (
    select b.kind,b.key,b.data,b.position from base b where not exists (
      select 1 from public.personal_content_items p where p.user_id=(select auth.uid()) and p.kind=b.kind and lower(p.key)=lower(b.key))
    union all
    select p.kind,p.key,p.data,2140000000 from public.personal_content_items p where p.user_id=(select auth.uid()) and not p.deleted
  )
  select jsonb_build_object(
    'words',coalesce((select jsonb_agg(data order by position,key) from effective where kind='words'),'[]'),
    'grammar',coalesce((select jsonb_agg(data order by position,key) from effective where kind='grammar'),'[]'),
    'challenges','[]'::jsonb,'combos','[]'::jsonb,'stories','[]'::jsonb,'levelOrder','[]'::jsonb,'note','');
$$;

-- One atomic write for imports or grouping: an invalid row rolls back the batch.
create function public.save_personal_items(p_items jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; d jsonb; k text; typ text;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500 or octet_length(p_items::text)>2000000 then raise exception 'Expected 1 to 500 items (maximum 2 MB)' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    typ:=item->>'kind'; k:=btrim(item->>'key'); d:=item->'data';
    if typ not in ('words','grammar') or typ is null or k is null or length(k) not between 1 and 200 or jsonb_typeof(d) is distinct from 'object'
      or d->>(case when typ='words' then 'word' else 'id' end) is distinct from k or coalesce(btrim(d->>'category'),'')='' then
      raise exception 'Invalid personal item' using errcode='22023';
    end if;
    if (d ? 'units') and (jsonb_typeof(d->'units') is distinct from 'array') then raise exception 'Units must be an array' using errcode='22023'; end if;
    if typ='words' and (coalesce(btrim(d->>'meaning'),'')='' or coalesce(d->>'type','') not in ('vocab','idiom','phrasal','binomial','fyi')) then raise exception 'Incomplete word' using errcode='22023'; end if;
    if typ='grammar' and (coalesce(btrim(d->>'rule'),'')='' or coalesce(btrim(d->>'explanation'),'')='' or (not (d ? 'questions') and coalesce(d->>'answer','')='')) then raise exception 'Incomplete grammar rule' using errcode='22023'; end if;
    -- Preserve one spelling per personal key without renaming another person's data.
    delete from public.personal_content_items where user_id=auth.uid() and kind=typ and lower(key)=lower(k) and key<>k;
    insert into public.personal_content_items(user_id,kind,key,data) values(auth.uid(),typ,k,d)
      on conflict(user_id,kind,key) do update set data=excluded.data,deleted=false,updated_at=clock_timestamp();
  end loop;
end;
$$;
create function public.remove_personal_item(p_kind text,p_key text) returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or p_kind not in ('words','grammar') then raise exception 'Invalid request' using errcode='22023'; end if;
  if p_kind='words' then
    delete from public.personal_words where user_id=auth.uid() and lower(word_key)=lower(p_key);
    delete from public.personal_content_items where user_id=auth.uid() and kind='words' and lower(key)=lower(p_key);
  else
    insert into public.personal_content_items(user_id,kind,key,data,deleted) values(auth.uid(),'grammar',p_key,jsonb_build_object('id',p_key),true)
      on conflict(user_id,kind,key) do update set deleted=true,updated_at=clock_timestamp();
  end if;
end;
$$;
revoke all on function public.save_personal_items(jsonb),public.remove_personal_item(text,text) from public,anon;
grant execute on function public.save_personal_items(jsonb),public.remove_personal_item(text,text) to authenticated;

-- Capture the sender's own version, including private categories and authored words.
alter table public.friend_shares add column entries jsonb not null default '[]';
create function public.snapshot_shared_words() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  select coalesce(jsonb_agg(w),'[]') into new.entries from jsonb_array_elements(public.my_library_content()->'words') w where w->>'word'=any(new.word_keys);
  if jsonb_array_length(new.entries)<>cardinality(new.word_keys) then raise exception 'Choose words from your library' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function public.snapshot_shared_words() from public,anon,authenticated;
create trigger capture_shared_words before insert on public.friend_shares for each row execute function public.snapshot_shared_words();
drop policy "share to accepted friend" on public.friend_shares;
create policy "share to accepted friend" on public.friend_shares for insert to authenticated with check (
  sender=(select auth.uid()) and exists(select 1 from public.friendships f where f.status='accepted'
    and least(f.requester,f.recipient)=least(sender,friend_shares.recipient) and greatest(f.requester,f.recipient)=greatest(sender,friend_shares.recipient))
  and jsonb_array_length(entries)=cardinality(word_keys)
);
create function public.accept_word_share(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare shared public.friend_shares; items jsonb;
begin
  select * into shared from public.friend_shares where id=p_id and recipient=auth.uid();
  if not found then raise exception 'Share not found' using errcode='42501'; end if;
  if jsonb_array_length(shared.entries)>0 then
    -- Adding a share does not overwrite the recipient's existing personal edits.
    select coalesce(jsonb_agg(jsonb_build_object('kind','words','key',w->>'word','data',w)),'[]') into items
      from jsonb_array_elements(shared.entries) w where not exists (
        select 1 from jsonb_array_elements(public.my_library_content()->'words') own where lower(own->>'word')=lower(w->>'word'));
    if jsonb_array_length(items)>0 then perform public.save_personal_items(items); end if;
  else
    insert into public.personal_words(user_id,word_key) select auth.uid(),k from unnest(shared.word_keys) k on conflict do nothing;
  end if;
  delete from public.friend_shares where id=p_id;
end;
$$;
revoke all on function public.accept_word_share(uuid) from public,anon;
grant execute on function public.accept_word_share(uuid) to authenticated;
notify pgrst,'reload schema';

-- Reuse every published match in one round trip before starting any AI work.
create function public.choose_bulk_words(p_terms text[]) returns jsonb language plpgsql security invoker set search_path='' as $$
declare lowered text[]; result jsonb;
begin
  if auth.uid() is null or p_terms is null or cardinality(p_terms)>100 then raise exception 'Invalid batch' using errcode='22023'; end if;
  select array_agg(lower(btrim(t))) into lowered from unnest(p_terms) t;
  insert into public.personal_words(user_id,word_key)
    select auth.uid(),c.key from public.content_items c where c.kind='words' and not c.deleted and lower(c.key)=any(lowered) on conflict do nothing;
  select coalesce(jsonb_agg(w),'[]') into result from jsonb_array_elements(public.my_library_content()->'words') w where lower(w->>'word')=any(lowered);
  return result;
end;
$$;
revoke all on function public.choose_bulk_words(text[]) from public,anon;
grant execute on function public.choose_bulk_words(text[]) to authenticated;
notify pgrst,'reload schema';
