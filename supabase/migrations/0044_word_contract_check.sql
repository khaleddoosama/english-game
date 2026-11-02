-- The shape rules of a word under the data contract (ADR 0011, docs/adr/0011-word-data-contract.md), in SQL.
--
-- Why: the server must refuse a word that breaks the contract, whoever writes it (the app, a staged draft when it is
-- published, or a direct write by the admin). This migration only adds the check. It is attached to nothing: no
-- trigger, no caller. Attaching it (a trigger on content_items) is step 7 of the ADR, after the migration of the
-- stored words, and needs the owner's approval.
--
-- What: public.word_contract_errors(data jsonb) (with its helper public.word_contract_empty) returns the problems as 'path: code' texts, or an empty array. The
-- same rules are in src/engine/wordContract.js (checkWord, the reference). tests/fixtures/word-contract-cases.json is
-- run against both (tests/word-contract.test.js, tests/integration/word-contract-sql.test.js); they must agree.
-- Warnings (a reference to no word, a sentence that shows the word, a missing part of speech) are browser-only.
--
-- Nobody but the database owner may run it now: the trigger that will use it runs as the owner.
-- Rollback: supabase/rollback/0044_down.sql.

-- Empty: "", only spaces, null, [] or {}. false and 0 are values, never empty. (A missing key is not empty either:
-- it is absent; callers treat a SQL null, from a missing key, as absent.)
create or replace function public.word_contract_empty(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null and (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and v #>> '{}' ~ '^\s*$')
         or v = '[]'::jsonb or v = '{}'::jsonb)
$$;

create or replace function public.word_contract_errors(p_data jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  e text[] := '{}';
  k text;
  v jsonb;
  item jsonb;
  i int;
  seen text[];
  t text;
  stub boolean;
  stored constant text[] := array['word','id','type','category','subCategory','units','level','partsOfSpeech','meaning',
    'situations','gaps','hints','plainForm','transformExample','commonMistakes','antonyms','synonyms','confusableWords',
    'excludeFromSameOptionsWith','pictureAvoid','collocations','collocationChecks','wordFamily','image','illustration',
    'distractorGroup','learningData'];
  sys constant text[] := array['categoryId','subCategoryTitle','_autoStub','_aiAdded','gapsCheckedFor','contract'];
  not_stored constant text[] := array['situation','gap','commonMistake','opposite','relations','example','links'];
  retired constant text[] := array['register','chainGroup','acceptedWrittenAnswers','sentenceBuild'];
  string_lists constant text[] := array['units','partsOfSpeech','situations','gaps','hints','antonyms','synonyms',
    'confusableWords','excludeFromSameOptionsWith','pictureAvoid','collocations'];
  texts constant text[] := array['word','id','category','subCategory','meaning','plainForm','distractorGroup',
    'categoryId','subCategoryTitle','gapsCheckedFor'];
  pos_list constant text[] := array['noun','verb','adjective','adverb','noun phrase','verb phrase','adjective phrase',
    'adverbial phrase','phrasal verb','idiom','expression','binomial phrase','proper noun','interjection','preposition',
    'conjunction'];
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return array['$: not-object']; end if;

  -- Empty: "", only spaces, null, [] or {}. false and 0 are values, never empty.
  for k, v in select key, value from jsonb_each(p_data) loop
    if k = any(retired) then e := e || (k || ': retired-key'); continue; end if;
    if k = any(not_stored) then e := e || (k || ': not-stored'); continue; end if;
    if not (k = any(stored) or k = any(sys)) then e := e || (k || ': unknown-key'); continue; end if;
    if public.word_contract_empty(v) then e := e || (k || ': empty'); end if;
  end loop;

  if not p_data ? 'contract' then e := e || 'contract: required'::text;
  elsif p_data -> 'contract' <> '1'::jsonb then e := e || 'contract: type'::text; end if;

  stub := coalesce((p_data -> '_autoStub') = 'true'::jsonb, false);
  foreach k in array array['word','type','category','meaning'] loop
    if not p_data ? k then e := e || (k || ': required'); end if;
  end loop;
  if not stub then
    foreach k in array array['situations','gaps'] loop
      if not p_data ? k then e := e || (k || ': required'); end if;
    end loop;
  end if;

  -- Texts: of type string, within their length.
  foreach k in array texts loop
    v := p_data -> k;
    continue when v is null or public.word_contract_empty(v);
    if jsonb_typeof(v) <> 'string' then e := e || (k || ': type'); continue; end if;
    i := case k when 'word' then 120 when 'id' then 80 when 'category' then 60 when 'subCategory' then 60
           when 'meaning' then 300 else 2147483647 end;
    if char_length(v #>> '{}') > i then e := e || (k || ': too-long'); end if;
  end loop;

  if jsonb_typeof(p_data -> 'type') = 'string' and p_data ->> 'type' !~ '^\s*$'
     and not (p_data ->> 'type' = any(array['vocab','idiom','binomial','phrasal','fyi'])) then
    e := e || 'type: enum'::text;
  end if;
  v := p_data -> 'level';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'string' then e := e || 'level: type'::text;
    elsif v #>> '{}' !~ '^[A-C][12](\.[1-3])?$' then e := e || 'level: enum'::text; end if;
  end if;

  -- Lists of texts.
  foreach k in array string_lists loop
    v := p_data -> k;
    continue when v is null or public.word_contract_empty(v);
    if jsonb_typeof(v) <> 'array' then e := e || (k || ': type'); continue; end if;
    seen := '{}';
    for i in 0 .. jsonb_array_length(v) - 1 loop
      item := v -> i;
      if jsonb_typeof(item) <> 'string' then e := e || format('%s[%s]: type', k, i); continue; end if;
      t := item #>> '{}';
      if t ~ '^\s*$' then e := e || format('%s[%s]: empty', k, i); continue; end if;
      if k in ('situations', 'gaps') and char_length(t) > 300 then e := e || format('%s[%s]: too-long', k, i); end if;
      if k = 'gaps' and regexp_count(t, '_{2,}') <> 1 then e := e || format('%s[%s]: one-blank', k, i); end if;
      if k = 'situations' and t ~ '_{2,}' then e := e || format('%s[%s]: has-blank', k, i); end if;
      if k = 'partsOfSpeech' and not (t = any(pos_list)) then e := e || format('%s[%s]: enum', k, i); end if;
      if lower(btrim(t)) = any(seen) then e := e || format('%s[%s]: repeat', k, i); end if;
      seen := seen || lower(btrim(t));
    end loop;
    if k = 'partsOfSpeech' and jsonb_array_length(v) > 3 then e := e || 'partsOfSpeech: too-many'::text; end if;
  end loop;

  -- transformExample: {before, after}, phrasal or fyi only.
  v := p_data -> 'transformExample';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'object' then e := e || 'transformExample: type'::text;
    else
      for k in select jsonb_object_keys(v) loop
        if k not in ('before', 'after') then e := e || ('transformExample.' || k || ': unknown-key'); end if;
      end loop;
      foreach k in array array['before','after'] loop
        if jsonb_typeof(v -> k) is distinct from 'string' then
          e := e || ('transformExample.' || k || case when v -> k is null then ': empty' else ': type' end);
        elsif v ->> k ~ '^\s*$' then e := e || ('transformExample.' || k || ': empty'); end if;
      end loop;
      if coalesce(p_data ->> 'type', '') not in ('phrasal', 'fyi') then e := e || 'transformExample: wrong-word-type'::text; end if;
    end if;
  end if;

  -- commonMistakes: [{sentence, correction, why}], the correction differs from the sentence
  -- (ignoring case, extra spaces and end punctuation).
  v := p_data -> 'commonMistakes';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'array' then e := e || 'commonMistakes: type'::text;
    else for i in 0 .. jsonb_array_length(v) - 1 loop
      item := v -> i;
      if jsonb_typeof(item) <> 'object' then e := e || format('commonMistakes[%s]: type', i); continue; end if;
      for k in select jsonb_object_keys(item) loop
        if k not in ('sentence', 'correction', 'why') then e := e || format('commonMistakes[%s].%s: unknown-key', i, k); end if;
      end loop;
      foreach k in array array['sentence','correction','why'] loop
        if jsonb_typeof(item -> k) is distinct from 'string' then
          e := e || format('commonMistakes[%s].%s: %s', i, k, case when item -> k is null then 'empty' else 'type' end);
        elsif item ->> k ~ '^\s*$' then e := e || format('commonMistakes[%s].%s: empty', i, k); end if;
      end loop;
      if jsonb_typeof(item -> 'sentence') = 'string' and jsonb_typeof(item -> 'correction') = 'string'
         and item ->> 'sentence' !~ '^\s*$'
         and lower(regexp_replace(regexp_replace(btrim(item ->> 'sentence'), '\s+', ' ', 'g'), '[.!?]+$', ''))
           = lower(regexp_replace(regexp_replace(btrim(item ->> 'correction'), '\s+', ' ', 'g'), '[.!?]+$', '')) then
        e := e || format('commonMistakes[%s]: same-as-correction', i);
      end if;
    end loop; end if;
  end if;

  -- collocationChecks: [{sentence (one blank), answer, wrong (at least two, none equal to the answer), explanation?}]
  v := p_data -> 'collocationChecks';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'array' then e := e || 'collocationChecks: type'::text;
    else for i in 0 .. jsonb_array_length(v) - 1 loop
      item := v -> i;
      if jsonb_typeof(item) <> 'object' then e := e || format('collocationChecks[%s]: type', i); continue; end if;
      for k in select jsonb_object_keys(item) loop
        if k not in ('sentence', 'answer', 'wrong', 'explanation') then e := e || format('collocationChecks[%s].%s: unknown-key', i, k); end if;
      end loop;
      foreach k in array array['sentence','answer'] loop
        if jsonb_typeof(item -> k) is distinct from 'string' then
          e := e || format('collocationChecks[%s].%s: %s', i, k, case when item -> k is null then 'empty' else 'type' end);
        elsif item ->> k ~ '^\s*$' then e := e || format('collocationChecks[%s].%s: empty', i, k); end if;
      end loop;
      if jsonb_typeof(item -> 'sentence') = 'string' and item ->> 'sentence' !~ '^\s*$'
         and regexp_count(item ->> 'sentence', '_{2,}') <> 1 then
        e := e || format('collocationChecks[%s].sentence: one-blank', i);
      end if;
      if jsonb_typeof(item -> 'wrong') is distinct from 'array' then e := e || format('collocationChecks[%s].wrong: type', i);
      else
        if exists (select 1 from jsonb_array_elements(item -> 'wrong') x where jsonb_typeof(x) <> 'string' or x #>> '{}' ~ '^\s*$') then
          e := e || format('collocationChecks[%s].wrong: type', i);
        end if;
        if (select count(*) from jsonb_array_elements(item -> 'wrong') x where jsonb_typeof(x) = 'string' and x #>> '{}' !~ '^\s*$') < 2 then
          e := e || format('collocationChecks[%s].wrong: too-few', i);
        end if;
        if jsonb_typeof(item -> 'answer') = 'string' and exists (select 1 from jsonb_array_elements(item -> 'wrong') x
             where jsonb_typeof(x) = 'string' and x #>> '{}' !~ '^\s*$' and lower(btrim(x #>> '{}')) = lower(btrim(item ->> 'answer'))) then
          e := e || format('collocationChecks[%s].wrong: equals-answer', i);
        end if;
      end if;
      if item ? 'explanation' and (jsonb_typeof(item -> 'explanation') <> 'string' or item ->> 'explanation' ~ '^\s*$') then
        e := e || format('collocationChecks[%s].explanation: %s', i, case when jsonb_typeof(item -> 'explanation') = 'string' then 'empty' else 'type' end);
      end if;
    end loop; end if;
  end if;

  -- wordFamily: [{word, pos?}]
  v := p_data -> 'wordFamily';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'array' then e := e || 'wordFamily: type'::text;
    else for i in 0 .. jsonb_array_length(v) - 1 loop
      item := v -> i;
      if jsonb_typeof(item) <> 'object' then e := e || format('wordFamily[%s]: type', i); continue; end if;
      for k in select jsonb_object_keys(item) loop
        if k not in ('word', 'pos') then e := e || format('wordFamily[%s].%s: unknown-key', i, k); end if;
      end loop;
      if jsonb_typeof(item -> 'word') is distinct from 'string' then
        e := e || format('wordFamily[%s].word: %s', i, case when item -> 'word' is null then 'empty' else 'type' end);
      elsif item ->> 'word' ~ '^\s*$' then e := e || format('wordFamily[%s].word: empty', i); end if;
      if item ? 'pos' and (jsonb_typeof(item -> 'pos') <> 'string' or item ->> 'pos' ~ '^\s*$') then
        e := e || format('wordFamily[%s].pos: %s', i, case when jsonb_typeof(item -> 'pos') = 'string' then 'empty' else 'type' end);
      end if;
    end loop; end if;
  end if;

  -- Pictures.
  v := p_data -> 'image';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'string' then e := e || 'image: type'::text;
    elsif v #>> '{}' !~ '^https://\S+$' then e := e || 'image: https'::text; end if;
  end if;
  v := p_data -> 'illustration';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'string' then e := e || 'illustration: type'::text;
    elsif v #>> '{}' !~* '^\s*<svg[\s>]' or v #>> '{}' ~* '<script|on\w+\s*=|javascript:' or char_length(v #>> '{}') > 12000 then
      e := e || 'illustration: svg'::text;
    end if;
  end if;

  -- learningData: {cluster} only.
  v := p_data -> 'learningData';
  if v is not null and not public.word_contract_empty(v) then
    if jsonb_typeof(v) <> 'object' then e := e || 'learningData: type'::text;
    else
      for k in select jsonb_object_keys(v) loop
        if k <> 'cluster' then e := e || ('learningData.' || k || case when k = 'difficulty' then ': retired-key' else ': unknown-key' end); end if;
      end loop;
      if not v ? 'cluster' then e := e || 'learningData.cluster: required'::text;
      elsif jsonb_typeof(v -> 'cluster') <> 'string' then e := e || 'learningData.cluster: type'::text;
      elsif v ->> 'cluster' ~ '^\s*$' then e := e || 'learningData.cluster: empty'::text; end if;
    end if;
  end if;

  -- Flags: only true.
  foreach k in array array['_autoStub','_aiAdded'] loop
    if p_data ? k and p_data -> k <> 'true'::jsonb then e := e || (k || ': true-only'); end if;
  end loop;

  return e;
end $$;

revoke all on function public.word_contract_empty(jsonb) from public, anon, authenticated;
revoke all on function public.word_contract_errors(jsonb) from public, anon, authenticated;
