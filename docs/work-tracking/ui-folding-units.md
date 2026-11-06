# View folding and units filters

Status: **Implemented**, 2026-10-22. Type: **Feature**. Merge requires owner approval.

Started from master `bb929c19c918dbec1a0c1e807f835d83fb54c6c0`. The owning module pages were marked
Planned in `e20852666ef5fdfd457a2ce41dcf84d674197d87` before implementation, then changed to Implemented after verification.

## Screens and behaviour

- Home's My Views groups and selected root, plus the editable tree at `/library`: shared folding arrow/state,
  independent name actions, no arrow on leaves, 44px keyboard-operable buttons with accessible names and
  `aria-expanded`. Nested fold state survives folding ancestors; hidden editable rows stay mounted to preserve
  panel selection. No membership or practice-scope changes.
- `/admin/words` and `/admin/grammar`: unit filter combines with existing filters/search, persists in URL and
  resets pagination. All units and Without unit are distinct from real unit names.
- The owner confirmed both destinations reached from Profile: `/library` Library tab (words and rules) and
  `/library?view=<id>` In this view (independent words/rules filters). ProfilePage itself has no content lists.
  Local filter state follows each screen's existing lifetime; no new URL state was introduced there.
- Options come only from the relevant available list, not the global dictionary for a personal list.
  Multi-unit items match any unit; absent/empty arrays match Without unit. Clear action remains available
  when filters/search yield no results. Word show-more resets when the unit changes.
- No database, production data, AI, Catalog notifications, Live or Realtime code changes.

## Evidence

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm test -- --reporter=dot` | 104 files, 1183 tests passed; 12 files / 116 tests require external services and were skipped locally |
| `npm run build` | Passed |
| `npm run e2e -- units-folding` | 46 checks passed on the built app, desktop 1280×900 and mobile 390×900 |
| Visual review | Admin Words/Grammar, Library, In this view, editable tree and Home reviewed; mobile names/arrow layout adjusted and rechecked |
| Data effects | Unit tests assert no content update calls and unchanged practice arguments; browser uses only isolated synthetic local data |

The browser spec generates twelve screenshots in `e2e/out`: `units-{words,grammar,library,view}-{desktop,mobile}`
and `fold-{tree,home}-{desktop,mobile}`. Screenshots are delivered separately rather than stored as binary source.

The existing tree test now checks visible rows and separately asserts the hidden descendant count; its folding
expectation is preserved. The library dependency guard explicitly includes the two shared unit UI helpers;
module boundaries and every other dependency remain guarded.

## Limits

Local browser verification uses Chromium and the local API adapter; it does not access production or prove
server authorization. Required `app`, `database`, `e2e`, `pr-rules`, and `realstack` checks must finish on the
PR's latest commit before readiness is reported. This record does not claim local database tests ran.
