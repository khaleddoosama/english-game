-- Advisor follow-ups: one policy per role/action, and an index for the
-- live_rooms foreign key.
drop policy "admin writes content" on public.content_items;
create policy "admin adds content" on public.content_items for insert to authenticated with check ((select public.is_admin()));
create policy "admin edits content" on public.content_items for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin removes content" on public.content_items for delete to authenticated using ((select public.is_admin()));

drop policy "admin updates reports" on public.reports;
drop policy "players update their own reports" on public.reports;
create policy "players update their reports, admin updates all" on public.reports for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

create index live_rooms_host_idx on public.live_rooms (host_id);
