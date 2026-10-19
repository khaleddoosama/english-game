// @vitest-environment jsdom
// Loading and saving the content (src/features/content): applying a saved copy, the save after a change (admin only,
// after the load), renames sent with it and put back after a failure, the warning, saves one after another, and the
// picture move. Real React state; the repo, the save queue and the picture store are fakes; made-up content.
// The steps with no state: content-sync-rules.test.js. Docs: docs/modules/content/content-sync.md.
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVEL_ORDER, WORDS, mergeCustomData } from "../src/engine/data";

const storeEmbeddedImages = vi.fn();
vi.mock("../src/lib/images", async (original) => ({ ...(await original()), storeEmbeddedImages: (...a) => storeEmbeddedImages(...a) }));
const { useContentLists, useContentSave } = await import("../src/features/content");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const W = (word, extra = {}) => ({ word, type: "vocab", category: "Weather", meaning: `The meaning of ${word}.`, situation: `A ${word} today.`, gap: "A ______ today.", ...extra });
const later = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

let root, host, api, state, props, jobs, repo, renames;
function Probe() {
  const lists = useContentLists();
  const [dataVersion, setDataVersion] = useState(0);
  const [warning, setStorageWarning] = useState(null);
  const pendingSavesRef = useRef({});
  const contentWritesRef = useRef(0);
  const debouncedSave = (name, run) => { pendingSavesRef.current[name] = run; jobs.push(run); return () => { delete pendingSavesRef.current[name]; }; };
  useContentSave({ loaded: props.loaded, isAdmin: props.isAdmin, repo, lists, dataVersion, setDataVersion, saves: { debouncedSave, pendingSavesRef, contentWritesRef }, renames, setStorageWarning });
  api = lists;
  state = { dataVersion, warning, writes: contentWritesRef, setDataVersion };
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  props = { loaded: false, isAdmin: true };
  jobs = [];
  repo = { mode: "local", saveContent: vi.fn(async () => {}) };
  renames = { takePendingRenames: vi.fn(() => [{ kind: "word", from: "Calm", to: "Still" }]), returnPendingRenames: vi.fn() };
  storeEmbeddedImages.mockReset();
  mergeCustomData([], [], [], []);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const rerender = (next) => act(async () => { Object.assign(props, next); root.render(<Probe />); });
const run = (fn) => act(async () => { await fn(); });
const runLastJob = () => run(() => jobs.at(-1)());

describe("applying a saved copy", () => {
  it("none: nothing changes and it says so", async () => {
    let had;
    await run(() => { had = api.applySavedContent(null); });
    expect(had).toBe(false);
    expect(api.customWords).toEqual([]);
  });
  it("sets the five lists and the note, drops removed fields, and rebuilds the game's copy with the saved order", async () => {
    let had;
    await run(() => { had = api.applySavedContent({ note: "From the admin", puns: [1], words: [W("Gust", { sentenceBuild: "x" })], grammar: [{ id: "g1", category: "Weather", rule: "r" }], challenges: "not a list", combos: [{ id: "c1" }], stories: [{ id: "s1" }], levelOrder: ["Weather", "Spare"] }); });
    expect(had).toBe(true);
    expect(api.customWords).toEqual([W("Gust")]);
    expect(api.customGrammar).toHaveLength(1);
    expect(api.customChallenges).toEqual([]);
    expect(api.customCombos).toEqual([{ id: "c1" }]);
    expect(api.customStories).toEqual([{ id: "s1" }]);
    expect(api.contentNoteRef.current).toBe("From the admin");
    expect(WORDS.map((w) => w.word)).toEqual(["Gust"]);
    expect([...LEVEL_ORDER]).toEqual(["Weather", "Spare"]);
  });
  it("setContent sets all five lists", async () => {
    await run(() => api.setContent({ words: [W("Mist")], grammar: [1], challenges: [2], combos: [3], stories: [4] }));
    expect([api.customWords.length, api.customGrammar, api.customChallenges, api.customCombos, api.customStories]).toEqual([1, [1], [2], [3], [4]]);
  });
});

describe("saving", () => {
  it("nothing before the load, nothing for a player", async () => {
    expect(jobs).toHaveLength(0);
    await rerender({ loaded: true, isAdmin: false });
    await run(() => api.setContent({ words: [W("Mist")], grammar: [], challenges: [], combos: [], stories: [] }));
    expect(jobs).toHaveLength(0);
  });
  it("after the load the admin's content is saved, with the waiting renames and the level order", async () => {
    await run(() => api.applySavedContent({ note: "n", words: [W("Gust")], levelOrder: ["Weather"] }));
    await rerender({ loaded: true });
    expect(jobs.length).toBeGreaterThan(0);
    expect(state.writes.current).toBe(1);
    await runLastJob();
    expect(repo.saveContent).toHaveBeenCalledWith({ note: "n", combos: [], stories: [], words: [W("Gust")], grammar: [], challenges: [], levelOrder: ["Weather"] }, { renames: [{ kind: "word", from: "Calm", to: "Still" }] });
    expect(state.writes.current).toBe(0);
  });
  it("a change (or a dataVersion bump) schedules another save", async () => {
    await rerender({ loaded: true });
    const before = jobs.length;
    await run(() => api.setContent({ words: [W("Mist")], grammar: [], challenges: [], combos: [], stories: [] }));
    await run(() => state.setDataVersion((v) => v + 1));
    expect(jobs.length).toBe(before + 2);
  });
  it("a failed save puts the renames back and shows the warning; a conflict shows its own message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await rerender({ loaded: true });
    repo.saveContent.mockRejectedValueOnce(new Error("offline"));
    await runLastJob();
    expect(renames.returnPendingRenames).toHaveBeenCalledWith([{ kind: "word", from: "Calm", to: "Still" }]);
    expect(state.warning).toMatch(/^Content could not be saved to the server/);
    repo.saveContent.mockRejectedValueOnce(Object.assign(new Error("Someone else saved first."), { conflict: true }));
    await runLastJob();
    expect(state.warning).toBe("Someone else saved first.");
    expect(state.writes.current).toBe(0);
  });
  it("saves run one after another", async () => {
    await rerender({ loaded: true });
    const first = later();
    repo.saveContent.mockReturnValueOnce(first.promise);
    await act(async () => { jobs.at(-1)(); });
    await run(() => api.setContent({ words: [W("Mist")], grammar: [], challenges: [], combos: [], stories: [] }));
    await act(async () => { jobs.at(-1)(); });
    expect(repo.saveContent).toHaveBeenCalledTimes(1);
    await run(async () => { first.resolve(); });
    expect(repo.saveContent).toHaveBeenCalledTimes(2);
  });
});

