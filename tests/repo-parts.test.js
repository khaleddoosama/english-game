// The pure parts of the repo (src/lib/repo/*): what a content save sends, how
// progress is split into saved sections, what changed in mastery, how an
// unsaved device copy and the reports table are merged, paging, the status.
import { describe, expect, it, vi } from "vitest";
import { CONTENT_KINDS, contentFromCache, emptyContent, hasContent, planContentSave } from "../src/lib/repo/contentPlan.js";
import { fetchAll } from "../src/lib/repo/fetchAll.js";
import { SECTION_OF, hasServerRows, masteryDiff, profileSummary, splitSections, weekStart } from "../src/lib/repo/progressShape.js";
import { reconcileReports } from "../src/lib/repo/reportsMerge.js";
import { createStatusHub } from "../src/lib/repo/status.js";
import { mergeUnsynced } from "../src/lib/repo/unsyncedMerge.js";
import { stableJson } from "../src/lib/stableJson.js";

const row = (kind, key, position, data = { id: key, word: key }) => [`${kind}\u0000${key}`, { kind, key, json: stableJson(data), position }];
const rows = (...entries) => new Map(entries.map((e) => row(...e)));
const NO_META = { levelOrder: "[]", note: "" };

describe("content: what a save sends", () => {
  it("everything is new on the first save, in order, with gaps between positions", () => {
    const plan = planContentSave({ words: [{ word: "A" }, { word: "B" }, { word: "C" }], grammar: [{ id: "g1" }] }, new Map(), NO_META);
    expect(plan.upserts.map((u) => [u.kind, u.key, u.position])).toEqual([["words", "A", 0], ["words", "B", 1000], ["words", "C", 2000], ["grammar", "g1", 0]]);
    expect(plan.removes).toEqual([]);
    expect(plan.metaChanged).toBe(false);
  });

  it("an unchanged item at its place sends nothing; a changed one sends one row, keeping its position", () => {
    const stored = rows(["words", "A", 0, { word: "A" }], ["words", "B", 1000, { word: "B" }]);
    expect(planContentSave({ words: [{ word: "A" }, { word: "B" }] }, stored, NO_META).upserts).toEqual([]);
    const plan = planContentSave({ words: [{ word: "A" }, { word: "B", meaning: "edited" }] }, stored, NO_META);
    expect(plan.upserts.map((u) => [u.key, u.position])).toEqual([["B", 1000]]);
  });

  it("a new item between two old ones takes a position between them, and nothing else is renumbered", () => {
    const stored = rows(["words", "A", 0, { word: "A" }], ["words", "C", 1000, { word: "C" }]);
    const plan = planContentSave({ words: [{ word: "A" }, { word: "B" }, { word: "C" }] }, stored, NO_META);
    expect(plan.upserts.map((u) => [u.key, u.position])).toEqual([["B", 500]]);
  });

  it("an item added at the front goes before the first", () => {
    const stored = rows(["words", "B", 1000, { word: "B" }]);
    const plan = planContentSave({ words: [{ word: "A" }, { word: "B" }] }, stored, NO_META);
    expect(plan.upserts.map((u) => u.position)).toEqual([0]);                // halfway between -1000 and the first one
  });

  it("an item taken out becomes a removal; the same key twice, or no key, is skipped", () => {
    const stored = rows(["words", "A", 0, { word: "A" }], ["words", "B", 1000, { word: "B" }]);
    const plan = planContentSave({ words: [{ word: "A" }, { word: "A" }, {}, { word: "" }] }, stored, NO_META);
    expect(plan.removes).toEqual([{ kind: "words", key: "B" }]);
    expect(plan.upserts).toEqual([]);
  });

  it("the level order and the note count as a change when they differ from what the server has", () => {
    expect(planContentSave({ levelOrder: ["X"] }, new Map(), NO_META)).toMatchObject({ metaChanged: true, levelOrder: ["X"] });
    expect(planContentSave({ note: "n" }, new Map(), NO_META)).toMatchObject({ metaChanged: true, note: "n" });
    expect(planContentSave({}, new Map(), NO_META).metaChanged).toBe(false);
  });

  it("the kinds, the empty content and 'has content'", () => {
    expect(CONTENT_KINDS).toEqual(["words", "grammar", "challenges", "stories", "combos"]);
    expect(hasContent(emptyContent())).toBe(false);
    expect(hasContent(null)).toBe(false);
    expect(hasContent({ ...emptyContent(), combos: [{ id: "c" }] })).toBe(true);
  });

  it("the cache gives the content back in stored order (ties by key)", () => {
    const cache = { items: { a: { kind: "words", key: "B", position: 5, data: { word: "B" } }, b: { kind: "words", key: "A", position: 5, data: { word: "A" } }, c: { kind: "grammar", key: "g", position: 0, data: { id: "g" } } }, levelOrder: ["L"], note: "hi" };
    expect(contentFromCache(cache)).toEqual({ ...emptyContent(), words: [{ word: "A" }, { word: "B" }], grammar: [{ id: "g" }], levelOrder: ["L"], note: "hi" });
  });
});

