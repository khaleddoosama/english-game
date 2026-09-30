-- Every AI call goes through /api, which asks this gate first with the
-- caller's own token: signed in? admin-only task? daily quota left?
-- One round trip; the admin has no quota.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "players see their own AI usage"
  on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.ai_gate(p_admin_only boolean default false, p_daily_limit integer default 150)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_admin boolean;
  v_calls integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'signin');
  end if;
  select role = 'admin' into v_admin from public.profiles where id = v_user;
  v_admin := coalesce(v_admin, false);
  if p_admin_only and not v_admin then
    return jsonb_build_object('ok', false, 'reason', 'admin', 'admin', false);
  end if;
  insert into public.ai_usage (user_id, day, calls) values (v_user, current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into v_calls;
  if not v_admin and v_calls > p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'admin', false, 'calls', v_calls);
  end if;
  return jsonb_build_object('ok', true, 'admin', v_admin, 'calls', v_calls);
end;
$$;
revoke execute on function public.ai_gate(boolean, integer) from public, anon;
grant execute on function public.ai_gate(boolean, integer) to authenticated;
