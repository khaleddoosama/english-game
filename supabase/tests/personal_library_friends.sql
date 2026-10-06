do $$
declare a uuid; b uuid; c uuid; f uuid; n int; payload jsonb; room text;
begin
  perform public.register_player('lib_alice','secret1');perform public.register_player('lib_bob','secret1');perform public.register_player('lib_cara','secret1');
  select id into a from public.profiles where username='lib_alice';select id into b from public.profiles where username='lib_bob';select id into c from public.profiles where username='lib_cara';
  insert into public.content_items(kind,key,data) values
    ('words','apple','{"word":"apple","partsOfSpeech":["noun"],"meaning":"a fruit","units":["Food"]}'),
    ('words','bread','{"word":"bread","partsOfSpeech":["noun"],"meaning":"baked food","units":["Food"]}'),
    ('words','retired','{"word":"retired","units":["Old"]}'),
    ('grammar','food-rule','{"id":"food-rule","units":["Food"]}'),
    ('grammar','old-rule','{"id":"old-rule","units":["Old"]}');
  update public.content_items set deleted=true where key='retired';
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  payload:=public.my_library_content();
  if jsonb_array_length(payload->'words')<>0 or jsonb_array_length(payload->'grammar')<>0 then raise exception 'FAIL: empty library falls back to global content';end if;
  insert into public.personal_words(word_key) values ('apple');
  begin insert into public.personal_words(user_id,word_key) values(b,'bread');raise exception 'FAIL: writes another library';exception when insufficient_privilege then null;end;
  begin insert into public.personal_words(word_key) values('retired');raise exception 'FAIL: chooses retired content';exception when insufficient_privilege then null;end;
  payload:=public.my_library_content();
  if jsonb_array_length(payload->'words')<>1 or payload->'words'->0->>'word'<>'apple' or jsonb_array_length(payload->'grammar')<>1 then raise exception 'FAIL: personal scope incorrect %',payload;end if;
  insert into public.friendships(recipient) values(b) returning id into f;
  begin update public.friendships set requester=b where id=f;raise exception 'FAIL: requester identity changed';exception when insufficient_privilege then null;end;
  update public.friendships set status='accepted' where id=f;
  select count(*) into n from public.friendships where id=f and status='accepted';if n<>0 then raise exception 'FAIL: sender accepts own request';end if;
  begin insert into public.friend_shares(recipient,word_keys) values(b,array['apple']);raise exception 'FAIL: shared with pending friend';exception when insufficient_privilege then null;end;
  begin perform public.store_generated_word(a,'{"word":"evil","partsOfSpeech":["noun"],"meaning":"x"}');raise exception 'FAIL: client publishes AI words';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',json_build_object('sub',c,'role','authenticated')::text,true);
  select count(*) into n from public.friendships;if n<>0 then raise exception 'FAIL: outsider sees request';end if;
  select count(*) into n from public.personal_words;if n<>0 then raise exception 'FAIL: outsider sees library';end if;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  update public.friendships set status='accepted' where id=f;
  select count(*) into n from public.friendships where id=f and status='accepted';if n<>1 then raise exception 'FAIL: recipient cannot accept';end if;
  begin insert into public.friendships(requester,recipient,status) values(b,c,'accepted');raise exception 'FAIL: self-approved friendship';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  insert into public.friend_shares(recipient,word_keys) values(b,array['apple']);
  begin insert into public.friend_shares(recipient,word_keys) values(b,array['bread']);raise exception 'FAIL: shares unselected words';exception when insufficient_privilege then null;end;
  room:=public.live_create('Friends',20,3,'together','{}','[{"mode":"meaning","prompt":"one","options":["Apple","Bread"],"answer":"Apple","word":"apple"},{"mode":"meaning","prompt":"two","options":["Apple","Bread"],"answer":"Bread","word":"bread"},{"mode":"meaning","prompt":"three","options":["Apple","Bread"],"answer":"Apple","word":"apple"}]');
  insert into public.friend_invites(recipient,code) values(b,room);
  begin insert into public.friend_invites(recipient,code) values(c,room);raise exception 'FAIL: invites nonfriend';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  select count(*) into n from public.friend_shares;if n<>1 then raise exception 'FAIL: recipient cannot read shared words';end if;
  select count(*) into n from public.friend_invites;if n<>1 then raise exception 'FAIL: recipient cannot read invitation';end if;
  select count(*) into n from public.personal_words;if n<>0 then raise exception 'FAIL: sharing automatically added words';end if;
  insert into public.personal_words(word_key) values('apple');
  begin insert into public.friend_invites(recipient,code) values(a,room);raise exception 'FAIL: nonhost sends challenge invitation';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',json_build_object('sub',c,'role','authenticated')::text,true);
  select count(*) into n from public.friend_shares;if n<>0 then raise exception 'FAIL: outsider reads shares';end if;
  select count(*) into n from public.friend_invites;if n<>0 then raise exception 'FAIL: outsider reads invites';end if;
  execute 'reset role';
  -- Server concurrent/casing reuse preserves the existing published definition.
  execute 'set local role service_role';
  payload:=public.store_generated_word(c,'{"word":"Apple","partsOfSpeech":["noun"],"meaning":"overwrite"}');
  if payload->>'meaning'<>'a fruit' then raise exception 'FAIL: existing content overwritten';end if;
  perform public.store_generated_word(c,'{"word":"freshword","partsOfSpeech":["noun"],"meaning":"fresh","units":["Food"]}');
  perform public.store_generated_word(c,'{"word":"FreshWord","partsOfSpeech":["noun"],"meaning":"overwrite"}');
  select count(*) into n from public.content_items where kind='words' and lower(key)='freshword';if n<>1 then raise exception 'FAIL: duplicate generated headword';end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  delete from public.personal_words where word_key='apple';
  if jsonb_array_length(public.my_library_content()->'words')<>0 then raise exception 'FAIL: removed word still practised';end if;
  delete from public.friendships where id=f;
  begin insert into public.friend_invites(recipient,code) values(b,room);raise exception 'FAIL: removed friend still receives invitations';exception when insufficient_privilege then null;end;
  execute 'reset role';
  execute 'set local role anon';
  begin perform public.my_library_content();raise exception 'FAIL: anonymous library access';exception when insufficient_privilege then null;end;
  begin select count(*) into n from public.friendships;raise exception 'FAIL: anonymous friendship access';exception when insufficient_privilege then null;end;
  execute 'reset role';
  raise exception 'PERSONAL LIBRARY FRIENDS TESTS PASSED: selection, privacy, requests, sharing, invites, canonical AI reuse';
end $$;
