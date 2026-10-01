import { describe, expect, it } from "vitest";
import { fromForm, sameItem, toForm, wordProblems } from "../src/features/admin/editors/WordEditor.jsx";
import backup from "../word-hunter-backup.json";

describe("word editor form", () => {
  it("opening and saving an untouched word changes nothing (all real words)", () => {
    const changed = backup.words.filter((w) => !sameItem(fromForm(toForm(w), w), w));
    expect(changed.map((w) => w.word)).toEqual([]);
  });
  it("edits only what changed", () => {
    const w = { word: "Fork", meaning: "a tool", situation: "Use a fork.", gap: "Pass the ___.", hints: ["eat"], category: "Kitchen", extra: { keep: true } };
    const f = toForm(w);
    const out = fromForm({ ...f, meaning: "a tool for eating", hints: "eat\nkitchen" }, w);
    expect(out).toMatchObject({ meaning: "a tool for eating", hints: ["eat", "kitchen"], extra: { keep: true }, situation: "Use a fork." });
    expect(out.situations).toBeUndefined(); // still one sentence
  });
  it("adds lists when there is more than one sentence", () => {
    const out = fromForm({ ...toForm({ word: "x", category: "c" }), situations: "One.\nTwo.", gaps: "a ___ b\nc ___ d" }, {});
    expect(out).toMatchObject({ situation: "One.", situations: ["One.", "Two."], gap: "a ___ b", gaps: ["a ___ b", "c ___ d"] });
  });
  it("reads word family lines and comma lists", () => {
    const out = fromForm({ ...toForm({ word: "x", category: "c" }), wordFamily: "noun: happiness\nhappily", synonyms: "glad, joyful,", partsOfSpeech: "adjective" }, {});
    expect(out.wordFamily).toEqual([{ pos: "noun", word: "happiness" }, { word: "happily" }]);
    expect(out.synonyms).toEqual(["glad", "joyful"]);
  });
  it("can clear a field", () => {
    const w = { word: "x", category: "c", hints: ["a"], opposite: "y" };
    const out = fromForm({ ...toForm(w), hints: "", opposite: "" }, w);
    expect(out.hints).toEqual([]);
    expect("opposite" in out).toBe(false);
  });
  it("catches problems before saving", () => {
    const all = [{ word: "Fork" }];
    expect(wordProblems({ word: "fork", category: "c" }, all, null)[0]).toMatch(/already exists/);
    expect(wordProblems({ word: "Spoon", category: "" }, all, null)[0]).toMatch(/category/);
    expect(wordProblems({ word: "Spoon", category: "c", meaning: "ملعقة" }, all, null)[0]).toMatch(/English only/);
    expect(wordProblems({ word: "Spoon", category: "c", gap: "no blank" }, all, null)[0]).toMatch(/blank/);
    expect(wordProblems({ word: "Fork", category: "c" }, all, all[0])).toEqual([]); // editing itself is fine
  });
});
