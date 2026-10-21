# Closing the module refactor (2026-10-21)

What the agreed refactor covered, what is done, what was decided to stay as it is, and what is left outside it.
Status words follow the [documentation rules](../README.md#documentation-rules).

## Scope

Phase 4 of the [roadmap](../architecture/roadmap.md#phase-4-make-the-code-easy-to-change) (`MT-01` to `MT-04` and the
module cycles), the [module plan](../architecture/modules.md#plan-for-the-other-modules) (rows 1-7), Home, the unused
exports, and the `engine` <-> `lib` loop. Each step kept behaviour (a browser spec that passed before and after the move,
or a build that is the same), except the behaviour changes listed in
[modules.md](../architecture/modules.md#behaviour-changes-made-during-this-work), each made in its own PR.

## Done (Implemented)

| Item | Where it is recorded |
| --- | --- |
| Module plan rows 1-7 (repo parts, question reports, content admin, import/export, AI helpers, progress state and answer recording, starting rounds) and Home | [modules.md](../architecture/modules.md), each row's guide |
| `MT-01`: `WordHunter.jsx` 2,150 → 412 lines (target: under about 600) | [roadmap](../architecture/roadmap.md#problem-register) |
| `MT-02`: content passed down instead of module variables | [content-catalog.md](../modules/content/content-catalog.md) |
| `MT-03`: the unreachable round engine removed | roadmap |
| `MT-04`: sign-in, save effects, answer recording and starting rounds have unit tests and browser specs (one part open, below) | roadmap |
| Cycles: `live` <-> `social` (2026-10-19), `engine` <-> `features/media` (2026-10-19), `engine` <-> `lib` (2026-10-21) | [ADR 0010](../adr/0010-ai-prompts-outside-the-engine.md) |
| Import rules enforced by a test (no loop between files or modules, the engine imports no module, each module's allowed imports, index-only access; reports and import & export reach `lib` only for the AI prompts) | `tests/architecture.test.js`, `tests/library-boundary.test.js` |
| Unused exports removed or made internal, with a guard | [unused-exports.md](../architecture/unused-exports.md) |

## Decided to stay as it is

- **The progress engine in `repo.js` stays one piece.** The pure parts and the content and reports stores are out
  (556 → 289 lines); the rest shares the save queue, revisions and snapshot state, and splitting it would only
  lower the line count ([repo.md](../architecture/repo.md)). Roadmap Phase 4 step 3 is closed on that basis.
- **`WordHunter.jsx` stays as the shell** that wires the modules (412 lines). It gathers the data each module needs
  (library keys and views, progress, app settings) and passes it in.

## Outside the refactor (recorded, not done here)

- **Bugs** kept on purpose, each with steps and a proposed behaviour: [known-bugs.md](known-bugs.md) (three).
- **Roadmap phases 1, 2, 3 and 5** (data loss on renames, one meaning of "mastered", permissions, the progress model)
  change behaviour, data or permissions and need the owner's decisions; they are tracked in the
  [roadmap](../architecture/roadmap.md#plan). Phase 0's known-failure SQL test for `DP-01` belongs with Phase 1.
- **Known Issues** listed on module pages (for example "1 new words" on Home) stay as they are.

## Integration tests: open gaps

The refactor is complete; the integrated verification is **not**. The gaps below are separate from the refactor and
are **not** closed by mocks or by other tests passing:

1. ~~The real stack was not run again after `realtime.send` was added~~ **closed** 2026-10-21 (#74): CI job
   `realstack` runs it on every push and pull request (Supabase's Postgres, GoTrue, PostgREST, supabase-js) and fails
   if a test is skipped. The agent's own environment still cannot fetch those images.
2. ~~No test checks that the Realtime service delivers a signal~~ **closed** 2026-10-21 (#76): the `realstack` job
   runs Supabase's Realtime service; `tests/realstack/realtime.test.js` checks that friend requests, answers, Live
   invitations and a player joining reach the right players, and that another player cannot listen
   ([integration-tests.md](../integration-tests.md), "Real stack").
3. **No browser spec runs the app against a Supabase backend** (`MT-04`'s open part). The specs run in local mode or
   with a fake Supabase; `saveclose.cjs` runs the repo against a real PostgreSQL through the test harness, without
   supabase-js, PostgREST or GoTrue.
4. **The real project** was not compared with the migrations by these tests; `supabase/ci/preflight-compare.sh` is
   the read-only check for that ([review-0037-0042.md](../migrations/review-0037-0042.md)).
