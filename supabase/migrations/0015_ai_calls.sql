-- AI call log (Admin -> AI usage). One row per AI or voice request: who,
-- when, which feature, and how it went (model, time, tokens, or why it
-- was refused or failed). ai_gate writes the row when it decides, so
-- every allowed call and every refusal is recorded by the database
-- itself; the server function then fills in the result with
-- ai_call_finish, which only touches the caller's own unfinished row.

create table public.ai_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'ai' check (kind in ('ai', 'tts')),
  task text,
  admin_only boolean not null default false,
  status text not null default 'started' check (status in ('started', 'ok', 'error', 'denied')),
  reason text,
  http_status integer,
  model text,
  ms integer,
  prompt_chars integer,
  output_chars integer,
  input_tokens integer,
  output_tokens integer,
  preview text,
  finished_at timestamptz
);
create index ai_calls_at_idx on public.ai_calls (at desc);
create index ai_calls_user_idx on public.ai_calls (user_id, at desc);
create index ai_calls_task_idx on public.ai_calls (task, at desc);
alter table public.ai_calls enable row level security;
create policy "admin reads AI calls" on public.ai_calls for select to authenticated using ((select public.is_admin()));

-- The gate, now also naming the feature and logging its decision. Returns
-- the call id to finish later.
drop function if exists public.ai_gate(boolean, integer, text);
create or replace function public.ai_gate(
  p_admin_only boolean default false, p_daily_limit integer default 150, p_kind text default 'ai',
  p_task text default null, p_preview text default null, p_chars integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_calls integer;
  v_limit integer := coalesce((public.app_setting('aiDailyLimit'))::integer, p_daily_limit);
  v_kind text := case when p_kind = 'tts' then 'tts' else 'ai' end;
  v_task text := nullif(left(coalesce(p_task, ''), 80), '');
  v_preview text := nullif(left(coalesce(p_preview, ''), 300), '');
  v_id bigint;
  v_reason text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  select role = 'admin' into v_admin from public.profiles where id = v_user;
  v_admin := coalesce(v_admin, false);
  if p_admin_only and not v_admin then
    v_reason := 'admin';
  elsif not v_admin and not coalesce((public.app_setting(case when v_kind = 'tts' then 'ttsForPlayers' else 'aiForPlayers' end))::boolean, true) then
    v_reason := 'off';
  else
    insert into public.ai_usage (user_id, day, calls) values (v_user, current_date, 1)
    on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
    returning calls into v_calls;
    if not v_admin and v_calls > v_limit then v_reason := 'quota'; end if;
  end if;
  insert into public.ai_calls (user_id, kind, task, admin_only, status, reason, prompt_chars, preview, finished_at)
  values (v_user, v_kind, v_task, coalesce(p_admin_only, false), case when v_reason is null then 'started' else 'denied' end, v_reason,
          p_chars, v_preview, case when v_reason is null then null else now() end)
  returning id into v_id;
  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason, 'kind', v_kind, 'admin', v_admin, 'calls', v_calls, 'limit', v_limit, 'call', v_id);
  end if;
  return jsonb_build_object('ok', true, 'admin', v_admin, 'calls', v_calls, 'limit', v_limit, 'call', v_id);
end;
$$;

-- The server reports how the call went. Only the caller's own row, only
-- once, and only for 15 minutes after the gate.
create or replace function public.ai_call_finish(
  p_id bigint, p_ok boolean, p_model text default null, p_ms integer default null, p_http_status integer default null,
  p_error text default null, p_output_chars integer default null, p_input_tokens integer default null, p_output_tokens integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_calls set
    status = case when p_ok then 'ok' else 'error' end,
    model = left(p_model, 80), ms = greatest(0, p_ms), http_status = p_http_status,
    reason = case when p_ok then null else left(p_error, 300) end,
    output_chars = greatest(0, p_output_chars), input_tokens = greatest(0, p_input_tokens), output_tokens = greatest(0, p_output_tokens),
    finished_at = now()
  where id = p_id and user_id = (select auth.uid()) and status = 'started' and at > now() - interval '15 minutes';
end;
$$;

-- Admin summary for a period: totals, and calls by feature, model, player
-- and outcome.
create or replace function public.admin_ai_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)));
begin
  perform public.require_admin();
  return (
    with c as (select * from public.ai_calls where at >= v_from)
    select jsonb_build_object(
      'totals', (select jsonb_build_object(
        'calls', count(*), 'ok', count(*) filter (where status = 'ok'), 'errors', count(*) filter (where status = 'error'),
        'denied', count(*) filter (where status = 'denied'), 'unfinished', count(*) filter (where status = 'started'),
        'players', count(distinct user_id), 'avg_ms', round(avg(ms) filter (where status = 'ok')),
        'p95_ms', round(percentile_cont(0.95) within group (order by ms) filter (where status = 'ok')),
        'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from c),
      'by_task', coalesce((select jsonb_agg(t order by t.calls desc) from (
        select coalesce(task, case when kind = 'tts' then 'Pronunciation' else 'Other' end) as task, kind, count(*) as calls,
          count(*) filter (where status = 'ok') as ok, count(*) filter (where status = 'error') as errors, count(*) filter (where status = 'denied') as denied,
          round(avg(ms) filter (where status = 'ok')) as avg_ms, coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0) as tokens
        from c group by 1, 2) t), '[]'::jsonb),
      'by_model', coalesce((select jsonb_agg(m order by m.calls desc) from (
        select model, count(*) as calls, round(avg(ms)) as avg_ms, coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0) as tokens
        from c where model is not null group by model) m), '[]'::jsonb),
      'by_user', coalesce((select jsonb_agg(u order by u.calls desc) from (
        select coalesce(p.username, 'deleted player') as username, count(*) as calls, count(*) filter (where c.status = 'error') as errors,
          count(*) filter (where c.status = 'denied') as denied, coalesce(sum(c.input_tokens), 0) + coalesce(sum(c.output_tokens), 0) as tokens
        from c left join public.profiles p on p.id = c.user_id group by 1) u), '[]'::jsonb),
      'by_reason', coalesce((select jsonb_agg(r order by r.calls desc) from (
        select status, coalesce(reason, '') as reason, count(*) as calls
        from c where status in ('error', 'denied') group by status, coalesce(reason, '') order by count(*) desc limit 12) r), '[]'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.ai_gate(boolean, integer, text, text, text, integer) from public, anon;
grant execute on function public.ai_gate(boolean, integer, text, text, text, integer) to authenticated;
revoke execute on function public.ai_call_finish(bigint, boolean, text, integer, integer, text, integer, integer, integer) from public, anon;
grant execute on function public.ai_call_finish(bigint, boolean, text, integer, integer, text, integer, integer, integer) to authenticated;
revoke execute on function public.admin_ai_summary(integer) from public, anon;
grant execute on function public.admin_ai_summary(integer) to authenticated;
notify pgrst, 'reload schema';
