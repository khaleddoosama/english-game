// @vitest-environment jsdom
// /join/<token>: what a friend shared by link, and taking your own copy.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JoinPage from "../src/features/library/JoinPage.jsx";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
let root, host, storage, ann, bob, token, view;
const names = { a: "ann", b: "bob" };
const as = (u) => createLocalLibraryApi({ storage, me: () => u, nameOf: (id) => names[id] });
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  storage = memory(); ann = as("a"); bob = as("b");
  view = await ann.create("A1.1 sports"); await ann.add(view, ["w1", "w2"]);
  token = (await ann.linkCreate(view)).token;
});
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const render = async (api, t = token, props = {}) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<JoinPage api={api} token={t} {...props} />));
  await flush();
};
const $ = (s) => host.querySelector(s);
const button = (text) => [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

describe("JoinPage", () => {
  it("shows who shared what, and takes a copy", async () => {
    const onTaken = vi.fn();
    await render(bob, token, { onTaken });
    expect(host.textContent).toContain("ann");
    expect(host.textContent).toContain("A1.1 sports");
    expect(host.textContent).toContain("2 words");
    await click(button("Add to my library"));
    expect(host.textContent).toContain("Added “A1.1 sports (from ann)”");
    expect(onTaken).toHaveBeenCalledWith(expect.objectContaining({ words: 2 }));
    expect((await bob.tree()).map((v) => v.name)).toEqual(["A1.1 sports (from ann)"]);
    await click(button("Open my views"));
    expect(onTaken).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  it("a link that doesn't work says why", async () => {
    await render(bob, "nonsense");
    expect($(".lib-notice.error").textContent).toMatch(/isn’t right/);
    await act(async () => root.unmount());
    await ann.linkRevoke(token);
    await render(bob);
    expect($(".lib-notice.error").textContent).toMatch(/took this link back/);
  });

  it("the owner sees it is their own view and can't take it", async () => {
    await render(ann);
    expect(host.textContent).toContain("This is your own view");
    expect(button("Add to my library").disabled).toBe(true);
  });

  it("someone who already took it is told so", async () => {
    await bob.linkAccept(token);
    await render(bob);
    expect(host.textContent).toContain("already have a copy");
    expect(button("Open my copy")).toBeTruthy();
    await click(button("Open my copy"));
    expect(host.textContent).toContain("already have this one");
    expect((await bob.tree()).length).toBe(1);
  });

  it("a failed take shows the error", async () => {
    const api = { linkInfo: async () => ({ valid: true, name: "X", from: "ann", words: 1, rules: 0, views: 1 }), linkAccept: async () => { throw new Error("You do not have room for 1 more views (the most is 200)."); } };
    await render(api);
    await click(button("Add to my library"));
    expect($(".lib-notice.error").textContent).toContain("do not have room");
  });
});
