// @vitest-environment jsdom
// The question-reports hook: what each operation does to the list, to progressExtrasRef (the copy that is saved with
// the progress) and to the rest of the game, with the AI review mocked. The pure rules: question-reports-rules.test.js.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/aiPrompts", async (original) => ({ ...(await original()), reviewReportedQuestion: vi.fn(), locateReportSource: vi.fn(() => "source") }));

import { reviewReportedQuestion, locateReportSource } from "../src/lib/aiPrompts";
import { gameContent, setGameContent } from "../src/features/content";
import { getWordPools } from "../src/engine/questions";
import { useQuestionReports } from "../src/features/reports";

let root, host, api, env;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  env = {
    gameContent,
    progressExtrasRef: { current: { seenSentences: { a: 1 }, reports: [] } }, profile: { id: "u1", username: "ann" },
    liveContent: vi.fn(() => ({ words: [] })), markSentencesSeen: vi.fn(), touchSession: vi.fn(),
    poolsRef: { current: {} }, setPools: vi.fn(), triggerGeneration: vi.fn(),
  };
  vi.mocked(reviewReportedQuestion).mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function Probe() { api = useQuestionReports(env); return null; }
const mount = () => act(async () => root.render(<Probe />));
const q = { id: "q1", mode: "gap", prompt: "She ____ it", targets: ["Alpha"], answers: ["did"], poolType: "gap", poolItemId: "pool-1" };
const session = { id: "s1", queue: [1] };
const file = async (over = {}) => { let r; await act(async () => { r = api.report({ ...q, ...over }, session, "Typo", "x", "note"); }); return r; };

describe("filing a report", () => {
  it("the question counts as read, the report is in the list, and the same list is what is saved with the progress", async () => {
    await mount();
    const r = await file();
    expect(env.markSentencesSeen).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }));
    expect(api.reports).toEqual([r]);
    expect(env.progressExtrasRef.current.reports).toEqual([r]);
    expect(env.progressExtrasRef.current.seenSentences).toEqual({ a: 1 });          // the rest of what is saved is kept
    expect(r.reporter).toEqual({ id: "u1", username: "ann" });
  });
  it("an unresolved report holds its (word, mode) back from the question choosers", async () => {
    await mount();
    await file();
    expect([...api.quarantine]).toEqual(["alpha|gap"]);
  });
  it("many resolved reports are cut to 150 as new ones come in; unresolved ones are never cut", async () => {
    env.progressExtrasRef.current.reports = [...Array.from({ length: 160 }, (_, i) => ({ id: `d${i}`, resolvedAt: 1, targetWords: [] })), { id: "keep", resolvedAt: null }];
    await mount();
    await file();
    const list = env.progressExtrasRef.current.reports;
    expect(list.filter((r) => r.resolvedAt)).toHaveLength(150);
    expect(list.map((r) => r.id)).toContain("keep");
    expect(api.reports).toEqual(list);
  });
});

describe("the AI review", () => {
  it("the report is looked up in the content as it is now, the review is stored on it, and returned", async () => {
    await mount();
    const r = await file();
    vi.mocked(reviewReportedQuestion).mockResolvedValue({ verdict: "fine" });
    let out;
    await act(async () => { out = await api.review(r, { force: true }); });
    expect(locateReportSource).toHaveBeenCalledWith({ words: [] }, r);
    expect(reviewReportedQuestion).toHaveBeenCalledWith(r, "source", { force: true });
    expect(out).toEqual({ verdict: "fine" });
    expect(api.reports[0].aiReview).toEqual({ verdict: "fine" });
    expect(env.progressExtrasRef.current.reports[0].aiReview).toEqual({ verdict: "fine" });
  });
  it("when the AI fails, nothing is stored and the error reaches the caller (the learner sees 'Retry')", async () => {
    await mount();
    const r = await file();
    vi.mocked(reviewReportedQuestion).mockRejectedValue(new Error("Unavailable"));
    await act(async () => { await expect(api.review(r)).rejects.toThrow("Unavailable"); });
    expect(api.reports[0].aiReview).toBeUndefined();
  });
  it("a report deleted while the AI was thinking is not brought back", async () => {
    await mount();
    const r = await file();
    let finish; vi.mocked(reviewReportedQuestion).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    let pending; await act(async () => { pending = api.review(r); });
    await act(async () => api.remove(r));
    await act(async () => { finish({ verdict: "flawed" }); await pending; });
    expect(api.reports).toEqual([]);
    expect(env.progressExtrasRef.current.reports).toEqual([]);
  });
});

