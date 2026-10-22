// Ask AI about a word, with the AI mocked: the term checked before any call, what is sent, and the checks of the
// answer (src/lib/askAiCard.js, used by askAiForWord in src/lib/aiPrompts.js). Replies are written by hand; the fixed
// cases are in askAiCases.js. These tests say nothing about how good the real model's answers are: that is
// tests/ask-ai-eval.test.js. Made-up content. Docs: docs/modules/ai-media/ask-ai.md.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/ai", () => ({ callAiText: vi.fn() }));
import { callAiText } from "../src/lib/ai";
import { askAiForWord } from "../src/lib/aiPrompts";
import { ASK_AI_INSTRUCTIONS, PARTS_OF_SPEECH, askAiInput, askAiTerm, readAskAiAnswer, showsWord } from "../src/lib/askAiCard.js";
import { AI_TASKS } from "../api/_lib/tasks.js";
import { V2 } from "../src/engine/v2";
import { ASK_AI_CASES } from "./askAiCases.js";

afterEach(() => vi.clearAllMocks());
const sentInput = () => JSON.parse(callAiText.mock.calls[0][0].split("\n\nINPUT JSON:\n").at(-1));
const good = (extra = {}) => ({ status: "ok", word: "lantern", type: "vocab", partsOfSpeech: ["noun"], category: "Camping", meaning: "A light in a case that you can carry.", pronunciation: "LAN-turn", situation: "We hung a lantern outside the tent.", gap: "Bring a ______ so we can see the path at night.", hints: ["It gives light.", "You can carry it."], nearWords: [{ word: "Torch", difference: "A torch is a small electric light you hold." }], commonMistake: { sentence: "Turn up the lantern.", correction: "Turn on the lantern.", why: "We turn lights on and off." }, ...extra });
const read = (extra, opts = {}) => readAskAiAnswer(good(extra), { term: "lantern", ...opts });

describe("the fixed cases (AI mocked with a good reply)", () => {
  it.each(ASK_AI_CASES.map((c) => [c.id, c]))("%s", async (_id, c) => {
    if (c.reply) callAiText.mockResolvedValueOnce(JSON.stringify(c.reply));
    const asked = askAiForWord(c.term, c.gameEntry, c.topic);
    if (c.expect.status === "refused") {
      await expect(asked).rejects.toThrow(c.expect.message);
      expect(callAiText).not.toHaveBeenCalled();
      return;
    }
    if (c.expect.status === "invalid") {
      await expect(asked).rejects.toThrow(c.expect.message);
      return;
    }
    const card = await asked;
    const { expect: e } = c;
    expect(V2.norm(card.word)).toBe(V2.norm(e.word));
    if (e.type) expect(card.type).toBe(e.type);
    if (e.partsOfSpeech) expect(card.partsOfSpeech).toEqual(e.partsOfSpeech);
    if (e.meaning) expect(card.meaning).toMatch(e.meaning);
    if (e.notMeaning) expect(card.meaning).not.toMatch(e.notMeaning);
    expect(card.gap.match(/_{2,}/g)).toHaveLength(1);
    expect(showsWord(card.word, card.gap)).toBe(false);
    for (const h of card.hints) expect(showsWord(card.word, h)).toBe(false);
  });
});

