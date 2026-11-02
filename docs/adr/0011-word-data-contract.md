# ADR 0011: One data contract for a word

- Status: **Accepted** (2026-11-02), after the owner's reviews on 2026-11-01 and 2026-11-02. **Planned**: nothing is
  built yet; each step in section 10 is a separate PR that needs its own approval.
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

**Converted and unconverted rows.** A row written under the contract carries the system key `contract: 1`. A row
without it is *unconverted*; today every row is. Readers, writers and the server tell the two apart by this marker
alone, never by guessing from the other keys.
- An unconverted row is read exactly as today, field by field: the stored `situation`, `gap`, `commonMistake`,
  `opposite` and `relations.*` are used where they are used today, even where they disagree with the lists.
- A converted row is read from the lists and the top-level relation lists. It holds no derived or alias key.

An unconverted row is never counted as converted or valid just because it loads (section 6.3).

### 2. Values: absent, empty, false and zero

- **Empty** means `""` (or only spaces), `null`, `[]` or `{}`. `false` and `0` are **not** empty. A key that does not
  accept them refuses them with a type error; they are never dropped silently. The only number is the system marker
  `contract`, which accepts only `1`; the system flags accept only `true`.
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
| `contract` | System | `1` | — | Set by every write under the contract; never typed, never accepted as input | Unconverted row: read the old way | Which reading and saving rules apply (sections 1, 6) |
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
  - **Decided (owner, 2026-11-01).** A is the recommendation. It is applied to a word only after the report has
    shown, for that word, the text behind every pool id before and after, and the two match. B needs its own
    approval for moving or resetting the counts.
  - The same applies to `situations`. Practice does not ask the situation pool today, but its stored counts are
    reported the same way.
- **Normalising is stable.** `normalize(normalize(x))` equals `normalize(x)` for every input. The migration's
  check runs the normaliser a second time on its own output and expects no change (section 7).

### 5. Relations between words

- **Top-level lists are the only stored place.** `relations` is accepted on input for compatibility and merged in.
  `relations.synonyms` adds nothing in production. `relations.confusableWords` moves as it is.
- **No new opposites are turned on as a side effect.**
  - The game does not read `relations.antonyms` today. Loading never folds it in.
  - The 4 production entries in `relations.antonyms` that are missing from `antonyms` are shown in the report, each
    with:
    - the meanings of both words;
    - the effect in play: which opposite pair appears, and in which question kinds (Opposite Battle, its pair
      questions, Live);
    - a recommendation for that entry.

    The owner chooses per entry: move it into `antonyms` (a listed change in play), or archive it. **Nothing is
    moved or archived without that choice** (decided 2026-11-01). Until then the entry stays where it is and is
    not read by the game (sections 6.1 and 6.2).
  - A new write that gives `relations.antonyms` is merged, because it is new authored input.
- **References to no word stay as they are.**
  - The 183 `confusableWords` references (181 to no word, 2 to deleted words) are kept and listed by class in the
    report.
  - They are neither deleted nor turned into stubs.
  - A new write that names no live word gives a warning.
- **Renames update every relation list** (`antonyms`, `synonyms`, `confusableWords`, `excludeFromSameOptionsWith`,
  `pictureAvoid`), for entries equal to the old name ignoring case. This is a fix that comes with step 5
  (writers).

### 6. One path for every writer, checked on the server too

