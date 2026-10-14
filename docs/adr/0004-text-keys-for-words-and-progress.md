# ADR 0004: Words and progress keyed by the word's text, bridged to ids by `legacy_key`

- Status: Accepted, **under review**. Related problems: `DP-01`, `DP-02`, `DP-06`.
- Modules: [content](../modules/content/README.md), [progress](../modules/progress/README.md), [library](../modules/library/README.md)

## Context

The game began as a single file where a word was identified by its text. Imports, backups, mastery rows, pools, confusions and reports all use that text. Later, a dictionary with ids, personal libraries and views was added.

## Decision

Keep the text as the key for content and for progress. The text before a trailing bracket is the headword, and the whole text is the key ("Cast", "Cast (to throw)"). The new tables hold the old key in `legacy_key`, and the browser maps keys to ids with an id map built from those columns. A rename of a word or category is applied to every player's progress in the same transaction as the content save, and recorded in `item_key_aliases`.

## Why

From the README and migration 0027: existing backups, import files and saved progress stay valid; nothing about progress had to be migrated when the library was added.

## Alternatives (reconstructed)

- Move to ids everywhere at once: cleaner, but needs a migration of every player's progress and a new backup format.
- Keep two unrelated models: avoids a bridge, but a word added to a library would not be the word the player practises.

## Consequences

- A rename changes the key, so everything keyed by id needs care: the library does not follow a rename today (`DP-01`).
- A word that exists only as a private library row has no text key in the content, so it cannot be practised (`DP-02`).
- `sense_progress` and `rule_progress` were created for id-keyed progress and are not used (`DP-06`). Phase 5 of the [roadmap](../architecture/roadmap.md#phase-5-decide-the-progress-model) is to decide.
- Import, export and backup formats are public contracts with players' data; changing the key rule needs a migration path.
