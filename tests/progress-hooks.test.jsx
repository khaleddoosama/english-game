// @vitest-environment jsdom
// The progress as the game holds it (src/features/progress: useProgress, useProgressSave, useSaveQueue), wired as the
// shell wires them, with a fake repo: opening with saved progress, a new player or an unreadable one; nothing saved
// before the game has opened; one save 600 ms after a burst of changes, at once when the page is hidden or left;
// leaving during a content write asks first; a restored backup saved once as a replacement; reset (also when the server
// cannot be reached); study days; each badge shown once; another device's changes taken in (online only, at most every
// 10 s, only while visible). Made-up progress and words. Docs: docs/modules/progress/progress-state.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { badgesFor } from "../src/engine/catalog";
import { useProgress, useProgressSave, useSaveQueue } from "../src/features/progress";

const LEVELS = [{ id: "cat-Hotel", title: "Hotel", items: [{ kind: "word", key: "Vacancy", obj: { word: "Vacancy" } }] }];
const CONTENT = { badges: badgesFor(LEVELS), levels: LEVELS };
const mastered = { stage: "Mastered", correct: 9, total: 9, reviewStep: 6, productionCorrect: 3, everMastered: true, streak: 5, lastSeen: Date.now() };
const SAVED = { score: 120, streak: 2, bestStreak: 6, attempted: 30, studyStreak: 3, bestStudyStreak: 5, lastStudyDate: "2026-10-19", levelsCleared: ["cat-Hotel"], settings: { dailyGoal: 25 }, sessionLogs: [{ id: "r1", kind: "practice", title: "Hotel", correct: 3, total: 4, at: 1 }], reports: [{ id: "rep-1" }], seenSentences: { "A ______ sign.": 1 } };

function fakeRepo({ online = false } = {}) {
  const repo = {
    saves: [], resets: 0, refreshes: 0, merged: null,
    saveProgress: vi.fn(async (data, opts) => { repo.saves.push([data, opts]); }),
    resetProgress: vi.fn(async () => { repo.resets++; }),
  };
  if (online) {
    repo.onMerged = (fn) => { repo.merged = fn; return () => { repo.merged = null; }; };
    repo.refreshProgress = async () => { repo.refreshes++; return false; };
  }
  return repo;
}

let out, queue, root, host, calls;
function Probe({ repo, loaded, reports }) {
  queue = useSaveQueue();
  out = useProgress({ repo, loaded, gameContent: () => CONTENT, onReports: (r) => calls.reports.push(r), onBadge: (b) => calls.badges.push(b.label) });
  useProgressSave({ repo, loaded, progress: out, debouncedSave: queue.debouncedSave, alsoOn: reports });
  return null;
}
const render = (props) => act(async () => root.render(<Probe reports={null} {...props} />));
const mount = async (props) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render(props); };
const wait = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setVisibility = (v) => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
// Opens a game the way the shell does: progress put on screen, then "loaded".
async function open(repo, raw = SAVED, props = {}) {
  await mount({ repo, loaded: false, ...props });
  await act(async () => out.startFrom(raw, { dailyGoal: 7, questionsPerRound: 9 }));
  await render({ repo, loaded: true, ...props });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 20, 12)); globalThis.IS_REACT_ACT_ENVIRONMENT = true; calls = { reports: [], badges: [] }; setVisibility("visible"); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe("opening the game", () => {
  it("saved progress: the numbers, the settings, the extras and the reports", async () => {
    const repo = fakeRepo();
    await open(repo);
    expect([out.score, out.streak, out.bestStreak, out.attempted, out.studyStreak, out.lastStudyDate, out.settings.dailyGoal]).toEqual([120, 2, 6, 30, 3, "2026-10-19", 25]);
    expect(out.sessionLogs.map((l) => l.id)).toEqual(["r1"]);
    expect(out.progressExtrasRef.current.seenSentences).toEqual(SAVED.seenSentences);
    expect(calls.reports).toEqual([[{ id: "rep-1" }]]);
  });

  it("a new player starts from zero with the admin's defaults", async () => {
    await open(fakeRepo(), null);
    expect([out.score, out.studyStreak, out.lastStudyDate, out.settings.dailyGoal, out.settings.questionsPerRound]).toEqual([0, 0, null, 7, 9]);
  });

  it("progress that cannot be read leaves the starting state, and badges earned later are still shown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = { get levelsCleared() { throw new Error("broken"); } };
    await open(fakeRepo(), raw);
    expect(console.error).toHaveBeenCalledWith("Could not read progress:", expect.any(Error));
    expect(out.score).toBe(0);
    await act(async () => out.setBestStreak(5));
    expect(calls.badges).toEqual(["Warming Up"]);
  });
});

