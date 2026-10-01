-- Only the server writes the shared pronunciation cache and finishes AI
-- log rows (review F05, F10). It uses the project's secret key
-- (SUPABASE_SECRET_KEY in Vercel); a player's own token can do neither.

-- Players could upload any file under tts/v1/, including a wrong audio for
-- a phrase before the server made it. Now nobody but the server can.
drop policy if exists "players cache pronunciation audio" on storage.objects;

-- The log row is finished by the server, not by the player it belongs to,
-- so the model, time and token numbers can't be made up. Still only once,
-- and only for 15 minutes after the gate.
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
  where id = p_id and status = 'started' and at > now() - interval '15 minutes';
end;
$$;
revoke execute on function public.ai_call_finish(bigint, boolean, text, integer, integer, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_call_finish(bigint, boolean, text, integer, integer, text, integer, integer, integer) to service_role;
