// @vitest-environment jsdom
// My views on the home screen is read only: browse and practise; the pencil and + go to the library page.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyViewsHome from "../src/features/library/components/MyViewsHome.jsx";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
let root, host, api;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; api = createLocalLibraryApi({ storage: memory(), me: () => "a" }); window.history.replaceState({}, "", "/"); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const render = async (props = {}) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MyViewsHome api={api} onPractice={() => {}} {...props} />));
  await flush();
};
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

describe("MyViewsHome", () => {
  it("no views: says how to make one", async () => {
    await render();
    expect($(".lib-empty").textContent).toContain("Tap + to make one");
  });

  it("lists the views as a tree, read only: no inputs, no remove, no rename, no add words", async () => {
    const top = await api.create("A1.1"); await api.create("sports", top);
    await api.add(top, ["w1"]);
    await render();
    expect($$(".lib-readonly .wh-level-card").map((li) => li.textContent.replace(/\s+/g, " ").trim())).toEqual(expect.arrayContaining([expect.stringContaining("A1.1"), expect.stringContaining("sports")]));
    expect($(".lib-readonly").textContent).toContain("0 mastered · 0 learned · 0 familiar · 0 new");   // the same card as the lessons
    expect($$("input, textarea, select").length).toBe(0);
    expect($$("button").map((b) => b.textContent.trim()).filter((t) => /Remove|Rename|Move|Create|Add|Share/.test(t))).toEqual([]);
  });

  it("Practise asks for the view with the views inside it", async () => {
    const top = await api.create("A1.1"); await api.add(top, ["w1"]);
    const onPractice = vi.fn();
    await render({ onPractice });
    await click($(".lib-go"));
    expect(onPractice).toHaveBeenCalledWith(top, true, "A1.1");
  });

  it("an empty view can't be practised", async () => {
    await api.create("Empty");
    await render();
    expect($(".lib-go").disabled).toBe(true);
  });

  it("the pencil opens that view in the library page; My library opens it plain", async () => {
    const top = await api.create("A1.1");
    await render();
    await click($('button[aria-label="Edit A1.1"]'));
    expect(window.location.pathname + window.location.search).toBe(`/library?view=${encodeURIComponent(top)}`);
    await click($$("button").find((b) => b.textContent === "My library"));
    expect(window.location.pathname).toBe("/library");
  });

  it("views friends shared are mentioned, with a way to open them", async () => {
    await render({ offers: 2 });
    expect($(".lib-offers").textContent).toContain("2 views shared with you");
    await click($(".lib-offers"));
    expect(window.location.pathname).toBe("/library");
  });

  it("a view with views inside is a heading with an All card and a card for each, like Gateway", async () => {
    const g = await api.create("Gateway"); const a = await api.create("A1.1", g); await api.create("Articles", a); await api.create("Pronouns", a);
    await api.add(a, ["w1"]);
    await render();
    expect($$(".lib-readonly h3").map((h) => h.textContent.replace(/\s+/g, " ").trim().split(" ")[0])).toEqual(["Gateway", "A1.1"]);
    const titles = $$(".lib-readonly .wh-level-title").map((t) => t.textContent);
    expect(titles).toEqual(["All of Gateway", "All of A1.1", "Articles", "Pronouns"]);
  });

  it("opens the catalog", async () => {
    await render();
    await click($$("button").find((b) => b.textContent === "Catalog"));
    expect(window.location.pathname).toBe("/catalog");
  });

  it("any depth works: every view with views inside is a heading, with a + to add a view inside it", async () => {
    const g = await api.create("Gateway"); const a = await api.create("A1.1", g); const t = await api.create("Articles", a); await api.create("Deep", t);
    await render();
    expect($$(".lib-readonly h3").map((h) => h.textContent.trim().split(" ")[0])).toEqual(["Gateway", "A1.1", "Articles"]);
    expect($$(".lib-readonly .wh-level-title").map((x) => x.textContent)).toEqual(["All of Gateway", "All of A1.1", "All of Articles", "Deep"]);
    await click($('button[aria-label="New view inside A1.1"]'));
    expect(window.location.pathname + window.location.search).toBe(`/library?new=1&parent=${encodeURIComponent(a)}`);
  });

  it("a view with nothing inside is a card with a pencil and a + of its own", async () => {
    const z = await api.create("Z1");
    await render();
    expect($$(".lib-readonly h3").length).toBe(0);
    await click($('button[aria-label="New view inside Z1"]'));
    expect(window.location.search).toBe(`?new=1&parent=${encodeURIComponent(z)}`);
  });

  it("with a biggest view open (its name is the tab), it shows what is inside it like Gateway does", async () => {
    const g = await api.create("Gateway"); const a = await api.create("A1.1", g); await api.create("Articles", a); await api.create("Other");
    await render({ rootId: g });
    expect($$(".lib-readonly h3").map((h) => h.textContent.trim().split(" ")[0])).toEqual(["A1.1"]);
    expect($$(".lib-readonly .wh-level-title").map((x) => x.textContent)).toEqual(["All of Gateway", "All of A1.1", "Articles"]);
    await click($('button[aria-label="New view inside Gateway"]'));
    expect(window.location.search).toBe(`?new=1&parent=${encodeURIComponent(g)}`);
  });

  it("an open biggest view with nothing inside is one card", async () => {
    const z = await api.create("Z1");
    await render({ rootId: z });
    expect($$(".lib-readonly .wh-level-title").map((x) => x.textContent)).toEqual(["Z1"]);
  });

  it("a biggest view that is gone shows a note, not every other view", async () => {
    await api.create("Other");
    await render({ rootId: "gone" });
    expect($(".lib-readonly .wh-level-card")).toBeNull();
    expect($(".lib-home").textContent).toContain("isn’t here any more");
  });
});