describe("pictures inside the content", () => {
  it("online, the admin's embedded pictures become links; the game's copy is rebuilt and saved again", async () => {
    repo.mode = "supabase";
    storeEmbeddedImages.mockResolvedValue(new Map([[PNG, "https://store/gust.png"]]));
    await run(() => api.applySavedContent({ words: [W("Gust", { image: PNG }), W("Fog")], levelOrder: ["Weather"] }));
    await rerender({ loaded: true });
    expect(storeEmbeddedImages).toHaveBeenCalledWith([PNG]);
    expect(api.customWords[0].image).toBe("https://store/gust.png");
    expect(WORDS.find((w) => w.word === "Gust").image).toBe("https://store/gust.png");
    expect(state.dataVersion).toBe(1);
  });
  it("nothing in local mode, for a player, or with no embedded picture", async () => {
    await run(() => api.applySavedContent({ words: [W("Gust", { image: PNG })] }));
    await rerender({ loaded: true });
    await rerender({ isAdmin: false });
    repo.mode = "supabase";
    await run(() => api.setContent({ words: [W("Gust", { image: PNG })], grammar: [], challenges: [], combos: [], stories: [] }));
    await rerender({ isAdmin: true });
    await run(() => api.setContent({ words: [W("Fog")], grammar: [], challenges: [], combos: [], stories: [] }));
    expect(storeEmbeddedImages).not.toHaveBeenCalled();
  });
});
