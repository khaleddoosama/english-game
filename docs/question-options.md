# How answer choices are created

This doc answers: *"When a question shows 4 options, who chose the 3 wrong
ones, and why those?"*

## 1. Two builders

| Builder | File | Used by |
|---|---|---|
| **V2 engine** — `V2.practice`, `V2.makeQuestion`, `V2.optionWords` | `src/engine/v2.js` | Level Practice (main game), Live Challenge (meaning / reverse / gap), stories, combos, Opposite Chain |
| **Adaptive builders** — `buildQuestion`, `buildOppositeQuestion`, `buildWhoAmIQuestion`, `buildTwoPeopleQuestion`, … | `src/engine/questions.js` | the "extra" style of each practice round (`buildPracticeExtra` in `WordHunter.jsx`), Weak Evidence, Final Case, Speed Round, Live "Who am I" and "Opposites" |

Both end up calling the same core function for distractors:
**`V2.optionWords(targets, words, count, rng, opts)`**.
(`sampleDistractors` in `questions.js` is just `V2.optionWords([target], WORDS, n+1)` without the target itself.)

## 2. Which style does a word get? (`V2.practice`)

`practice()` first picks the words (new ones in course-level order, known ones in rotation: missed first, then least recently seen). Then for each word it lists the possible **modes** by stage:

| Stage | Modes |
|---|---|
| New | `meaning`, `reverse` |
| Familiar | `reverse`, `gap`, and `gapTyping` once it has ≥1 correct |
| Learned / Mastered | `typing`, `gapTyping`, `gap` (+ `transform` for phrasal/fyi words that have `transformExample`) |

Extra rules:

- **Production gate:** if the word has no correct *typed* answer yet and (`reviewStep ≥ 2` or it is Learned/Mastered), only typing modes are allowed until it types one correctly.
- **Grammar Court:** a known word that has a `commonMistake` also gets a 2-option question (wrong sentence vs correction).
- **Extra style** (not for New words, not while the gate wants typing): `buildPracticeExtra` picks one at random from Who Am I, Idiom Detective, Story, Opposite, Two People, Select Two (Learned+), Opposite Clue, Word Partners, Word Family, Picture — only those the word can really build.
- A word appears at most twice per round, never within two questions of itself, and the same mode is not used 3 times in a row. The round queue is ordered so each mode is used in proportion to `weights` (e.g. `picture: 3`, `grammarCourt: 1`).
- Questions whose sentence the player read in the last **20 hours** (`SEEN_FRESH_HOURS`) are dropped (a short round is better than a repeated one).

## 3. `V2.optionWords` step by step

Input: the correct word(s) (`targets`), all `words`, how many options you want in total (`count`, correct ones included).

### Step A — hard filters (a word that fails is never a distractor)

For every correct target `t` and candidate `w` (`fits(w)`):

1. `compatible(t, w)` must be true:
   - not the **same headword** (two meanings of one word, like `Cast` and `Cast (to throw)`, never appear together);
   - not listed in `t.excludeFromSameOptionsWith` (either direction);
   - not a **synonym** of `t` (`synonyms` or `relations.synonyms`, either direction) — a second right answer would be unfair.
2. `norm(t.meaning) !== norm(w.meaning)` — two words with the identical definition are alternatives.

### Step B — rank the rest (closest first)

Each candidate gets a score = the **best** score over the targets:

| Signal | Points | Where it comes from |
|---|---|---|
| `t.relations.confusableWords` contains `w` | **150** | authored |
| `w.relations.confusableWords` contains `t` | 120 | authored (reverse direction) |
| Player's own mix-up (`confusions`, either direction) | **200** | the `boost` option, built in `practice()` from `opts.confusions` |
| Same part of speech (`partsOfSpeech[0]` base, or "expression" for idiom/binomial/fyi) | 130 | so options can't be ruled out by form |
| Same word count (1, 2, 3+ words) | 60 | |
| Both plural nouns or both not | 30 | |
| Same course unit (`units` overlap) | 70 | same topic |
| Same `subCategory` or same `distractorGroup` | 100 | authored grouping |
| Same `learningData.cluster` | 40 | |
| Same `type` (vocab/idiom/…) | 10 | |
| Same category (ignoring a trailing "II", "III") | 5 | |
| *Meaning mode only* (`definitionLike`): shared content words (×60), same first word (+30), similar length (+20) | up to ~110 | so wrong definitions *read like* the right one |