describe("progress: sections and changes", () => {
  it("fields go to their section, the rest to core; mastery and content never do", () => {
    const out = splitSections({ score: 1, pools: { a: 1 }, sessionLogs: [1], completedSessions: ["s"], levelStats: {}, reports: [], mastery: { w: {} }, words: [{}], note: "x", undefined: undefined, gone: undefined });
    expect(out).toEqual({ core: { score: 1 }, pools: { pools: { a: 1 } }, history: { sessionLogs: [1], completedSessions: ["s"] }, levels: { levelStats: {} }, reports: { reports: [] } });
    expect(SECTION_OF.seenSentences).toBe("seen");
    expect(splitSections(null)).toEqual({});
  });

  it("mastery: only records whose content changed are sent, and records that left are removed", () => {
    const a = { total: 1 }, b = { total: 2 };
    const refs = new Map([["A", a], ["B", b]]), json = new Map([["A", stableJson(a)], ["B", stableJson(b)], ["Old", "{}"]]);
    const same = { A: a, B: { total: 2 } };                               // B is a new object with the same content
    expect(masteryDiff(refs, json, same)).toEqual({ upserts: {}, removes: ["Old"] });
    expect(masteryDiff(refs, json, { A: a, B: { total: 3 }, C: { total: 1 } })).toEqual({ upserts: { B: { total: 3 }, C: { total: 1 } }, removes: ["Old"] });
    expect(masteryDiff(new Map(), new Map(), null)).toEqual({ upserts: {}, removes: [] });
  });

  it("the week starts on Monday, local time", () => {
    expect(weekStart(new Date(2026, 2, 4))).toBe("2026-03-02");           // a Wednesday
    expect(weekStart(new Date(2026, 2, 8))).toBe("2026-03-02");           // the Sunday before the next Monday
    expect(weekStart(new Date(2026, 2, 9))).toBe("2026-03-09");
  });

  it("the profile summary counts mastered words only (not grammar, combos…), and gives this week", () => {
    const mastered = { everMastered: true, regressionStrikes: 0, correct: 9, total: 9 };
    const p = profileSummary({ mastery: { Word: mastered, "grammar:g1": mastered, Other: { total: 1 } } });
    expect(p.mastered_count).toBe(1);
    expect(p.week_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(profileSummary({}).mastered_count).toBe(0);
  });

  it("'the server has progress' means any section or mastery row", () => {
    expect([hasServerRows([], []), hasServerRows([1], []), hasServerRows([], [1])]).toEqual([false, true, true]);
  });
});

describe("a device copy that was never sent, against the server", () => {
  const snap = (data, revs, sections) => ({ data, dirty: true, base: { revs, sections } });
  it("a section the server has not changed since this copy's base keeps this device's values", () => {
    const out = mergeUnsynced(snap({ score: 150, mastery: { W: { total: 2 } } }, { core: 3 }, { core: stableJson({ score: 100 }) }), { core: { score: 100 } }, {}, new Map([["core", 3]]));
    expect(out.score).toBe(150);
    expect(out.mastery.W.total).toBe(2);
  });
  it("a section another device changed is merged from the base: what each side added is counted", () => {
    const out = mergeUnsynced(snap({ score: 130 }, { core: 3 }, { core: stableJson({ score: 100 }) }), { core: { score: 150 } }, {}, new Map([["core", 4]]));
    expect(out.score).toBe(180);
  });
  it("a record both sides have: the one with more answers wins", () => {
    const out = mergeUnsynced(snap({ mastery: { W: { total: 2 } } }, {}, {}), {}, { W: { total: 5, correct: 5 } }, new Map());
    expect(out.mastery.W.total).toBe(5);
  });
  it("with no base at all, it still merges and does not fail", () => {
    expect(mergeUnsynced({ data: { score: 5, mastery: {} }, dirty: true }, { core: { score: 7 } }, {}, new Map()).score).toBe(7);
  });
});

describe("the player's reports against the reports table", () => {
  const dataRow = (id, extra = {}) => ({ id, data: { id, note: "n" }, resolved_at: null, ...extra });
  const R = (over) => reconcileReports({ local: [], sectionReports: [], rows: [], isAdmin: false, ...over });

  it("a report the table has comes back as the table has it (with the admin's decision), and is noted as saved", () => {
    const out = R({ local: [{ id: "r1", note: "n" }], sectionReports: [{ id: "r1", note: "n" }], rows: [dataRow("r1", { resolved_at: "2026-03-01T00:00:00Z" })] });
    expect(out.reports).toEqual([{ id: "r1", note: "n", resolvedAt: Date.parse("2026-03-01T00:00:00Z") }]);
    expect(out.saved.map(([id]) => id)).toEqual(["r1"]);
  });
  it("one only this device has was not sent yet: it stays; one the saved progress lists but the table lacks was deleted", () => {
    expect(R({ local: [{ id: "new" }] }).reports).toEqual([{ id: "new" }]);
    expect(R({ local: [{ id: "gone" }], sectionReports: [{ id: "gone" }] }).reports).toEqual([]);
  });
  it("a report with no id is kept as it is", () => {
    expect(R({ local: [{ note: "x" }] }).reports).toEqual([{ note: "x" }]);
  });
  it("changed here since the last save: a player keeps the text but takes the admin's decision; the admin keeps theirs", () => {
    const local = [{ id: "r1", note: "edited here" }];
    const base = { sectionReports: [{ id: "r1", note: "n" }], rows: [dataRow("r1", { resolved_at: "2026-03-01T00:00:00Z" })] };
    expect(R({ local, ...base }).reports[0]).toEqual({ id: "r1", note: "edited here", resolvedAt: Date.parse("2026-03-01T00:00:00Z") });
    expect(R({ local, ...base, isAdmin: true }).reports[0]).toEqual({ id: "r1", note: "edited here" });
  });
  it("it remembers nothing itself: the same call twice gives the same answer", () => {
    const args = { local: [{ id: "r1" }], sectionReports: [{ id: "r1" }], rows: [dataRow("r1")] };
    expect(R(args)).toEqual(R(args));
  });
});

describe("paging", () => {
  const source = (n) => () => { const calls = []; const build = () => ({ range: async (a, b) => { calls.push([a, b]); return { data: Array.from({ length: Math.max(0, Math.min(n, b + 1) - a) }, (_, i) => a + i), error: null }; } }); return { build, calls }; };
  it("reads page after page until a short one", async () => {
    const { build, calls } = source(2500)();
    expect(await fetchAll(build)).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("exactly one full page ends with one more empty request", async () => {
    const { build, calls } = source(1000)();
    expect(await fetchAll(build)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
  it("an error stops it", async () => {
    await expect(fetchAll(() => ({ range: async () => ({ data: null, error: new Error("boom") }) }))).rejects.toThrow("boom");
  });
});

describe("the saving status", () => {
  it("tells each listener at once and on every change, and only on a change", () => {
    const hub = createStatusHub();
    const seen = []; const off = hub.subscribe((s) => seen.push(s));
    hub.set("saving"); hub.set("saving"); hub.set("saved");
    off(); hub.set("error");
    expect(seen).toEqual(["idle", "saving", "saved"]);
    expect(hub.get()).toBe("error");
  });
  it("a listener that throws does not stop the others", () => {
    const hub = createStatusHub();
    const ok = vi.fn();
    hub.subscribe(ok);
    expect(() => hub.set("saving")).not.toThrow();
    expect(ok).toHaveBeenLastCalledWith("saving");
  });
});
