---
name: anki-to-word-hunter
description: Turns vocabulary for the "Word Hunter" game into a ready-to-import, fully enriched content v3 JSON file — from an Anki "Notes in Plain Text" export (.txt, any Gateway course format) OR from a word list the user pastes with a category / unit / level. Trigger whenever the user uploads or pastes an Anki export, or pastes words (often with "category = …", "unit = …", "level …") and wants them in the game, asks for "json", "import file", "add these words to the game", or says things like "حوّل الملف ده للعبة" or "جهزلي الاستيراد بتاع الجيم ده".
---

# Word Hunter content generator (content v3, enriched)

## What this does

Produces ONE JSON file the user imports in Word Hunter (**Import → Apply / Restore**). Every word is written fresh and fully enriched: meaning, 2 situations, 3 gaps, hints, a common mistake, word family, collocations, a Word Partners check, synonyms/antonyms, links, and the engine's flat fields. Grammar rules get proper multiple-choice / judge / fix questions.

The output must look exactly like the **Output schema** below — every field on every word, never a shorter format.

## Inputs

1. **An Anki export** (`#separator:tab`, `#html:true|false`, `#tags column:N`; fields may be `"…"`-quoted with `""` escapes; the front is `<b>Word</b>` or `Word (Part of Speech)`). The type comes from the tag (`English::Idiom`, `::Grammar`, `::Phrasal-Verbs`, `::Binomial`, `::FYI`, `::Puns`) or from the front text ("Idiom: …", "Phrasal Verb: … = ?", "💡 FYI: … = ?" — for "X = ?" cards the answer in the back is the word). The level comes from `English::Gateway::Level-N`, the unit from the lesson tag (`English::Pet-Peeves` → "Pet Peeves").
2. **A pasted list**, usually with `category = …`, `unit = …`, `level …`. Board notes may include word families, "Miscellaneous terms", or an idiom with an example sentence — every item becomes its own card (use the given example as one of its gaps).

If both are given, include everything from both in the same file.

### Category, unit, level

- **Category**: use what the user wrote, exactly (it becomes the category `title`; the `id` is its slug, e.g. "Travel & Transport" → `travel-transport`). Without one, use the Anki topic mapping: `Goals-and-Dreams` → Mindset, `Work-Money` → Marketing, `Entertainment-Media` → Media, `People-Relationships` → Personality, `Personality-Behavior` → Pet Peeves; anything else → Title Case of the tag's last segment.
- **Unit**: what the user wrote, else the lesson tag. Goes in `units: ["…"]` on every word and grammar rule.
- **Level** is the Gateway course level, three to a band: 3 = A1.1, 4 = A1.2, 5 = A1.3, 6 = A2.1, 7 = A2.2, 8 = A2.3, 9 = B1.1, 10 = B1.2, 11 = B1.3, 12 = B2.1 … Write it as `"A2.1"` (normalize "a2.1" → "A2.1"). If no level is given at all, use a plain difficulty (`"A2"`, `"B1"` — the game shows those under "No course level yet") and tell the user, asking for the Gateway level.
- If the user's category or unit is missing or unclear, pick the obvious one (e.g. the words already live in a category), say which one you chose, and carry on.

## Output schema (mandatory — every field, every word)