describe("saving", () => {
  it("nothing is saved before the game has opened", async () => {
    const repo = fakeRepo();
    await mount({ repo, loaded: false });
    await act(async () => out.setScore(10));
    await wait(5000);
    expect(repo.saves).toEqual([]);
  });

  it("a burst of changes is one save, 600 ms after the last; it holds the extras and the numbers", async () => {
    const repo = fakeRepo();
    await open(repo);
    await wait(600);
    repo.saves.length = 0;
    await act(async () => out.setScore(130));
    await wait(300);
    await act(async () => out.setAttempted(31));
    await wait(599);
    expect(repo.saves).toEqual([]);
    await wait(1);
    expect(repo.saves).toHaveLength(1);
    const [data, opts] = repo.saves[0];
    expect(data).toMatchObject({ score: 130, attempted: 31, bestStreak: 6, seenSentences: SAVED.seenSentences, settings: { dailyGoal: 25 } });
    expect(opts).toEqual({ replace: false });
  });

  it("a study day that changes only the date is saved", async () => {
    const repo = fakeRepo();
    await open(repo, { ...SAVED, studyStreak: 1, bestStudyStreak: 1, lastStudyDate: "2026-10-15" });
    await wait(600); repo.saves.length = 0;
    await act(async () => out.recordStudyDay());
    expect([out.studyStreak, out.bestStudyStreak]).toEqual([1, 1]);
    await wait(600);
    expect(repo.saves.map(([d]) => d.lastStudyDate)).toEqual(["2026-10-20"]);
  });

  it("a change of the reports, or of the extras alone, saves too", async () => {
    const repo = fakeRepo();
    await open(repo);
    await wait(600); repo.saves.length = 0;
    await render({ repo, loaded: true, reports: [{ id: "rep-2" }] });
    await wait(600);
    expect(repo.saves).toHaveLength(1);
    out.progressExtrasRef.current = { ...out.progressExtrasRef.current, seenSentences: { "Another ______.": 2 } };
    await act(async () => out.extrasChanged());
    await wait(600);
    expect(repo.saves).toHaveLength(2);
    expect(repo.saves[1][0].seenSentences).toEqual({ "Another ______.": 2 });
  });

  it("hiding or leaving the page saves at once, once", async () => {
    const repo = fakeRepo();
    await open(repo);
    await wait(600); repo.saves.length = 0;
    await act(async () => out.setScore(140));
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(repo.saves.map(([d]) => d.score)).toEqual([140]);
    await wait(600);
    expect(repo.saves).toHaveLength(1);
    await act(async () => out.setScore(150));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(repo.saves).toHaveLength(1);
    setVisibility("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(repo.saves.map(([d]) => d.score)).toEqual([140, 150]);
    await act(async () => out.setScore(160));
    await act(async () => { window.dispatchEvent(new Event("beforeunload")); });
    expect(repo.saves.map(([d]) => d.score)).toEqual([140, 150, 160]);
  });

  it("leaving while the admin's content is being written asks first", async () => {
    await open(fakeRepo());
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    queue.contentWritesRef.current = 1;
    const asking = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asking);
    expect(asking.defaultPrevented).toBe(true);
  });

  it("the save's promise is kept while it runs (sign-out waits for it); a failed save is logged", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = fakeRepo();
    repo.saveProgress = vi.fn(async () => { throw new Error("offline"); });
    await open(repo);
    await wait(600);
    expect(queue.runningSavesRef.current.progress).toBeInstanceOf(Promise);
    await act(async () => { await queue.runningSavesRef.current.progress; });
    expect(console.error).toHaveBeenCalledWith("Could not save progress:", expect.any(Error));
  });
});

