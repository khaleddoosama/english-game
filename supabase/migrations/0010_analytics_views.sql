-- Analysis views for reviewing the game's data: content quality, how
-- players are doing, reports, Live Challenges, daily activity, and one
-- list of data problems to fix. They live in their own `analytics` schema,
-- which the public API doesn't expose: query them in the Supabase SQL
-- editor (e.g. `select * from analytics.data_issues;`), or in the admin
-- panel (Data quality), which reads them through admin-only functions.

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
comment on schema analytics is 'Read-only views for reviewing data quality and usage. Not exposed through the API.';

-- ------------------------------------------------------------ helpers
-- Live words, one row each, with the fields the checks look at.
create or replace view analytics.words with (security_invoker = on) as
select
  c.key as word,
  c.data ->> 'category' as category,
  c.data ->> 'subCategory' as sub_category,
  c.data ->> 'type' as type,
  c.data ->> 'level' as cefr_level,
  c.position,
  c.updated_at,
  c.data,
  coalesce(c.data ->> 'meaning', '') <> '' as has_meaning,
  coalesce(c.data ->> 'situation', '') <> '' as has_example,
  coalesce(c.data ->> 'gap', '') <> '' as has_gap,
  coalesce(c.data ->> 'gap', '') ~ '_{3,}' as gap_has_blank,
  case when jsonb_typeof(c.data -> 'hints') = 'array' then jsonb_array_length(c.data -> 'hints') else 0 end as hints,
  case when jsonb_typeof(c.data -> 'synonyms') = 'array' then jsonb_array_length(c.data -> 'synonyms') else 0 end as synonyms,
  case when jsonb_typeof(c.data -> 'antonyms') = 'array' then jsonb_array_length(c.data -> 'antonyms') else 0 end as antonyms,
  case when jsonb_typeof(c.data -> 'collocations') = 'array' then jsonb_array_length(c.data -> 'collocations') else 0 end as collocations,
  case when jsonb_typeof(c.data -> 'wordFamily') = 'array' then jsonb_array_length(c.data -> 'wordFamily') else 0 end as word_family,
  coalesce(c.data ->> 'opposite', '') <> '' as has_opposite,
  coalesce(c.data ->> 'image', '') <> '' or c.data ? 'illustration' as has_picture,
  coalesce(c.data ->> 'image', '') like '%/storage/v1/object/public/word-images/%' as picture_stored,
  coalesce(c.data ->> 'image', '') ~ '^https?://' and coalesce(c.data ->> 'image', '') not like '%/storage/v1/object/public/word-images/%' as picture_external,
  coalesce((c.data ->> '_autoStub')::boolean, false) as is_stub,
  coalesce((c.data ->> '_aiAdded')::boolean, false) as ai_added
from public.content_items c
where c.kind = 'words' and not c.deleted;

-- What every player did with every word, summed per word.
create or replace view analytics.word_play with (security_invoker = on) as
select
  m.item_key as word,
  count(distinct m.user_id)::integer as players,
  coalesce(sum((m.stats ->> 'total')::numeric), 0)::integer as attempts,
  coalesce(sum((m.stats ->> 'correct')::numeric), 0)::integer as correct,
  max(m.updated_at) as last_played
from public.mastery m
where m.item_key !~ '^(grammar|combo|challenge|pun):'
group by m.item_key;

