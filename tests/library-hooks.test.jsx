// @vitest-environment jsdom
// The two hooks that hold the module's state: useLibrary (is the library on,
// the API and the key <-> id maps) and useViews (the library screen's tree,
// open view and "run a change"). Both are driven here through fake APIs.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ local: false, api: null, loadIds: null }));
vi.mock("../src/lib/supabase", () => ({ get isLocalMode() { return env.local; }, supabase: { marker: "sb" } }));
vi.mock("../src/features/library/libraryApi", async (orig) => {
  const actual = await orig();
  return { ...actual, getLibraryApi: (...a) => (env.local ? actual.getLibraryApi(...a) : env.api) };
});
vi.mock("../src/features/library/libraryIds", async (orig) => ({ ...(await orig()), loadIds: (...a) => env.loadIds(...a) }));

import { useLibrary } from "../src/features/library/useLibrary.js";
import { useViews } from "../src/features/library/useViews.js";
import { identityIds } from "../src/features/library/libraryIds.js";

let root, host, seen;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount(Component, props) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Component {...props} />));
  await settle();
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = seen = undefined; });
beforeEach(() => { env.local = false; env.api = null; env.loadIds = null; window.localStorage.clear(); });

function LibraryProbe(props) { seen = useLibrary(props); return null; }
function ViewsProbe(props) { seen = useViews(props); return null; }

describe("useLibrary", () => {
  const ids = { senseOf: (k) => `id-${k}`, keyOfSense: (i) => i, ruleOf: (k) => k, keyOfRule: (i) => i };

  it("waits while it is not enabled: nothing is asked of the server", async () => {
    env.api = { tree: vi.fn() };
    await mount(LibraryProbe, { enabled: false, me: "u1" });
    expect(seen.status).toBe("loading");
    expect(env.api.tree).not.toHaveBeenCalled();
  });

  it("online, ready once the tables answer and the dictionary has been copied", async () => {
    env.api = { tree: vi.fn(async () => []) };
    env.loadIds = vi.fn(async () => ({ ids, words: 12, rules: 3 }));
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    expect(seen.status).toBe("ready");
    expect(seen.api).toBe(env.api);
    expect(seen.ids).toBe(ids);
    expect(env.loadIds).toHaveBeenCalledWith({ marker: "sb" });
  });

  it("online, off (never half-working) when the tables are not there yet", async () => {
    env.api = { tree: vi.fn(async () => { throw new Error("relation does not exist"); }) };
    env.loadIds = vi.fn();
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    expect(seen.status).toBe("off");
    expect(env.loadIds).not.toHaveBeenCalled();
  });

  it("online, off when the dictionary has not been copied (no words)", async () => {
    env.api = { tree: async () => [] };
    env.loadIds = async () => ({ ids, words: 0, rules: 0 });
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    expect(seen.status).toBe("off");
  });

  it("online, off when loading the ids fails", async () => {
    env.api = { tree: async () => [] };
    env.loadIds = async () => { throw new Error("network"); };
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    expect(seen.status).toBe("off");
  });

  it("refreshIds reloads the map once ready, and changes nothing while off", async () => {
    env.api = { tree: async () => [] };
    const second = { ...ids, senseOf: (k) => `new-${k}` };
    env.loadIds = vi.fn().mockResolvedValueOnce({ ids, words: 1, rules: 0 }).mockResolvedValueOnce({ ids: second, words: 2, rules: 0 });
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    let returned;
    await act(async () => { returned = await seen.refreshIds(); });
    expect(returned).toBe(second);
    expect(seen.ids).toBe(second);
  });

  it("refreshIds while the library is off does not turn it on", async () => {
    env.api = { tree: async () => { throw new Error("no"); } };
    env.loadIds = async () => ({ ids, words: 5, rules: 0 });
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    await act(async () => { await seen.refreshIds(); });
    expect(seen.status).toBe("off");
  });

  it("local mode is ready at once, a key is its own id, and only known words can be added", async () => {
    env.local = true;
    await mount(LibraryProbe, { enabled: true, me: "u1", knownWord: (k) => k === "Real" });
    expect(seen.status).toBe("ready");
    expect(seen.ids).toBe(identityIds);
    expect(await seen.api.libraryAdd(["Real", "Made up"])).toEqual(["Real"]);
    expect(await seen.refreshIds()).toBe(identityIds);
  });

  it("local mode learns who the player's friends are from the app, not from the friends module", async () => {
    env.local = true;
    const people = { areFriends: vi.fn((a, b) => a === "u1" && b === "u2"), nameOf: (id) => `name-${id}` };
    await mount(LibraryProbe, { enabled: true, me: "u1", people });
    const view = await seen.api.create("Trip");
    expect(await seen.api.share(view, ["u2"])).toBe(1);                          // a friend
    await expect(seen.api.share(view, ["u3"])).rejects.toThrow(/only with your friends/);
    expect(people.areFriends).toHaveBeenCalled();
  });

  it("local mode with no people given has no friends", async () => {
    env.local = true;
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    const view = await seen.api.create("Trip");
    await expect(seen.api.share(view, ["u2"])).rejects.toThrow(/only with your friends/);
  });

  it("local mode keeps one library for each player", async () => {
    env.local = true;
    await mount(LibraryProbe, { enabled: true, me: "u1" });
    await seen.api.libraryAdd(["Real"]);
    await act(async () => root.render(<LibraryProbe enabled me="u2" />));
    await settle();
    expect((await seen.api.libraryList()).words).toEqual([]);
  });
});