describe("resolve, reopen, delete", () => {
  it("resolving stamps the time, lifts the hold on the question, and makes the open round redraw", async () => {
    await mount();
    const r = await file();
    vi.spyOn(Date, "now").mockReturnValue(1234);
    await act(async () => api.resolve(r));
    expect(api.reports[0].resolvedAt).toBe(1234);
    expect(env.progressExtrasRef.current.reports[0].resolvedAt).toBe(1234);
    expect(api.quarantine.size).toBe(0);
    expect(env.touchSession).toHaveBeenCalledTimes(1);
  });
  it("reopening clears the time and holds the question back again, without touching the round", async () => {
    await mount();
    const r = await file();
    await act(async () => api.resolve(r));
    env.touchSession.mockClear();
    await act(async () => api.reopen(r));
    expect(api.reports[0].resolvedAt).toBeNull();
    expect([...api.quarantine]).toEqual(["alpha|gap"]);
    expect(env.touchSession).not.toHaveBeenCalled();
  });
  it("deleting removes only that report", async () => {
    await mount();
    const a = await file({ id: "qa" }), b = await file({ id: "qb" });
    await act(async () => api.remove(a));
    expect(api.reports.map((r) => r.id)).toEqual([b.id]);
    expect(env.progressExtrasRef.current.reports.map((r) => r.id)).toEqual([b.id]);
  });
});

describe("retiring a reported variant", () => {
  // a made-up course word with a gap sentence, so it has a pool to retire a variant from
  const made = { word: "Alpha", type: "vocab", category: "c", meaning: "m", situation: "s", gap: "She ____ it.", gaps: ["She ____ it."] };
  beforeEach(() => setGameContent([made], [], [], []));
  afterEach(() => setGameContent([], [], [], []));
  const word = () => gameContent().words.find((w) => w.word === "Alpha");
  it("the variant is flagged and locked for a hundred years, a new one is asked for, and the report is resolved", async () => {
    await mount();
    const item = getWordPools({}, word()).gap[0];
    const r = await file({ targets: ["Alpha"], poolType: "gap", poolItemId: item.id });
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await act(async () => api.retire(r));
    const next = env.setPools.mock.calls[0][0];
    const retired = next.Alpha.gap.find((i) => i.id === item.id);
    expect(retired).toMatchObject({ flagged: true, lockedUntil: 1_000 + 100 * 365 * 86400000 });
    expect(env.poolsRef.current).toBe(next);
    expect(env.triggerGeneration).toHaveBeenCalledWith([{ word: "Alpha", poolType: "gap" }], next);
    expect(api.reports[0].resolvedAt).toBe(1_000);
    expect(env.touchSession).toHaveBeenCalled();
  });
  it("a report with no variant, or about a word that is gone, is only resolved", async () => {
    await mount();
    const noVariant = await file({ id: "n1", targets: ["Alpha"], poolType: null, poolItemId: null });
    const noWord = await file({ id: "n2", targets: ["NoSuchWordAnywhere"], poolType: "gap", poolItemId: "x" });
    await act(async () => { api.retire(noVariant); api.retire(noWord); });
    expect(env.setPools).not.toHaveBeenCalled();
    expect(env.triggerGeneration).not.toHaveBeenCalled();
    expect(api.reports.every((r) => r.resolvedAt)).toBe(true);
  });
});

describe("what the shell calls", () => {
  it("loading progress replaces the list (the shell sets the ref with the rest of the progress); anything but a list is empty", async () => {
    await mount();
    await act(async () => api.load([{ id: "x", targetWords: ["A"], mode: "gap" }]));
    expect(api.reports).toHaveLength(1);
    expect([...api.quarantine]).toEqual(["a|gap"]);
    await act(async () => api.load(undefined));
    expect(api.reports).toEqual([]);
    expect(env.progressExtrasRef.current.reports).toEqual([]);                    // load does not write the ref
  });
  it("a renamed word: the reports follow it, in the list and in what is saved", async () => {
    env.progressExtrasRef.current.reports = [{ id: "r", mode: "gap", targetWords: ["Old"] }];
    await mount();
    await act(async () => api.followRename(new Map([["Old", "New"]])));
    expect(api.reports[0].targetWords).toEqual(["New"]);
    expect(env.progressExtrasRef.current.reports[0].targetWords).toEqual(["New"]);
  });
});