-- ------------------------------------------------------------- content
create or replace view analytics.word_quality with (security_invoker = on) as
with reports as (
  select lower(t) as word, count(*) as total, count(*) filter (where r.resolved_at is null) as open
  from public.reports r cross join lateral unnest(coalesce(r.target_words, '{}')) t
  group by lower(t)
), last_edit as (
  select distinct on (a.item_key) a.item_key, a.at, p.username
  from public.admin_audit a left join public.profiles p on p.id = a.admin_id
  where a.entity = 'words' and a.action like 'content.%'
  order by a.item_key, a.at desc
), meta as (select level_order from public.content_meta where id = 1)
select
  w.word, w.category, w.sub_category, w.type, w.cefr_level,
  array_remove(array[
    case when w.is_stub then 'stub (needs real content)' end,
    case when not w.has_meaning then 'no meaning' end,
    case when not w.has_example then 'no example sentence' end,
    case when not w.has_gap then 'no gap sentence' when not w.gap_has_blank then 'gap has no ___ blank' end,
    case when w.hints = 0 then 'no hints' end,
    case when not w.has_picture then 'no picture' end,
    case when w.picture_external then 'picture is an outside link' end,
    case when w.category is null or not exists (select 1 from meta where meta.level_order ? w.category) then 'category not in the level list' end
  ], null) as problems,
  round(100.0 * (
      w.has_meaning::int * 25 + w.has_example::int * 15 + (w.has_gap and w.gap_has_blank)::int * 15 + least(w.hints, 2) * 5
    + w.has_picture::int * 10 + (w.synonyms > 0)::int * 5 + (w.antonyms > 0 or w.has_opposite)::int * 5
    + (w.collocations > 0)::int * 5 + (w.word_family > 0)::int * 5) / 95) as quality_score,
  w.hints, w.synonyms, w.antonyms, w.collocations, w.word_family, w.has_picture, w.picture_stored, w.is_stub, w.ai_added,
  coalesce(p.players, 0) as players, coalesce(p.attempts, 0) as attempts, coalesce(p.correct, 0) as correct,
  case when p.attempts > 0 then round(100.0 * p.correct / p.attempts, 1) end as accuracy_pct,
  p.last_played,
  coalesce(r.open, 0)::integer as open_reports, coalesce(r.total, 0)::integer as total_reports,
  w.updated_at as last_edited, le.username as last_edited_by
from analytics.words w
left join analytics.word_play p on p.word = w.word
left join reports r on r.word = lower(w.word)
left join last_edit le on le.item_key = w.word;
comment on view analytics.word_quality is 'One row per word: missing fields, a 0-100 completeness score, how players do on it, and its reports.';

-- Accuracy per word and question type (finds question types that are
-- too hard or too easy for a word).
create or replace view analytics.word_mode_accuracy with (security_invoker = on) as
select
  m.item_key as word,
  mode.key as mode,
  count(distinct m.user_id)::integer as players,
  sum((mode.value ->> 'total')::numeric)::integer as attempts,
  sum((mode.value ->> 'correct')::numeric)::integer as correct,
  round(100.0 * sum((mode.value ->> 'correct')::numeric) / nullif(sum((mode.value ->> 'total')::numeric), 0), 1) as accuracy_pct
from public.mastery m
cross join lateral jsonb_each(case when jsonb_typeof(m.stats -> 'modes') = 'object' then m.stats -> 'modes' else '{}'::jsonb end) mode
group by m.item_key, mode.key;

create or replace view analytics.mode_accuracy with (security_invoker = on) as
select mode, count(distinct word)::integer as words, sum(players)::integer as player_words, sum(attempts)::integer as attempts, sum(correct)::integer as correct,
       round(100.0 * sum(correct) / nullif(sum(attempts), 0), 1) as accuracy_pct
from analytics.word_mode_accuracy
group by mode;

create or replace view analytics.category_summary with (security_invoker = on) as
with meta as (select level_order from public.content_meta where id = 1)
select
  coalesce(q.category, '(none)') as category,
  coalesce((select (ord - 1)::integer from meta cross join lateral jsonb_array_elements_text(meta.level_order) with ordinality as e(name, ord) where e.name = q.category), null) as level_position,
  count(*)::integer as words,
  count(*) filter (where cardinality(q.problems) > 0)::integer as words_with_problems,
  count(*) filter (where q.has_picture)::integer as with_picture,
  round(avg(q.quality_score)) as avg_quality,
  sum(q.attempts)::integer as attempts,
  round(100.0 * sum(q.correct) / nullif(sum(q.attempts), 0), 1) as accuracy_pct,
  sum(q.open_reports)::integer as open_reports
from analytics.word_quality q
group by q.category;

