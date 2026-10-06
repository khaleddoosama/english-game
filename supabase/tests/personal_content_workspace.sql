do $$
declare a uuid; b uuid; outsider uuid; share_id uuid; payload jsonb; n int; before_meaning text;
begin
  perform public.register_player('author_alice','secret1');perform public.register_player('author_bob','secret1');perform public.register_player('author_cara','secret1');
  select id into a from public.profiles where username='author_alice';select id into b from public.profiles where username='author_bob';select id into outsider from public.profiles where username='author_cara';
  insert into public.content_items(kind,key,data) values
    ('words','author-apple','{"word":"author-apple","type":"vocab","category":"Food","meaning":"global fruit","units":["Food"]}'),
    ('grammar','author-food-rule','{"id":"author-food-rule","rule":"Some and any","category":"Food","explanation":"Some in positive sentences.","units":["Food"],"questions":[{"type":"fix","sentence":"I have any apples.","answer":"I have some apples."}]}');
  insert into public.friendships(requester,recipient,status) values(a,b,'accepted');
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  payload:=public.choose_bulk_words(array['AUTHOR-APPLE','not-in-catalogue']);
  if jsonb_array_length(payload)<>1 then raise exception 'FAIL: bulk existing lookup not immediate/case insensitive';end if;
  perform public.save_personal_items('[{"kind":"words","key":"author-apple","data":{"word":"author-apple","type":"vocab","category":"My course","meaning":"my edited definition","units":["Unit 4","Revision"]}},{"kind":"words","key":"my-private-word","data":{"word":"my-private-word","type":"vocab","category":"My course","meaning":"private word","units":["Unit 4"]}},{"kind":"grammar","key":"my-private-rule","data":{"id":"my-private-rule","rule":"Used to","category":"My course","explanation":"Past habits.","units":["Unit 4"],"questions":[{"type":"fix","sentence":"I use to run.","answer":"I used to run."}]}}]');
  payload:=public.choose_bulk_words(array['AUTHOR-APPLE','my-private-word']);
  if jsonb_array_length(payload)<>2 or not exists(select 1 from jsonb_array_elements(payload) w where w->>'word'='author-apple' and w->>'meaning'='my edited definition') then raise exception 'FAIL: bulk reuse lost private edits';end if;
  payload:=public.my_library_content();
  if jsonb_array_length(payload->'words')<>2 or jsonb_array_length(payload->'grammar')<>2 then raise exception 'FAIL: private content missing %',payload;end if;
  select data->>'meaning' into before_meaning from public.content_items where kind='words' and key='author-apple';
  if before_meaning<>'global fruit' then raise exception 'FAIL: private edits changed shared catalogue';end if;
  if not exists(select 1 from jsonb_array_elements(payload->'words') w where w->>'word'='author-apple' and w->>'category'='My course' and w->>'meaning'='my edited definition') then raise exception 'FAIL: override ignored';end if;
  begin
    insert into public.personal_content_items(user_id,kind,key,data) values(b,'words','intruder','{"word":"intruder"}');
    raise exception 'FAIL: wrote another player content';
  exception when insufficient_privilege then null;end;
  begin
    perform public.save_personal_items('[{"kind":"words","key":"rollback-me","data":{"word":"rollback-me","type":"vocab","category":"Test","meaning":"Valid"}},{"kind":"grammar","key":"invalid","data":{"id":"invalid"}}]');
    raise exception 'FAIL: invalid import accepted';
  exception when invalid_parameter_value then null;end;
  if exists(select 1 from public.personal_content_items where key='rollback-me') then raise exception 'FAIL: partial import saved';end if;
  perform public.remove_personal_item('grammar','author-food-rule');
  if jsonb_array_length(public.my_library_content()->'grammar')<>1 then raise exception 'FAIL: automatic grammar cannot be removed';end if;
  insert into public.friend_shares(recipient,word_keys,entries) values(b,array['author-apple','my-private-word'],'[{"word":"forged"}]') returning id into share_id;
  select count(*) into n from public.friend_shares where id=share_id and jsonb_array_length(entries)=2 and entries::text not like '%forged%';
  if n<>1 then raise exception 'FAIL: shared snapshot trusts caller data';end if;
  perform set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);
  if exists(select 1 from public.personal_content_items) then raise exception 'FAIL: private data leaked';end if;
  begin perform public.accept_word_share(share_id);raise exception 'FAIL: outsider accepts share';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  if jsonb_array_length(public.my_library_content()->'words')<>0 then raise exception 'FAIL: share added before acceptance';end if;
  perform public.save_personal_items('[{"kind":"words","key":"author-apple","data":{"word":"author-apple","type":"vocab","category":"Bob","meaning":"keep Bob edit"}}]');
  perform public.accept_word_share(share_id);
  payload:=public.my_library_content();
  if jsonb_array_length(payload->'words')<>2 or not exists(select 1 from jsonb_array_elements(payload->'words') w where w->>'word'='author-apple' and w->>'meaning'='keep Bob edit') then raise exception 'FAIL: acceptance overwrote own edit or lost private word';end if;
  perform public.remove_personal_item('words','my-private-word');
  if jsonb_array_length(public.my_library_content()->'words')<>1 then raise exception 'FAIL: private removal failed';end if;
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  if jsonb_array_length(public.my_library_content()->'words')<>2 then raise exception 'FAIL: removal changed sender library';end if;
  perform public.remove_personal_item('words','author-apple');
  payload:=public.my_library_content();
  if jsonb_array_length(payload->'words')<>1 then raise exception 'FAIL: override or selection remained after removal';end if;
  execute 'reset role';
  raise exception 'PERSONAL CONTENT WORKSPACE TESTS PASSED (rolled back)';
end;
$$;
