// Study Dashboard numbers: stages and accuracy, the last 14 days from the
// round log, question types, weak words, mix-ups and the level filters.
import { describe, expect, it } from "vitest";
import { localDateKey } from "../src/engine/data";
import { filterLevels, lastDays, studyStats } from "../src/features/stats/studyStats";

const word = (w, category = "Food") => ({ kind: "word", obj: { word: w, category, meaning: "m", situation: "s", gap: "___", hints: ["h"] } });
const levels = [
  { id: "cat-Food", title: "Food", items: [word("Apple"), word("Bread"), word("Cheese")] },
  { id: "cat-Work", title: "Work", items: [word("Boss", "Work"), { kind: "grammar", obj: { id: "g1", rule: "Used to" } }] },
  { id: "cat-Empty", title: "Empty", items: [] },
];
const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const DAY = 86400000;

describe("studyStats", () => {
  it("an empty game gives zeros, not errors", () => {
    const s = studyStats({ now: NOW });
    expect(s.items).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.activity).toHaveLength(14);
    expect(s.weak).toEqual([]);
    expect(s.modes).toEqual([]);
  });

  it("counts stages, practised items and accuracy", () => {
    const mastery = { Apple: { total: 4, correct: 3 }, Bread: { total: 2, correct: 0 }, "grammar:g1": { total: 1, correct: 1 } };
    const s = studyStats({ levels, mastery, now: NOW });
    expect(s.items).toBe(5);
    expect(s.practised).toBe(3);
    expect(s.answers).toBe(7);
    expect(s.accuracy).toBeCloseTo(4 / 7);
    expect(Object.values(s.stages).reduce((a, b) => a + b, 0)).toBe(5);
    expect(s.stages.New).toBeGreaterThanOrEqual(2); // Bread (none right) and Cheese, Boss (never tried)
  });

  it("an item in two levels counts once in the totals", () => {
    const twice = [levels[0], { id: "cat-Again", title: "Again", items: [word("Apple")] }];
    const s = studyStats({ levels: twice, mastery: { Apple: { total: 2, correct: 2 } }, now: NOW });
    expect(s.items).toBe(3);
    expect(s.answers).toBe(2);
    expect(s.levels[1].answers).toBe(2);
  });

  it("levels have a status, stars and their items", () => {
    const s = studyStats({ levels, mastery: { Apple: { total: 1, correct: 1 } }, levelStats: { "cat-Food": { stars: 2, bestAccuracy: 90 } }, now: NOW });
    const [food, work, empty] = s.levels;
    expect(food).toMatchObject({ status: "started", stars: 2, bestAccuracy: 90, total: 3, practised: 1 });
    expect(work.status).toBe("new");
    expect(empty.status).toBe("new");
    expect(work.items.map((r) => r.name)).toEqual(["Boss", "Used to"]);
    expect(work.items[1].kind).toBe("grammar");
  });

  it("the last 14 days come from the round log; older rounds are left out", () => {
    const logs = [
      { at: NOW, correct: 8, total: 10 },
      { at: NOW - 1000, correct: 2, total: 2 },
      { at: NOW - 3 * DAY, correct: 5, total: 12 },
      { at: NOW - 20 * DAY, correct: 9, total: 9 },
    ];
    const s = studyStats({ sessionLogs: logs, now: NOW });
    const today = s.activity.at(-1);
    expect(today).toMatchObject({ day: localDateKey(new Date(NOW)), rounds: 2, answered: 12, correct: 10 });
    expect(s.activity.find((d) => d.day === localDateKey(new Date(NOW - 3 * DAY))).answered).toBe(12);
    expect(s.activeDays).toBe(2);
    expect(s.week).toMatchObject({ answered: 24, rounds: 3, prevAnswered: 0 });
  });

  it("lastDays ends today and has no gaps", () => {
    const d = lastDays(7, NOW);
    expect(d).toHaveLength(7);
    expect(d.at(-1)).toBe(localDateKey(new Date(NOW)));
    expect(new Set(d).size).toBe(7);
  });

  it("question types: words only, most answered first, with labels", () => {
    const mastery = {
      Apple: { total: 5, correct: 4, modes: { gap: { total: 3, correct: 3 }, meaning: { total: 2, correct: 1 } } },
      Bread: { total: 4, correct: 1, modes: { gap: { total: 4, correct: 1 } } },
      "grammar:g1": { total: 9, correct: 9, modes: { gap: { total: 9, correct: 9 } } },
    };
    const s = studyStats({ levels, mastery, now: NOW });
    expect(s.modes.map((m) => m.id)).toEqual(["gap", "meaning"]);
    expect(s.modes[0]).toMatchObject({ total: 7, correct: 4, label: "Fill the Gap" });
  });

  it("weak words: tried at least twice, under 75%, worst first", () => {
    const mastery = { Apple: { total: 4, correct: 1 }, Bread: { total: 2, correct: 1 }, Cheese: { total: 1, correct: 0 }, Boss: { total: 8, correct: 7 } };
    const s = studyStats({ levels, mastery, now: NOW });
    expect(s.weak.map((w) => w.name)).toEqual(["Apple", "Bread"]);
    expect(s.weak[0].level).toBe("Food");
  });

  it("mix-ups: the most frequent pairs, ignoring empty or broken ones", () => {
    const confusions = { "Apple|Bread": { count: 3 }, "Boss|Cheese": 5, "Odd": 4, "A|B": null };
    const s = studyStats({ confusions, now: NOW });
    expect(s.mixups).toEqual([{ pair: ["Boss", "Cheese"], count: 5 }, { pair: ["Apple", "Bread"], count: 3 }]);
  });
});

describe("filterLevels", () => {
  const s = studyStats({ levels, mastery: { Apple: { total: 1, correct: 1 } }, now: NOW });
  it("by status", () => {
    expect(filterLevels(s.levels, "started").map((l) => l.title)).toEqual(["Food"]);
    expect(filterLevels(s.levels, "new").map((l) => l.title)).toEqual(["Work", "Empty"]);
    expect(filterLevels(s.levels, "").length).toBe(3);
  });
  it("by a word or level name, keeping the matching items", () => {
    const hit = filterLevels(s.levels, "", "chee");
    expect(hit.map((l) => l.title)).toEqual(["Food"]);
    expect(hit[0].matches.map((r) => r.name)).toEqual(["Cheese"]);
    expect(filterLevels(s.levels, "", "work").map((l) => l.title)).toEqual(["Work"]);
    expect(filterLevels(s.levels, "", "zzz")).toEqual([]);
  });
});