describe("restore and reset", () => {
  it("a restored backup is put on screen and saved once as a replacement", async () => {
    const repo = fakeRepo();
    await open(repo);
    await wait(600); repo.saves.length = 0;
    await act(async () => out.restore({ ...SAVED, score: 999, mastery: {}, pools: {}, confusions: {}, levelStats: {}, bestSpeedScore: 0, bestSpeedCombo: 0, settings: { dailyGoal: 40 }, reports: [{ id: "rep-9" }] }));
    expect([out.score, out.settings.dailyGoal]).toEqual([999, 40]);
    expect(calls.reports.at(-1)).toEqual([{ id: "rep-9" }]);
    await wait(600);
    expect(repo.saves.map(([d, o]) => [d.score, o.replace])).toEqual([[999, true]]);
    await act(async () => out.setScore(1000));
    await wait(600);
    expect(repo.saves.map(([d, o]) => [d.score, o.replace])).toEqual([[999, true], [1000, false]]);
  });

  it("reset: the server's copy is deleted and everything starts from zero; badges can be earned again", async () => {
    const repo = fakeRepo();
    await open(repo, { ...SAVED, bestStreak: 5 });
    expect(calls.badges).toEqual([]);
    await act(async () => out.reset());
    expect(repo.resets).toBe(1);
    expect([out.score, out.bestStreak, out.studyStreak, out.lastStudyDate, out.activeSession, out.sessionLogs.length]).toEqual([0, 0, 0, null, null, 0]);
    expect(out.progressExtrasRef.current).toEqual({});
    await act(async () => out.setBestStreak(5));
    expect(calls.badges).toEqual(["Warming Up"]);
  });

  it("reset when the server cannot be reached: onError is told, the game still starts from zero", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = fakeRepo();
    repo.resetProgress = vi.fn(async () => { throw new Error("offline"); });
    await open(repo);
    const onError = vi.fn();
    await act(async () => out.reset({ onError }));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(out.score).toBe(0);
  });
});

describe("study days", () => {
  it("yesterday then today adds a day; twice today counts once; a missed day starts again; the best is kept", async () => {
    await open(fakeRepo());
    await act(async () => out.recordStudyDay());
    expect([out.studyStreak, out.bestStudyStreak, out.lastStudyDate]).toEqual([4, 5, "2026-10-20"]);
    await act(async () => out.recordStudyDay());
    expect(out.studyStreak).toBe(4);
    vi.setSystemTime(new Date(2026, 9, 23, 12));
    await act(async () => out.recordStudyDay());
    expect([out.studyStreak, out.bestStudyStreak, out.lastStudyDate]).toEqual([1, 5, "2026-10-23"]);
  });
});

describe("badges", () => {
  it("one already earned when the game opens is not shown; a new one is shown once", async () => {
    await open(fakeRepo(), { ...SAVED, bestStreak: 5 });
    await act(async () => out.setBestStreak(10));
    await act(async () => out.setBestStreak(11));
    await act(async () => out.setMastery({ Vacancy: mastered }));
    expect(calls.badges).toEqual(["On a Roll", "Hotel Files Closed", "Full Case Archive"]);
  });

  it("nothing is shown before the game has opened; then the new ones are", async () => {
    const repo = fakeRepo();
    await mount({ repo, loaded: false });
    await act(async () => out.startFrom({ ...SAVED, bestStreak: 0 }, {}));
    await act(async () => out.setBestStreak(5));
    expect(calls.badges).toEqual([]);
    await render({ repo, loaded: true });
    expect(calls.badges).toEqual(["Warming Up"]);
  });
});

describe("another device's changes (online)", () => {
  it("merged progress is put on screen", async () => {
    const repo = fakeRepo({ online: true });
    await open(repo);
    await act(async () => repo.merged({ ...SAVED, score: 555, reports: [{ id: "rep-3" }] }));
    expect(out.score).toBe(555);
    expect(calls.reports.at(-1)).toEqual([{ id: "rep-3" }]);
  });

  it("looked for on focus while visible, at most every 10 s; not while hidden; stops on unmount", async () => {
    const repo = fakeRepo({ online: true });
    await open(repo);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    expect(repo.refreshes).toBe(1);
    await wait(10000);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(repo.refreshes).toBe(1);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(repo.refreshes).toBe(2);
    await act(async () => root.unmount()); root = undefined;
    expect(repo.merged).toBe(null);
    await wait(10000);
    window.dispatchEvent(new Event("focus"));
    expect(repo.refreshes).toBe(2);
  });

  it("not before the game has opened", async () => {
    const repo = fakeRepo({ online: true });
    await mount({ repo, loaded: false });
    window.dispatchEvent(new Event("focus"));
    expect([repo.refreshes, repo.merged]).toEqual([0, null]);
  });
});
