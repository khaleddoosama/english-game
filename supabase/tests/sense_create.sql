-- A player's own words (migration 0030): private, in the library at once, the
-- same word twice gives the same row, limits, and nobody else sees it
-- (begin; <this>; rollback;).
create function pg_temp.act(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.must(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
end;
$$;
create function pg_temp.fails(q text) returns boolean language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end;
$$;

do $$
declare
  a uuid; b uuid; r jsonb; r2 jsonb; id1 uuid; n integer; i integer;
begin
  perform public.register_player('sc_a', 'secret1');
  perform public.register_player('sc_b', 'secret1');
  select id into a from public.profiles where username = 'sc_a';
  select id into b from public.profiles where username = 'sc_b';
  insert into public.headwords (text) values ('Scpublic');
  insert into public.senses (headword_id, meaning) select id, 'The shared one' from public.headwords where text = 'Scpublic';

  perform pg_temp.act(a);
  r := public.sense_create('Quokka', 'vocab', array['noun'], 'Animals', 'A small marsupial', '{"situation":"We saw a quokka.","gap":"We saw a ______."}', 'ai');
  id1 := (r ->> 'id')::uuid;
  perform pg_temp.must((r ->> 'existing')::boolean = false, 'a new word');
  perform pg_temp.must((select visibility = 'private' and owner_id = a and source = 'ai' and review_status = 'approved' from public.senses where id = id1), 'it is private to a, marked as AI-written');
  perform pg_temp.must((select content ->> 'situation' from public.senses where id = id1) = 'We saw a quokka.', 'the card content is kept');
  perform pg_temp.must(exists (select 1 from public.library_entries where user_id = a and sense_id = id1 and removed_at is null), 'it is in a''s library at once');
  perform pg_temp.must((select pos from public.senses where id = id1) = array['noun'], 'parts of speech kept');

  -- the same word again: the same row
  r2 := public.sense_create(' quokka ', 'vocab', '{}', null, 'Another wording', '{}');
  perform pg_temp.must((r2 ->> 'id')::uuid = id1 and (r2 ->> 'existing')::boolean, 'the same word (any case) gives the same row');
  perform pg_temp.must((select meaning from public.senses where id = id1) = 'A small marsupial', 'and does not overwrite it');

  -- a second meaning with a label is a different sense of the same headword
  r2 := public.sense_create('Quokka (cartoon)', 'vocab', '{}', null, 'A cartoon animal', '{}');
  perform pg_temp.must((r2 ->> 'id')::uuid <> id1, 'a labelled meaning is another sense');
  perform pg_temp.must((select label from public.senses where id = (r2 ->> 'id')::uuid) = 'cartoon', 'its label is the brackets');
  perform pg_temp.must((select count(*) from public.headwords where lower(text) = 'quokka') = 1, 'one headword for both');

  -- a word that exists in the shared dictionary can still be made privately
  r2 := public.sense_create('Scpublic', 'vocab', '{}', null, 'My own take', '{}');
  perform pg_temp.must((select count(*) from public.senses s join public.headwords h on h.id = s.headword_id where h.text = 'Scpublic' and s.deleted_at is null) = 2, 'a private sense next to the shared one');

  -- nobody else sees it, or can put it in a library
  perform pg_temp.act(b);
  set local role authenticated;
  perform pg_temp.must(not exists (select 1 from public.senses where id = id1), 'b does not see it');
  reset role;
  perform pg_temp.must((select count(*) from public.library_add(array[id1])) = 0, 'b cannot add it to a library');
  perform pg_temp.must(pg_temp.fails($q$select public.sense_create('', 'vocab', '{}', null, 'x', '{}')$q$), 'an empty word is refused');
  perform pg_temp.must(pg_temp.fails($q$select public.sense_create('Word', 'vocab', '{}', null, '  ', '{}')$q$), 'a word needs a meaning');
  perform pg_temp.must(pg_temp.fails($q$select public.sense_create('Word', 'vocab', '{}', null, 'x', '[]')$q$), 'the content must be an object');
  r := public.sense_create('Odd', 'weird', '{}', null, 'x', '{}');
  perform pg_temp.must((select type from public.senses where id = (r ->> 'id')::uuid) = 'vocab', 'an unknown type becomes vocab');
  r := public.sense_create('Typed', 'vocab', '{}', null, 'x', '{}', 'nonsense');
  perform pg_temp.must((select source from public.senses where id = (r ->> 'id')::uuid) = 'user', 'an unknown source is a typed-in word');

  -- the limit
  perform pg_temp.act(a);
  select count(*) into n from public.senses where owner_id = a and deleted_at is null;
  for i in 1..(500 - n) loop perform public.sense_create('Bulk' || i, 'vocab', '{}', null, 'm', '{}'); end loop;
  perform pg_temp.must(pg_temp.fails($q$select public.sense_create('One too many', 'vocab', '{}', null, 'm', '{}')$q$), 'at most 500 words of one''s own');
  perform pg_temp.must((public.sense_create('Quokka', 'vocab', '{}', null, 'm', '{}') ->> 'existing')::boolean, 'but an existing one still comes back at the limit');

  raise exception 'SENSE CREATE TESTS PASSED';
end $$;
