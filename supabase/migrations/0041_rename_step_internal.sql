-- apply_item_renames is a step of content_save_v2, not an API (review of 0039).
--
-- It was granted to `authenticated` (migration 0017). It refuses non-admins, but an admin
-- could call it directly through the API, with any list of renames: it then moved or MERGED
-- every player's progress (keeping the record with more answers) without any content change
-- and without the check of migration 0039 that a rename must not land on a name another word
-- has. That is a way around the protection.
--
-- Now nobody but the function's owner can execute it. content_save_v2 (security definer, same
-- owner) still calls it, so a content save with renames works as before, with the check.
-- The app never called it directly (it calls content_save_v2).
--
-- Compatibility: a client that called apply_item_renames directly would now get "permission
-- denied for function" (42501). None of this repository's code does.

revoke execute on function public.apply_item_renames(jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
