// Live Challenge questions: a mix of types (not mostly definitions), words
// that rotate between matches, grammar questions, and every question in the
// shape the server accepts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { mergeCustomData, WORDS } from "../src/engine/data";
import { firstPersonify } from "../src/engine/questions";
import { LIVE_KINDS, liveKey, liveOption, liveQuestions } from "../src/features/live/liveEngine";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const content = V2.withoutRemovedFields(backup);
mergeCustomData(content.words, content.grammar, content.challenges, content.levelOrder);
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const words = WORDS.filter((w) => w.category === "People-Relationships").slice(0, 80);
const counts = (qs) => qs.reduce((m, q) => ({ ...m, [q.mode]: (m[q.mode] || 0) + 1 }), {});
// What the server's live_create checks.
const serverOk = (q) => q.prompt && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8 && q.answer && q.options.some((o) => o.trim().toLowerCase() === q.answer.trim().toLowerCase());

describe("variety", () => {
  it("a match mixes several question types; no type is most of it", () => {
    const qs = liveQuestions(words, 20, { rng: seeded(11) });
    const c = counts(qs);
    expect(qs).toHaveLength(20);
    expect(Object.keys(c).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...Object.values(c))).toBeLessThanOrEqual(8);
  });

  it("offers the new types", () => {
    const ids = LIVE_KINDS.map((k) => k.id);
    for (const id of ["whoami", "opposite", "antonym", "grammar"]) expect(ids).toContain(id);
  });

  it("types that can't be built for these words are skipped, not forced", () => {
    const qs = liveQuestions(words, 20, { rng: seeded(2), kinds: ["meaning", "reverse"] });
    expect(new Set(qs.map((q) => q.mode))).toEqual(new Set(["meaning", "reverse"]));
    expect(Math.abs((counts(qs).meaning || 0) - (counts(qs).reverse || 0))).toBeLessThanOrEqual(2);
  });

  it("every question is shaped for the server, and never prints its own answer", () => {
    for (const seed of [1, 2, 3]) for (const q of liveQuestions(words, 25, { rng: seeded(seed) })) {
      expect(serverOk(q), `${q.mode}: ${q.prompt}`).toBe(true);
      if (q.mode !== "meaning" && q.answer.length > 3) expect(V2.norm(q.prompt).includes(V2.norm(q.answer)), `${q.mode}: ${q.prompt} → ${q.answer}`).toBe(false);
    }
  });
});

describe("rotation", () => {
  it("words asked in one match wait behind fresh ones in the next", () => {
    const first = liveQuestions(words, 15, { rng: seeded(5) });
    const seen = {};
    for (const q of first) for (const k of q.sentences) seen[k] = Date.now() - 3600000; // as markSentencesSeen does
    const second = liveQuestions(words, 15, { rng: seeded(6), seen });
    const again = second.filter((q) => first.some((f) => f.word === q.word));
    expect(again).toHaveLength(0);
  });

  it("with few words, a word may come back but as a different question", () => {
    const few = words.slice(0, 6);
    for (const seed of [9, 21, 33, 47, 58]) {
      const first = liveQuestions(few, 6, { rng: seeded(seed) });
      const seen = {};
      for (const q of first) for (const k of q.sentences) seen[k] = Date.now() - 3600000;
      const second = liveQuestions(few, 6, { rng: seeded(seed + 1), seen });
      expect(second).toHaveLength(6);
      const same = second.filter((q) => first.some((f) => f.word === q.word && f.mode === q.mode && f.prompt === q.prompt));
      expect(same.map((q) => `${q.word}:${q.mode}`), `seed ${seed}`).toEqual([]);
    }
  });

  it("a definition question is remembered by its word and type", () => {
    const q = liveQuestions(words.slice(0, 1), 1, { rng: seeded(1), kinds: ["meaning"] })[0];
    expect(q.sentences).toContain(liveKey("meaning", q.word));
    expect(q.sentences).toContain(liveKey("word", q.word));
  });
});

describe("grammar", () => {
  const rules = [
    { id: "r1", rule: "Used to", explanation: "x", questions: [
      { type: "choose", prompt: "I ______ play football.", options: ["used to", "use to", "was used to"], answer: "used to", explanation: "Past habit." },
      { type: "judge", correct: false, sentence: "He didn't used to run.", fix: "He didn't use to run.", explanation: "After didn't." },
      { type: "fix", sentence: "I used play.", answer: "I used to play.", explanation: "" },
    ] },
    { id: "r2", rule: "Old rule", prompt: "She ______ here.", options: ["has lived", "lives", "is living"], answer: "has lived", explanation: "Since." },
  ];

  it("a match includes grammar questions from the lesson's rules", () => {
    const qs = liveQuestions(words, 12, { rng: seeded(4), grammar: rules });
    const g = qs.filter((q) => q.mode === "grammar");
    expect(g.length).toBeGreaterThanOrEqual(1);
    expect(g.length).toBeLessThanOrEqual(2); // one per rule
    for (const q of g) { expect(serverOk(q)).toBe(true); expect(rules.map((r) => r.rule)).toContain(q.word); }
  });

  it("only multiple-choice questions: a fix-the-sentence question is never used", () => {
    for (let seed = 1; seed < 15; seed++) for (const q of liveQuestions([], 5, { rng: seeded(seed), grammar: rules }).filter((x) => x.mode === "grammar")) expect(q.prompt).not.toMatch(/Fix the mistake/);
  });

  it("without the Grammar type, no grammar", () => {
    expect(liveQuestions(words, 12, { rng: seeded(4), grammar: rules, kinds: ["meaning"] }).filter((q) => q.mode === "grammar")).toHaveLength(0);
  });

  it("grammar options keep their own spelling, not capitalised like word options", () => {
    expect(liveOption("used to", { mode: "grammar" })).toBe("used to");
    expect(liveOption("harsh", { mode: "gap" })).toBe("Harsh");
  });
});

describe("what the player is asked", () => {
  it("an Opposites question says what to pick (Live shows only the prompt)", () => {
    const withOpposite = WORDS.filter((w) => w.opposite);
    expect(withOpposite.length).toBeGreaterThan(3);
    const qs = liveQuestions(withOpposite, 8, { rng: seeded(3), kinds: ["opposite"] });
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) expect(q.prompt).toMatch(/^What is the opposite of “.+”\?$/);
  });

  it("an outside antonym becomes a clue that points at the word", () => {
    const w = { ...WORDS.find((x) => x.type === "vocab" && !x.opposite), antonyms: ["blorple"] };
    const qs = liveQuestions([w], 1, { rng: seeded(5), kinds: ["antonym"] });
    expect(qs).toHaveLength(1);
    expect(qs[0].prompt).toBe("The opposite of “blorple” is…");
    expect(qs[0].answer).toBe(w.word);
    expect(qs[0].options).toContain(w.word);
  });

  it("a Who am I? riddle doesn't end in two full stops", () => {
    expect(firstPersonify("Having paid work.")).toBe("I'm having paid work.");
    expect(firstPersonify("Having paid work")).toBe("I'm having paid work.");
    expect(firstPersonify("Not responsible for a crime (formal).")).toBe("I'm not responsible for a crime.");
    for (const q of liveQuestions(words, 20, { rng: seeded(8), kinds: ["whoami"] })) expect(q.prompt).not.toMatch(/\.\./);
  });
});
