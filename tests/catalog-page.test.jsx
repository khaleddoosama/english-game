// @vitest-environment jsdom
// /catalog: search, take a copy, take your own entry down.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CatalogPage from "../src/features/library/CatalogPage.jsx";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
let root, host, storage, ann, bob, clock;
const as = (user, isAdmin) => createLocalLibraryApi({ storage, me: () => user, isAdmin, now: () => ++clock, nameOf: (id) => ({ a: "ann", b: "bob" })[id] });
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; storage = memory(); clock = 1000; window.history.replaceState({}, "", "/catalog");
  ann = as("a"); bob = as("b");
  const top = await ann.create("Movies"); await ann.add(top, ["w1", "w2"]);
  await ann.catalogPublish(top, "Movie night", "Scary and fun");
});
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });
const render = async (api, props = {}) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<CatalogPage api={api} {...props} />));
  await flush();
};
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const type = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }); await flush(); };

describe("CatalogPage", () => {
  it("lists what people published, with who and what it holds", async () => {
    await render(bob);
    const t = $(".lib-catalog-list").textContent;
    expect(t).toContain("Movie night"); expect(t).toContain("Scary and fun"); expect(t).toContain("by ann"); expect(t).toContain("2 words");
  });
  it("searches, and says when nothing matches", async () => {
    await render(bob);
    await type($('input[aria-label="Search the catalog"]'), "zzz");
    expect($(".lib-empty").textContent).toContain("Nothing matches");
    await type($('input[aria-label="Search the catalog"]'), "scary");
    expect($$(".lib-catalog-list li").length).toBe(1);
  });
  it("Add to my library gives my own copy, and the page says so", async () => {
    await render(bob);
    await click($$("button").find((b) => b.textContent === "Add to my library"));
    expect($(".lib-notice").textContent).toContain("Added “Movies (from ann)”: 2 words.");
    expect((await bob.tree()).length).toBe(1);
    expect($$("button").some((b) => b.textContent === "Add again")).toBe(true);
  });
  it("my own entry can be taken down, not added", async () => {
    await render(ann);
    expect($$("button").some((b) => b.textContent === "Add to my library")).toBe(false);
    await click($$("button").find((b) => b.textContent === "Take it down"));
    expect($(".lib-empty").textContent).toContain("The catalog is empty");
  });
  it("an admin can remove someone else's", async () => {
    await render(bob, { isAdmin: true });
    expect($$("button").some((b) => b.textContent === "Remove")).toBe(true);
  });
  it("an empty catalog says how to fill it", async () => {
    storage = memory(); await render(as("b"));
    expect($(".lib-empty").textContent).toContain("Publish one of your views");
  });
});