```json
{
  "schemaVersion": 3,
  "kind": "content",
  "note": "Meet Egypt, content v3 (10 words). Category Travel & Transport, course level A2.1, unit Meet Egypt. Fully enriched with mandatory engine fields (situation, gap, commonMistake, categoryId), interactive collocationChecks, distractorGroup, and learningData.",
  "categories": [
    { "id": "travel-transport", "title": "Travel & Transport",
      "subCategories": [ { "id": "culture-and-people", "title": "Culture and people" } ] }
  ],
  "words": [
    {
      "id": "hospitality",
      "word": "Hospitality",
      "type": "vocab",
      "partsOfSpeech": ["noun"],
      "category": "travel-transport",
      "subCategory": "culture-and-people",
      "level": "A2.1",
      "register": "neutral",
      "meaning": "Being friendly and welcoming to guests and visitors, and taking good care of them.",
      "situations": [
        "When we visited a village near Aswan, a family invited us in, made us tea and wouldn't let us leave without lunch.",
        "The hotel staff greeted us with cold juice and helped us with our bags."
      ],
      "gaps": [
        "Egyptian ______ is famous — people always invite you for tea.",
        "Thank you for your warm ______ during our stay.",
        "He works in the ______ industry, in hotels and restaurants."
      ],
      "hints": ["Welcoming and caring for guests.", "Starts with 'hospit-' and ends with '-ality'."],
      "commonMistakes": [
        { "sentence": "They showed us a great hospitable.", "correction": "They showed us great hospitality.", "why": "'Hospitable' is the adjective; the noun is 'hospitality'." }
      ],
      "wordFamily": [ { "word": "hospitable", "pos": "adjective" }, { "word": "host", "pos": "noun" } ],
      "collocations": ["warm hospitality", "the hospitality industry"],
      "synonyms": ["welcome", "friendliness"],
      "antonyms": ["unfriendliness", "hostility"],
      "links": { "opposite": null, "confusableWith": ["generosity"], "excludeWith": [] },
      "units": ["Meet Egypt"],
      "situation": "When we visited a village near Aswan, a family invited us in, made us tea and wouldn't let us leave without lunch.",
      "gap": "Egyptian ______ is famous — people always invite you for tea.",
      "commonMistake": { "sentence": "They showed us a great hospitable.", "correction": "They showed us great hospitality.", "why": "'Hospitable' is the adjective; the noun is 'hospitality'." },
      "categoryId": "travel-transport",
      "collocationChecks": [
        { "sentence": "The tourists were touched by the warm ______ of their Egyptian hosts.", "answer": "hospitality", "wrong": ["hospital", "hospitable", "hostile"] }
      ],
      "distractorGroup": "culture-and-people",
      "learningData": { "cluster": "culture-and-people", "difficulty": "easy" },
      "relations": { "synonyms": ["welcome", "friendliness"], "antonyms": ["unfriendliness", "hostility"], "confusableWords": ["Generosity"] }
    }
  ],
  "grammar": []
}
```

### Field rules

