# ADR 0002: Two runtime modes behind the same interfaces

- Status: Accepted. **Implemented.**
- Modules: all data modules

## Context

The app needs to be developed, tested and demonstrated without a Supabase project, and several features (Live, friends, the library) involve more than one player.

## Decision

When the Supabase settings are missing, the app runs in local mode: one built-in admin, data in IndexedDB and localStorage, AI off. The repo, the library, Live, friends and admin each define one interface with two implementations (online and local). Screens depend on the interface only.

## Why

From the code comments: tests and the browser specs run the whole app with no database; two tabs of one browser can play a Live Challenge against each other; the same screens work in both modes.

## Alternatives (reconstructed)

- Mock the network in tests only: cheaper to write, but does not give a runnable offline app and drifts from real behaviour.
- Always require a local Supabase: more faithful, heavier for contributors and for the browser specs.

## Consequences

- Each local implementation copies the server's rules and messages, so they can drift. The library guards against this with a differential test and with contract tests that run the app's API against the real SQL functions (`PGURL` set). Live, friends and admin have no equivalent test (`MT-05`).
- Local mode cannot show problems that depend on the database (permissions, revisions, triggers).
