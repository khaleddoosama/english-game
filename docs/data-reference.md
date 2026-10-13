# Data reference — what every key is for

Content (words, grammar…) is shared by everyone and written only by the
admin. Progress is private to each player. Both are JSON.

Legend: **R** = required by `V2.validateContent` · **O** = optional · **legacy** = old/other shape still read or kept.

## 1. Content file kinds

| `kind` | What | Notes |
|---|---|---|
| `content` | only `words`, `combos`, `stories`, `grammar`, `challenges` (+ `schemaVersion`, `kind`, `note`) | any other key is rejected; no player data allowed (`score`, `mastery`, `pools`…) |
| `backup` | content **and** one player's progress | `schemaVersion` 2–6 accepted |
| `schemaVersion: 3` | "v3 content": ids, category list, links by id | converted to the shape below by `V2.normalizeV3` |

Removed fields that are dropped on import (`withoutRemovedFields`): `puns`, `sentenceBuild`, `example` (kept as `situation` only if the word has no situation), challenges of type `buildSentence`.

## 2. Word entry (`content_items.kind = 'words'`, key = `word`)

The text in `word` is the **primary key** everywhere (mastery, pools, links). Renaming moves every player's progress (migration 0017).

| Key | Req | Type | What it is for | Used by |
|---|---|---|---|---|
| `word` | R | string | the headword / key. Several meanings → `Cast` and `Cast (to throw)` (text before the trailing bracket is the *headword*) | everywhere |
| `type` | R | `vocab` `idiom` `binomial` `phrasal` `fyi` | decides modes: idiom → Idiom Detective; phrasal/fyi + `transformExample` → Phrasal Transform; `vocab` only → Who Am I | `getAllowedModes`, `practice` |
| `category` | R | string | the lesson / level; one `LEVEL` per category | `buildLevel`, option ranking (+5) |
| `meaning` | R | string | the definition. Must not contain the word. Shown in `meaning`/`reverse`/`typing` | many |
| `situation` | R* | string | the **example sentence** (contains the word). *Not required for stubs.* | flashcards, Idiom Detective, Story fallback |
| `gap` | R* | string | the same idea with the word replaced by `______` (must have a blank) | `gap`, `gapTyping`, Two People |
| `situations` | O | string[] | v3 list of example sentences; `situation` = first | pool `situation` seeds |
| `gaps` | O | string[] | v3 list of gap sentences; `gap` = first | pool `gap` seeds (`seed`, `seed-2`, …) |
| `hints` | O | string[] | shown on request in a question | session UI |
| `partsOfSpeech` | O | string[] | e.g. `["noun"]`; first one drives option "form" matching and Word Family | `posKey`, `familyQuestion`. See `PARTS_OF_SPEECH` in `engine/ai.js` |
| `partOfSpeech`, `pos` | legacy | | older spellings in old backups; the game reads `partsOfSpeech` | — |
| `level` | O | `A1.1 … C2.3` or `A1 … C2` | course level (`A2.2` = Gateway 7) **or** plain difficulty. Gateway forms (`Level-7`) are converted on import | course view, new-word order (`difficultyRank`) |
| `subCategory` (+ `subCategoryTitle`) | O | string | group inside a lesson (`Daily-Evaluation`) | grouping, option ranking (+100), "same group" cap |
| `units` | O | string[] | the course sessions the word was taught in (from Anki tags) | course view, option ranking (+70), Live filter |
| `register` | O | string | formal / informal note | editor only |
| `distractorGroup` | O | string | authored "family of look-alikes" | option ranking (+100) |
| `excludeFromSameOptionsWith` | O | string[] words | never in the same options as these words | `compatible` |
| `synonyms` | O | string[] | words with (nearly) the same meaning; treated like exclusions | `compatible`, editor |
| `antonyms` | O | string[] | source of opposites. An antonym that is also a word in the game is linked both ways; others become **Opposite Clue** clues | `linkAntonyms`, `outsideAntonyms` |
| `opposite` | O | string (a word) | *derived* from `antonyms` (still accepted in old files; `"None"` is dropped) | Opposite modes |
| `chainGroup` | O | string | words that play Opposite Chain together | `chainSession` |
| `relations` | O | `{synonyms[], antonyms[], confusableWords[]}` | AI/author metadata. `confusableWords` get the biggest authored rank bonus | `optionWords` |
| `learningData` | O | `{cluster, difficulty}` | cluster match gives +40 in ranking | `optionWords` |
| `semanticGroup`, `wordFamily` | O | string / list | `semanticRelation`; `wordFamily` as list of `{word,pos}` powers Word Family (a plain string in older files is only metadata) | `questions.js`, `familyQuestion` |
| `commonMistake` | O | `{sentence, correction, why}` | Grammar Court question for known words | `practice` |
| `commonMistakes` | O | the same, as a list | picks one at random | `practice` |
| `transformExample` | O | `{before, after}` — only for `phrasal`/`fyi` | Phrasal Transform (typed, AI-judged) | `getAllowedModes` |
| `plainForm` | O | string | the plain word the informal `fyi` word replaces | metadata/editor |
| `collocations` | O | string[] | free list of words that go together (editor) | display |
| `collocationChecks` | O | `[{sentence (one ______), answer, wrong[≥2], explanation?}]` | **authored** Word Partners questions | `collocationQuestion` |
| `image` | O | `https://…` or `data:image/…` | picture for Picture Hunter and flashcards | `pictureQuestion`, `lib/images.js` |
| `illustration` | O | inline `<svg>` (no scripts, ≤ 12 000 chars) | drawing when no photo | `isIllustration` |
| `pictureAvoid` | O | string[] | words the picture could also show — never offered as options | `pictureQuestion` |
| `skipTyping` | O | boolean | no typing modes for this word | `getAllowedModes`, `resolvePoolMode` |
| `id` | O (v3: R) | string | stable id so a rename is a rename, not a new word | `normalizeV3` |
| `categoryId` | O | string | the v3 category id (title kept in `category`) | rename detection |
| `_autoStub` | O | true | placeholder created for a dangling reference (`Imported reference — needs a real definition.`); finish it in Content health | `healMissingWordRefs`, `healOpposites` |
| `_aiAdded` | O | true | the word was added by AI lookup | admin |
| `gapsCheckedFor` | O | string | key of the gap sentences AI already checked for "another word fits" | Content health |

