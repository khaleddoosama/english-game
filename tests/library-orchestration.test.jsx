// @vitest-environment jsdom
// The pieces that sit between the screens and the library API: what the app
// shell used to work out for itself (the offers count, the player's keys and
// biggest views for Home, a round from a view, keeping a new word in the
// library, which library screen to show) and what the library page did inside
// its buttons (the change and the sentence that tells the player). Written
// from the behaviour of the code before it was moved (see
// docs/architecture/modules.md); the browser spec e2e/specs/libshell.cjs
// checks the same in the real app.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeLimits, keysFromList, rootsFromTree } from "../src/features/library/libraryHome.js";
import { scopeOfView } from "../src/features/library/viewRound.js";
import { keepInLibrary } from "../src/features/library/ownWords.js";
import { libraryActions, offerAcceptedText } from "../src/features/library/libraryActions.js";
import { useLibraryHome } from "../src/features/library/useLibraryHome.js";
import LibraryRoutes from "../src/features/library/LibraryRoutes.jsx";
import * as publicApi from "../src/features/library/index.js";

const ids = {
  keyOfSense: (id) => ({ s1: "Word One", s2: "Word Two" })[id],
  keyOfRule: (id) => ({ r1: "g-1" })[id],
  senseOf: (k) => ({ "Word One": "s1", "Word Two": "s2" })[k],
  ruleOf: (k) => ({ "g-1": "r1" })[k],
};

describe("what Home needs from the library: pure rules", () => {
  it("keys: the words and rules a player has, by the game's key; ids with no key are left out", () => {
    const keys = keysFromList({ words: [{ id: "s1" }, { id: "gone" }, { id: "s2" }], rules: [{ id: "r1" }, { id: "r-gone" }] }, ids);
    expect([...keys.words]).toEqual(["Word One", "Word Two"]);
    expect([...keys.rules]).toEqual(["g-1"]);
  });

  it("roots: only top-level views, in their order (no position counts as 0), as { id, name }", () => {
    const rows = [
      { id: "c", parent: "a", name: "Child", position: 1 },
      { id: "b", parent: null, name: "Second", position: 2, words: 4 },
      { id: "a", parent: null, name: "First", position: 1 },
      { id: "z", parent: null, name: "Unplaced" },
    ];
    expect(rootsFromTree(rows)).toEqual([{ id: "z", name: "Unplaced" }, { id: "a", name: "First" }, { id: "b", name: "Second" }]);
    expect(rootsFromTree([])).toEqual([]);
  });

  it("limits: only a player (not the admin) with a ready library is cut down to it, and waits until it is read", () => {
    const keys = { words: new Set(), rules: new Set() };
    expect(homeLimits({ status: "ready", isAdmin: false, keys })).toEqual({ limit: true, waiting: false });
    expect(homeLimits({ status: "ready", isAdmin: false, keys: null })).toEqual({ limit: false, waiting: true });
    expect(homeLimits({ status: "ready", isAdmin: true, keys: null })).toEqual({ limit: false, waiting: false });
    expect(homeLimits({ status: "ready", isAdmin: true, keys })).toEqual({ limit: false, waiting: false });
    for (const status of ["loading", "off"]) expect(homeLimits({ status, isAdmin: false, keys: null })).toEqual({ limit: false, waiting: false });
  });
});

describe("a round from a view", () => {
  it("asks for the view with the views inside it by default, and turns the rows into a scope of keys", async () => {
    const api = { contents: vi.fn(async () => [{ kind: "sense", id: "s1" }, { kind: "rule", id: "r1" }, { kind: "sense", id: "gone" }]) };
    const scope = await scopeOfView({ api, ids }, "v1");
    expect(api.contents).toHaveBeenCalledWith("v1", true);
    expect([...scope.words]).toEqual(["Word One"]);
    expect([...scope.rules]).toEqual(["g-1"]);
    await scopeOfView({ api, ids }, "v1", false);
    expect(api.contents).toHaveBeenLastCalledWith("v1", false);
  });
  it("a view that cannot be read is an error for the caller to show", async () => {
    await expect(scopeOfView({ api: { contents: async () => { throw new Error("That view does not exist."); } }, ids }, "v1")).rejects.toThrow("does not exist");
  });
});

describe("keeping a new word in the library", () => {
  it("creates it and reloads the key map, when the library is ready", async () => {
    const library = { status: "ready", api: { createWord: vi.fn(async () => ({ id: "x" })) }, refreshIds: vi.fn(async () => {}) };
    await keepInLibrary(library, { word: "Quokka", meaning: "m" });
    expect(library.api.createWord).toHaveBeenCalledWith({ word: "Quokka", meaning: "m" });
    expect(library.refreshIds).toHaveBeenCalledTimes(1);
  });
  it("does nothing while the library is loading or off", async () => {
    for (const status of ["loading", "off"]) {
      const library = { status, api: { createWord: vi.fn() }, refreshIds: vi.fn() };
      await keepInLibrary(library, { word: "Quokka" });
      expect(library.api.createWord).not.toHaveBeenCalled();
    }
  });
  it("is best effort: a refused word is not an error, and the map is not reloaded", async () => {
    const library = { status: "ready", api: { createWord: vi.fn(async () => { throw new Error("A word is 1 to 120 characters."); }) }, refreshIds: vi.fn() };
    await expect(keepInLibrary(library, { word: "" })).resolves.toBeUndefined();
    expect(library.refreshIds).not.toHaveBeenCalled();
  });
});

