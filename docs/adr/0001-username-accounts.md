# ADR 0001: Username and password accounts through a placeholder email

- Status: Accepted. **Implemented.**
- Modules: [accounts](../modules/accounts/README.md)

## Context

Players are learners, often friends of the admin. Asking for an email address adds friction and exposes personal data. Supabase Auth, however, identifies a user by email and password.

## Decision

A player signs up with a username (3 to 20 characters of `a-z`, `0-9`, `_`) and a password of at least 6 characters. The browser maps the username to a placeholder address on the reserved `.test` domain and uses Supabase Auth with that address. Accounts are created only by the database function `register_player`; open sign-up in Supabase Auth must stay off.

## Why

From [supabase.js](../../src/lib/supabase.js) and the README: no email is needed, so sign-up takes seconds; usernames are what friends type to find each other; creating accounts through one function lets the database apply sign-up limits and always create a `player`.

## Alternatives (reconstructed)

- Real email and magic links: less friction for recovery, but collects personal data and needs mail delivery.
- Social login: needs third-party accounts and gives the app names it does not need.
- Open Supabase sign-up with email: bypasses the rate limits and the "always a player" rule.

## Consequences

- No password reset by email. The admin can set a password (`admin_set_password`). A player changes it from the profile page.
- The placeholder address is an internal detail; it is not a real mailbox.
- If "Allow new users to sign up" is turned on in Supabase, the sign-up limits and the player-only rule can be bypassed. This is a deployment setting to keep off.