describe("useViews", () => {
  const flat = [
    { id: "t", parent: null, name: "Top", position: 1, words: 1, rules: 0 },
    { id: "c", parent: "t", name: "Child", position: 1, words: 0, rules: 1 },
  ];
  const makeApi = (over = {}) => ({
    tree: vi.fn(async () => flat),
    contents: vi.fn(async () => [{ kind: "sense", id: "s1" }, { kind: "sense", id: "gone" }, { kind: "rule", id: "r1" }]),
    libraryList: vi.fn(async () => ({ words: [{ id: "s1", views: 1 }, { id: "gone", views: 0 }], rules: [{ id: "r1" }, { id: "r-gone" }] })),
    ...over,
  });
  const keys = { keyOfSense: (id) => ({ s1: "Word One" })[id], keyOfRule: (id) => ({ r1: "g-1" })[id] };

  it("loads my views as a tree, and my whole library by key, leaving out what has no key any more", async () => {
    await mount(ViewsProbe, { api: makeApi(), ids: keys });
    expect(seen.loading).toBe(false);
    expect(seen.rows.map((v) => `${v.depth}:${v.name}`)).toEqual(["0:Top", "1:Child"]);
    expect(seen.mine.words.map((w) => w.key)).toEqual(["Word One"]);
    expect(seen.mine.rules.map((r) => r.key)).toEqual(["g-1"]);
  });

  it("opening a view reads what is directly in it, by key", async () => {
    const api = makeApi();
    await mount(ViewsProbe, { api, ids: keys });
    expect(seen.view).toBeNull();
    expect(seen.inside).toEqual({ words: [], rules: [] });
    await act(async () => seen.select("t"));
    await settle();
    expect(api.contents).toHaveBeenCalledWith("t", false);
    expect(seen.view.id).toBe("t");
    expect(seen.inside).toEqual({ words: ["Word One"], rules: ["g-1"] });
  });

  it("selecting something that is not a view of mine opens nothing", async () => {
    await mount(ViewsProbe, { api: makeApi(), ids: keys });
    await act(async () => seen.select("someone-elses"));
    expect(seen.view).toBeNull();
  });

  it("a change runs, everything is reloaded, the player is told, and busy is off again", async () => {
    const api = makeApi();
    await mount(ViewsProbe, { api, ids: keys });
    const before = api.tree.mock.calls.length;
    let out;
    await act(async () => { out = await seen.act(async () => 7, (n) => `Changed ${n}.`); });
    expect(out).toBe(7);
    expect(api.tree.mock.calls.length).toBe(before + 1);
    expect(seen.notice).toEqual({ kind: "ok", text: "Changed 7." });
    expect(seen.busy).toBe(false);
  });

  it("a change that fails says why, returns nothing, and does not reload", async () => {
    const api = makeApi();
    await mount(ViewsProbe, { api, ids: keys });
    const before = api.tree.mock.calls.length;
    let out = "unset";
    await act(async () => { out = await seen.act(async () => { throw new Error("That view does not exist."); }, "Done."); });
    expect(out).toBeUndefined();
    expect(seen.notice).toEqual({ kind: "error", text: "That view does not exist." });
    expect(seen.busy).toBe(false);
    expect(api.tree.mock.calls.length).toBe(before);
  });

  it("a new change clears the last message", async () => {
    await mount(ViewsProbe, { api: makeApi(), ids: keys });
    await act(async () => { await seen.act(async () => { throw new Error("first"); }); });
    await act(async () => { await seen.act(async () => 1); });          // no text to show
    expect(seen.notice).toBeNull();
  });

  it("if the views cannot be read, the screen shows an empty list and the reason", async () => {
    await mount(ViewsProbe, { api: makeApi({ tree: vi.fn(async () => { throw new Error("You're offline. The library needs a connection."); }) }), ids: keys });
    expect(seen.loading).toBe(false);
    expect(seen.flat).toEqual([]);
    expect(seen.notice).toMatchObject({ kind: "error", text: expect.stringMatching(/offline/) });
  });

  it("if the library list cannot be read, it is empty and there is no error banner", async () => {
    await mount(ViewsProbe, { api: makeApi({ libraryList: vi.fn(async () => { throw new Error("x"); }) }), ids: keys });
    expect(seen.mine).toEqual({ words: [], rules: [] });
    expect(seen.notice).toBeNull();
  });
});
