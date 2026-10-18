# ADR 0007: Library and views as a new data model beside the legacy content

- Status: Accepted. **Migration unfinished.**
- Modules: [library](../modules/library/README.md), [content](../modules/content/README.md)

## Context

Players wanted their own set of words, organised in folders that can sit inside each other, shared with friends, by link, or through a catalog. The existing model has one shared pool of content and per-player progress by text.

## Decision

Add a dictionary (`headwords` and `senses`), grammar rules and questions, and per-player `library_entries`, `library_rules` and `collections` (views, up to four levels deep) as new tables. Copy the existing content into them with `dictionary_sync`. All writes go through database functions that check who is asking; nothing is physically removed, only flagged; a player keeps only the fields they changed (a patch) so an admin fix still reaches them. The game keeps playing from the legacy content; the library only decides which words a player sees and practises.

## Why

From migrations 0026 and 0027: shared words are stored once; sharing copies a tree and never gives away private words; removal can be undone and no progress points at nothing.

## Alternatives (reconstructed)

- Store each player's library inside the progress JSON: no new tables, but no sharing, no catalog and no queries across players.
- Move everything to the new model first: cleaner end state, much bigger first step.

## Consequences

- Two models live together until progress and content move (see [ADR 0004](0004-text-keys-for-words-and-progress.md)). The copy is kept in step by a best-effort call (`DP-03`).
- Renames and deletions in the legacy content need to be reflected in the new tables (`DP-01`).
- The library is hidden until the dictionary has been copied.
