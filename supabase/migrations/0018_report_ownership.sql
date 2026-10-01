-- Reports: the admin's decision stays the admin's (review F07).
--
-- A player owns the text of their report, not its status. When a player
-- edits a report, whether it's resolved (the column and the copy inside
-- the data) stays as it was, and the report can't move to someone else.
-- A report that was deleted (by the admin, or withdrawn) can't be filed
-- again under the same id by an old copy on a player's device.

create table if not exists public.report_tombstones (
  id text primary key,
  deleted_at timestamptz not null default now()
);
alter table public.report_tombstones enable row level security;
-- No policies: only the triggers below use it.

create or replace function public.reports_keep_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then return new; end if;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.resolved_at := old.resolved_at;
  if old.data ? 'resolvedAt' or new.data ? 'resolvedAt' then
    new.data := jsonb_set(new.data, '{resolvedAt}', coalesce(old.data -> 'resolvedAt', 'null'::jsonb));
  end if;
  return new;
end;
$$;
drop trigger if exists reports_keep_decision on public.reports;
create trigger reports_keep_decision before update on public.reports
  for each row execute function public.reports_keep_decision();

create or replace function public.reports_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.report_tombstones (id) values (old.id) on conflict (id) do nothing;
  return null;
end;
$$;
drop trigger if exists reports_tombstone on public.reports;
create trigger reports_tombstone after delete on public.reports
  for each row execute function public.reports_tombstone();

create or replace function public.reports_no_resurrect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then return new; end if;
  if exists (select 1 from public.report_tombstones where id = new.id) then
    return null; -- skipped without an error: the report was deleted
  end if;
  -- A new report from a player is open.
  new.resolved_at := null;
  if new.data ? 'resolvedAt' then new.data := jsonb_set(new.data, '{resolvedAt}', 'null'::jsonb); end if;
  return new;
end;
$$;
drop trigger if exists reports_no_resurrect on public.reports;
create trigger reports_no_resurrect before insert on public.reports
  for each row execute function public.reports_no_resurrect();

revoke execute on function public.reports_keep_decision() from public, anon, authenticated;
revoke execute on function public.reports_tombstone() from public, anon, authenticated;
revoke execute on function public.reports_no_resurrect() from public, anon, authenticated;
