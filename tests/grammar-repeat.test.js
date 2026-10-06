// A grammar rule isn't asked again right after it was read (reports: "grammar
// sentence repeated many times"). A rule with one question used to come back
// in every round; now it sits out for SEEN_FRESH_HOURS, like rules with several.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const CATEGORY = "Pet Peeves";
const base = V2.withoutRemovedFields(backup);
const one = { id: "g-one", category: CATEGORY, rule: "Test rule", prompt: "Which is right?", options: ["She has gone.", "She have gone."], answer: "She has gone.", explanation: "Has with she." };
const many = { id: "g-many", category: CATEGORY, rule: "Test rule 2", explanation: "x", questions: [
  { type: "choose", prompt: "Pick one: A or B?", options: ["A", "B"], answer: "A", explanation: "" },
  { type: "choose", prompt: "Pick two: C or D?", options: ["C", "D"], answer: "C", explanation: "" },
] };
const content = (grammar) => ({ ...base, grammar });
const round = (grammar, seen = {}, seed = 3) => V2.practice(content(grammar), {}, CATEGORY, seeded(seed), null, { questionsPerRound: 12, newWordsPerRound: 10, seen });
const grammarOf = (s) => s.queue.filter((q) => String(q.id).startsWith("grammar:"));

describe("grammar repetition", () => {
  it("a rule with one question is asked when it hasn't been read", () => {
    expect(grammarOf(round([one]))).toHaveLength(1);
  });

  it("…and sits the round out once it was read recently", () => {
    const seen = { [V2.sentence(one.prompt)]: Date.now() - 3600000 };
    expect(grammarOf(round([one], seen))).toHaveLength(0);
  });

  it("…and comes back after the window", () => {
    const seen = { [V2.sentence(one.prompt)]: Date.now() - (V2.SEEN_FRESH_HOURS + 1) * 3600000 };
    expect(grammarOf(round([one], seen))).toHaveLength(1);
  });

  it("a rule with several questions moves to one it hasn't read", () => {
    const seen = { [V2.sentence("Pick one: A or B?")]: Date.now() };
    const g = grammarOf(round([many], seen));
    expect(g).toHaveLength(1);
    expect(g[0].prompt).toBe("Pick two: C or D?");
  });
});