describe("the changes on the library page and what they tell the player", () => {
  const api = {
    addRules: vi.fn(async () => 2), libraryRemoveRule: vi.fn(async () => {}), add: vi.fn(async () => 1), create: vi.fn(async () => "new-view"), libraryRemove: vi.fn(async () => {}),
  };
  const actions = libraryActions({ api, ids });
  const run = async ([fn, text], result) => [await fn(), typeof text === "function" ? text(result) : text];

  it("add rules to a view: only rules with an id; says how many, or that they were all there", async () => {
    const [fn, text] = actions.addRulesToView("v1", ["g-1", "unknown"]);
    expect(await fn()).toBe(2);
    expect(api.addRules).toHaveBeenCalledWith("v1", ["r1"]);
    expect(text(1)).toBe("Added 1 rule to the view.");
    expect(text(3)).toBe("Added 3 rules to the view.");
    expect(text(0)).toBe("Those are already in that view.");
  });

  it("add words to a view: same", async () => {
    const [fn, text] = actions.addToView("v1", ["Word One", "nope", "Word Two"]);
    await fn();
    expect(api.add).toHaveBeenCalledWith("v1", ["s1", "s2"]);
    expect([text(2), text(0)]).toEqual(["Added 2 to the view.", "Those are already in that view."]);
  });

  it("remove rules and words from the library one at a time, and count them", async () => {
    const [rf, rt] = actions.removeRules(["g-1", "g-1"]);
    expect(await rf()).toBe(2);
    expect(api.libraryRemoveRule).toHaveBeenCalledTimes(2);
    expect([rt(1), rt(2)]).toEqual(["Removed 1 rule from your library.", "Removed 2 rules from your library."]);
    const [wf, wt] = actions.removeWords(["Word One", "Word Two", "Word One"]);
    expect(await wf()).toBe(3);
    expect(api.libraryRemove.mock.calls.map((c) => c[0])).toEqual(["s1", "s2", "s1"]);
    expect([wt(1), wt(3)]).toEqual(["Removed 1 word from your library.", "Removed 3 words from your library."]);
  });

  it("a new view with words: made first, then filled; the sentence uses the trimmed name and the count the player picked", async () => {
    const [fn, text] = actions.newViewWith("  Trip  ", ["Word One", "Word Two"]);
    expect(await fn()).toBe("new-view");
    expect(api.create).toHaveBeenCalledWith("  Trip  ");
    expect(api.add).toHaveBeenLastCalledWith("new-view", ["s1", "s2"]);
    expect(text).toBe("Made “Trip” with 2 words.");
    expect(actions.newViewWith("A", ["Word One"])[1]).toBe("Made “A” with 1 word.");
  });

  it("nothing is sent when the player picked nothing the server knows", async () => {
    api.add.mockClear();
    await run(actions.addToView("v1", ["nope"]));
    expect(api.add).toHaveBeenCalledWith("v1", []);
  });

  it("the sentence for an accepted offer: counts, rules only when there are some, and how many private words were left out", () => {
    expect(offerAcceptedText({ name: "Trip (from zed)", words: 3, rules: 0, skipped: 0 })).toBe("Added “Trip (from zed)”: 3 words.");
    expect(offerAcceptedText({ name: "T", words: 1, rules: 2, skipped: 0 })).toBe("Added “T”: 1 word, 2 rules.");
    expect(offerAcceptedText({ name: "T", words: 1, rules: 1, skipped: 1 })).toBe("Added “T”: 1 word, 1 rule (1 private word was not shared).");
    expect(offerAcceptedText({ name: "T", words: 0, rules: 0, skipped: 2 })).toBe("Added “T”: 0 words (2 private words were not shared).");
  });
});