| Writer | With the contract |
| --- | --- |
| Import (v2, v3 files, a backup's content) | `prepareImport` (the v3 conversion is kept) → `readWord` on each incoming word → `checkWord`, strict. **Any error refuses the whole file before anything is written.** The report lists word, field and reason. Old-shape files are accepted when they only use input aliases without conflicts; retired or unknown keys refuse them. A file entry for an existing unconverted word changes it through the carry-over save (6.2). |
| Word editor | The form gives the lists → `updateWord(previous, changes)` with partial-update rules → `checkWord`. An unconverted word gets the carry-over save (6.2): a change to a conflicting list needs Choice A, and other fields can be saved. |
| Ask AI | The AI is asked only for keys of the table that a card can hold. Required: `word`, `type`, `category`, `meaning`, one example, one gap. Optional: `partsOfSpeech`, `hints`, at most one common mistake. Display-only: `pronunciation`, `nearWords`, shown in the drawer and never stored. **Optional keys may be generated when they are correct and useful.** The prompt never requires them, so one that does not fit stays missing instead of being invented. Every key is checked (`readAskAiAnswer`), and the card becomes a word through `readWord(…, {source: "ai"})` → `checkWord`, like any other write. The same applies to editor fill and stub fill. |
| Content Health, Regenerate, Report fix | `updateWord(previous, patch)` → `checkWord`. Regenerate replaces `situations[0]`. A report fix that fails is shown with its errors and cannot be applied. |
| Save of the game's copy | A new word or a converted row: `storedWord` removes derived keys and sets `contract: 1`. An unconverted row: the carry-over save of 6.2. Only changed words are sent, as today. |
| **Server** | A trigger on `content_items` for every insert and update (6.4). It runs `public.word_contract_errors(data)` and raises on any error. It covers `content_save_v2`, staged drafts when they are published, and direct table writes by the admin. |

**The browser and the server must agree.**
- The rules are written twice: JavaScript (the reference) and SQL.
- One shared file of cases (`tests/fixtures/word-contract-cases.json`) is run against both: `checkWord` in the `app`
  job and `word_contract_errors` in the `database` job. A difference fails CI.

**What the server does not check.**
- Warnings, and rules that need other words (whether a reference resolves), stay in the browser.
- No check, in either place, proves that a meaning is right, an example natural, or a gap clear: a valid shape is not
  a correct word.

#### 6.1 Reading while both shapes exist (steps 2 and 3)

Each reader picks its rules by the `contract` marker only:

| Reader | Unconverted row (no marker) | Converted row |
| --- | --- | --- |
| Game view (`wordView`), CSV, admin screens | As today. `situation`, `gap` and `commonMistake` are used as stored, **even when they differ from the lists' `[0]`**. `opposite` comes from `linkAntonyms` over `antonyms` and the stored `opposite`. `relations.confusableWords` and `relations.synonyms` are read as today. `relations.antonyms` is not read. | The single fields from item `[0]`. `opposite` from `antonyms`. `confusableWords` from the top-level list. |
| `analytics.words`, `word_quality` | `data->>'situation'`, `data->>'gap'` and `data->>'opposite'`, as today | `situations->>0`, `gaps->>0`, and whether an antonym names a live word (what `opposite` held) |
| `dictionary_sync` | Links from `opposite`, `relations.*` and `synonyms`, and `senses.content`, as today | Links from `antonyms` (entries that name a live word), `synonyms` and `confusableWords`. `senses.content` also gets `situation` and `gap` from `[0]`, so the library copy keeps its keys. |

Differential tests prove that this step changes nothing; it is not assumed. The fixtures cover every class found in
production:
- a single field that differs from `[0]` and is not in the list;
- a stored `opposite`;
- `relations.antonyms` entries missing from `antonyms`;
- empty lists;
- retired keys;
- references to no word.

The tests:
1. For each unconverted fixture, the old code and the new code give the same view, the same questions (seeded),
   the same analytics row, and the same library links and `senses.content`.
2. For each fixture without a conflict, its converted form gives the same outputs as the unconverted one.
3. For each conflict fixture, its converted form under Choice A shows the same sentence first, and every pool id
   names the same text.

#### 6.2 Saving before the migration (steps 5 and 6)

Two ways of saving exist until the migration, chosen by the stored row's marker:

- **A new word, or a converted row: contract save.** Strict checks, lists only, `contract: 1`.
- **An unconverted row: carry-over save.**
  - The fields the admin changed are checked strictly, with the same rules as a contract save. A change that
    breaks them is refused.
  - Every other stored key is kept exactly as stored, including retired keys, the single fields, `relations` and
    the stored `opposite`. **Nothing is dropped and nothing is archived before the approved migration.**
  - The row stays unconverted, without the marker, so it is still read the old way.
  - The row stays consistent for the old readers:
    - a changed `situations` also rewrites `situation` from its new `[0]`; the same holds for `gaps` with `gap` and
      `commonMistakes` with `commonMistake`;
    - a changed `antonyms` recomputes the stored `opposite`, as today's save does.
  - A change cannot add a retired or unknown key: such a request is refused.
  - `relations.antonyms` is never read or merged by a carry-over save. The 4 words keep their current play, and
    changing `antonyms` on one of them changes only `antonyms`.
  - **A word with a conflict:**
    - A change to the conflicting list or its single field needs Choice A in the same request (the editor asks);
      without it, the save is refused.
    - **Choice A only resolves the conflict.**
      - It never removes a sentence: `situation: "B"` with `situations: ["A", "C"]` becomes `["B", "C", "A"]`.
      - Any change the author makes to the sentences (removing "A", adding "D", reordering) is a separate edit,
        applied after Choice A and shown as the author's own change in the save's diff and the audit log. It is never
        part of Choice A.
    - Choice B is not offered until it has its own approval.
    - Other fields of that word can still be saved; the conflict stays listed.
- **After the migration has converted a word,** every save of it is a contract save.

The editor's choice prompt is part of step 5 and is planned with the UI batch.

#### 6.3 Words that do not conform (decided 2026-11-01)

- **The list.** After the migration, the view `content_unconverted_words` lists every active row without the marker,
  with the reasons and the open decision. It is computed, never kept by hand.
- **They keep working.** These words keep loading and playing, read the old way. Nothing counts them as converted or
  valid: not the reports, not Content Health.
- **Saving them.**
  - From step 7 on, any change to their data must make them conform: a contract save that converts them, with the
    choices they need.
  - The editor can open them and fix them. It cannot save them as they are.
  - Reordering or other position-only changes still work (6.4).

#### 6.4 The server check

A `BEFORE INSERT OR UPDATE` trigger on `content_items` runs for each row and for any column. The check depends on
the row as it will be after the write: it runs whenever that row is an active word (`kind = 'words'` and not
deleted), whatever the row was before. So it covers:
- an insert;
- a change of `data`;
- **undeleting a row, even with `data` unchanged.** A deleted row holds `{}`, so it cannot be undeleted without
  valid data;
- a change of `key`.

**`kind` cannot change on update**, in either direction. A row never becomes, or stops being, a word through an
update.

A write passes only when one of these holds:
1. its `data` passes `word_contract_errors` and carries `contract: 1`;
2. it is an update of an active word that changes none of `key`, `data`, `kind` or `deleted` (for example position
   or `updated_at`), so an unconverted word can still be reordered;
3. it is a restore of an original row (below).

Deleting a word is not checked.

**The restore exception holds only the snapshot's original values.**
- A row passes without the check only when a `content_restores` record exists for the current transaction
  (`txid_current()`), and the snapshot it names holds an item with the same `kind` and `key` whose `data`,
  `deleted` and position equal the row being written.
- Any other value for that key in the same transaction is checked normally, and fails if it does not conform.
- Only the definer function `content_restore` can write `content_restores`, and it deletes its record before
  returning.

**Tests** (CI database, synthetic rows):
- a word without the marker, or with the marker and bad data, fails on insert and on update; a conforming word passes;
- undeleting a row fails unless its `data` conforms;
- a change of `kind` fails, both ways;
- a position-only update of an unconverted word passes; once the trigger is on, any `data` change to it fails;
- an update that changes only `key` (same `data`, same position) is checked like any other write, and fails when the
  row does not conform;
- a restore of a snapshot's original row passes, even if it does not conform;
- within the same restore transaction, any other value for that key fails;
- a snapshot row written under another key fails;
- a `content_restores` record from another transaction does not help;
- a staged draft with one bad word fails when published, and writes nothing.

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
   - writes the converted rows through the normal save path, each with `contract: 1`;
   - records the hash of each row it wrote, for the restore's conflict check.
   - All of it happens in one transaction.

   Words with an unresolved conflict, an undecided `relations.antonyms` entry or a strict failure are not
   written. They stay unconverted and are listed (6.3).
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
  - It writes the snapshot rows byte for byte and raises the content version, so devices reload. The trigger lets
    through only those original values (6.4).
  - The audit log records before and after. Archive rows stay, marked as restored.
  - Restoring a downloaded file loads it into a new snapshot first; its SHA-256 must match.
  - The import is **not** the restore path: it would refuse or convert old shapes.
- **Tests** (CI database, synthetic rows):
  - snapshot → migrate → restore gives `data` equal (`jsonb`) to the original for every row;
  - a key edited after the migration is refused, and is written only when passed explicitly;
  - progress tables are untouched;
  - the trigger tests of 6.4, including that the restore cannot write anything other than the snapshot's original
    value for a key.

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
| `"contract": 1` typed by a person or sent by the AI | `contract`: set only by code |
| undeleting a word row (`deleted: false`) while its `data` is still `{}` | server: required keys missing |
| changing a row's `kind` from `words` | server: `kind` cannot change |
| inside a restore, writing a value for a key that differs from the snapshot's | server: checked normally, and refused if it does not conform |
| a carry-over save that adds `"register": "formal"` to an old word | `register`: retired key, cannot be added |

**Saving an old (unconverted) word before the migration** (6.2):

| Stored row | Change | Result |
| --- | --- | --- |
| has `register`, `learningData.difficulty`, `relations` and `opposite`; no conflict | `level` → `"B1"` | Saved. Only `level` changes; everything else is kept; still unconverted. |
| `situation: "B"`, `situations: ["A", "C"]` (a conflict) | `hints` changed | Saved. The conflict is still listed. |
| the same | `situations` changed, no choice given | Refused: "this word has a conflict in situations; choose A". |
| the same | Choice A, and no other change to the sentences | Saved. `situations` becomes `["B", "C", "A"]` and `situation` stays "B". Nothing is removed; the conflict is gone. |
| the same | Choice A, and the author also removes "A" and adds "D" | Saved in two recorded parts. Choice A gives `["B", "C", "A"]`. The author's edit then gives `["B", "C", "D"]`, and the diff and audit log show the removal of "A" as the author's change. |
| `relations.antonyms: ["Calm"]` missing from `antonyms` | `antonyms` → `["Quiet", "Still"]` | Saved. `antonyms` changes and `opposite` is recomputed from it. "Calm" is neither read nor moved. |

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
| 2 | App readers pick their rules by the marker (6.1): the load view, the CSV and the admin screens. The differential tests of 6.1 include the conflicting rows. | Feature | Nothing, proven by the differential tests and not assumed. No row has the marker yet. |
| 3 | Database readers pick their rules by the marker (6.1): `dictionary_sync`, `analytics.words` and `word_quality`. Rollback included. | Data or permissions (owner approval) | Nothing for unconverted rows, which are all rows at this point. For converted rows, the library-link differences are listed in the dry run and approved in step 6. |
| 4 | Snapshot, archive and restore tables and functions, with the tests of section 8. | Data or permissions (owner approval) | Nothing |
| 5 | Writers switch to the contract: import (whole-file refusal), Ask AI (add, fill, stubs), Content Health, Regenerate, report fix, the editor, and the save. There are two save modes (6.2). The Admin files (`WordEditor.jsx`, `Words.jsx`, `Reports.jsx`, `ContentHealthPanel.jsx`) are **scheduled with the UI batch first**. | Feature | **From here:** imports and edits that break the rules are refused; an empty value clears; report fixes are checked; new words are stored converted; old words get carry-over saves (nothing dropped); changing a conflicting list needs Choice A. |
| 6 | The migration (section 7): dry run → the owner's decisions → snapshot → apply → checks. Converted rows get the marker. | Data or permissions (owner approval) | Only the approved items. For example: the antonym entries the owner chose to move; the retired keys archived and removed; and, through the marker, converted rows read from their lists, which the checks show to be the same as before. |
| 7 | Attach the trigger (6.4). The view `content_unconverted_words` lists the words that still do not conform (6.3). | Data or permissions (owner approval) | Writes that break the rules are refused, direct ones included. Listed words still load and play, and can only be saved once fixed. |

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
- Between steps 5 and 6 there are two ways of saving (contract and carry-over). The marker decides which one applies,
  and the migration ends the carry-over save for every word it converts.
- Steps 3, 4, 6 and 7 change the database and need the owner's approval each.
- Step 5 touches Admin files and is scheduled with the UI batch.

## Decisions taken (owner, 2026-11-01)

1. **The key table (section 3) is agreed in principle,** with `collocations` kept because the admin and the export
   use it.
   - Ask AI may produce optional keys when they are correct and useful; it is never made to invent them.
2. **Conflicts.** Choice A is the recommendation, given after the report shows that every sentence keeps its counts.
   Choice B needs its own approval to move or reset the counts.
3. **The 4 `relations.antonyms` entries.** Each is shown in the report with the meanings, the effect and a
   recommendation. None is turned on or archived without the owner's choice.
4. **Words that still fail.** The check is switched on with an explicit, computed list of old words that do not
   conform (6.3). They are still read and played; saving them is refused until they are fixed. They are not counted
   as converted or valid.

The design was approved on 2026-11-02, with two corrections (6.4: `key` must not change in a position-only update;
6.2: Choice A never removes a sentence). Step 1 is the next PR.