describe("what is sent", () => {
  it("the instructions, then the term, the game's entry and the topic, as the task Ask AI about a word", async () => {
    callAiText.mockResolvedValueOnce(JSON.stringify(good()));
    await askAiForWord("lantern", null, "Camping");
    const [prompt, opts] = callAiText.mock.calls[0];
    expect(prompt.startsWith(ASK_AI_INSTRUCTIONS)).toBe(true);
    expect(prompt.split("INPUT JSON:")).toHaveLength(2);
    expect(opts.task).toBe("Ask AI about a word");
    expect(opts.adminOnly).toBeUndefined();
    expect(sentInput()).toEqual({ term: "lantern", gameEntry: null, topic: "Camping" });
  });
  it("only the fields of the game's entry that say which meaning it is: no picture, drawing or other fields", async () => {
    const bat = ASK_AI_CASES.find((c) => c.id === "several-meanings-game-entry").gameEntry;
    callAiText.mockResolvedValueOnce(JSON.stringify(good({ word: "bat" })));
    await askAiForWord("bat", { ...bat, units: ["U1"], hints: ["x"], _aiAdded: true }, "Night");
    expect(sentInput().gameEntry).toEqual({ word: "Bat", type: "vocab", partsOfSpeech: ["noun"], meaning: bat.meaning, situation: bat.situation, category: "Animals" });
    // The drawing alone is about 11,000 characters: sending it would bring the prompt near the 20,000 limit.
    expect(callAiText.mock.calls[0][0].length).toBeLessThan(AI_TASKS["Ask AI about a word"].maxChars / 2);
  });
  it("a stub sends only its word and opposite: its meaning and type are placeholders", () => {
    const stub = { word: "Calm", type: "vocab", category: "General", meaning: 'Opposite of "Anxious".', opposite: "Anxious", _autoStub: true };
    expect(askAiInput("Calm", stub, null).gameEntry).toEqual({ word: "Calm", opposite: "Anxious" });
  });
  it("long texts are shortened; an empty topic is null", () => {
    const input = askAiInput("x", { word: "Long", meaning: "m".repeat(900), category: "c".repeat(200) }, "   ");
    expect(input.gameEntry.meaning).toHaveLength(300);
    expect(input.gameEntry.category).toHaveLength(60);
    expect(input.topic).toBeNull();
  });
  it("the instructions list the game's parts of speech and never ask for the course's own fyi type", () => {
    expect(ASK_AI_INSTRUCTIONS).toContain(PARTS_OF_SPEECH.join(", "));
    expect(ASK_AI_INSTRUCTIONS).toContain('"type":"vocab|phrasal|idiom|binomial"');
    expect(ASK_AI_INSTRUCTIONS).toMatch(/never invent one/);
  });
});

describe("the term, checked before any AI call", () => {
  it("cleans the ends and spaces, keeps accented letters, and cuts to 80 characters", () => {
    expect(askAiTerm('  "lantern," ')).toBe("lantern");
    expect(askAiTerm("café")).toBe("café");
    expect(askAiTerm("rock-'n'-roll!")).toBe("rock-'n'-roll");
    expect(askAiTerm("give   up")).toBe("give up");
    expect(askAiTerm("a".repeat(100))).toHaveLength(80);
  });
  it("refuses an empty term, other alphabets, and more than 8 words", () => {
    expect(askAiTerm("  12 ").message).toBe("Select or type an English word first.");
    expect(askAiTerm("bank بنك").message).toBe("Type the word in English letters.");
    expect(askAiTerm("one two three four five six seven eight")).toBe("one two three four five six seven eight");
    expect(askAiTerm("one two three four five six seven eight nine").message).toBe("Ask about one word or a short phrase.");
  });
});