The list is **shuffled before sorting**, so words with the same score come out in random order — the same question differs each time.

### Step C — pick

Walk the ranked list from the top:

- skip anything that fails Step A;
- at most `sameGroupMax` words from the target's own `subCategory/distractorGroup` first (they are put in a `later` list); if there are not enough words outside the group, the `later` words are used after all;
- stop when `count` options are reached.

Finally the options are **shuffled** (`shuffleCopy`).

If the targets are missing or duplicated the function throws (`Correct targets are missing or duplicated`). A question with fewer than 2 options is discarded (`makeQuestion` returns `null`).

### Worked example

Target `Pricy` (adjective, one word, `distractorGroup: ht-cost`, `relations.confusableWords: [prickly, price]`, `excludeFromSameOptionsWith: [Expensive, Cost an arm and a leg]`).

- `Expensive` and `Cost an arm and a leg` are removed by Step A.
- `Cheap` (adjective, same distractorGroup) scores 130+60+100+… and is near the top.
- `Prickly`, if it exists as a word, gets +150.
- A noun like `Furniture` gets no part-of-speech bonus and falls to the bottom.

## 4. How difficulty changes the options

`questionDifficulty(stats)` in `v2.js` (1 New · 2 Familiar · 3 Learned or last 3 all correct · 4 Mastered; −1 if the last 2–3 were mostly wrong).

| Difficulty | Options for `reverse`, `gap` | Options for `meaning` | Same-group distractors allowed |
|---|---|---|---|
| 1–2 | 4 | 4 | at most 2 (`sameGroupMax: 2`) |
| 3–4 | 6 | 5 | unlimited (look-alikes are welcome) |

> The code comment says "at most one distractor from the word's own subCategory" but the code uses `2`. The code is the truth.

## 5. Each question style

| Style (mode) | Prompt shown | Options come from | Notes |
|---|---|---|---|
| `meaning` | the word | **meanings** of the target + distractor words (`definitionLike` ranking) | answer is the meaning text |
| `reverse` | the meaning | words | |
| `gap` | a gap sentence with `______` | words | the sentence is picked from the `gap` pool |
| `gapTyping`, `typing` | gap sentence / meaning | none (typed) | first-letter hint at low difficulty (`T_____`) |
| `situation` (older builder only) | situation sentence | words | not in V2 practice: `situation` contains the word |
| `whoami` | "I'm …" riddle made from the meaning (`firstPersonify`) | `sampleDistractors` | only `vocab` words whose meaning is a description (not "to …", "a …", "the …") |
| `opposite` | 4 sub-modes below | | needs `opposite` (or becomes the *trap*) |
| ↳ direct | the word | the opposite + 3 distractors that are **not also opposites** (`safeOppositeDistractor`) | |
| ↳ sentence | the word's gap sentence | `[word, opposite]` | 2 options |
| ↳ pair judgement | `A ⚔️ B` | "Yes, opposites" / "No, not opposites" | false pair = same category+type word that is not an opposite |
| ↳ trap (no `opposite`) | the word | "No clear opposite" + 3 words | teaches that not every word has an opposite |
| `antonym` (Opposite Clue) | "The opposite of “clue” is…" | the word + others that are **not** also opposites of the clue | clue = an antonym that is *not* a word in the game (`V2.outsideAntonyms`) |
| `collocation` (Word Partners) | authored sentence with one blank | **authored** `collocationChecks[].answer` + `wrong[]` (first 3) | nothing is auto-built; wrong options were checked by a human |
| `picture` | picture | `optionWords` over words, excluding `pictureAvoid` and same-subCategory words | needs an uploaded `image`, a loadable link, or an `illustration` SVG |
| `family` (Word Family) | "which one is the *verb*?" | the word and its `wordFamily` members | the answer is the only member with that part of speech; members that are just a part of the word are removed |
| `twopeople` | two sentences, "which word belongs to Person A?" | target + companion + 2 distractors (`fillToFour`) | companion = same category, different meaning (`meaningSimilarity < 0.55`), sentence never shown before |
| `selecttwo` | two numbered sentences | same, **multi-select** | answers = both words |
| `idiomDetective` | context sentence (difficulty ≤ 2, MCQ) or "what does it mean" (difficulty ≥ 3, free text judged by AI) | idioms/fyi/binomial | |
| `story` (fallback) | `situation` + "which word best describes the story?" | `hardDistractors` | only when the situation has 2–4 sentences, ≥ 18 words and does not contain the word |
| `phrasalTransform` | "Use “X”: before-sentence" | none (typed) | judged by AI (`modelOnly`) |
| `impostor` / authored challenges | authored | authored `options` | validated by `challengeValidationIssues`; shown through `safeLegacyQuestion` |
| `multi` combos | situation + prompt | the 2 combo words + distractors | `activityQuestion` → `optionWords(targets, words, max(4, n+1))` |
| stories | story text, then questions | **generated at runtime** with `optionWords` (stories store *no* options) | options come from the story's `sourceCategories` words if there are ≥ 4 |
| grammar `choose` | authored | authored (or AI variant) | shuffled |
| grammar `judge` | "Is this sentence correct? If not, choose the fixed version" | `["It's correct as it is", fix-or-alternative]` | |
| grammar `fix` | the wrong sentence | none (typed) | judged by AI |
| Speed Round | meaning (≤ 180 chars, without the word) or a gap | `optionWords(…, 4)` | only mastered words, 60 s, +10 per correct and +2 per combo step (max +10) |

