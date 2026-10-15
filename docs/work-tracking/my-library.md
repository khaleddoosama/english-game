# Work tracking: Module My Library

Branch: `ccr-29322d12-v8wkmd` (pushed; no pull request; nothing merged or deployed).
Scope: `src/features/library/`, its tests and docs, and the library part of
`supabase/`. Other modules are only read, except where a batch says otherwise.

## Done before this tracking file existed (earlier batches, same branch)

| Commit | What | Verified by |
| --- | --- | --- |
| `b65c0ee` | unit tests for rounds from a view: options, scope, rotation, grading, mastery, content input | `npm test` |
| `f796d20`..`d5e06da` | four defects: pasted list repeats, local own-word length, content check crash on empty entry, typed question showing the answer (test first, fix after) | `npm test` |
| `f4b058d` | rule -> test list `docs/library-unit-test-matrix.md` | review |
| `feb7a38` | integration tests as anon / authenticated against real PostgreSQL | `supabase/ci/run-integration.sh` |
| `e30b4d7` | migration 0037: a renamed word keeps its sense | SQL test + integration |
| `f1835ed` | migration 0038: deleting a player who used the library | SQL test + integration |
| `50e98e3` | integration docs, CI step | local run; the CI step itself was **not** run on GitHub |

## Batches in this conversation

(filled in as each batch is committed)
