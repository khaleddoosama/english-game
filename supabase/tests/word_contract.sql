-- The word contract's SQL check (migration 0044, ADR 0011 step 1), as the database owner (begin; <this>; rollback;).
-- Every shared case is checked against JavaScript in tests/integration/word-contract-sql.test.js; this file checks the
-- function itself: a valid word, a few refusals, that it reads no table and changes nothing, and that it is attached to
-- nothing and runnable by no app role. Made-up words only.
do $$
declare
  w jsonb := '{"word":"Ferry","type":"vocab","category":"Travel","meaning":"A boat that carries people.","situations":["We took the ferry."],"gaps":["We took the ______ home."],"contract":1}';
  e text[];
  n integer;
  report text := '';
begin
  e := public.word_contract_errors(w);
  if e <> '{}' then raise exception 'FAIL: a valid word gave %', e; end if;
  report := report || 'a valid word passes; ';

  e := public.word_contract_errors((w - 'contract') || '{"gap":"x","hints":[],"level":0,"register":"informal"}'::jsonb);
  if not (e @> array['contract: required','gap: not-stored','hints: empty','level: type','register: retired-key'] and cardinality(e) = 5) then
    raise exception 'FAIL: refusals: %', e;
  end if;
  report := report || 'missing marker, derived, empty, 0 and retired keys refused; ';

  e := public.word_contract_errors((w || '{"_autoStub":true}'::jsonb) - 'situations' - 'gaps');
  if e <> '{}' then raise exception 'FAIL: a stub needs no examples or gaps: %', e; end if;
  e := public.word_contract_errors('"Ferry"'::jsonb);
  if e <> array['$: not-object'] then raise exception 'FAIL: not an object: %', e; end if;
  report := report || 'stub and non-object; ';

  select count(*) into n from pg_proc where proname in ('word_contract_errors', 'word_contract_empty') and provolatile = 'i';
  if n <> 2 then raise exception 'FAIL: both functions should be immutable'; end if;
  select count(*) into n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname like 'word_contract%';
  if n <> 0 then raise exception 'FAIL: a trigger uses the contract check'; end if;
  if has_function_privilege('anon', 'public.word_contract_errors(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.word_contract_errors(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.word_contract_empty(jsonb)', 'execute') then
    raise exception 'FAIL: an app role may run the contract check';
  end if;
  report := report || 'immutable, attached to nothing, no app role may run it; ';

  raise exception 'WORD CONTRACT TESTS PASSED: %', report;
end $$;
