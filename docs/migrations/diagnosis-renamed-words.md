# Renames made before migration 0037: diagnosis and a separate repair plan

Status: **diagnosis only. No data was changed and no repair is written.** The queries below only read.

## The problem

Before 0037, renaming a word (content save with a rename, then the dictionary sync) left the library on
the old word: the sync flagged the old sense deleted and created a new one, so a library entry or a view
item that held the word stays on a **deleted sense**. The player's progress did follow the rename (migration 0017).
Migration 0037 stops this from happening again; it does not heal what already happened.

## Diagnosis (read-only; run on a copy or with a read-only role)

Entries and view items still on a deleted sense whose old key was renamed:

```sql
-- library entries
select e.user_id, e.sense_id, s.legacy_key as old_key, a.to_key as new_key
from public.library_entries e
join public.senses s on s.id = e.sense_id and s.deleted_at is not null
join public.item_key_aliases a on a.kind = 'word' and a.from_key = s.legacy_key
where e.removed_at is null;

-- view items (the same words inside views)
select cs.collection_id, cs.sense_id, s.legacy_key as old_key, a.to_key as new_key
from public.collection_senses cs
join public.senses s on s.id = cs.sense_id and s.deleted_at is not null
join public.item_key_aliases a on a.kind = 'word' and a.from_key = s.legacy_key
where cs.removed_at is null;
```
(Check the column names of `collection_senses` against the migrations before running; they are written from
the review, not run on real data.)

Report to produce from them, **without row content of users beyond ids**: how many players, entries and view
items are affected; for each, whether the new sense exists (`senses.legacy_key = new_key and deleted_at is null`);
whether the player already has the new sense in the library or in the same view (a clash: two rows for one
word); chains (A renamed to B, B to C).

## Plan for the repair (separate piece of work, needs approval)

1. Take the diagnosis report on a **copy** of production (restore of a backup), not on production.
2. Write the repair as a function that, per affected row, moves the entry / view item to the new sense, and when
   the player already has the new sense, keeps one and marks the other removed (never deletes rows). Chains are
   followed to the last name.
3. Write it test-first on made-up data that contains each case (plain, clash, chain, new sense missing).
   The upgrade check already has one affected entry (`upOld`).
4. Run it on the copy; compare counts before and after; the player-facing check is that each view lists the same
   words as before, under their new names.
5. A rollback: keep the old (sense, removed_at) values in a side table for the run, so it can be undone.
6. Only then, with approval, plan the production run (backup first, low traffic).

Not done and not decided: whether affected players are told.