-- ------------------------------------------------------------- players
create or replace view analytics.player_summary with (security_invoker = on) as
with sessions as (
  select user_id, count(*)::integer as sessions, max(at) as last_session from public.session_log_rows('UTC') group by user_id
), play as (
  select user_id, count(*)::integer as words_seen, coalesce(sum((stats ->> 'total')::numeric), 0)::integer as answers,
         coalesce(sum((stats ->> 'correct')::numeric), 0)::integer as correct, max(updated_at) as last_answer
  from public.mastery group by user_id
), ai as (
  select user_id, sum(calls)::integer as ai_calls, sum(calls) filter (where day > current_date - 30)::integer as ai_calls_30d from public.ai_usage group by user_id
), rep as (
  select user_id, count(*)::integer as reports, count(*) filter (where resolved_at is null)::integer as open_reports from public.reports group by user_id
)
select
  p.username, p.role, p.created_at as joined_at,
  greatest(play.last_answer, s.last_session, (select max(updated_at) from public.progress pr where pr.user_id = p.id)) as last_active,
  extract(day from now() - greatest(play.last_answer, s.last_session, p.created_at))::integer as days_since_active,
  p.score, p.week_score, p.mastered_count, p.study_streak, p.best_study_streak,
  coalesce(play.words_seen, 0) as words_seen, coalesce(play.answers, 0) as answers, coalesce(play.correct, 0) as correct,
  case when play.answers > 0 then round(100.0 * play.correct / play.answers, 1) end as accuracy_pct,
  coalesce(s.sessions, 0) as sessions,
  coalesce(ai.ai_calls, 0) as ai_calls, coalesce(ai.ai_calls_30d, 0) as ai_calls_30d,
  p.live_played, p.live_wins,
  coalesce(rep.reports, 0) as reports_filed, coalesce(rep.open_reports, 0) as open_reports_filed
from public.profiles p
left join sessions s on s.user_id = p.id
left join play on play.user_id = p.id
left join ai on ai.user_id = p.id
left join rep on rep.user_id = p.id;
comment on view analytics.player_summary is 'One row per player: activity, accuracy, AI use, Live results and reports filed.';

-- ------------------------------------------------------------- reports
create or replace view analytics.report_details with (security_invoker = on) as
select
  r.id, r.reported_at, p.username as reporter, r.reason, r.note,
  r.question_mode, r.question_type, r.question_prompt, r.question_options, r.correct_answers,
  r.player_answer, r.player_was_correct, r.target_words, r.session_title, r.session_kind,
  case when r.resolved_at is null then 'open' else 'resolved' end as status, r.resolved_at,
  r.data -> 'aiReview' ->> 'verdict' as ai_verdict, r.data -> 'aiReview' ->> 'adminNote' as ai_note,
  extract(day from now() - r.reported_at)::integer as age_days,
  exists (select 1 from public.content_items c where c.kind = 'words' and not c.deleted and lower(c.key) = any (select lower(t) from unnest(r.target_words) t)) as word_still_exists
from public.reports r left join public.profiles p on p.id = r.user_id;

-- ----------------------------------------------------------------- live
create or replace view analytics.live_challenge_summary with (security_invoker = on) as
select
  c.code, c.title, h.username as created_by, c.state, c.start_mode, c.question_count, c.seconds, c.max_players,
  c.created_at, c.started_at, c.ended_at, c.expires_at,
  (select count(*) from public.live_players p where p.code = c.code)::integer as joined,
  (select count(*) from public.live_players p where p.code = c.code and p.started_at is not null)::integer as started,
  (select count(*) from public.live_players p where p.code = c.code and p.finished_at is not null)::integer as finished,
  (select string_agg(pr.username, ', ') from public.live_results r join public.profiles pr on pr.id = r.user_id where r.room_code = c.code and r.rank = 1) as winner,
  (select round(avg(p.correct)::numeric, 1) from public.live_players p where p.code = c.code and p.started_at is not null) as avg_correct,
  (select round(avg(p.total_ms) / 1000.0, 1) from public.live_players p where p.code = c.code and p.finished_at is not null) as avg_seconds_to_finish
from public.live_challenges c join public.profiles h on h.id = c.host_id;

