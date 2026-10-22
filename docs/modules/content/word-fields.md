# Word fields (Content)

A reference for every field of a word in the course: what it is for, its type, an example, whether it is required,
what happens when it is missing or empty, where it is written, and where it is read. Part of the
[content](README.md) module. The rules for names, senses, antonyms and stubs are in
[dictionary-rules.md](dictionary-rules.md); how files come in and go out is in
[admin/import-export.md](../admin/import-export.md).

Status: **Implemented**. This page describes the code as it is, checked by reading it on 2026-10-22 (master
`bb929c1`). Where a behaviour has a test, the test is named. Examples are made up. Being mentioned in a comment does not
count as a use. "Never read" means the field name was searched across `src/` and `api/` (tests excluded) and no code
reads it.

## Where a word lives

A word is one object in `content.words`. Its key is its whole text (`word`); see
[ADR 0004](../../adr/0004-text-keys-for-words-and-progress.md).

| Stage | What happens | Code |
| --- | --- | --- |
| Import file (v2) | Fields are taken as written. Removed fields are dropped first. | `withoutRemovedFields` in [dictionary.js](../../../src/engine/dictionary.js) |
| Import file (v3) | Converted to the v2 shape. Category ids become titles; lists fill the single fields (`situations[0]` becomes `situation`); `links` become `antonyms`, `excludeFromSameOptionsWith` and `relations.confusableWords`. An `id` that is already known under another spelling is a rename. | `normalizeV3`, `prepareImport` in [v2.js](../../../src/engine/v2.js) |
| Check | Required fields and the shape of some fields. Fields not listed below as checked are not checked at all. | `validateContent` in [v2.js](../../../src/engine/v2.js) |
| Merge | Matched by the lower-cased word. The merge is shallow: an import adds or replaces fields but never removes one, and the existing spelling of the key stays. Then `opposite` is derived from `antonyms` and stubs are added for missing words. | `mergeContent`, `linkAntonyms`, `healOpposites`, `healMissingWordRefs` in [dictionary.js](../../../src/engine/dictionary.js) |
| Game's copy | Duplicates by lower-cased text are dropped (the first one stays) and `opposite` is derived again on every build. | `buildCatalog` in [catalog.js](../../../src/engine/catalog.js) |
| Stored | The whole word is one `jsonb` value. Table `content_items`: `kind = 'words'`, `key` = the word text, `data` = the word. A delete keeps a tombstone. | [contentStore.js](../../../src/lib/repo/contentStore.js), `content_save_v2` (migrations 0017, 0039) |
| Device | IndexedDB `content-cache` (online) or `local:content` (local mode). | [contentStore.js](../../../src/lib/repo/contentStore.js) |
| Library copy | After each admin save, `dictionary_sync` copies each word into `headwords` and `senses`. Some fields go to columns (below). All other fields go into `senses.content` (`data` minus `word`, `type`, `category`, `meaning`). Links go into `sense_links`. | migration [0027](../../../supabase/migrations/0027_dictionary_sync.sql) |
| Export | Content file: `contentOnly(liveContent())`, schema 2. There is no v3 export. CSV: 12 columns only. | `exportFileOf` in [importPlan.js](../../../src/features/data/importPlan.js), `wordsCsv` in [transfer.js](../../../src/features/data/transfer.js) |

**The admin edits and exports the game's copy.**
- The admin screens and the export work on `liveContent()`, which is the copy after `buildCatalog`.
- So a saved or exported word carries the **derived** `opposite` and the merged `antonyms`, not only what was typed.
- Two paths work on the raw custom list instead: Ask AI's "Add to Collection" and "Regenerate meaning & example".

## Kinds of fields