## 3. v3 import extras (`schemaVersion: 3`)

- `categories: [{id, title, subCategories:[{id,title}]}]` — titles listed once; words use the **id** in `category`. The category list also gives `levelOrder`.
- `words[].links = {opposite, excludeWith[], confusableWith[]}` — word **ids**. Converted to `antonyms`, `excludeFromSameOptionsWith`, `relations.confusableWords`.
- A word whose `id` is known under a different spelling = **rename** → existing entry renamed, progress moved.
- Unknown link ids give a warning and are skipped.

## 4. Grammar rule (`kind = 'grammar'`, key = `id`)

| Key | Meaning |
|---|---|
| `id` | stable id, may not contain `:` (progress key is `grammar:<id>`) |
| `category` | lesson it appears in; `level`, `units`, `subCategory` work as for words |
| `rule` | the rule's name ("Was/Were supposed to") |
| `explanation` | shown after the question |
| **Old shape** | `prompt`, `options[]`, `answer` — one `choose` question |
| **New shape** | `questions: [ … ]`, each of: |
| `{type:"choose", prompt, options[≥2], answer, explanation?}` | multiple choice |
| `{type:"judge", sentence, correct:true, alternative}` or `{…, correct:false, fix}` | "is it correct? if not choose the fix" |
| `{type:"fix", sentence, answer}` | type the corrected sentence (AI-judged) |
| `title`, `ruleFamily`, `mode`, `difficulty`, `scenario`, `distractorRationale`, `modelAnswer`, `acceptableVariants`, `gradingNotes` | present in some imported files. **The game does not read them** today (no use in `src/` or `api/`); they are stored and exported only. |

Rule rotation: a rule steps through its `questions` using `mastery["grammar:<id>"].total % questions.length`. When all are read within 20 h, AI-written `gen-…` variants (max 20 per rule) are used (`grammarNeedsVariant`).

