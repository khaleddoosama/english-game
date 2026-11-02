-- Rollback of migration 0044 (the word contract's SQL check): removes the two functions. Nothing uses them in this
-- step, so nothing else changes. Run in one transaction:  psql "$URL" -1 -f supabase/rollback/0044_down.sql
drop function if exists public.word_contract_errors(jsonb);
drop function if exists public.word_contract_empty(jsonb);
