-- Deleting a player who used the library (migration 0038): their views, own
-- words, shares, links and catalog entries go; what others copied stays.
-- begin; <this>; rollback;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;

do $$
declare
  v_admin uuid; v_eve uuid; v_fay uuid; v_word uuid; v_view uuid; v_sub uuid; v_link jsonb; v_copy jsonb; v_entry jsonb; v_taken jsonb; v_fay_view uuid;
begin
  perform public.register_player('dp_eve', 'secret1');
  perform public.register_player('dp_fay', 'secret1');
  select id into v_admin from public.profiles where username = 'ci_admin';
  select id into v_eve from public.profiles where username = 'dp_eve';
  select id into v_fay from public.profiles where username = 'dp_fay';

  perform set_config('request.jwt.claims', json_build_object('sub', v_eve, 'role', 'authenticated')::text, true);
  perform public.friend_request('dp_fay');
  perform set_config('request.jwt.claims', json_build_object('sub', v_fay, 'role', 'authenticated')::text, true);
  perform public.friend_respond(v_eve, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_eve, 'role', 'authenticated')::text, true);
  v_word := (public.sense_create('dpOwnWord', 'vocab', '{}', null, 'mine', '{}'::jsonb, 'user') ->> 'id')::uuid;
  v_view := public.view_create('dp view');
  v_sub := public.view_create('dp sub', v_view);
  perform public.view_add(v_sub, array[v_word]);
  perform public.view_share(v_view, array[v_fay]);
  v_link := public.view_link_create(v_view);
  v_entry := public.catalog_publish(v_view, 'dp entry', '');

  -- Fay takes a copy by link and through the catalog; she also sends Eve a view
  perform set_config('request.jwt.claims', json_build_object('sub', v_fay, 'role', 'authenticated')::text, true);
  v_copy := public.view_link_accept(v_link ->> 'token');
  v_taken := public.catalog_take((v_entry ->> 'id')::uuid);
  v_fay_view := public.view_create('dp fay view');
  perform public.view_share(v_fay_view, array[v_eve]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_eve, 'role', 'authenticated')::text, true);
  perform public.view_share_accept((select id from public.collection_shares where to_user = v_eve limit 1));

  -- the admin deletes Eve
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.admin_delete_player(v_eve);

  perform pg_temp.must(not exists (select 1 from public.profiles where id = v_eve), 'the player is gone');
  perform pg_temp.must(not exists (select 1 from public.collections where owner_id = v_eve), 'her views are gone');
  perform pg_temp.must(not exists (select 1 from public.senses where id = v_word), 'her own word is gone');
  perform pg_temp.must(not exists (select 1 from public.view_links where owner_id = v_eve), 'her links are gone');
  perform pg_temp.must(not exists (select 1 from public.catalog_entries where owner_id = v_eve), 'her catalog entries are gone');
  perform pg_temp.must(not exists (select 1 from public.collection_shares where from_user = v_eve or to_user = v_eve), 'her shares are gone');
  perform pg_temp.must(exists (select 1 from public.collections where id = (v_copy ->> 'view')::uuid and owner_id = v_fay), 'the copy Fay took by link stays hers');
  perform pg_temp.must(exists (select 1 from public.collections where id = (v_taken ->> 'view')::uuid and owner_id = v_fay), 'the copy Fay took from the catalog stays hers');
  perform pg_temp.must(exists (select 1 from public.collections where id = v_fay_view), 'Fay''s own view stays');
  perform pg_temp.must(exists (select 1 from public.admin_audit where action = 'player.delete' and target = 'dp_eve'), 'the deletion is in the audit log');

  -- a player cannot delete anyone
  perform set_config('request.jwt.claims', json_build_object('sub', v_fay, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_delete_player(v_admin);
    raise exception 'FAIL: a player could delete an account';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  raise exception 'ADMIN DELETE PLAYER TESTS PASSED';
end $$;