## 5. Combo (`kind = 'combos'`)

`{id, category, words:[A, B], situation, prompt, explanation}` — exactly two different existing words. Asked as a *select two* question; options are generated. AI variants live in the player's pools under `combo:<id>`.

## 6. Story (`kind = 'stories'`)

`{id, category, sourceCategories?, title, text, targetWords[5–12], questions[≥5], grammarQuestions?[]}`.
Each story question: `{mode: 'mcq'|'typing'|'multi', targetWord | targetWords[2], prompt, explanation}` — **no options and no answer**; they come from the target word(s) and `optionWords`. Every target must be tested at least once.

## 7. Challenge (`kind = 'challenges'`)

`{id, type, category, difficulty, prompt, options?, answer | answers | acceptedAnswers, linkedWords[], explanation, relationship?, interaction?, steps?[], requiredWords?, exampleAnswer?}`.

| `type` | Shape |
|---|---|
| `story`, `idiomStory`, `reverseIdiomStory`, `impostor`, `reverseImpostor` | exactly 4 unique options; prompt must not contain the answer; impostor needs `relationship`; idiom types must link `type: idiom` words |
| `phrasalTransform` | linked words must be phrasal entries |
| `grammarCourt` | usually `steps` |
| any with `steps: [{type:'mcq'|'typing', prompt, options, answer, explanation}]` | multi-step, one question per step |
| `interaction: 'selfCheck' \| 'freeSentence'` | "write a sentence" (never gives mastery) |

A challenge only enters a level round when its linked words are at least Familiar (Learned for level-3+ phrasal transforms) — `challengeProgressEligible`.

## 8. Level order and notes

`content_meta`: `level_order` (category titles in play order), `note`, `version` (bumped on every content save; clients compare it to their cache).

## 9. Progress object (one per player)

Saved in **sections** (`SECTION_OF` in `repo.js`); fields not listed go to section `core`.

| Field | Section | Meaning | Merge rule (`progressMerge.mergeField`) |
|---|---|---|---|
| `score`, `attempted` | core | points / answers | counters add up |
| `streak`, `bestStreak` | core | answer streak | streak: this device; best: max |
| `studyStreak`, `bestStudyStreak`, `lastStudyDate` | core | daily study streak | later date wins |
| `bestSpeedScore`, `bestSpeedCombo` | core | Speed Round bests | max |
| `dailyProgress` | core | `{date, answered, correct}` for the daily goal | same day adds up |
| `settings` | core | player settings (see §11) | this device's |
| `schemaVersion` | core | 6 | — |
| `activeSession` | session | the round in progress (resume) | this device's |
| `pools` | pools | per-word sentence pools (§10) | deep merge by key |
| `seenSentences` | seen | `{normalized sentence → last seen ms}`; max 4 000 kept | max per key |
| `confusions` | confusions | `{"Target\|Chosen": {count,lastAt}}`; top 80 | counts add up |
| `sessionLogs` | history | last 50 rounds `{id, kind, title, correct, total, at}` | union by id |
| `completedSessions` | history | last 500 round ids | union |
| `solvedStories` | history | `[{id, correct, total}]` | union by id |
| `dailyHistory` | history | `{YYYY-MM-DD: {rounds, answered, correct}}`, 120 days | per day adds up |
| `reports` | reports | the player's question reports | union by id |
| `levelStats` | levels | per category `{attempts, bestAccuracy, stars, lastPlayedAt, migrated}` | attempts add up, bests max |
| `levelsCleared` | levels | cleared category ids | union |
| `mastery` | *(table `mastery`)* | one record per word / `grammar:<id>` / `combo:<id>` / `challenge:<id>` | §10 |

## 10. Mastery record, pool item, report

**Mastery** (`normalizeMasteryRecord`):