## 6. Guards against bad questions

- **Leak guards:** a non-meaning question whose prompt contains the answer returns `null`; `situationLeaks` and `contextSentence` decide whether a sentence may be shown; `buildPracticeExtra` has a "last line of defence" that drops any prompt spelling out an answer; AI-written variants must contain `______` and must not contain the word (`localGeneratedVariantCheck`).
- **Duplicate options:** `uniqueStrings` / `new Set(norm)` checks. `safeLegacyQuestion` turns an authored question with duplicate or incompatible options into an "unavailable" question (no mastery credit) and tells the player to report it.
- **Exclusions inside authored challenges:** `validateContent` runs `pairs()` so authored options may not violate `excludeFromSameOptionsWith`.
- **Players can report** a bad question; the reported question/word/mode is quarantined for that player (`reportQuarantine`), so it is not offered again.

## 7. Where the player's own mistakes enter

1. The player picks a wrong *word* → `trackConfusion(target, selected)` (WordHunter.jsx) stores `"Target|Selected" → {count, lastAt}` in `confusions` (top 80 kept: `pruneConfusions`).
2. Next `V2.practice` builds `confusedPairs` (both directions) → `boost` = **+200** in `optionWords`, so the word they confused it with is likely to appear again.
3. `getStrongConfusion` (count ≥ 2) also raises `meaning`, `impostor` and `situation` weights in `selectAdaptiveMode` (weak-word sessions).

## 8. What you can edit in the data to improve options

| You want… | Edit this field on the word |
|---|---|
| Two words never together (near-synonyms) | `excludeFromSameOptionsWith` (both words) or `synonyms` |
| Two words that learners confuse to appear together | `relations.confusableWords` |
| A family of look-alikes | same `distractorGroup` (or `subCategory`) |
| A picture question never to show a wrong-but-valid word | `pictureAvoid` |
| Word Partners questions | `collocationChecks` |
| Fewer easy distractors | give every word `partsOfSpeech` |
| Stop typing questions for a word | `skipTyping: true` |
| Two meanings of one spelling | separate entries `Cast` and `Cast (to throw)` |

## 9. Known gaps (good first tasks)

1. `hardDistractors(target, count, confusionPartner)` in `questions.js` accepts `confusionPartner` but **ignores it**. The main practice path uses confusions (through `boost`), but Weak Evidence sessions, `idiomDetective` and the story fallback do not force the partner into the options.
2. The `sameGroupMax` comment mismatch above.
3. `optionWords` has no explicit "minimum distance" between two distractors; two distractors can be near-duplicates of each other (only the target is compared).
