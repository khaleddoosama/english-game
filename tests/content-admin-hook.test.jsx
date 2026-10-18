// @vitest-environment jsdom
// The content-admin hook (src/features/content-admin): what each admin operation does to the content lists, the
// game's level order, the progress kept on this device and the renames waiting for the server. Real React state;
// made-up content. The pure rules: content-admin-rules.test.js. Docs: docs/modules/admin/content-admin.md.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVEL_ORDER, mergeCustomData } from "../src/engine/data";
import { useContentAdmin } from "../src/features/content-admin";

let root, host, api, state, refs, followReportRename, isAdmin;
const startContent = () => ({
  words: [{ word: "Chilly", category: "Weather", meaning: "a bit cold" }, { word: "Lobby", category: "Hotel", meaning: "the entrance hall" }],
  grammar: [{ id: "g-1", category: "Hotel" }],
  challenges: [{ id: "c-1", category: "Weather", linkedWords: ["Chilly"] }],
  combos: [{ id: "k-1", category: "Weather", words: ["Chilly", "Lobby"] }],
  stories: [{ id: "s-1", category: "Hotel", targetWords: ["Lobby"] }],
});

function Probe() {
  const start = startContent();
  const [customWords, setCustomWords] = useState(start.words);
  const [customGrammar, setCustomGrammar] = useState(start.grammar);
  const [customChallenges, setCustomChallenges] = useState(start.challenges);
  const [customCombos, setCustomCombos] = useState(start.combos);
  const [customStories, setCustomStories] = useState(start.stories);
  const [dataVersion, setDataVersion] = useState(0);
  const [toast, setToast] = useState(null);
  const [mastery, setMastery] = useState(refs.masteryRef.current);
  const [pools, setPools] = useState(refs.poolsRef.current);
  const [confusions, setConfusions] = useState(refs.confusionsRef.current);
  const [levelStats, setLevelStats] = useState({ "cat-Weather": { plays: 3 } });
  const [levelsCleared, setLevelsCleared] = useState(["cat-Weather", "cat-Hotel"]);
  state = { customWords, customGrammar, customChallenges, customCombos, customStories, dataVersion, toast, mastery, pools, confusions, levelStats, levelsCleared };
  api = useContentAdmin({
    isAdmin,
    content: { customWords, customGrammar, customChallenges, customCombos, customStories },
    set: { setCustomWords, setCustomGrammar, setCustomChallenges, setCustomCombos, setCustomStories, setDataVersion, setToast },
    progress: { ...refs, setMastery, setPools, setConfusions, setLevelStats, setLevelsCleared },
    followReportRename,
  });
  return null;
}

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isAdmin = true;
  followReportRename = vi.fn();
  refs = {
    masteryRef: { current: { Chilly: { seen: 4 }, Lobby: { seen: 1 } } },
    poolsRef: { current: { Chilly: { gap: [] } } },
    confusionsRef: { current: { "Chilly|Lobby": 2 } },
  };
  const c = startContent();
  mergeCustomData(c.words, c.grammar, c.challenges, ["Weather", "Hotel"]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const mount = () => act(async () => root.render(<Probe />));
const run = (fn) => act(async () => { fn(); });

describe("renaming a word", () => {
  it("into a name another word has: refused with a message, nothing changes and nothing is queued", async () => {
    await mount();
    await run(() => api.renameWord("Chilly", { word: "lobby", category: "Weather" }));
    expect(state.toast.text).toMatch(/already a word called .Lobby./);
    expect(state.customWords.map((w) => w.word)).toEqual(["Chilly", "Lobby"]);
    expect(state.dataVersion).toBe(0);
    expect(api.takePendingRenames()).toEqual([]);
  });
  it("to a free name: the content follows, progress moves with it on this device, and the rename waits for the server", async () => {
    await mount();
    await run(() => api.renameWord("Chilly", { word: "Cool", category: "Weather", meaning: "a bit cold" }));
    expect(state.customWords.map((w) => w.word)).toEqual(["Cool", "Lobby"]);
    expect(state.customCombos[0].words).toEqual(["Cool", "Lobby"]);
    expect(state.customChallenges[0].linkedWords).toEqual(["Cool"]);
    expect(state.mastery).toEqual({ Cool: { seen: 4 }, Lobby: { seen: 1 } });
    expect(refs.masteryRef.current).toBe(state.mastery);                    // ref and state agree
    expect(state.pools).toEqual({ Cool: { gap: [] } });
    expect(state.confusions).toEqual({ "Cool|Lobby": 2 });
    expect(followReportRename).toHaveBeenCalledWith(new Map([["Chilly", "Cool"]]));
    expect(state.dataVersion).toBe(1);                                      // schedules the content save
    expect(api.takePendingRenames()).toEqual([{ kind: "word", from: "Chilly", to: "Cool" }]);
  });
  it("on a player's device, progress moves but nothing is queued for the server", async () => {
    isAdmin = false;
    await mount();
    await run(() => api.renameWord("Chilly", { word: "Cool", category: "Weather" }));
    expect(state.mastery.Cool).toEqual({ seen: 4 });
    expect(api.takePendingRenames()).toEqual([]);
  });
});

describe("categories and levels", () => {
  it("merging: every item moves, the game's level order has one entry, level progress follows, and the renames wait", async () => {
    await mount();
    await run(() => api.mergeCategories("Places", ["Weather", "Hotel"]));
    expect([...state.customWords, ...state.customGrammar, ...state.customChallenges, ...state.customCombos, ...state.customStories].every((x) => x.category === "Places")).toBe(true);
    expect(LEVEL_ORDER).toEqual(["Places"]);
    expect(state.levelStats).toEqual({ "cat-Places": { plays: 3 } });
    expect(state.levelsCleared).toEqual(["cat-Places"]);
    expect(api.takePendingRenames()).toEqual([{ kind: "category", from: "Weather", to: "Places" }, { kind: "category", from: "Hotel", to: "Places" }]);
    expect(state.dataVersion).toBe(1);
  });
  it("merging into itself does nothing", async () => {
    await mount();
    await run(() => api.mergeCategories("Weather", ["Weather"]));
    expect(state.dataVersion).toBe(0);
    expect(LEVEL_ORDER).toEqual(["Weather", "Hotel"]);
  });
  it("removing empty levels returns how many went; none to remove changes nothing", async () => {
    const c = startContent();
    mergeCustomData(c.words, c.grammar, c.challenges, ["Empty", "Weather", "Hotel"]);
    await mount();
    let removed;
    await run(() => { removed = api.removeEmptyLevels(); });
    expect(removed).toBe(1);
    expect(LEVEL_ORDER).toEqual(["Weather", "Hotel"]);
    expect(state.dataVersion).toBe(1);
    await run(() => { removed = api.removeEmptyLevels(); });
    expect(removed).toBe(0);
    expect(state.dataVersion).toBe(1);
  });
  it("deleting a category deletes its items and its level; nothing is renamed", async () => {
    await mount();
    await run(() => api.deleteLevelCategory({ title: "Weather" }));
    expect(state.customWords.map((w) => w.word)).toEqual(["Lobby"]);
    expect(state.customChallenges).toEqual([]);
    expect(state.customCombos).toEqual([]);
    expect(LEVEL_ORDER).toEqual(["Hotel"]);
    expect(api.takePendingRenames()).toEqual([]);
  });
  it("renaming a level in the levels editor moves its items and its progress", async () => {
    await mount();
    await run(() => api.updateAdminContent("levels", [{ id: "cat-Weather", title: "Climate" }, { id: "cat-Hotel", title: "Hotel" }]));
    expect(state.customWords[0].category).toBe("Climate");
    expect(LEVEL_ORDER).toEqual(["Climate", "Hotel"]);
    expect(state.levelStats).toEqual({ "cat-Climate": { plays: 3 } });
    expect(api.takePendingRenames()).toEqual([{ kind: "category", from: "Weather", to: "Climate" }]);
  });
});

describe("other edits", () => {
  it("a list from an editor replaces only that list", async () => {
    await mount();
    await run(() => api.updateAdminContent("stories", []));
    expect(state.customStories).toEqual([]);
    expect(state.customWords).toHaveLength(2);
    expect(state.dataVersion).toBe(1);
  });
  it("a word's fields change, not its name", async () => {
    await mount();
    await run(() => api.updateWordFields("lobby", { meaning: "the hall" }));
    expect(state.customWords[1]).toEqual({ word: "Lobby", category: "Hotel", meaning: "the hall" });
  });
});

describe("renames waiting for the server", () => {
  it("the save takes them all; a failed save puts them back in front of newer ones", async () => {
    await mount();
    await run(() => api.renameWord("Chilly", { word: "Cool", category: "Weather" }));
    const taken = api.takePendingRenames();
    expect(api.takePendingRenames()).toEqual([]);
    await run(() => api.renameWord("Lobby", { word: "Hall", category: "Hotel" }));
    api.returnPendingRenames(taken);
    expect(api.takePendingRenames().map((r) => r.to)).toEqual(["Cool", "Hall"]);
  });
});
