-- The Activity log reads each entry with the admin's username
-- (admin:admin_id(username)). The API can only follow links to tables it
-- exposes, and admin_id pointed at auth.users only, so the request failed
-- with "Could not find a relationship between 'admin_audit' and 'admin_id'".
-- Link it to profiles as well, the same way reports.user_id is linked.
alter table public.admin_audit
  add constraint admin_audit_admin_profile_fk foreign key (admin_id) references public.profiles (id) on delete set null;
create index admin_audit_admin_idx on public.admin_audit (admin_id);
notify pgrst, 'reload schema';
