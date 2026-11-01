# ADR 0011: One data contract for a word

- Status: **Proposed** (revised 2026-11-01 after the owner's first review). The owner agreed with the direction;
  this text waits for approval. Nothing here is built. No code and no production data were changed for it.
- Modules: [content](../modules/content/README.md), [ai-media](../modules/ai-media/README.md),
  [admin](../modules/admin/README.md), [learning-engine](../modules/learning-engine/README.md),
  [library](../modules/library/README.md)
- Related:
  - [ADR 0004](0004-text-keys-for-words-and-progress.md): a word is keyed by its text. This record keeps that.
  - `docs/modules/content/word-fields.md` (in PR #83): how every field is written and read today.
  - Register entry `LC-04` (also in PR #83).

## Context

A word is one JSON object in `content_items.data`. Five kinds of writer each shape it their own way:

- import (v2 and v3 files);
- the word editor;
- Ask AI (drawer add, editor fill, stub fill);
- Content Health, Regenerate and the report fix;
- the save of the game's copy.

Only some keys are checked (`validateContent`). Any admin can also write `content_items` directly: the row policies
from `0005` allow insert and update to the admin, so no rule is enforced on the server.

**Production** (754 live words; read-only counts from `content_items`, 2026-11-01; no content copied):

| Finding | Count |
| --- | --- |
| Words with both `situation` and `situations`, and with both `gap` and `gaps` | 442 each |
| `situation` is not `situations[0]` and not in the list | 8 words |
| `gap` is not `gaps[0]` and not in the list | 1 word |
| `gap` with two blanks | 1 word |
| More than one example / more than one gap | 176 / 302 words |
| Stored `opposite` (each one is also in `antonyms`) | 107 words |
| `relations` present (`antonyms` 301, `synonyms` 301, `confusableWords` 344) | 347 words |
| `relations.antonyms` entries missing from `antonyms` | 4 entries in 4 words. Each names a live word: moving them would add opposite pairs to play. |
| `relations.synonyms` entries missing from `synonyms` | 0 |
| `relations.confusableWords` references | 557: 374 to live words, 181 to no word, 2 to deleted words |
| Empty lists stored | 288 words (`excludeFromSameOptionsWith` 152, `antonyms` 115, `wordFamily` 89, `synonyms` 52, `collocations` 1) |
| Stored values `false` or `0` | 0 |
| `categoryId` / `subCategoryTitle` / `id` | 747 / 265 / 281 words |
| `learningData` (`cluster` and `difficulty`, both strings) | 303 words |
| `register` | 281 words |
| `acceptedWrittenAnswers`: a list that no code reads and no doc names | 13 words |
| `chainGroup`, `plainForm`, `_autoStub`, `image` as `data:` | 0 each |
| `_aiAdded` (always `true`) | 9 words |

Readers of the stored shape outside the game's own code:
- `dictionary_sync` (`0027`) reads `opposite`, `relations.*`, `synonyms`, `partsOfSpeech`, `level` and `units`, and
  copies the rest into `senses.content`. It reads `_aiAdded` by presence only, so `"_aiAdded": false` would still count
  as AI.
- The analytics views (`0010`: `analytics.words`, `word_quality`) read `situation`, `gap`, `opposite`, `meaning`,
  `hints`, `synonyms`, `antonyms`, `collocations`, `wordFamily`, `image`, `_aiAdded` and `_autoStub`.

## Decision

One contract, in one pure module (`src/engine/wordContract.js`). It is enforced in two places:
- in the browser, by every writer (warnings and clear errors before anything is sent);
- on the server, by a trigger on `content_items` that refuses any write of a word that breaks the shape rules,
  whoever sends it (section 6).

The game keeps reading what it reads today, through a view built at load time.

### 1. Classes of key

| Class | Meaning | Stored |
| --- | --- | --- |
| **Stored** | Authored and used. The one place for its fact. | Yes |
| **System** | Set only by code, and used. Kept on export so that a backup restores it. | Yes |
| **Derived** | Worked out at read time from stored keys. | Never |
| **Input alias** | An older or v3 way to give a stored key, accepted for compatibility and converted on input. | Never |
| **Retired** | Found in stored data but proven unused. Moved to an archive table outside the word, then deleted, only by the approved migration (section 7). Until then it is left untouched in stored rows, and refused in new input. | No, after the migration |

There is no "extra" class. **A key that is not in the table below is refused in any new write.** A key like that
already stored is reported by the dry run and treated as Retired.

### 2. Values: absent, empty, false and zero

- **Empty** means `""` (or only spaces), `null`, `[]` or `{}`. `false` and `0` are **not** empty. A key that does not
  accept them refuses them with a type error; they are never dropped silently. No stored key accepts a number, and
  the system flags accept only `true`.
- Text is trimmed and inner spaces become single. Lists keep their order.

**Full write** (a new word: create, Ask AI add, a new word in an import):
- a missing **optional** key means no value;
- a missing **required** key is an error;
- an empty **optional** key is the same as missing: it is not stored;
- an empty **required** key is an error.

**Partial update** (an existing word: editor save, import over an existing word, AI fill, Content Health,
Regenerate, report fix):
- a key that is **absent** keeps its stored value;
- a key that is **present and not empty** replaces it; a list replaces the whole list;
- a key that is **present and empty** clears an optional key, and is an error for a required one.

The saved word never holds an empty value.

### 3. The final key table

"Shows the word" uses the check of PR #83 (regular forms only; limits listed there). It gives a **warning** only,
because the check is limited.

| Key | Class | Type | Req. | Valid when | Absent / empty | Use today |
| --- | --- | --- | --- | --- | --- | --- |
| `word` | Stored | string, at most 120 | Required | Not empty. Unique ignoring case and spaces (the row key). A trailing `(qualifier)` names one meaning. Never changed by the contract (renames have their own path). | Error | The identity and the progress key |
| `id` | Stored | string, at most 80 | Optional | Not empty; unique | No id | Rename detection on a v3 import |
| `type` | Stored | `vocab` \| `idiom` \| `binomial` \| `phrasal` \| `fyi` | Required | One of the five | Error | Question modes, options |
| `category` | Stored | string, at most 60 | Required | Not empty | Error | The lesson |
| `subCategory` | Stored | string, at most 60 | Optional | Not empty | No group | Options, lesson groups |
| `units` | Stored | string[] | Optional | Items not empty, no repeats | No units | Lesson sessions, options, Live filter |
| `level` | Stored | `A1.1` … `C2.3`, or `A1` … `C2` | Optional | Matches after `normalizeLevel` | Middle rank | Course view, new-word order |
| `partsOfSpeech` | Stored | string[], 1–3 | Optional | Each from the game's list (lower case). The first is the main one. | Options grouped by type (warning) | Options, Word Family, display |
| `meaning` | Stored | string, at most 300 | Required | Not empty. Warning if it shows the word. | Error | Questions, display, AI |
| `situations` | Stored | string[], at least 1 | Required, except for a stub | Items not empty, at most 300, no repeats, no blank | Error | Item `[0]` is shown (as `situation`) |
| `gaps` | Stored | string[], at least 1 | Required, except for a stub | Each has exactly one blank (two or more `_`), at most 300, no repeats. Warning if it shows the word. | Error | `[0]` and the rest are the gap-pool seeds, by position (section 5) |
| `hints` | Stored | string[] | Optional | Items not empty. Warning if one shows the word. | No hints | Questions |
| `plainForm` | Stored | string | Optional | Not empty | Line hidden | New-word card |
| `transformExample` | Stored | `{before, after}` | Optional | Both not empty; type `phrasal` or `fyi` only | No Transform | Transform questions |
| `commonMistakes` | Stored | `{sentence, correction, why}[]` | Optional | All three not empty; the correction differs from the sentence (ignoring case and punctuation) | No Grammar Court | Grammar Court |
| `antonyms` | Stored | string[] | Optional | Items not empty, no repeats | No opposite | The only source of opposites |
| `synonyms` | Stored | string[] | Optional | as `antonyms` | None | Option exclusion |
| `confusableWords` | Stored | string[] | Optional | as `antonyms`. A name with no live word: warning, kept, never stubbed. | None | Option ranking |
| `excludeFromSameOptionsWith` | Stored | string[] | Optional | as `antonyms` | None | Option exclusion |
| `pictureAvoid` | Stored | string[] | Optional | as `antonyms` | None | Picture options |
| `collocations` | Stored | string[] | Optional | Items not empty | None | Admin quality score, CSV, editor. Not used by questions; kept as admin-used. |
| `collocationChecks` | Stored | `{sentence, answer, wrong[], explanation?}[]` | Optional | One blank; an answer; at least two wrong options, none equal to the answer | No Word Partners | Word Partners |
| `wordFamily` | Stored | `{word, pos?}[]` | Optional | `word` not empty. A member without `pos` gives a warning (it is not used). | No Word Family | Word Family |
| `image` | Stored | `https://` link | Optional | `https://` only | No photo | Picture Hunter, display |
| `illustration` | Stored | inline `<svg>`, at most 12,000 | Optional | No script, no event handler | No drawing | Picture Hunter, display |
| `distractorGroup` | Stored | string | Optional | Not empty | Not grouped | Options, when there is no `subCategory` |
| `learningData` | Stored | `{cluster: string}` | Optional | `cluster` not empty; no other key | No bonus | Option ranking (`cluster` only) |
| `categoryId` | System | string | — | Set by a v3 import. Removed when `category` changes. | — | v3 category renames |
| `subCategoryTitle` | System | string | — | Set by a v3 import. Removed when `subCategory` changes. | — | Lesson group title |
| `_autoStub` | System | `true` | — | Set only when a stub is made | Not a stub | Fewer required keys; admin badge |
| `_aiAdded` | System | `true` | — | Set only when Ask AI adds a word | Not AI | Admin badge; library source |
| `gapsCheckedFor` | System | string | — | Set only by Content Health | Not checked | Content Health |
| `situation`, `gap`, `commonMistake` | Derived; Input alias | | | Read as item `[0]` of the list. On input see section 4. | | Read by the game, analytics and the CSV |
| `opposite` | Derived; Input alias | | | Read as `linkAntonyms` gives it, as today. On input it is added to `antonyms`; `"None"` means no opposite. | | Opposite Battle, library links |
| `relations.antonyms`, `relations.synonyms`, `relations.confusableWords` | Input alias | | | Merged into the top-level list (union, order kept, no repeats). | | |
| `example` | Input alias | | | Added to `situations` when not already there | | |
| v3 `links`, v3 category ids | Input alias | | | Converted as `normalizeV3` does today | | |
| `register` | Retired | | | | | Only its own editor box reads it |
| `chainGroup` | Retired | | | | | Read only by `chainSession`, which has no caller |
| `learningData.difficulty` | Retired (only this inner key) | | | | | Never read; `learningData.cluster` stays |
| `acceptedWrittenAnswers` | Retired | | | | | Never read; **no new feature for it now** |
| `sentenceBuild` | Retired | | | | | Removed feature |

### 4. Lists, single fields and conflicts

- **Lists are the only stored place.** The single fields `situation`, `gap` and `commonMistake` are worked out at
  read time from item `[0]`.
- **A single field on input** (alias):
  - if there is no list, the list becomes `[value]`;
  - if the value equals list item `[0]`, nothing happens;
  - otherwise it is a **conflict**:
    - a new write with a conflict is refused, naming the word, the field and both values;
    - a stored word with a conflict is not converted. It appears in the dry run, and only the owner's decision
      for that word resolves it.

  The single field never wins on its own.
- **Each sentence keeps its practice statistics.**
  - Pool items are named by position. `seed` holds the counts of the sentence the first question showed, which today
    is the single `gap` (`makeQuestion` uses `w.gap` for `seed`). `seed-2`, `seed-3` … hold the counts of `gaps[1]`,
    `gaps[2]` ….
  - So for each conflict the dry run shows: the single value (shown to players, owner of the `seed` counts); `[0]` of
    the list (not shown as the first gap while the two differed); and how many players have counts on `seed` for that
    word.
  - **Choice A**: the shown sentence becomes `[0]`, and the old `[0]` goes to the end. No counts move.
  - **Choice B**: keep the list's `[0]`. The `seed` counts would then sit on a different sentence. So B is offered
    only together with a separate, approved change that moves those counts in players' progress, or an explicit
    approval to reset them for that word.
  - The same applies to `situations`. Practice does not ask the situation pool today, but its stored counts are
    reported the same way.
- **Normalising is stable.** `normalize(normalize(x))` equals `normalize(x)` for every input. The migration's
  check runs the normaliser a second time on its own output and expects no change (section 7).

### 5. Relations between words

- **Top-level lists are the only stored place.** `relations` is accepted on input for compatibility and merged in.
  `relations.synonyms` adds nothing in production. `relations.confusableWords` moves as it is.
- **No new opposites are turned on as a side effect.**
  - The game does not read `relations.antonyms` today. Loading never folds it in.
  - For the 4 production words whose `relations.antonyms` has entries missing from `antonyms`, the migration does
    not decide on its own. The owner chooses per word:
    - move the entry into `antonyms`: a listed change in play, because new opposite pairs appear;
    - or archive it.
  - A new write that gives `relations.antonyms` is merged, because it is new authored input.
- **References to no word stay as they are.**
  - The 183 `confusableWords` references (181 to no word, 2 to deleted words) are kept and listed by class in the
    report.
  - They are neither deleted nor turned into stubs.
  - A new write that names no live word gives a warning.
- **Renames update every relation list** (`antonyms`, `synonyms`, `confusableWords`, `excludeFromSameOptionsWith`,
  `pictureAvoid`), for entries equal to the old name ignoring case. This is a fix that comes with step 4
  (writers).

### 6. One path for every writer, checked on the server too

| Writer | With the contract |
| --- | --- |
| Import (v2, v3 files, a backup's content) | `prepareImport` (the v3 conversion is kept) → `readWord` on each incoming word → `checkWord`, strict. **Any error refuses the whole file before anything is written.** The report lists word, field and reason. Old-shape files are accepted when they only use input aliases without conflicts; retired or unknown keys refuse them. |
| Word editor | The form gives the lists → `updateWord(previous, changes)` with partial-update rules → `checkWord`. A word with an unresolved conflict cannot be saved; the message names the conflict. |
| Ask AI | The AI is asked only for keys in the table: `word`, `type`, `partsOfSpeech`, `category`, `meaning`, one example, one gap, `hints`, at most one common mistake. It may also give `pronunciation` and `nearWords`, which are shown in the drawer and never stored. Optional keys are not asked to be filled: a missing hint or mistake stays missing (the prompt of PR #83 already says "never invent"). The checked card (`readAskAiAnswer`) becomes a word through `readWord(…, {source: "ai"})` → `checkWord`. The same applies to editor fill and stub fill. |
| Content Health, Regenerate, Report fix | `updateWord(previous, patch)` → `checkWord`. Regenerate replaces `situations[0]`. A report fix that fails is shown with its errors and cannot be applied. |
| Save of the game's copy | `storedWord` removes derived keys and keeps retired keys that are already stored (until the migration). Only changed words are sent, as today. |
| **Server** | A `BEFORE INSERT OR UPDATE OF data` trigger on `content_items`, for a word row that is not deleted, calls `public.word_contract_errors(data)` and raises on any error. It checks the shape rules of section 3: allowed keys, types, required keys, the enums, one blank per gap, list items, flags only `true`, no derived or alias keys. It covers `content_save_v2`, staged drafts when they are published, and direct table writes by the admin. |

**Server check details.**
- **The browser and the server must agree.** The rules are written twice: JavaScript (the reference) and SQL. One
  shared file of cases (`tests/fixtures/word-contract-cases.json`) is run against both, `checkWord` in the `app`
  job and `word_contract_errors` in the `database` job. A difference fails CI.
- **What the server does not check.**
  - Warnings, and rules that need other words (whether a reference resolves), stay in the browser.
  - No check, in either place, proves that a meaning is right, an example natural, or a gap clear: a valid shape is
    not a correct word.
- **The only exception is the restore** (section 8). It writes snapshot rows exactly as they were. The trigger lets
  a row through only when a `content_restores` record for the same transaction (`txid_current()`) lists that
  snapshot row. Only the definer function `content_restore` can write that table.

### 7. Changing the stored words (the migration)

1. **Dry run (read-only).**
   - The contract runs over the raw rows: not the game's copy, which has derived values.
   - It writes a report with one line per word and field. The classes:
     - moved (alias to list, `relations` flattened);
     - removed empty value;
     - retired (to archive);
     - conflict (section 4, with the seed counts);
     - `relations.antonyms` extras (section 5);
     - reference to no word or to a deleted word;
     - library links that would change;
     - fails strict (for example, the gap with two blanks).
   - The owner reviews it and records the decisions (conflict choices, the 4 antonym entries, the archive).
2. **Snapshot** (section 8), in the same transaction as the apply.
3. **Apply.** One function, `content_migrate(snapshot, upserts, archive, expected_version)`:
   - checks the content version;
   - writes the archive rows: table `content_field_archive` with migration id, word key, key path, value and time;
   - writes the converted rows through the normal save path;
   - records the hash of each row it wrote, for the restore's conflict check.
   - All of it happens in one transaction.

   Words with an unresolved conflict or a strict failure are not written.
4. **Checks after the apply.**
   - Running the normaliser again gives no change.
   - The game view of every converted word equals its view before, except the approved changes in the report.
   - For each word, the text behind `seed` is the same as before.
   - Progress, mastery, pools, reports, Live records and library links (except the changes in the report) are
     untouched. The `word` key does not change.
5. **Before production.** It runs first on the real-stack CI with synthetic data covering every class above.

### 8. Backup and restore

- **The snapshot holds the original rows**, before any conversion or removed key:
  - table `content_snapshots` (id, time, by, content version, note);
  - table `content_snapshot_items` (kind, key, `data`, position, deleted, `updated_at`), copied from
    `content_items` as they are.
  - A file of the same rows can also be downloaded, with its SHA-256 recorded on the snapshot. The current
    "export" is not a backup for this: it writes the game's copy, which drops duplicates and adds derived values.
- **Restore** (`content_restore(snapshot, expected_version, overwrite_keys default none)`):
  - It **refuses to overwrite newer edits.** For each key, it compares the current row with the hash the migration
    recorded. A key changed since then is listed, and nothing is written unless that key is passed in
    `overwrite_keys`.
  - It writes the snapshot rows byte for byte (the trigger exception above) and raises the content version, so
    devices reload.
  - The audit log records before and after. Archive rows stay, marked as restored.
  - Restoring a downloaded file loads it into a new snapshot first; its SHA-256 must match.
  - The import is **not** the restore path: it would refuse or convert old shapes.
- **Tests** (CI database, synthetic rows):
  - snapshot → migrate → restore gives `data` equal (`jsonb`) to the original for every row;
  - a key edited after the migration is refused, and is written only when passed explicitly;
  - progress tables are untouched;
  - a direct write of a bad row fails, while the restore of the same row passes.

### 9. Examples (synthetic)

**Valid: a new word, full write.**

```json
{
  "word": "Ferry",
  "id": "w-ferry",
  "type": "vocab",
  "category": "Travel",
  "subCategory": "Boats",
  "units": ["Unit 4"],
  "level": "A2.2",
  "partsOfSpeech": ["noun"],
  "meaning": "A boat that carries people and cars across water.",
  "situations": ["We took the ferry to the island.", "The ferry was late because of the wind."],
  "gaps": ["The ______ leaves the harbour every hour, so we can bring the car.", "Cars drove onto the ______ before it crossed the river."],
  "hints": ["It floats.", "It can carry cars."],
  "commonMistakes": [{ "sentence": "We went by the ferry.", "correction": "We went by ferry.", "why": "After 'by' we use the transport without 'the'." }],
  "confusableWords": ["Raft"],
  "collocationChecks": [{ "sentence": "We need to ______ the ferry at six.", "answer": "catch", "wrong": ["hold", "keep"] }],
  "wordFamily": [{ "word": "ferryman", "pos": "noun" }],
  "learningData": { "cluster": "transport" }
}
```

Stored as given. The view adds `situation`, `gap` and `commonMistake` from item `[0]`. `"Raft"` gives a warning if no
word has that name.

**Valid: a partial update of "Ferry".**
- Input `{"word": "Ferry", "hints": [], "level": "A2.3"}`.
- Result: `hints` is cleared, `level` is replaced, everything else is kept.

**Refused** (the whole write, or the whole import file):

| Input | Error |
| --- | --- |
| a new word without `gaps` | `gaps`: required |
| `{"word": "Ferry", "meaning": ""}` (partial) | `meaning`: required, cannot be cleared |
| `"type": "slang"` | `type`: one of vocab, idiom, binomial, phrasal, fyi |
| `"gaps": ["We took the ______ to the ______."]` | `gaps[0]`: needs exactly one blank |
| `"partsOfSpeech": ["thing"]` | `partsOfSpeech[0]`: not in the game's list |
| `"level": "Beginner"` | `level`: a course level (A1.2) or A1–C2 |
| `"level": 0` | `level`: expected text (a `0` is not dropped) |
| `"_aiAdded": false` | `_aiAdded`: only `true`, and set only by code |
| `"register": "informal"` | `register`: retired key |
| `"acceptedWrittenAnswers": ["boat"]` | `acceptedWrittenAnswers`: unknown key |
| `"opposite": "Calm"` sent straight to the table (bypassing the app) | server: `opposite` is derived, not stored |
| `"transformExample": {"before": "a", "after": "b"}` on a `vocab` word | `transformExample`: phrasal or fyi only |
| `"commonMistakes": [{"sentence": "a.", "correction": "A", "why": "x"}]` | `commonMistakes[0]`: the correction equals the sentence |

**Conflicting** (refused as a new write; reported, not converted, when already stored):

| Input or stored row | Report line |
| --- | --- |
| `"situation": "B", "situations": ["A", "C"]` | `situations`: the single value "B" differs from `[0]` "A". Choose A (B first, A last) or B (needs the counts moved or reset). |
| `"gap": "X ______.", "gaps": ["Y ______."]` and 12 players have counts on `seed` | the same, with "12 players have counts on the shown gap" |
| `"relations": {"antonyms": ["Calm"]}` (stored), `"antonyms": ["Quiet"]` | `relations.antonyms` "Calm" is not in `antonyms`, and "Calm" is a live word: moving it adds an opposite pair. Choose move or archive. |
| `"relations": {"confusableWords": ["Barge"]}` and no word "Barge" | kept as `confusableWords`; class "no word" |

### 10. Steps, in order

Readers first: every reader of the stored shape accepts the new shape before any writer produces it. Each step is
one PR and follows the [workflow](../development-workflow.md).

| Step | What | Type | When something changes for users |
| --- | --- | --- | --- |
| 1 | `wordContract.js`, the shared case file and its tests; `word_contract_errors` in SQL, created but not attached; the read-only dry-run report. Nothing calls them. | Feature (tooling) + Data (a function only) | Nothing |
| 2 | App readers accept both shapes: the load view (single fields from lists; `confusableWords` from either place), CSV, admin screens. A differential test shows the same view and the same questions (seeded) for a word in old and in new shape. | Feature | Nothing, proven by the differential test, not assumed |
| 3 | Database readers accept both shapes: `dictionary_sync` (links from the top-level lists as well as the old keys), `analytics.words` and `word_quality` (`situations[0]` / `gaps[0]` when present). Rollback included. | Data or permissions (owner approval) | Nothing for old-shape rows. Library-link differences for converted rows are listed in the dry run, to be approved in step 6. |
| 4 | Snapshot, archive and restore tables and functions, with the tests of section 8. | Data or permissions (owner approval) | Nothing |
| 5 | Writers switch to the contract: import (whole-file refusal), Ask AI (add, fill, stubs), Content Health, Regenerate, report fix, editor, save. The Admin files (`WordEditor.jsx`, `Words.jsx`, `Reports.jsx`, `ContentHealthPanel.jsx`) are **scheduled with the UI batch first**. | Feature | **From here:** imports and edits that break the rules are refused; empty input clears; report fixes are checked; Regenerate stays in step; edited words are saved in the new shape (retired keys kept until step 6); a word with a conflict cannot be saved. |
| 6 | The migration (section 7): dry run → the owner's decisions → snapshot → apply → checks. | Data or permissions (owner approval) | Only the approved items: e.g. any of the 4 antonym entries moved, and the archived keys removed from words. |
| 7 | Attach the trigger. Only after step 6, when every live word passes or the owner accepts the listed ones as locked until fixed. | Data or permissions (owner approval) | Direct writes that break the rules are refused |

Not in this plan:
- word ids instead of text keys (ADR 0004 stays);
- grammar rules and challenges;
- any screen layout;
- a feature for `acceptedWrittenAnswers`;
- moving readers from single fields to lists (later, one reader per change).

### 11. PR #83 and this contract

| Part of #83 | Mergeable on its own? | Change later |
| --- | --- | --- |
| `word-fields.md`, the AI inventory, `LC-04`, index lines | Yes: they describe the current code | Step 2 links the contract; each step updates its rows |
| Ask AI: term check, what is sent, prompt, `readAskAiAnswer`, `showsWord`, the drawer fix | Yes: independent of how a word is stored. The drawer fix closes a crash. | Step 5: `PARTS_OF_SPEECH` and the type names move to `wordContract.js`. |
| `aiWordEntry` and `aiWordProblem` | Yes, as long as writers use today's shape | Step 5: they produce `situations` and `gaps` and call `checkWord` |
| Tests and the real-model eval | Yes | Step 5 adds tests of the add path through the contract |

## Why

- **One path and a server check** remove the cause of the conflicts, not only the 8 + 1 found. A rule that only the
  browser checks can be bypassed today.
- **Lists as the only stored place** match what v3 files, the editor and Content Health already write. The view keeps
  question building unchanged until a reader is moved on purpose.
- **No guessing about conflicts, opposites or references.** Each one is a visible decision with its effect on
  statistics and play.
- **Archive before removing.** Unused keys leave the active data, and nothing is lost.

## Alternatives

- **The single field wins automatically.** Simple, but it decides for the owner, and it would hide 9 conflicts that
  carry statistics.
- **Keep unknown keys under `extra`.** Nothing is lost, but the contract stays open. Rejected by the owner.
- **Check only in the browser.** Smaller, but a direct write still bypasses every rule.
- **Do everything in SQL.** One place on the server, but the editor and the import need the same rules and messages
  before sending, so the browser would repeat them anyway.
- **Use the current export as the backup.** Rejected: it is the game's copy, not the stored rows, and importing it
  back would refuse or convert it.

## Consequences

- Imports and edits that pass today can be refused after step 5. The report and the messages say exactly why.
- The rules exist twice (JavaScript and SQL), held together by the shared cases.
- Until step 7 a direct write can still bypass the rules, as today.
- Steps 3, 4, 6 and 7 change the database and need the owner's approval each.
- Step 5 touches Admin files and is scheduled with the UI batch.

## Open decisions for the owner

1. Is the key table (section 3) final, including `collocations` kept as admin-used?
2. Conflicts: Choice A as the recommended answer per word, with B only together with a separate counts change?
3. The 4 `relations.antonyms` entries: decided per word in the dry run (move or archive)?
4. Should step 7 accept words that still fail as "locked until fixed", or should all of them be fixed first?