| Key | Meaning |
|---|---|
| `correct`, `total` | independent rounds counted, rounds counted |
| `modes` | per mode `{total, correct, spellingMisses, lastResult, lastDifficulty}` |
| `productionCorrect`, `productionAttempts` | correct / attempted typed answers |
| `assistedAttempts` | answers marked `assisted` in the round (they never count as correct) |
| `spellingMisses` | typed answers one letter off |
| `sentenceAttempts`, `sentenceSuccesses` | written-sentence checks |
| `aiEvaluatedAttempts` | answers judged by AI |
| `everMastered`, `regressionStrikes` | once mastered, 3 strikes are needed to lose it |
| `evidenceV2` | true when the record uses the V2 rules |
| `independentSessions` | last 20 round ids that were fully correct (Mastered needs ≥ 3) |
| `appliedSessions` | last 50 round ids already counted (a round is never counted twice, even after a merge) |
| `introducedAt` | first time the word was shown |
| `reviewStep` | streak of correct rounds (cap 2 until one typed success, then 4) |
| `lastReviewedAt`, `nextReviewAt` | `nextReviewAt` is always 0: spaced repetition is **off** |
| `lastResult` | `correct`, `wrong`, `spelling`, `assisted` |
| `recentResults` | last 8 `{correct, modeId, difficulty, at, spelling}` |

**Pool item** (`pools[word][poolType][]`, poolType ∈ `meaning gap situation typing`): `{id ('seed','seed-2','gen-…'), text, attempts, correctCount, lockedUntil, flagged}`. Two independent correct answers → `lockedUntil = now + 7 days` and a new AI variant is requested. `flagged`/retired variants get a far-future lock. Combo/grammar variants live at `pools['combo:<id>'].variant[]` / `pools['grammar:<id>'].variant[]` with their own fields (`situation`+`prompt`, or `prompt`+`options`+`answer`+`explanation`).

**Report** (`reports` table + section): `{id, questionId, sessionId, prompt, targetWords, mode, type, options, answers, poolType, poolItemId, reason, details, learnerAnswer, learnerAnswerText, wasCorrect, answerSubmitted, at, reportedAt, resolvedAt, …}`. Only the admin resolves it (0018).

## 11. Player `settings` (`normalizeSettings`)

| Key | Range / default |
|---|---|
| `questionsPerRound` | 4–30, 12 |
| `newWordsPerRound` | 0–10, 3 |
| `weakReviewSize` | 3–20, 8 |
| `enablePairModes` | Two People / Select Two on (true) |
| `dailyGoal` | 5–100, 20 |
| `levelView` | `lesson` · `group` · `course` |
| `sound`, `hints`, `shortcuts` | true |
| `speakWord`, `reduceMotion` | false |
| `autoAdvanceMs` | 0, 1000, 2000, 3000 |
| `speedSeconds` | 30, 45, 60, 90, 120 |
| `textSize` | `normal` `large` `xlarge` |
| `liveQuestions` / `liveSeconds` | personal Live defaults, or `null` = use the admin's |

## 12. App-wide settings (`app_settings.data`, Admin → Settings)

| Key | Meaning |
|---|---|
| `signupsOpen`, `signupsPer10Min` (5–200) | sign-ups and rate per network |
| `maintenance`, `maintenanceMessage` | lock the app with a message |
| `announcement`, `announcementTone` (`info` `success` `warning`) | banner |
| `aiForPlayers`, `aiDailyLimit` (0–2000) | AI switch and per-player daily calls |
| `ttsForPlayers` | new AI audio for players (cached audio always plays) |
| `liveCreate` (`everyone`/`admin`), `liveMaxPlayers` (2–10), `liveDefaultQuestions` (5–30), `liveDefaultSeconds`, `liveMaxHours` (1–168) | Live limits |
| `leaderboard` | when false players can read only their own profile row (0013) |
| `newPlayerDefaults` | `{questionsPerRound, newWordsPerRound, dailyGoal, sound, enablePairModes}` |

The same rules exist twice on purpose: `normalizeAppSettings` (browser) and `admin_save_settings` (database).

## 13. Live question (what players see vs what stays secret)

Built by `liveQuestions`, split by `splitQuestions`:

- **public** (`live_challenges.questions[]`): `{mode, prompt, options[], picture?, photo?}`
- **secret** (`live_answer_keys.answers[]`): `{answer, word, explanation, sentences[]}`

`settings` of a challenge: `{lesson, unit, kinds[], reveal, requested, next_code?, next_by?}`. Details: [live-challenge.md](live-challenge.md).
