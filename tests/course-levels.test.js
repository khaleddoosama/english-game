// The Gateway course levels (A1.1, A1.2 … in an item's `level`) and their
// sessions: naming, order, the "By course level" groups, rounds narrowed
// to one level or session, editor fields and import warnings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { courseLevelGroups } from "../src/engine/data";
import { normalizeSettings } from "../src/engine/progress";
import { courseLevelWarnings } from "../src/features/data/transfer";
import { fromForm, toForm } from "../src/features/admin/editors/WordEditor.jsx";
import { cleanGrammarDraft } from "../src/features/admin/editors/grammarRules";

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

  it("sessions are class numbers", () => {
    expect([3, "4", " 5 "].map((session) => V2.sessionOf({ session }))).toEqual([3, 4, 5]);
    for (const session of [0, -1, 2.5, "three", null, undefined]) expect(V2.sessionOf({ session }), String(session)).toBeNull();
  });

  it("new words come easier first, course levels included", () => {
    const ranks = ["A1.2", "A1", "B1.1", "A2.3", "B1", ""].map((level) => V2.difficultyRank({ level }));
    expect(ranks[1]).toBeLessThan(ranks[0]); // A1 < A1.2
    expect(ranks[0]).toBeLessThan(ranks[3]); // A1.2 < A2.3
    expect(ranks[3]).toBeLessThan(ranks[2]); // A2.3 < B1.1
  });
});

describe("the By course level groups", () => {
  const w = (word, level, session, category = "Food") => ({ word, category, meaning: "m", level, ...(session != null ? { session } : {}) });
  const words = [w("Apple", "A1.2", 2), w("Bread", "A1.2", 1, "Kitchen"), w("Cheese", "A1.2"), w("Dog", "A2.1", 1), w("Egg", "B1"), w("Fork")];
  const grammar = [{ id: "g1", rule: "Going to", level: "A1.2", session: 1 }, { id: "g2", rule: "Past", level: "B2" }];

  it("one group per level in course order, split into sessions; the rest apart", () => {
    const { levels, none } = courseLevelGroups(words, grammar);
    expect(levels.map((l) => [l.id, l.gateway])).toEqual([["A1.2", 4], ["A2.1", 6]]);
    const a12 = levels[0];
    expect(a12.sessions.map((s) => [s.title, s.items.map((it) => it.obj.word || it.obj.id)])).toEqual([["Session 1", ["Bread", "g1"]], ["Session 2", ["Apple"]]]);
    expect(a12.unsorted.map((it) => it.obj.word)).toEqual(["Cheese"]);
    expect(none.map((it) => it.obj.word)).toEqual(["Egg", "Fork"]); // words only: a difficulty level isn't a course level
  });
});

describe("a round for one course level or session", () => {
  // Real words from the backup, from different lessons, given course levels.
  const pick = (category, n) => backup.words.filter((x) => x.category === category && x.gap && x.situation).slice(0, n);
  const s1 = [...pick("Pet Peeves", 5), ...pick("Media", 4)].map((x) => ({ ...x, level: "A1.2", session: 1 }));
  const s2 = pick("Marketing", 6).map((x) => ({ ...x, level: "A1.2", session: 2 }));
  const other = pick("Hobbies", 6).map((x) => ({ ...x, level: "A2.1" }));
  const tagged = new Set([...s1, ...s2, ...other].map((x) => x.word));
  const content = V2.withoutRemovedFields({ ...backup, words: [...backup.words.filter((x) => !tagged.has(x.word)), ...s1, ...s2, ...other] });
  const targetsOf = (session) => new Set(session.queue.flatMap((q) => q.targets || []));
  const opts = { questionsPerRound: 12, newWordsPerRound: 10 };

  it("one session: only its words, from every lesson", () => {
    const round = V2.practice(content, {}, null, seeded(), null, { ...opts, courseLevel: "A1.2", session: 1 });
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
    const withRule = { ...content, grammar: [{ ...rule, level: "A1.2", session: 1 }] };
    const mastery = Object.fromEntries(s1.map((x) => [x.word, { total: 3, correct: 3, modes: { meaning: { total: 3, correct: 3 } } }]));
    const inLevel = V2.practice(withRule, mastery, null, seeded(9), null, { ...opts, courseLevel: "A1.2", session: 1 });
    expect(inLevel.queue.some((q) => q.progressKey === `grammar:${rule.id}`)).toBe(true);
    const elsewhere = V2.practice(withRule, mastery, null, seeded(9), null, { ...opts, courseLevel: "A2.1" });
    expect(elsewhere.queue.some((q) => q.progressKey === `grammar:${rule.id}`)).toBe(false);
  });
});

describe("editing and importing", () => {
  it("the word editor keeps the course level and the session", () => {
    const word = { word: "Fork", type: "vocab", category: "Kitchen", meaning: "a tool", level: "A1.2", session: 3 };
    const form = toForm(word);
    expect(form).toMatchObject({ level: "A1.2", session: "3" });
    expect(fromForm({ ...form, session: "4" }, word)).toMatchObject({ level: "A1.2", session: 4 });
    expect(fromForm({ ...form, session: "" }, word).session).toBeUndefined();
    expect(fromForm({ ...form, session: "x" }, word).session).toBeUndefined();
  });

  it("the grammar editor keeps the session as a number", () => {
    const base = { id: "g", rule: "r", category: "c", level: "A2.1", explanation: "e", examples: [], commonMistakes: [], questions: [] };
    expect(cleanGrammarDraft({ ...base, session: "2" })).toMatchObject({ level: "A2.1", session: 2 });
    expect(cleanGrammarDraft({ ...base, session: "" })).not.toHaveProperty("session");
  });

  it("an import says which levels or sessions won't show in By course level", () => {
    const warnings = courseLevelWarnings([
      { word: "a", level: "A1.2", session: 1 }, { word: "b", level: "B1" }, { word: "c", level: "Level 4" }, { word: "d", level: "Level 4" },
      { word: "e", level: "A1.2", session: "three" }, { word: "f", session: 2 },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/level "Level 4" \(2 items\).*A1\.2/);
    expect(warnings[1]).toMatch(/session "three"/);
    expect(warnings[2]).toMatch(/1 item has a session but no course level/);
  });

  it("the home layout can be By course level", () => {
    expect(normalizeSettings({ levelView: "course" }).levelView).toBe("course");
    expect(normalizeSettings({ levelView: "nonsense" }).levelView).toBe("lesson");
  });
});