- `id`: slug of the word (`"Sense of humor"` → `sense-of-humor`), unique in the file. `word`: the headword as the user/Anki wrote it — **but if the word already exists in the game, reuse that exact spelling** (the game merges by `word`, ignoring case; a different spelling creates a duplicate and loses progress).
- `type`: exactly one of `vocab`, `idiom`, `binomial`, `phrasal`, `fyi`. Fixed figurative phrase → `idiom`; "X and/or Y" fixed pair → `binomial`; verb + particle → `phrasal`; casual equivalent of a plain phrase ("I'm not okay = I've seen better days") → `fyi`; everything else, including verb phrases like "Do the dishes", → `vocab`. Wrong answers are picked from the same type, so get this right.
- `partsOfSpeech`: `noun`, `verb`, `adjective`, `adverb`, `phrasal verb`, or `phrase` (idioms / binomials / fyi).
- `category` and `categoryId`: the category **id** (slug). `subCategory`: an id listed under that category in `categories`; group the batch into 3–6 sensible sub-categories (e.g. bad-moods, hygiene, tourism). Every sub-category used must be listed.
- `distractorGroup` and `learningData.cluster`: the word's `subCategory` id. `learningData.difficulty`: `easy` (A1–A2), `medium` (B1), `hard` (B2+).
- `register`: `neutral`, `informal`, or `formal` (slang/rude → `informal` and say so in the meaning, e.g. "(informal and a bit rude)").
- `situations` (2) / `gaps` (3) / `hints` (2) / `commonMistakes` (1) — see the quality rules. The flat fields are copies: `situation` = `situations[0]`, `gap` = `gaps[0]`, `commonMistake` = `commonMistakes[0]`.
- `wordFamily`: related forms with `pos`; `[]` when none. `collocations`: 2–4 real ones.
- `synonyms` / `antonyms`: short, real ones; `[]` when none. Mirror them in `relations.synonyms` / `relations.antonyms`.
- `links.opposite`: **always `null`** (antonyms carry opposites; an `opposite` naming a word that isn't in the game makes the import create an empty stub card).
- `links.confusableWith`: **ids of words in this same file** that a learner could mix up (near-synonyms, same family, look-alikes). `relations.confusableWords`: the same words by their `word` text. Link both directions. Never link unrelated words. `links.excludeWith`: ids in this file that must never appear as options together (rare); otherwise `[]`. Don't link to words outside the file — the link is skipped with a warning.
- `collocationChecks` (Word Partners, 1 per word): a short B1 sentence with exactly one `______`, an `answer`, and 3 `wrong` options that are **clearly wrong in that exact sentence**. Either blank the partner word ("______ a tantrum" → throw; wrong: make, do, take) or the target in a fixed collocation testing its form ("a ______ city" → coastal; wrong: coast, coasting, coaster). Never offer a wrong option that also works ("convince/persuade the board that…", "a do-or-die moment"). The engine needs at least 2 non-empty wrong options.

### Grammar rules

One entry per rule (never put grammar in `words`):

```json
{ "id": "g-supposed-to-1", "rule": "Was / were supposed to", "category": "<category id>", "level": "B1.1", "units": ["…"],
  "explanation": "One or two lines stating the rule.",
  "examples": ["…", "…", "…"],
  "commonMistakes": [ { "sentence": "…", "correction": "…", "why": "…" } ],
  "questions": [
    { "type": "choose", "prompt": "The ad ______ start on Monday, but it didn't.", "options": ["was supposed to", "supposed to", "was suppose"], "answer": "was supposed to", "explanation": "…" },
    { "type": "judge", "sentence": "They were supposed to sending it.", "correct": false, "fix": "They were supposed to send it.", "explanation": "…" },
    { "type": "judge", "sentence": "You aren't supposed to park here.", "correct": true, "alternative": "You aren't suppose to park here.", "explanation": "…" },
    { "type": "fix", "sentence": "She was suppose to call.", "answer": "She was supposed to call.", "explanation": "…" }
  ] }
```

Write ~5 questions per rule (2 choose, 2 judge, 1 fix). `answer` must match an option character for character; exactly one option is defensibly right. A `judge` with `correct: true` **must** have an `alternative` (a wrong version), with `correct: false` it must have `fix`. If the rule already exists in the game, reuse its `id` so it updates.

**Puns**: the game no longer supports puns (the import drops them). Leave them out and tell the user.

## Quality rules (these came from real bugs)

1. **One meaning, one word.** In Typing mode the player sees only `meaning`. It must fit this word and no other — especially not another word in the file or the same unit. For near-synonym clusters (short-tempered / hot-tempered / snappy / grumpy / cranky; convince / persuade; retail / wholesale; customer / client; guarantee / warranty) write the definitions together, in parallel language, each naming the feature the others lack (how quickly vs how strongly; speech vs mood; cause; who / where).
2. **Same family, different form.** For Persist / Persistent / Persistence, make the meaning show the form ("To keep doing…" / "Describes a person who…" / "The quality of…") and make the common mistake a wrong-form error.
3. **No answer leakage.** No situation and no gap may contain the target word, its stem, or (for multi-word items) its key words — "price", "gloves", "plants", "dishes" leak "Price gouging", "Gloveless food handlers", "Water the plants", "Do the dishes". For phrasal verbs don't repeat the particle. Rewrite the sentence, don't just delete the word.
4. **Situations point to one word.** Each is a tiny concrete story (people, places, actions) that only this word fits, without naming it. Two situations per word, different from each other and from every other word's.
5. **Gaps**: exactly one `______` each, natural, under ~20 words; the blank is filled by the headword in its natural form (for "Piss someone off", "It really ______ when…" is fine). Use the user's example sentence as one gap when they give one.
6. **Common mistake**: a real learner error with a one-line `why` (wrong form, wrong preposition, make/do, spelling, false friend). Don't call correct English a mistake.
7. **Language level**: target B1 (A2 for A-level lessons) in everything except the headword. Everyday words, short sentences. Local, relatable examples are welcome (Egyptian names, places, food), matching the lesson.
8. **Hints**: hint 1 = a plain clue to the meaning; hint 2 = a form clue (first letters, ending, number of words, rhymes with…), never the full word.
9. **No placeholders** ("N/A", "TBD", "see grammar card") anywhere. Skip an item rather than write a stub.

## Workflow

1. Read everything first. List every item, its type, and the near-synonym clusters.
2. If the repo is available (`word-hunter-backup.json`, `imports/`), check which words already exist and reuse their exact spelling; mention which ones will be **updated** and any whose category will change. Existing grammar rule ids are reused the same way.
3. Write the words cluster by cluster, then grammar.
4. Self-check: every field present; flat copies match; ids unique; every `confusableWith` id exists in the file; every subCategory listed; no leaks; one blank per gap; grammar answers match options.
5. When working in the game's repo: save to `imports/<lesson-slug>-v3.json`, run it through the game's own import code (`V2.prepareImport(data, {})` and `V2.validateContent(r.data)` from `src/engine/v2.js`; e.g. a throwaway Vitest file) and fix every error and warning, then commit and push, and send the file to the user. Otherwise output only the JSON.
6. Reply briefly: where the file is, category / unit / level used, what's in it, which words update existing cards, anything you changed or assumed (spelling fixes, missing level, puns left out).

When the user adds more words for the same lesson later, add them to the same file (keep existing entries and their spellings) unless they ask for a separate one.
