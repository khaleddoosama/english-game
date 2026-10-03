// The Gateway course levels (A1.1, A1.2 … in an item's `level`) and their
// sessions (the item's `units`, as in the Anki tags): naming, order, the
// "By course level" groups, rounds narrowed to one level or session,
// Gateway levels turned into course levels on import, and warnings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { courseLevelGroups } from "../src/engine/data";
import { normalizeSettings } from "../src/engine/progress";
import { courseLevelWarnings } from "../src/features/data/transfer";
import { fromForm, toForm } from "../src/features/admin/editors/WordEditor.jsx";

const backup = JSON.parse(readFileSync(new URL("../word-hunter-backup.json", import.meta.url), "utf8"));
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

describe("course level names", () => {
  it("reads A1.2-style levels; a plain A1 – C2 is a difficulty, not a course level", () => {
    expect(V2.courseLevelOf({ level: "A1.2" })).toBe("A1.2");
    expect(V2.courseLevelOf({ level: " b1.1 " })).toBe("B1.1");
    expect(V2.courseLevelOf({ level: "A2.03" })).toBe("A2.3");
    for (const level of ["B1", "A1.0", "Level 4", "A1-2", "D1.1", "", null, undefined]) expect(V2.courseLevelOf({ level }), String(level)).toBeNull();
  });

  it("puts them in course order, and knows the Gateway number", () => {
    const ids = ["B1.1", "A1.3", "A2.1", "A1.2", "A1.10", "C1.1"];
    expect([...ids].sort((a, b) => V2.courseLevelRank(a) - V2.courseLevelRank(b))).toEqual(["A1.2", "A1.3", "A1.10", "A2.1", "B1.1", "C1.1"]);
    expect(["A1.2", "A1.3", "A2.1", "A2.2", "A2.3", "B1.1"].map(V2.gatewayLevel)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(V2.gatewayLevel("A1.4")).toBeNull();
    expect(V2.COURSE_LEVELS.slice(0, 4)).toEqual(["A1.1", "A1.2", "A1.3", "A2.1"]);
  });

  it("a Gateway level becomes its course level (Level-7 = A2.2)", () => {
    expect([3, 4, 5, 6, 7, 8, 9, 10].map(V2.courseLevelFromGateway)).toEqual(["A1.1", "A1.2", "A1.3", "A2.1", "A2.2", "A2.3", "B1.1", "B1.2"]);
    for (const v of ["Level-7", "level 7", "Gateway 7", "Gateway Level 7", "English::Gateway::Level-7", " a2.2 "]) expect(V2.normalizeLevel(v), v).toBe("A2.2");
    for (const v of ["B1", "", "Level-2", "Level-99", "7", 7, null]) expect(V2.normalizeLevel(v), String(v)).toBe(v);
  });

  it("new words come easier first, course levels included", () => {
    const ranks = ["A1.2", "A1", "B1.1", "A2.3", "B1", ""].map((level) => V2.difficultyRank({ level }));
    expect(ranks[1]).toBeLessThan(ranks[0]); // A1 < A1.2
    expect(ranks[0]).toBeLessThan(ranks[3]); // A1.2 < A2.3
    expect(ranks[3]).toBeLessThan(ranks[2]); // A2.3 < B1.1
  });
});

describe("the By course level groups", () => {
  const w = (word, level, units, category = "Food") => ({ word, category, meaning: "m", level, ...(units ? { units } : {}) });
  const words = [w("Apple", "A1.2", ["Feelings-and-Emotions"]), w("Bread", "A1.2", ["Daily-Life"], "Kitchen"), w("Cheese", "A1.2"), w("Dog", "A2.1", ["Pets"]), w("Egg", "B1"), w("Fork"), w("Grape", "A1.2", ["Daily-Life", "Feelings-and-Emotions"])];
  const grammar = [{ id: "g1", rule: "Going to", level: "A1.2", units: ["Daily-Life"] }, { id: "g2", rule: "Past", level: "B2" }];

  it("one group per level in course order, split into its sessions; the rest apart", () => {
    const { levels, none } = courseLevelGroups(words, grammar);
    expect(levels.map((l) => [l.id, l.gateway])).toEqual([["A1.2", 4], ["A2.1", 6]]);
    const a12 = levels[0];
    // Sessions in the order they first appear; a word in two sessions is in both.
    expect(a12.sessions.map((s) => [s.title, s.items.map((it) => it.obj.word || it.obj.id)])).toEqual([["Feelings and Emotions", ["Apple", "Grape"]], ["Daily Life", ["Bread", "Grape", "g1"]]]);
    expect(a12.sessions[0].unit).toBe("Feelings-and-Emotions");
    expect(a12.unsorted.map((it) => it.obj.word)).toEqual(["Cheese"]);
    expect(none.map((it) => it.obj.word)).toEqual(["Egg", "Fork"]); // words only: a difficulty level isn't a course level
  });
});

describe("a round for one course level or session", () => {
  // Real words from the backup, from different lessons, given course levels.
  const pick = (category, n) => backup.words.filter((x) => x.category === category && x.gap && x.situation).slice(0, n);
  const s1 = [...pick("Pet Peeves", 5), ...pick("Media", 4)].map((x) => ({ ...x, level: "A1.2", units: ["Memories-and-Fear"] }));
  const s2 = pick("Marketing", 6).map((x) => ({ ...x, level: "A1.2", units: ["Goals-and-Dreams"] }));
  const other = pick("Hobbies", 6).map((x) => ({ ...x, level: "A2.1" }));
  const tagged = new Set([...s1, ...s2, ...other].map((x) => x.word));
  const content = V2.withoutRemovedFields({ ...backup, words: [...backup.words.filter((x) => !tagged.has(x.word)), ...s1, ...s2, ...other] });
  const targetsOf = (session) => new Set(session.queue.flatMap((q) => q.targets || []));
  const opts = { questionsPerRound: 12, newWordsPerRound: 10 };

  it("one session: only its words, from every lesson", () => {
    const round = V2.practice(content, {}, null, seeded(), null, { ...opts, courseLevel: "A1.2", unit: "Memories-and-Fear" });
    expect(round.queue.length).toBeGreaterThan(0);
    const allowed = new Set(s1.map((x) => x.word));
    for (const t of targetsOf(round)) expect(allowed.has(t), t).toBe(true);
    expect(new Set(round.introductions.map((x) => x.word || x)).size).toBeGreaterThan(0);
  });

  it("the whole level: any of its sessions, nothing from another level", () => {
    const round = V2.practice(content, {}, null, seeded(3), null, { ...opts, courseLevel: "A1.2" });
    const allowed = new Set([...s1, ...s2].map((x) => x.word));
    for (const t of targetsOf(round)) expect(allowed.has(t), t).toBe(true);
  });

  it("no course level: only words without one", () => {
    const round = V2.practice(content, {}, null, seeded(5), null, { ...opts, noCourseLevel: true });
    for (const t of targetsOf(round)) expect(tagged.has(t), t).toBe(false);
  });

  it("grammar rules join only their own level's rounds", () => {
    const rule = (content.grammar || []).find((g) => V2.grammarQuestions(g).length);
    const withRule = { ...content, grammar: [{ ...rule, level: "A1.2", units: ["Memories-and-Fear"] }] };
    const mastery = Object.fromEntries(s1.map((x) => [x.word, { total: 3, correct: 3, modes: { meaning: { total: 3, correct: 3 } } }]));
    const inLevel = V2.practice(withRule, mastery, null, seeded(9), null, { ...opts, courseLevel: "A1.2", unit: "Memories-and-Fear" });
    expect(inLevel.queue.some((q) => q.progressKey === `grammar:${rule.id}`)).toBe(true);
    const elsewhere = V2.practice(withRule, mastery, null, seeded(9), null, { ...opts, courseLevel: "A2.1" });
    expect(elsewhere.queue.some((q) => q.progressKey === `grammar:${rule.id}`)).toBe(false);
  });
});

describe("editing and importing", () => {
  it("the word editor keeps the course level and the sessions (units)", () => {
    const word = { word: "Fork", type: "vocab", category: "Kitchen", meaning: "a tool", level: "A2.2", units: ["Memories-and-Fear"] };
    const form = toForm(word);
    expect(form).toMatchObject({ level: "A2.2", units: "Memories-and-Fear" });
    expect(fromForm({ ...form, units: "Memories-and-Fear, Fears" }, word)).toMatchObject({ level: "A2.2", units: ["Memories-and-Fear", "Fears"] });
  });

  it("an import turns Gateway levels into course levels, and says which levels it can't read", async () => {
    const { inspectImport } = await import("../src/features/data/transfer");
    const word = (w, level) => ({ word: w, type: "vocab", category: "Emotions Psychology", meaning: "m", situation: `A sentence about ${w}.`, gap: "A ______ here.", hints: ["h"], level, units: ["Memories-and-Fear"] });
    const check = inspectImport(JSON.stringify({ words: [word("Deja vu", "Level-7"), word("Nostalgia", "English::Gateway::Level-7"), word("Shiver", "A2.2"), word("Amnesia", "B1"), word("Recall", "Lvl seven")] }), { words: [] });
    const levels = Object.fromEntries((await import("../src/engine/v2")).V2.prepareImport(check.raw, { words: [] }).data.words.map((w) => [w.word, w.level]));
    expect(levels).toEqual({ "Deja vu": "A2.2", Nostalgia: "A2.2", Shiver: "A2.2", Amnesia: "B1", Recall: "Lvl seven" });
    expect(check.warnings.filter((x) => /course level/.test(x))).toEqual([expect.stringMatching(/level "Lvl seven" \(1 item\)/)]);
    expect(courseLevelWarnings([{ level: "Level-4" }, { level: "B1" }, { level: "A1.2" }])).toEqual([]);
  });

  it("the home layout can be By course level", () => {
    expect(normalizeSettings({ levelView: "course" }).levelView).toBe("course");
    expect(normalizeSettings({ levelView: "nonsense" }).levelView).toBe("lesson");
  });
});
