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
    expect($$(".lib-readonly li").map((li) => li.textContent.replace(/\s+/g, " ").trim())).toEqual(expect.arrayContaining([expect.stringContaining("A1.1"), expect.stringContaining("sports")]));
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

  it("the pencil opens that view in the library page; + opens it ready to make one; My library opens it plain", async () => {
    const top = await api.create("A1.1");
    await render();
    await click($('button[aria-label="Edit A1.1"]'));
    expect(window.location.pathname + window.location.search).toBe(`/library?view=${encodeURIComponent(top)}`);
    await click($('button[aria-label="New view"]'));
    expect(window.location.pathname + window.location.search).toBe("/library?new=1");
    await click($$("button").find((b) => b.textContent === "My library"));
    expect(window.location.pathname).toBe("/library");
  });

  it("views friends shared are mentioned, with a way to open them", async () => {
    await render({ offers: 2 });
    expect($(".lib-offers").textContent).toContain("2 views shared with you");
    await click($(".lib-offers"));
    expect(window.location.pathname).toBe("/library");
  });
});
