-- Players can edit their own reports (an AI review attached to a report
-- they filed), not just add or withdraw them.
create policy "players update their own reports"
  on public.reports for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Link reports and live results to profiles so the API can return the
-- player's username alongside each row.
alter table public.reports
  add constraint reports_user_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
alter table public.live_results
  add constraint live_results_user_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
create index reports_user_idx on public.reports (user_id);

-- Only signed-out visitors need the sign-up function.
revoke execute on function public.register_player(text, text) from authenticated;
