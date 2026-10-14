-- Grammar rules in the library and in views get the same handling as words:
-- put rules in my library, take one out of a view, take one out of my library
-- (which also takes it out of my views). Nothing is physically removed.

create or replace function public.library_add_rules(p_rules uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_new integer;
begin
  if v_me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if coalesce(array_length(p_rules, 1), 0) > 200 then raise exception 'Add up to 200 rules at a time.' using errcode = '22023'; end if;
  insert into public.library_rules (user_id, rule_id)
  select v_me, r.id from public.grammar_rules r where r.id = any (p_rules) and r.deleted_at is null
  on conflict (user_id, rule_id) do update set removed_at = null, added_at = now() where public.library_rules.removed_at is not null;
  get diagnostics v_new = row_count;
  return v_new;
end;
$$;

create or replace function public.view_drop_rule(p_view uuid, p_rule uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.collection_rules cr set removed_at = now()
  where cr.collection_id = p_view and cr.rule_id = p_rule and cr.removed_at is null
    and exists (select 1 from public.collections c where c.id = p_view and c.owner_id = (select auth.uid()));
$$;

create or replace function public.library_remove_rule(p_rule uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.library_rules set removed_at = now() where user_id = (select auth.uid()) and rule_id = p_rule and removed_at is null;
  update public.collection_rules cr set removed_at = now()
  where cr.rule_id = p_rule and cr.removed_at is null
    and exists (select 1 from public.collections c where c.id = cr.collection_id and c.owner_id = (select auth.uid()));
$$;

do $$
declare f text;
begin
  foreach f in array array['public.library_add_rules(uuid[])', 'public.view_drop_rule(uuid, uuid)', 'public.library_remove_rule(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