| Kind | Fields |
| --- | --- |
| Imported and stored | Every field in the tables below, unless marked otherwise. |
| Accepted only in a v3 file (converted, not stored as written) | `links` (`opposite`, `excludeWith`, `confusableWith`), the top-level `categories` list. A v3 `category` is an id. |
| Made when a file comes in, then stored | `categoryId`, `subCategoryTitle` (from v3); `situations`, `gaps`, `commonMistakes` (always set by v3); `_autoStub` stub words; the level made standard (`normalizeLevel`). |
| Worked out while the game runs (never typed, recomputed each build) | `opposite` from `antonyms` (`linkAntonyms`), the headword (the text before a trailing bracket, `bareWord`). AI variants in the player's `pools` can replace `meaning` or `gap` text inside one question (`makeQuestion`); they are player progress, not word fields. |
| Old or removed (dropped when content comes in) | `example` (kept as `situation` only when there is no situation), `sentenceBuild`, puns. |
| Written but never read by the game | `register`; `collocations` (read only by the admin's quality score and the CSV); `chainGroup` (read only by `chainSession`, which nothing calls); `categoryId` (read only to spot a category rename on the next v3 import); `_aiAdded` (admin badge, library source). |
| Read but never written by the app | `learningData.cluster` (only from an imported file). |

## Fields

"Checked" quotes the error that `validateContent` gives (`words[i].<field>: …`). "Never checked" means any value is
accepted.

### Identity

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `word` | The word's key and the text shown. String: `"Ferry"`, `"Cast (to throw)"`. A trailing bracket marks one meaning of a headword. | Required: "expected non-empty string", "duplicate key". | Import; editor "Word" (a rename moves progress); Ask AI add; stubs. | Everywhere. Answer and option text; progress, pools, reports and library keys; `findWord`; `grade` accepts the headword alone. Two meanings of one headword are never in the same question (`compatible`). |
| `id` | A stable id in v3 files. String: `"w-ferry"`. | v3: required ("v3 words need a stable id", "duplicate id"). v2: optional, non-empty if present. | Import only; kept by the editor; JSON view. | `normalizeV3` only, to spot a rename. Never read by the game. |
| `type` | The kind of item. One of `vocab`, `idiom`, `binomial`, `phrasal`, `fyi` (the course's own label for an "FYI" item, e.g. `"Mixed up"`). | Required: "unsupported type". | Import; editor select; Ask AI; stubs (`vocab`, or the type of the word that names it). | Which question modes exist: Who am I (vocab only), the idiom modes (`idiom`, `binomial`, `fyi`), Transform (`phrasal` or `fyi`, with `transformExample`). Option ranking. Story targets. Sent to several AI prompts. Library `senses.type`. |
| `category` | The lesson (level) title. String: `"Travel"`. In v3 it is a category id, turned into the title. | Required. | Import; editor (a new name makes a new lesson); Ask AI (the lesson the player is on, else the AI's, else "AI Discoveries"); category merge, rename and delete. | Lessons (`buildLevel`, exact title). Rounds: `practice` ignores a trailing Roman numeral, so "Media II" words join "Media". Option ranking. AI "siblings" lists. Library `senses.category`. |
| `categoryId` | The v3 category id. | Made by v3 import; never checked. | v3 import only. Not changed when the category is edited, so it can go stale. | `normalizeV3` only (category renames). |

### Grouping and level

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `subCategory` | A group inside a lesson. String: `"Symptoms"`. | Optional, never checked. Missing: no group bonus, and the word is shown under "Other words". | Import; editor "Unit / group"; CSV. | Options: words of the same group rank higher, and at most 2 come from the group below difficulty 3 (`optionWords`). Picture options leave out the group. Lesson groups when no word has `units` (`levelGroups` in [data.js](../../../src/engine/data.js)). Live unit filter. |
| `subCategoryTitle` | The group's title from a v3 file. | Made by v3 import. | v3 import only; not changed when `subCategory` changes. | `levelGroups` (shown title; falls back to `subCategory`). |
| `distractorGroup` | A group for options only. String. | Optional; must be non-empty if present. | Import; JSON view. | `optionWords` only, and only when `subCategory` is empty. Not used for pictures. |
| `units` | The course units (sessions) the word belongs to. Array of strings: `["Unit 3"]`. | Optional: "expected an array of strings". | Import; editor "Units". | Lesson and course-level sessions (`levelGroups`, `courseLevelGroups`), rounds for a unit, option ranking (shared unit), Live filter. Library `session` collections. |
| `level` | A course level (`"A2.1"`) or a plain difficulty (`"B1"`). | Optional, type never checked. Import makes it standard (`normalizeLevel`, "Level-7" becomes A2.2) and warns about other values. Missing: middle rank; listed under "No course level". | Import; editor "Level". | "By course level" (`courseLevelOf`), the order new words are introduced in (`difficultyRank`). Library `senses.course_level` (course levels only). Not kept when Ask AI keeps a word in the admin's library (`senseFromCard`). |
| `register` | Formality, e.g. `"informal"`. | Optional, never checked. | Import; editor "Register". | **Never read.** |
| `chainGroup` | A group for Opposite Chain. | Optional; non-empty if present. | Import; JSON view. | Only `chainSession`, which has no caller. |

### Meaning and sentences

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `meaning` | The definition. String: `"A boat that carries people across water."` | Required (stubs too). Import warns about "1) … 2)" inside one meaning. | Import; editor; Ask AI; Content Health ("meaning", "duplicate"); "Regenerate meaning & example". Stub text: "Imported reference — needs a real definition." or `Opposite of "X".` | The new-word card. Meaning, Name the Word and typing questions (a typing question that shows the word is skipped). Options: identical meanings never sit together; in Meaning questions similar-looking definitions rank higher. Seed of the `meaning` and `typing` pools. Most AI prompts. Library `senses.meaning`. |
| `partsOfSpeech` | Parts of speech for this meaning. Array of strings from the game's list ([askAiCard.js](../../../src/lib/askAiCard.js) `PARTS_OF_SPEECH`): `["noun"]`. | Optional, never checked. Missing: options are grouped by type instead; no Word Family question with the word itself. | Import; editor (comma-separated); Ask AI (the game's value wins); Content Health. | Only the **first** value counts for option ranking and Word Family (`posKey`, `familyQuestion`). Shown on the new-word card and in the Ask AI drawer. Library `senses.pos`. |
| `situation` | The example sentence; it normally uses the word. String: `"We took the ferry to the island."` | Required (not for stubs). | Import (v3: `situations[0]`); editor (first line of "Example sentences"); Ask AI; Content Health; Regenerate (this field only). | The new-word card. Questions that ask "which word?" use it only when it does not show the word (`contextSentence`). Story fallback. AI checks of written answers, story and rewrite prompts. |
| `situations` | Every example sentence (v3). Array of strings. | Optional; v2 never checks it. | v3 import; editor (kept as a list only if there was one, or with more than one line). | Only the legacy "situation" pool (`authoredTexts`). See [which one wins](#which-field-wins). |
| `gap` | A sentence with the word replaced by a blank of two or more underscores. String: `"We took the ______ to the island."` | Required (not for stubs). Only checked to be non-empty; the editor also asks for a blank. **Without a blank, the gap questions are skipped.** | Import (v3: `gaps[0]`); editor (first line of "Gap sentences"); Ask AI; Content Health "gaps". | Gap and typed-gap questions (`makeQuestion`, `practice`), only when the blank is there; a typed gap that shows the word is skipped. Live. Seed of the `gap` pool. |
| `gaps` | Every gap sentence (v3). Array of strings. | Optional. | v3 import; editor; Content Health "gaps". | Seeds of the `gap` pool (`seed`, `seed-2`, …): the second and later ones are asked through the pool. `gaps[0]` itself is never read; `gap` is. |
| `hints` | Clues shown on request. Array of strings: `["It floats.", "It carries cars too."]`. | Optional: "expected array", "expected non-empty string". Missing: no hints. | Import; editor; Ask AI (at most 3); CSV. | Questions made by `makeQuestion` and picture questions; the practice antonym clue. Using a hint makes the answer "assisted" (not independent evidence). Other question kinds and Live never carry hints. |
| `plainForm` | A plain way to say the item (for idioms and phrases). String. | Optional; non-empty if present. | Import; JSON view. | The new-word card ("Plain form: …"). Display only. |
| `transformExample` | A sentence to rewrite with a phrasal verb or FYI item. Object `{before, after}`: `{"before": "Please stop doing that.", "after": "Please cut it out."}`. | Optional: "expected object", both parts non-empty, "only phrasal/fyi". | Import; JSON view. | Transform questions for Learned and Mastered `phrasal` and `fyi` words; checked by the AI ("Check a written answer"); not counted as recall evidence. |
| `commonMistake` | A typical learner mistake. Object `{sentence, correction, why}`: `{"sentence": "I am agree.", "correction": "I agree.", "why": "Agree is a verb."}`. | Optional: "expected object", each part non-empty. Missing: no Grammar Court question. | Import (v3: `commonMistakes[0]`); editor ("Common mistake"); Ask AI (only when the AI gives a real one); Content Health. | Grammar Court questions for known words (options: the sentence and the correction). The Ask AI drawer. |
| `commonMistakes` | Several mistakes (v3). Array of the same objects. | Optional; v2 never checks it; v3 keeps only complete ones. | v3 import; Content Health adds to the front. **Saving the editor's mistake fields replaces the whole list with one item.** | Grammar Court picks one at random. |

### Links between words

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `antonyms` | Opposites, as text. Array of strings: `["Calm"]`. In v3 an antonym can be a word id. | Optional: "expected an array of strings". | Import (v3 adds `links.opposite`); editor; Content Health can add one. | The source of `opposite` (below). Antonyms that are not game words and do not contain the word make the Opposite Clue question (`outsideAntonyms`). Not copied to the library's links (only `opposite` and `relations.antonyms` are). |
| `opposite` | The opposite **that is a word in the game**. String: `"Calm"`. | Optional. If typed, it must name a known word ("unknown word"); `"None"` is dropped. | Derived on every build (`linkAntonyms`): from `antonyms` plus any stored `opposite`, both ways, only when that word exists. The editor's "Opposite in the game" is folded in the same way. | Opposite Battle and its pair questions (practice and Live need it). Library `antonym` links. |
| `synonyms` | Words with the same meaning. Array of strings: `["Boat"]`. | Optional, never checked. | Import; editor; CSV. | `compatible`: a synonym that is itself a game word is never an option next to the word (both ways). Never shown in the game. Library `synonym` links. |
| `relations.synonyms` | The same, in an older place. | Optional. | Import; JSON view. | Read only when `synonyms` is not a list. |
| `relations.confusableWords` | Words learners mix up with this one. Array of words. In v3: `links.confusableWith` ids. | Optional, never checked. | Import; JSON view. | Options: these words rank highest. Library `confusable` links. |
| `relations.antonyms` | Opposites, in an older place. | Optional. | Import only. | **Never read by the app**; only the library copy (`dictionary_sync`) links them. |
| `excludeFromSameOptionsWith` | Words that must never be options together with this one. Array of words: `["Boat"]`. In v3: `links.excludeWith` ids. | Optional: must be a list ("expected at least 0 word references", "duplicate targets"). A missing word gets a stub. | Import; JSON view. | `compatible` (both ways), so every option list. Library `never_together` links. |
| `pictureAvoid` | Words a picture could also show. Array of strings: `["Boat"]`. | Optional: "expected an array of strings". | Import; JSON view. | Picture questions leave them out of the options (this word's list only). |

A word rename updates `opposite`, `excludeFromSameOptionsWith`, `relations.confusableWords` and references in
combos, stories and challenges (`applyRenames`). It does not update `antonyms`, `synonyms`, `pictureAvoid` or
`wordFamily`.

### Word Partners and Word Family

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `collocations` | Common partner words, as text. Array: `["take a ferry"]`. | Optional, never checked. | Import; editor "Word partners"; CSV. | **Not used by the game**: Word Partners questions come from `collocationChecks`. Only the admin quality score and the CSV read it. |
| `collocationChecks` | Authored Word Partners questions. Array of `{sentence, answer, wrong[], explanation?}`: `{"sentence": "We need to ______ the ferry at six.", "answer": "catch", "wrong": ["hold", "keep"]}`. | Optional: "needs exactly one ______", answer non-empty, "expected at least two wrong options", "a wrong option equals the answer". Missing: no Word Partners question. | Import; JSON view. | Word Partners (`collocationQuestion`): the answer plus the first 3 wrong options. Typed once the word is Learned (practice only). These options do not go through the option rules. |
| `wordFamily` | Related forms. Array of `{word, pos}`: `[{"word": "happiness", "pos": "noun"}]`. | Optional, never checked. Members without a part of speech are dropped. | Import; editor "Word family" (`noun: happiness` per line). | Word Family questions (`familyQuestion`): needs 3 or more members (2 for typing), counting the word itself only when its first part of speech is known. Members that contain the word, or are contained in it, are left out. |

### Pictures

| Field | What it is, type, example | Required; when missing or empty | Written | Read |
| --- | --- | --- | --- | --- |
| `image` | A picture: a link to the `word-images` bucket, an outside link, or an older `data:image/…` value. | Optional, never checked. | Editor "Picture" (upload, or a link copied to the bucket). When the admin's game runs online, `data:` values found in the content are moved to the bucket. CSV. | Picture Hunter: an uploaded picture always counts; an outside link only once it was seen to load. Shown first by `WordPicture`, then the drawing if it fails. The new-word card; the picture after a right answer. |
| `illustration` | An inline drawing. String starting with `<svg`, no scripts, at most 12,000 characters. | Optional: "expected an inline <svg> drawing (no scripts, at most 12000 characters)". | Import; kept by the editor, but there is no input for it. | Picture Hunter (`picture`), and the fallback picture. |

### Marks and helper fields

| Field | What it is | Written | Read |
| --- | --- | --- | --- |
| `_autoStub` | `true` on a word made for a missing reference. Such a word needs only `word`, `type`, `category` and `meaning`. | `healMissingWordRefs`, `healOpposites`. Removed when the editor saves it with a meaning and an example, or when "Fill stubs with AI" works. | Content checks (fewer required fields). Admin badge, filter and score. Ask AI does not trust its meaning or type. **Not filtered out of play** (by reading, not seen in a run). |
| `_aiAdded` | `true` on a word added from the Ask AI drawer. | `aiWordEntry` ([askAiRules.js](../../../src/features/ai-helpers/askAiRules.js)). Never cleared. | Admin badge; library source `ai`. Not read by the game. |
| `gapsCheckedFor` | The gaps Content Health last found clear. | Content Health "gaps" fix. | Content Health, to skip checked words. |
| `learningData.cluster` | A cluster name used for option ranking. | **Never written by the app**; only from an imported file. | `optionWords` (small bonus for the same cluster). |

## Which field wins

| Fields | Rule |
| --- | --- |
| `situation` / `situations` | Everything reads `situation`, except the legacy situation pool, which takes `situations` when it is a non-empty list. A v3 import sets `situation = situations[0]`. Regenerate changes only `situation`, so the two can differ afterwards. |
| `gap` / `gaps` | The gap questions need a blank in `gap` and show `gap` for the first seed. `gaps` (if not empty) supplies the pool seeds, so later gaps are asked through the pool. With no blank in `gap`, no gap question is asked even if `gaps` holds good sentences. |
| `commonMistake` / `commonMistakes` | Grammar Court takes a random item of `commonMistakes` when it is a non-empty list, else `commonMistake`. The content checks look only at `commonMistake`. |
| `antonyms` / `opposite` / `relations.antonyms` | `antonyms` is the source. `opposite` is worked out from it (plus any stored `opposite`) on every build, and only names a game word. `relations.antonyms` is not read by the app. |
| `synonyms` / `relations.synonyms` | `synonyms` wins whenever it is a list, **even an empty one**. |
| `subCategory` / `distractorGroup` / `units` | Options: `subCategory`, else `distractorGroup`. Lesson groups: `units` when any word in the lesson has them, else `subCategory`. |
| `image` / `illustration` | `image` is shown first; the drawing is the fallback. Picture Hunter can use either. |
| The word's text / pool variants | A player's AI-written variant (in `pools`) replaces `meaning` or `gap` inside one question when it is usable; the word itself is not changed. |
| The game's entry / an Ask AI answer | Ask AI keeps the game's `word`, `type`, `partsOfSpeech` and `category` and explains the game's meaning ([ask-ai.md](../ai-media/ask-ai.md)). |

## Fields and AI

Which word fields each AI task gets, and which answer fields it can write back. The full list of tasks is
[ai-usage-inventory.md](../../ai-usage-inventory.md).

| Task | Word fields sent | Word fields written (after a person's click unless noted) |
| --- | --- | --- |
| Ask AI about a word | `word`, `type`, `partsOfSpeech`, `meaning`, `situation`, `category`, `opposite` (a stub: only `word`, `opposite`) | Admin "Add to Collection": `word`, `type`, `partsOfSpeech`, `category`, `meaning`, `situation`, `gap`, `hints`, `commonMistake`, `_aiAdded`. Editor fill: empty form fields. Stub fill: the stub's fields. |
| Rewrite a word | `word`, `type`, `partsOfSpeech`, `category`, `meaning`, `situation` | `meaning`, `situation` |
| Content health fix | `word`, `type`, `category`, `meaning`, `situation`, `gap` or `gaps`, up to 25 sibling words | The checked field (`situation`, `meaning`, `commonMistake`, `partsOfSpeech`, `gaps` and `gap`, `gapsCheckedFor`), sometimes `antonyms` |
| Write new practice sentences | `word`, `meaning`, `category`, sibling `word = meaning` pairs | None: the player's `pools` (progress) |
| Write a story | `word`, `type`, `category`, `meaning`, `situation` | None: a new story |
| Review a reported question, Suggest a fix for a report | The whole word | Admin "Apply fix": the whole word |
| Check a written answer, Check another word in a gap | `word`, `meaning`, `situation` (and the question) | None |

## Known Issues

Found by reading the code on 2026-10-22; register entry `LC-04` in [roadmap.md](../../architecture/roadmap.md).
None was changed in this work.

- `register` is written and edited but never read. `collocations` is edited but not used by the questions; the comment
  in `practiceRules.js` that says Word Partners come from it is out of date.
- `chainGroup` is read only by `chainSession`, which has no caller. `learningData.cluster` is read but never written.
- `categoryId` and `subCategoryTitle` are not updated when the editor changes the category or group.
- A `gap` without a blank turns off gap questions even when `gaps` has good sentences. Regenerate updates `situation`
  but not `situations[0]`.
- Saving the editor's mistake fields replaces a `commonMistakes` list with one item.
- Stub words are not filtered out of play, so a placeholder meaning can be shown.
- A word rename does not update `antonyms`, `synonyms`, `pictureAvoid` or `wordFamily`.
- The admin saves and exports the game's copy, so the derived `opposite` and merged `antonyms` are stored.
- The library copy links `relations.antonyms` and `opposite` but not the top-level `antonyms`. Keeping an Ask AI word in
  the admin's library drops its `level`.
