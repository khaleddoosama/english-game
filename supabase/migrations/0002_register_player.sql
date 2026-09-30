-- Player sign-up without email. Accounts are username + password; the auth
-- email is a placeholder on the reserved .test domain, so no mail is ever
-- sent and Supabase's email confirmation/rate limits never apply.
create or replace function public.register_player(p_username text, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(p_username));
  v_email text;
  v_id uuid := gen_random_uuid();
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 letters, numbers or _' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then
    raise exception 'Password must be 6-72 characters' using errcode = '22023';
  end if;
  v_email := v_username || '@wordhunter.test';
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where email = v_email) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;
  -- Crude abuse brake: at most 20 new accounts per 10 minutes.
  if (select count(*) from auth.users where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Too many sign-ups right now, try again in a few minutes' using errcode = '54000';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('username', v_username), now(), now(),
    '', '', '', '');
  insert into auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', v_id::text, now(), now(), now());
end;
$$;
revoke execute on function public.register_player(text, text) from public;
grant execute on function public.register_player(text, text) to anon, authenticated;

-- The admin account moves to the same placeholder domain.
update auth.users set email = 'khaled@wordhunter.test' where email = 'khaled@wordhunter.app';
update auth.identities
  set identity_data = jsonb_set(identity_data, '{email}', '"khaled@wordhunter.test"')
  where provider = 'email' and identity_data ->> 'email' = 'khaled@wordhunter.app';

-- Probe accounts from testing sign-up.
delete from auth.users where email like 'probe%';