describe("useLibraryHome", () => {
  let root, host, seen;
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  function Probe(props) { seen = useLibraryHome(props); return null; }
  async function mount(props) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<Probe {...props} />));
    await settle();
    return (next) => act(async () => { root.render(<Probe {...next} />); await new Promise((r) => setTimeout(r, 0)); });
  }
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = seen = undefined; });
  const makeLibrary = (over = {}) => ({
    status: "ready", ids,
    api: {
      inbox: vi.fn(async () => [{ id: "o1" }, { id: "o2" }]),
      libraryList: vi.fn(async () => ({ words: [{ id: "s1" }], rules: [{ id: "r1" }] })),
      tree: vi.fn(async () => [{ id: "b", parent: null, name: "B", position: 2 }, { id: "a", parent: null, name: "A", position: 1 }, { id: "c", parent: "a", name: "C", position: 1 }]),
      ...over,
    },
  });

  it("asks nothing while the library is not ready", async () => {
    const library = { ...makeLibrary(), status: "loading" };
    await mount({ library, screen: "levels" });
    expect(seen.inbox).toBe(0);
    expect(seen.keys).toBeNull();
    expect(seen.roots).toBeNull();
    expect(library.api.inbox).not.toHaveBeenCalled();
    expect(library.api.libraryList).not.toHaveBeenCalled();
  });

  it("counts the offers waiting, and reads the keys and biggest views when Home is open", async () => {
    await mount({ library: makeLibrary(), screen: "levels" });
    expect(seen.inbox).toBe(2);
    expect([...seen.keys.words]).toEqual(["Word One"]);
    expect([...seen.keys.rules]).toEqual(["g-1"]);
    expect(seen.roots).toEqual([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
  });

  it("on other screens it counts the offers but does not read the library again", async () => {
    const library = makeLibrary();
    await mount({ library, screen: "profile" });
    expect(seen.inbox).toBe(2);
    expect(library.api.libraryList).not.toHaveBeenCalled();
    expect(library.api.tree).not.toHaveBeenCalled();
    expect(seen.keys).toBeNull();
  });

  it("reads everything again when the screen changes, and the views again when the offers change", async () => {
    const library = makeLibrary();
    const rerender = await mount({ library, screen: "profile" });
    await rerender({ library, screen: "levels" });
    expect(library.api.inbox).toHaveBeenCalledTimes(2);
    expect(library.api.libraryList).toHaveBeenCalledTimes(1);
    const treeCalls = library.api.tree.mock.calls.length;
    library.api.inbox.mockResolvedValue([]);
    await act(async () => seen.refreshInbox());
    await settle();
    expect(seen.inbox).toBe(0);
    expect(library.api.tree.mock.calls.length).toBe(treeCalls + 1);
  });

  it("a failed read changes nothing", async () => {
    const library = makeLibrary({ inbox: vi.fn(async () => { throw new Error("offline"); }), libraryList: vi.fn(async () => { throw new Error("offline"); }), tree: vi.fn(async () => { throw new Error("offline"); }) });
    await mount({ library, screen: "levels" });
    expect(seen.inbox).toBe(0);
    expect(seen.keys).toBeNull();
    expect(seen.roots).toBeNull();
  });
});

describe("LibraryRoutes", () => {
  let root, host;
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  async function show(props) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<LibraryRoutes fallback={<p>skeleton</p>} route={{ token: "tok" }} words={[]} grammar={[]} levels={[]} {...props} />));
    for (let i = 0; i < 40 && host.textContent.includes("skeleton"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    await settle();
    return host.textContent;
  }
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
  const library = (status, api = {}) => ({ status, api, ids });

  it("the link page and the catalog say why they are not there yet", async () => {
    expect(await show({ screen: "join", library: library("loading") })).toBe("Loading…");
  });
  it("…and when the library is off", async () => {
    await act(async () => root?.unmount()); host?.remove();
    expect(await show({ screen: "join", library: library("off") })).toBe("Shared views aren’t available yet.");
    await act(async () => root.unmount()); host.remove();
    expect(await show({ screen: "catalog", library: library("off") })).toBe("The catalog isn’t available yet.");
    await act(async () => root.unmount()); host.remove();
    expect(await show({ screen: "catalog", library: library("loading") })).toBe("Loading…");
  });
  it("the library page shows nothing until the library is ready", async () => {
    expect(await show({ screen: "library", library: library("loading") })).toBe("");
  });
  it("a ready library shows the link page for the token in the address", async () => {
    const api = { linkInfo: vi.fn(async () => ({ valid: false, reason: "not_found" })) };
    const text = await show({ screen: "join", library: library("ready", api) });
    expect(api.linkInfo).toHaveBeenCalledWith("tok");
    expect(text).toContain("This link isn’t right");
  });
  it("…and the catalog", async () => {
    const api = { catalogList: vi.fn(async () => []) };
    const text = await show({ screen: "catalog", library: library("ready", api), isAdmin: false });
    expect(api.catalogList).toHaveBeenCalled();
    expect(text).toContain("atalog");
  });
  it("any other screen name shows nothing", async () => {
    expect(await show({ screen: "levels", library: library("ready", {}) })).toBe("");
  });
});

describe("the public surface of the module", () => {
  it("is small and listed", () => {
    expect(Object.keys(publicApi).sort()).toEqual(["LibraryRoutes", "MyViewsHome", "homeLimits", "keepInLibrary", "scopeIsEmpty", "scopeOfView", "useLibrary", "useLibraryHome", "useMyViews", "useViewScope"]);
  });
});
