// Ask AI about a word, the parts with no network: the check of the term before any AI call, what is sent, the
// instructions, and the check of the answer. askAiForWordImpl (aiPrompts.js) calls the AI with them; tests and
// tests/ask-ai-eval.test.js use them directly. Docs: docs/modules/ai-media/ask-ai.md, fields: docs/modules/content/word-fields.md.
import { V2 } from "../engine/v2";
import { normalizeAnswerText } from "../engine/text";

// The parts of speech the game uses (also the list Content Health gives the AI).
export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "noun phrase", "verb phrase", "adjective phrase", "adverbial phrase", "phrasal verb", "idiom", "expression", "binomial phrase", "proper noun", "interjection", "preposition", "conjunction"];
const TYPES = ["vocab", "idiom", "binomial", "phrasal", "fyi"];
// Names the AI may use for a type instead of the game's own.
const TYPE_NAMES = { "phrasal verb": "phrasal", "idiomatic expression": "idiom", "fixed expression": "idiom", "binomial phrase": "binomial", word: "vocab", vocabulary: "vocab" };
const MAX_WORDS = 8;
const BLANK = /_{2,}/g;
const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;

const text = (v, max) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim().replace(/\s+/g, " ") : "");
// Text compared without case, punctuation or extra spaces.
const plain = (v) => V2.norm(v).replace(/[^\p{L}\p{N}' ]/gu, "").replace(/\s+/g, " ").trim();
const cut = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The term to ask about, or an Error to show (nothing is sent). The ends lose anything that is not a letter (an
// apostrophe or hyphen stays at the end), inner spaces become single, and it is cut to 80 characters.
export function askAiTerm(raw) {
  const term = String(raw || "").replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}'-]+$/u, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!term) return new Error("Select or type an English word first.");
  if ([...term].some((c) => LETTER.test(c) && !LATIN.test(c))) return new Error("Type the word in English letters.");
  if (term.split(" ").length > MAX_WORDS) return new Error("Ask about one word or a short phrase.");
  return term;
}

// What the AI gets: the term, the game's own entry (only the fields that say which meaning it is), and the topic the
// player is on. A stub's meaning and type are placeholders, so only its word and opposite are sent.
export function askAiInput(term, gameEntry = null, topic = null) {
  let entry = null;
  if (gameEntry && typeof gameEntry === "object" && text(gameEntry.word, 120)) {
    const stub = !!gameEntry._autoStub;
    const pos = Array.isArray(gameEntry.partsOfSpeech) ? gameEntry.partsOfSpeech.filter((p) => typeof p === "string" && p.trim()) : [];
    entry = Object.fromEntries(Object.entries({
      word: text(gameEntry.word, 120),
      type: stub ? "" : TYPES.includes(gameEntry.type) ? gameEntry.type : "",
      partsOfSpeech: stub ? [] : pos,
      meaning: stub ? "" : cut(gameEntry.meaning, 300),
      situation: stub ? "" : cut(gameEntry.situation, 300),
      category: stub ? "" : cut(gameEntry.category, 60),
      opposite: cut(gameEntry.opposite, 120),
    }).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
  }
  return { term, gameEntry: entry, topic: cut(topic, 60) || null };
}

export const ASK_AI_INSTRUCTIONS = `You are the vocabulary coach of Word Hunter, a game for adults learning English at about B1 level. A learner asked about one English word or short phrase. Write a short, accurate learning card in simple English (B1 or easier; only the asked word itself may be harder). English only: never Arabic or any other language.

The input has:
- "term": what the learner typed or clicked. It may be capitalised, inflected ("went") or slightly misspelled ("recieve").
- "gameEntry": the game's own card for this word, or null. When it has a "meaning", explain exactly that meaning (you may say it more simply, but never change the sense) and keep its "word", "type" and "partsOfSpeech".
- "topic": the lesson the learner is studying, or null. Use it only to choose between meanings when gameEntry has no meaning.

First decide whether "term" is a real English word, phrasal verb, idiom or fixed expression. A small spelling mistake or an inflected form is fine: use the dictionary form ("went" -> "go", "recieve" -> "receive"). If it is not English, is random letters, is only a name, or is a whole sentence, return ONLY:
{"status":"invalid","reason":"one short sentence","suggestion":"the closest real English word or phrase, or null"}

Otherwise choose ONE meaning: gameEntry's meaning; else the meaning that fits "topic"; else the most common everyday meaning. Every field must be about that same meaning. Return ONLY this JSON:
{"status":"ok","word":"dictionary form","type":"vocab|phrasal|idiom|binomial","partsOfSpeech":["noun"],"category":"short topic","meaning":"...","pronunciation":"...","situation":"...","gap":"...","hints":["...","..."],"nearWords":[{"word":"...","difference":"..."}],"commonMistake":{"sentence":"...","correction":"...","why":"..."}}

Field rules:
- type: "phrasal" = a phrasal verb (verb + particle: "give up"); "idiom" = a fixed expression whose meaning is not literal ("under the weather"); "binomial" = two words joined by "and"/"or" in a fixed order ("sick and tired"); "vocab" = any other word or phrase.
- partsOfSpeech: for this meaning only, using only: ${PARTS_OF_SPEECH.join(", ")}.
- category: a short topic of 1-3 words ("Health", "Travel").
- meaning: one clear sentence of at most 20 words, so a learner could recognise the word from it. Do not use the word itself or a word from its family.
- pronunciation: an easy respelling with the stressed part in capitals, like "ri-LUK-tunt".
- situation: one natural everyday sentence (8-20 words) that uses the word in this meaning.
- gap: a DIFFERENT natural sentence where the word, written exactly as in "word", is replaced by "______" (exactly one blank). Give enough context that only this word fits. The word must not appear anywhere else in the sentence.
- hints: 2 short clues that help find the word without giving it away (no word from its family).
- nearWords: 0-3 real words or phrases that learners confuse with this one, each with one short sentence on the difference. Use [] when there is none. Never add a word just to fill the list, and never call a word a synonym or an opposite unless it really is one.
- commonMistake: a real, typical learner mistake with this word (its form, preposition, word choice or meaning), the corrected sentence, and a short reason. Use null when there is no typical mistake; never invent one.`;

// Inflected forms count: "rain" shows in "rained", "rains", "raining".
const tokens = (s) => normalizeAnswerText(s).replace(/[^a-z0-9' -]/g, " ").split(/[\s-]+/).filter(Boolean);
const formOf = (token, head) => token === head || (head.length > 2 && new RegExp(`^${head.replace(/e$/, "")}(s|es|d|ed|ing|er|est|e)$`).test(token));
// True when `sentence` contains the word (or an inflected form of each of its words, in order).
export function showsWord(word, sentence) {
  const head = tokens(V2.bareWord(word)), list = tokens(sentence);
  if (!head.length) return false;
  for (let i = 0; i + head.length <= list.length; i++) if (head.every((h, j) => formOf(list[i + j], h))) return true;
  return false;
}

// Throws when the answer cannot be used, else the card: word, type, partsOfSpeech, category, meaning, pronunciation,
// situation, gap ("" when unusable), hints, nearWords, commonMistake (only when complete). Nothing else of the answer.
export function readAskAiAnswer(raw, { term, gameEntry = null } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI returned an unreadable answer. Please try again.");
  if (raw.status === "invalid") {
    const suggestion = text(raw.suggestion, 80);
    const hint = suggestion && /^[\p{Script=Latin}' -]+$/u.test(suggestion) && V2.norm(suggestion) !== V2.norm(term) ? ` Did you mean “${suggestion}”?` : "";
    throw Object.assign(new Error(`“${term}” doesn't look like an English word or phrase.${hint}`), { code: "ASK_AI_INVALID_TERM" });
  }
  const meaning = text(raw.meaning, 400), situation = text(raw.situation, 400);
  if (!meaning || !situation) throw new Error("AI returned an incomplete explanation. Please try again.");
  const game = gameEntry && !gameEntry._autoStub ? gameEntry : null;
  const word = text(game?.word, 120) || text(raw.word, 80) || term;
  const typeName = V2.norm(raw.type);
  const type = TYPES.includes(game?.type) ? game.type : TYPES.includes(typeName) ? typeName : TYPE_NAMES[typeName] || "vocab";
  const gamePos = Array.isArray(game?.partsOfSpeech) ? game.partsOfSpeech.filter((p) => typeof p === "string" && p.trim()) : [];
  const partsOfSpeech = gamePos.length ? gamePos : [...new Set((Array.isArray(raw.partsOfSpeech) ? raw.partsOfSpeech : []).map((p) => V2.norm(p)).filter((p) => PARTS_OF_SPEECH.includes(p)))].slice(0, 3);
  const gap = text(raw.gap, 400);
  const gapOk = gap && (gap.match(BLANK) || []).length === 1 && !showsWord(word, gap);
  const hints = (Array.isArray(raw.hints) ? raw.hints : []).map((h) => text(h, 200)).filter((h) => h && !showsWord(word, h)).slice(0, 3);
  const nearWords = (Array.isArray(raw.nearWords) ? raw.nearWords : [])
    .map((n) => ({ word: text(n?.word, 80), difference: text(n?.difference, 300) }))
    .filter((n) => n.word && n.difference && V2.norm(n.word) !== V2.norm(word))
    .filter((n, i, all) => all.findIndex((x) => V2.norm(x.word) === V2.norm(n.word)) === i)
    .slice(0, 3);
  const m = raw.commonMistake;
  const mistake = m && typeof m === "object" ? { sentence: text(m.sentence, 300), correction: text(m.correction, 300), why: text(m.why, 300) } : null;
  const card = {
    word, type, partsOfSpeech,
    category: text(game?.category, 60) || text(raw.category, 40) || "AI Discoveries",
    meaning, pronunciation: text(raw.pronunciation, 60), situation, gap: gapOk ? gap : "", hints, nearWords,
  };
  if (mistake?.sentence && mistake.correction && mistake.why && plain(mistake.sentence) !== plain(mistake.correction)) card.commonMistake = mistake;
  return card;
}
