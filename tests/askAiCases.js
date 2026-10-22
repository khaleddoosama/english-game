// A small fixed set of Ask AI cases, all made up: a word with several meanings (with the game's own entry, with a
// topic, and with no context), an idiom, a phrasal verb, a misspelling, random letters, and two inputs refused before
// any AI call. Each case has a good reply written by hand (used by tests/ask-ai-card.test.js with the AI mocked) and
// what an answer must show, which tests/ask-ai-eval.test.js also checks against the real model.
// Docs: docs/modules/ai-media/ask-ai.md.

const bat = { word: "Bat", type: "vocab", partsOfSpeech: ["noun"], category: "Animals", meaning: "A small animal that flies at night and sleeps upside down.", situation: "A bat flew out of the old barn at sunset.", gap: "A ______ flew out of the old barn at sunset.", image: "https://example.org/bat.webp", illustration: `<svg viewBox="0 0 10 10">${"<path d='M0 0'/>".repeat(700)}</svg>` };

export const ASK_AI_CASES = [
  {
    id: "several-meanings-game-entry", term: "bat", gameEntry: bat, topic: null,
    expect: { status: "ok", word: "Bat", type: "vocab", partsOfSpeech: ["noun"], meaning: /animal|fl(y|ies)|night/i, notMeaning: /ball|hit|sport|cricket|baseball/i },
    reply: { status: "ok", word: "bat", type: "vocab", partsOfSpeech: ["noun"], category: "Animals", meaning: "A small flying animal that is active at night.", pronunciation: "BAT", situation: "We saw a bat flying around the street light last night.", gap: "A ______ hung upside down from the roof of the cave.", hints: ["It flies at night.", "It sleeps upside down."], nearWords: [{ word: "Bird", difference: "A bird has feathers; this animal has fur and thin wings." }], commonMistake: null },
  },
  {
    id: "several-meanings-topic", term: "bank", gameEntry: null, topic: "Rivers and lakes",
    expect: { status: "ok", word: "bank", meaning: /river|side|edge|land/i, notMeaning: /money|account|loan/i },
    reply: { status: "ok", word: "bank", type: "vocab", partsOfSpeech: ["noun"], category: "Nature", meaning: "The land along the side of a river or lake.", pronunciation: "BANK", situation: "We had a picnic on the bank of the river.", gap: "The children sat on the grassy ______ and watched the boats on the river.", hints: ["It is next to the water.", "You can sit on it by a river."], nearWords: [{ word: "Shore", difference: "Shore is used more for the sea or a big lake." }], commonMistake: { sentence: "We walked in the river bank.", correction: "We walked on the river bank.", why: "We say on the bank, not in the bank." } },
  },
  {
    id: "several-meanings-no-context", term: "bank", gameEntry: null, topic: null,
    // One meaning, any of the common ones; all fields must be about the same one (checked by a person in the eval).
    expect: { status: "ok", word: "bank" },
    reply: { status: "ok", word: "bank", type: "vocab", partsOfSpeech: ["noun"], category: "Money", meaning: "A business that keeps your money safe and lends money.", pronunciation: "BANK", situation: "I went to the bank to open a savings account.", gap: "She took out a loan from the ______ to buy her first car.", hints: ["You can keep your money there.", "It gives loans."], nearWords: [], commonMistake: null },
  },
  {
    id: "idiom", term: "a piece of cake", gameEntry: null, topic: null,
    expect: { status: "ok", word: "a piece of cake", type: "idiom", meaning: /easy/i },
    reply: { status: "ok", word: "a piece of cake", type: "idiom", partsOfSpeech: ["noun phrase"], category: "Everyday talk", meaning: "Something that is very easy to do.", pronunciation: "uh PEES uv KAYK", situation: "The driving test was a piece of cake for her.", gap: "Don't worry about the quiz; it will be ______.", hints: ["It means very easy.", "People say it about tests and tasks."], nearWords: [], commonMistake: { sentence: "The exam was a cake.", correction: "The exam was a piece of cake.", why: "The idiom always uses all its words." } },
  },
  {
    id: "phrasal-verb", term: "Give up", gameEntry: null, topic: null,
    expect: { status: "ok", word: "give up", type: "phrasal", partsOfSpeech: ["phrasal verb"], meaning: /stop|quit/i },
    reply: { status: "ok", word: "give up", type: "phrasal verb", partsOfSpeech: ["phrasal verb"], category: "Habits", meaning: "To stop doing or trying something, often because it is too hard.", pronunciation: "giv UP", situation: "He gave up smoking last year and feels much better.", gap: "The puzzle was very hard, but she did not ______ until she solved it.", hints: ["You stop trying.", "The opposite of keeping on."], nearWords: [{ word: "Give in", difference: "Give in means you stop fighting and accept what someone else wants." }], commonMistake: { sentence: "I gave up to smoke.", correction: "I gave up smoking.", why: "After give up we use the -ing form." } },
  },
  {
    id: "misspelling", term: "recieve", gameEntry: null, topic: null,
    expect: { status: "ok", word: "receive", meaning: /get|given|sent/i },
    reply: { status: "ok", word: "receive", type: "vocab", partsOfSpeech: ["verb"], category: "Communication", meaning: "To get something that someone gives or sends to you.", pronunciation: "ri-SEEV", situation: "Did you receive my email this morning?", gap: "You will ______ a text message when your parcel arrives.", hints: ["You get it from someone.", "It happens to letters and emails."], nearWords: [{ word: "Take", difference: "You take something yourself; you receive what someone gives you." }], commonMistake: { sentence: "I received to your letter.", correction: "I received your letter.", why: "Receive does not need a preposition." } },
  },
  {
    id: "random-letters", term: "xqzvbnt", gameEntry: null, topic: null,
    expect: { status: "invalid", message: /“xqzvbnt” doesn't look like an English word or phrase\./ },
    reply: { status: "invalid", reason: "These letters do not make an English word.", suggestion: null },
  },
  {
    id: "arabic-letters", term: "مرحبا", gameEntry: null, topic: null,
    expect: { status: "refused", message: /^Type the word in English letters\.$/ },
  },
  {
    id: "whole-sentence", term: "I would like to know what this whole sentence means please", gameEntry: null, topic: null,
    expect: { status: "refused", message: /^Ask about one word or a short phrase\.$/ },
  },
];
