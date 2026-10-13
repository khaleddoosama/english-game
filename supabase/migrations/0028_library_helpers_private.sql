-- view_depth and view_height are helpers for the view functions, which run as
-- their owner; players have no reason to call them (they would answer for any
-- view id). Revoked, the library functions keep working.
revoke execute on function public.view_depth(uuid) from public, anon, authenticated;
revoke execute on function public.view_height(uuid) from public, anon, authenticated;