describe("the answer", () => {
  it("a good answer becomes the card, with nothing else from the answer", () => {
    expect(read({ example: "x", adminOnly: true, extra: { a: 1 } })).toEqual({
      word: "lantern", type: "vocab", partsOfSpeech: ["noun"], category: "Camping", meaning: good().meaning, pronunciation: "LAN-turn",
      situation: good().situation, gap: good().gap, hints: good().hints, nearWords: good().nearWords, commonMistake: good().commonMistake,
    });
  });
  it("cannot be read, or has no meaning or example: a clear error", async () => {
    callAiText.mockResolvedValueOnce("Sorry, I can't help with that.");
    await expect(askAiForWord("lantern")).rejects.toThrow("AI returned an unreadable answer. Please try again.");
    expect(() => readAskAiAnswer([good()], { term: "lantern" })).toThrow("unreadable");
    expect(() => read({ meaning: "" })).toThrow("AI returned an incomplete explanation. Please try again.");
    expect(() => read({ situation: { text: "x" } })).toThrow("incomplete");
  });
  it("not an English word: the error, with the suggestion only when it is a different English word", () => {
    expect(() => read({ status: "invalid", suggestion: "lantern" }, { term: "lantren" })).toThrow("“lantren” doesn't look like an English word or phrase. Did you mean “lantern”?");
    expect(() => read({ status: "invalid", suggestion: "lantren" }, { term: "lantren" })).toThrow(/phrase\.$/);
    expect(() => read({ status: "invalid", suggestion: "فانوس" }, { term: "lantren" })).toThrow(/phrase\.$/);
  });
  it("the game's entry keeps its word, type, parts of speech and category", () => {
    const entry = { word: "Bat", type: "idiom", partsOfSpeech: ["noun"], category: "Animals" };
    expect(read({ word: "bat", type: "vocab", partsOfSpeech: ["verb"], category: "Sport" }, { term: "bat", gameEntry: entry })).toMatchObject({ word: "Bat", type: "idiom", partsOfSpeech: ["noun"], category: "Animals" });
    // A stub's type is a placeholder: the answer's own type is used.
    expect(read({ type: "phrasal" }, { gameEntry: { word: "Lantern", type: "vocab", _autoStub: true } }).type).toBe("phrasal");
  });
  it("type: the five types or a common name for one, else vocab; parts of speech: only the game's list", () => {
    expect(read({ type: "Phrasal verb" }).type).toBe("phrasal");
    expect(read({ type: "binomial phrase" }).type).toBe("binomial");
    expect(read({ type: "slang" }).type).toBe("vocab");
    expect(read({ partsOfSpeech: ["Noun", "thing word", "noun", "verb", "adjective", "adverb"] }).partsOfSpeech).toEqual(["noun", "verb", "adjective"]);
    expect(read({ partsOfSpeech: "noun" }).partsOfSpeech).toEqual([]);
  });
  it("an unusable gap is left empty and the rest is kept: no blank, two blanks, or the word in it", () => {
    expect(read({ gap: "Bring a lantern so we can see." }).gap).toBe("");
    expect(read({ gap: "Bring a ______ and a ______." }).gap).toBe("");
    expect(read({ gap: "The lantern ______ was bright." }).gap).toBe("");
    expect(read({ gap: "The lanterns ______ were bright." }).gap).toBe("");
    expect(read({ gap: "Bring a ______." }).meaning).toBe(good().meaning);
  });
  it("hints that give the word away are dropped; at most 3 are kept", () => {
    expect(read({ hints: ["It rhymes with lanterns.", "It gives light.", 7, "", "a", "b", "c"] }).hints).toEqual(["It gives light.", "a", "b"]);
  });
  it("near words: a list of word and difference texts, not the word itself, no repeats, at most 3", () => {
    expect(read({ nearWords: "Torch, lamp" }).nearWords).toEqual([]);
    expect(read({ nearWords: [{ word: "Torch", difference: { text: "x" } }, { word: "lantern", difference: "same" }, "Lamp", { word: "Lamp", difference: "a" }, { word: "lamp", difference: "b" }, { word: "Candle", difference: "c" }, { word: "Bulb", difference: "d" }, { word: "Flare", difference: "e" }] }).nearWords)
      .toEqual([{ word: "Lamp", difference: "a" }, { word: "Candle", difference: "c" }, { word: "Bulb", difference: "d" }]);
  });
  it("common mistake: only with three texts and a real correction; pronunciation: short text only", () => {
    expect(read({ commonMistake: null })).not.toHaveProperty("commonMistake");
    expect(read({ commonMistake: { sentence: "a", correction: "b" } })).not.toHaveProperty("commonMistake");
    expect(read({ commonMistake: { sentence: "Same.", correction: "same", why: "x" } })).not.toHaveProperty("commonMistake");
    expect(read({ pronunciation: { ipa: "x" } }).pronunciation).toBe("");
    expect(read({ pronunciation: "x".repeat(61) }).pronunciation).toBe("");
  });
  it("no category: AI Discoveries", () => {
    expect(read({ category: "" }).category).toBe("AI Discoveries");
  });
});

describe("whether a sentence shows the word", () => {
  it("the word or a regular form of it, as whole words, in order", () => {
    expect(showsWord("Rain", "It rained all day.")).toBe(true);
    expect(showsWord("Make", "She is making tea.")).toBe(true);
    expect(showsWord("Give up", "Never give up!")).toBe(true);
    expect(showsWord("Cast (to throw)", "They cast the net.")).toBe(true);
    expect(showsWord("Art", "We start at nine.")).toBe(false);
    expect(showsWord("Give up", "Give it up.")).toBe(false);
  });
});
