// A practice round from a personal view: only the view's words and rules are
// asked, but the wrong answers still come from the whole dictionary.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { scopeFromContents, scopedLists, scopeIsEmpty } from "../src/features/library/scope.js";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const content = V2.withoutRemovedFields(backup);
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = content.words.filter((w) => w.category === "Pet Peeves").slice(0, 6).map((w) => w.word);
const rule = { id: "g-scope-1", category: "Elsewhere", rule: "R", prompt: "Pick: ______", options: ["a", "b", "c", "d"], answer: "a", explanation: "x" };
const other = { ...rule, id: "g-scope-2", prompt: "Other: ______" };
const withRules = { ...content, grammar: [...(content.grammar || []), rule, other] };
const run = (scope, extra = {}) => V2.practice(withRules, {}, null, seeded(3), null, { questionsPerRound: 12, newWordsPerRound: 10, scope, ...extra });

describe("scope", () => {
  it("builds from the view's rows", () => {
    const s = scopeFromContents([{ kind: "sense", id: "A" }, { kind: "rule", id: "g1" }, { kind: "sense", id: "B" }]);
    expect([...s.words]).toEqual(["A", "B"]);
    expect([...s.rules]).toEqual(["g1"]);
    expect(scopeIsEmpty(scopeFromContents([]))).toBe(true);
    expect([...scopeFromContents([{ kind: "sense", id: 1 }], { resolveKey: (id) => `k${id}` }).words]).toEqual(["k1"]);
  });
});

describe("a round from a view", () => {
  it("asks only the view's words, and only its rules, whatever lesson they come from", () => {
    const scope = scopeFromContents([...pick.map((id) => ({ kind: "sense", id })), { kind: "rule", id: rule.id }]);
    const s = run(scope);
    const targets = new Set(s.queue.flatMap((q) => q.targets));
    for (const t of targets) expect(pick).toContain(t);
    expect(s.introductions.every((w) => pick.includes(w.word))).toBe(true);
    const grammar = s.queue.filter((q) => String(q.id).startsWith("grammar:"));
    expect(grammar.length).toBeLessThanOrEqual(2);
    for (const g of grammar) expect(g.id).toContain(rule.id);
  });

  it("wrong answers still come from the whole dictionary, so a small view is not easy", () => {
    const scope = scopeFromContents(pick.slice(0, 2).map((id) => ({ kind: "sense", id })));
    const s = run(scope);
    const options = s.queue.filter((q) => q.type === "mcq" && q.targets.length).flatMap((q) => q.options);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => !pick.slice(0, 2).includes(o))).toBe(true);
  });

  it("a view of rules only is a grammar round", () => {
    const s = run({ words: new Set(), rules: new Set([rule.id, other.id]) });
    expect(s.queue).toHaveLength(2);
    expect(s.queue.every((q) => q.mode === "grammarChoose")).toBe(true);
  });

  it("an empty view asks nothing", () => {
    expect(run({ words: new Set(), rules: new Set() }).queue).toHaveLength(0);
  });

  it("no scope behaves as before", () => {
    expect(run(null).queue.length).toBeGreaterThan(2);
  });

  it("plain lists for Live", () => {
    const scope = { words: new Set(pick.slice(0, 3)), rules: new Set([rule.id]) };
    const l = scopedLists(withRules, scope);
    expect(l.words.map((w) => w.word).sort()).toEqual([...pick.slice(0, 3)].sort());
    expect(l.grammar.map((g) => g.id)).toEqual([rule.id]);
  });
});
