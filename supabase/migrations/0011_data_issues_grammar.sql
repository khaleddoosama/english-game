-- Grammar checks understand both rule shapes: older rules hold one
-- question (prompt/options/answer), newer ones a questions[] list. The
-- first version flagged every newer rule as "no prompt or no answer".
create or replace view analytics.data_issues with (security_invoker = on) as
with meta as (select level_order from public.content_meta where id = 1),
words as (select * from analytics.words)
-- words
select 'high' as severity, 'words' as area, w.word as item, 'Stub word without real content' as issue, 'Fill it with AI or by hand (Admin → Words).' as fix from words w where w.is_stub
union all select 'high', 'words', w.word, 'No meaning', 'Add a meaning: definition questions can''t be built without it.' from words w where not w.has_meaning
union all select 'medium', 'words', w.word, 'Gap sentence has no ___ blank', 'Put ___ where the word goes.' from words w where w.has_gap and not w.gap_has_blank
union all select 'medium', 'words', w.word, 'No gap sentence', 'Add a sentence with ___ for fill-the-gap questions.' from words w where not w.has_gap
union all select 'low', 'words', w.word, 'No example sentence', 'Add a situation/example.' from words w where not w.has_example
union all select 'low', 'words', w.word, 'No hints', 'Add one or two hints.' from words w where w.hints = 0
union all select 'low', 'words', w.word, 'Picture is an outside link', 'Copy it into storage so it can''t break (Admin → Words → picture).' from words w where w.picture_external
union all select 'medium', 'words', w.word, 'Category "' || coalesce(w.category, '(none)') || '" is not in the level list', 'Move the word to a listed category, or add the category.' from words w
  where w.category is null or not exists (select 1 from meta where meta.level_order ? w.category)
union all select 'high', 'words', min(w.word), 'Duplicate word (' || count(*) || ' copies)', 'Keep one and delete the others.' from words w group by lower(w.word) having count(*) > 1
-- categories
union all select 'low', 'categories', e.name, 'Category has no words', 'Remove it or add words.' from meta cross join lateral jsonb_array_elements_text(meta.level_order) e(name)
  where not exists (select 1 from words w where w.category = e.name)
-- grammar: older rules hold one question (prompt/options/answer); newer
-- ones hold questions[] of type choose, judge or fix.
union all select 'high', 'grammar', c.key, 'Answer is not one of the options', 'Fix the answer or the options.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and c.data -> 'questions' is null and jsonb_typeof(c.data -> 'options') = 'array' and coalesce(c.data ->> 'answer', '') <> ''
    and not exists (select 1 from jsonb_array_elements_text(c.data -> 'options') o where lower(btrim(o)) = lower(btrim(c.data ->> 'answer')))
union all select 'high', 'grammar', c.key, 'No prompt or no answer', 'Complete the rule''s question.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and c.data -> 'questions' is null and (coalesce(c.data ->> 'prompt', '') = '' or coalesce(c.data ->> 'answer', '') = '')
union all select 'high', 'grammar', c.key, 'Rule has no questions', 'Add at least one question.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and jsonb_typeof(c.data -> 'questions') = 'array' and jsonb_array_length(c.data -> 'questions') = 0
union all select 'high', 'grammar', c.key || ' #' || q.n, 'Question ' || q.n || ': the answer is not one of the options', 'Fix the answer or the options.' from public.content_items c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data -> 'questions') = 'array' then c.data -> 'questions' else '[]'::jsonb end) with ordinality q(v, n)
  where c.kind = 'grammar' and not c.deleted and q.v ->> 'type' = 'choose'
    and not exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(q.v -> 'options') = 'array' then q.v -> 'options' else '[]'::jsonb end) o where lower(btrim(o)) = lower(btrim(coalesce(q.v ->> 'answer', ''))))
union all select 'medium', 'grammar', c.key || ' #' || q.n, 'Question ' || q.n || ': the corrected sentence is the same as the wrong one', 'Write the corrected sentence.' from public.content_items c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data -> 'questions') = 'array' then c.data -> 'questions' else '[]'::jsonb end) with ordinality q(v, n)
  where c.kind = 'grammar' and not c.deleted and q.v ->> 'type' = 'fix' and lower(btrim(coalesce(q.v ->> 'sentence', ''))) = lower(btrim(coalesce(q.v ->> 'answer', '')))
union all select 'low', 'grammar', c.key, 'No explanation', 'Add a short explanation of the rule.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and coalesce(c.data ->> 'explanation', '') = ''
-- stories
union all select 'medium', 'stories', c.key, 'Uses words that no longer exist: ' || string_agg(t, ', '), 'Edit the story or add the words back.' from public.content_items c
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(c.data -> 'targetWords') = 'array' then c.data -> 'targetWords' else '[]'::jsonb end) t
  where c.kind = 'stories' and not c.deleted and not exists (select 1 from words w where lower(w.word) = lower(t))
  group by c.key
-- reports
union all select 'medium', 'reports', r.id, 'Open for ' || extract(day from now() - r.reported_at)::integer || ' days: ' || left(coalesce(r.question_prompt, ''), 80), 'Review it in Admin → Reports.' from public.reports r
  where r.resolved_at is null and r.reported_at < now() - interval '14 days'
union all select 'low', 'reports', r.id, 'Open report about a word that was deleted', 'Resolve or delete the report.' from public.reports r
  where r.resolved_at is null and cardinality(r.target_words) > 0
    and not exists (select 1 from words w where lower(w.word) = any (select lower(t) from unnest(r.target_words) t))
-- player progress
union all select 'low', 'progress', p.username, count(*) || ' progress rows point at words that no longer exist', 'Harmless; they stop counting. Delete if the words won''t come back.' from public.mastery m
  join public.profiles p on p.id = m.user_id
  where m.item_key !~ '^(grammar|combo|challenge|pun):' and not exists (select 1 from words w where w.word = m.item_key)
  group by p.username
union all select 'low', 'players', p.username, 'Signed up ' || extract(day from now() - p.created_at)::integer || ' days ago and never played', 'Consider a nudge, or delete the account.' from public.profiles p
  where p.created_at < now() - interval '7 days' and not exists (select 1 from public.mastery m where m.user_id = p.id)
-- live
union all select 'low', 'live', c.code, 'Challenge past its end time but not closed', 'It closes the next time someone opens it; End it from Admin → Live.' from public.live_challenges c
  where c.state <> 'done' and c.expires_at < now();
comment on view analytics.data_issues is 'Every data problem worth fixing: severity, area, item, issue and how to fix it.';