-- ---------------------------------------------------------------- daily
create or replace view analytics.daily_activity with (security_invoker = on) as
with days as (
  select generate_series(current_date - 89, current_date, interval '1 day')::date as day
), s as (
  select day, count(*) as sessions, sum(total) as answers, sum(correct) as correct, count(distinct user_id) as players from public.session_log_rows('UTC') group by day
)
select
  d.day,
  coalesce(s.players, 0)::integer as active_players,
  coalesce(s.sessions, 0)::integer as sessions,
  coalesce(s.answers, 0)::integer as answers,
  case when s.answers > 0 then round(100.0 * s.correct / s.answers, 1) end as accuracy_pct,
  (select count(*) from public.profiles p where p.created_at::date = d.day)::integer as new_players,
  (select coalesce(sum(calls), 0) from public.ai_usage a where a.day = d.day)::integer as ai_calls,
  (select count(*) from public.reports r where r.reported_at::date = d.day)::integer as reports_filed,
  (select count(*) from public.live_challenges c where c.created_at::date = d.day)::integer as live_created,
  (select count(*) from public.admin_audit a where a.at::date = d.day and a.action in ('content.create', 'content.update', 'content.delete'))::integer as content_changes
from days d left join s on s.day = d.day;

create or replace view analytics.content_changes with (security_invoker = on) as
select a.at::date as day, coalesce(p.username, 'system') as changed_by, a.entity,
  count(*) filter (where a.action = 'content.create')::integer as added,
  count(*) filter (where a.action = 'content.update')::integer as edited,
  count(*) filter (where a.action = 'content.delete')::integer as deleted
from public.admin_audit a left join public.profiles p on p.id = a.admin_id
where a.action in ('content.create', 'content.update', 'content.delete')
group by 1, 2, 3;

-- --------------------------------------------------------- data issues
-- Every problem worth fixing, one row each: severity (high / medium /
-- low), area, the item, what's wrong and a hint for the fix.
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
-- grammar
union all select 'high', 'grammar', c.key, 'Answer is not one of the options', 'Fix the answer or the options.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and jsonb_typeof(c.data -> 'options') = 'array' and coalesce(c.data ->> 'answer', '') <> ''
    and not exists (select 1 from jsonb_array_elements_text(c.data -> 'options') o where lower(btrim(o)) = lower(btrim(c.data ->> 'answer')))
union all select 'high', 'grammar', c.key, 'No prompt or no answer', 'Complete the rule''s question.' from public.content_items c
  where c.kind = 'grammar' and not c.deleted and (coalesce(c.data ->> 'prompt', '') = '' or coalesce(c.data ->> 'answer', '') = '')
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

-- -------------------------------------------- admin panel access (RPC)
create or replace function public.admin_data_issues()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query select to_jsonb(i) from analytics.data_issues i
    order by case i.severity when 'high' then 0 when 'medium' then 1 else 2 end, i.area, i.item;
end;
$$;

create or replace function public.admin_analytics(p_view text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_view = 'word_quality' then return query select to_jsonb(v) - 'data' from analytics.word_quality v order by v.quality_score, v.word;
  elsif p_view = 'category_summary' then return query select to_jsonb(v) from analytics.category_summary v order by v.level_position nulls last;
  elsif p_view = 'mode_accuracy' then return query select to_jsonb(v) from analytics.mode_accuracy v order by v.accuracy_pct nulls last;
  elsif p_view = 'player_summary' then return query select to_jsonb(v) from analytics.player_summary v order by v.last_active desc nulls last;
  elsif p_view = 'report_details' then return query select to_jsonb(v) from analytics.report_details v order by v.reported_at desc;
  elsif p_view = 'live_challenge_summary' then return query select to_jsonb(v) from analytics.live_challenge_summary v order by v.created_at desc;
  elsif p_view = 'daily_activity' then return query select to_jsonb(v) from analytics.daily_activity v order by v.day desc;
  elsif p_view = 'content_changes' then return query select to_jsonb(v) from analytics.content_changes v order by v.day desc;
  else raise exception 'unknown view %', p_view using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.admin_data_issues() from public, anon;
revoke execute on function public.admin_analytics(text) from public, anon;
grant execute on function public.admin_data_issues() to authenticated;
grant execute on function public.admin_analytics(text) to authenticated;
