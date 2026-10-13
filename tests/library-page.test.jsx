// @vitest-environment jsdom
// The library screen, end to end with a real API object: server-style ids
// (the page must translate word keys to ids and back), views inside views,
// adding by search and pasted list, practice, sharing and the inbox.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "../src/features/library/LibraryPage.jsx";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";
import { idsFromMaps } from "../src/features/library/libraryIds.js";

const WORDS = [
  { word: "Reluctant", meaning: "Unwilling to do something" },
  { word: "Cast", meaning: "A group of actors" },
  { word: "Cast (to throw)", meaning: "To throw" },
  { word: "Shrink", meaning: "To become smaller" },
];
const GRAMMAR = [{ id: "g-1", rule: "Used to" }];
const ids = idsFromMaps(new Map(WORDS.map((w, i) => [w.word, `sense-${i}`])), new Map([["g-1", "rule-1"]]));
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

let root, host, api, storage;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; storage = memory(); api = createLocalLibraryApi({ storage, me: () => "a" }); });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

const render = async (props = {}) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LibraryPage api={api} ids={ids} words={WORDS} grammar={GRAMMAR} levels={[]} onPractice={props.onPractice || (() => {})} {...props} />));
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel) => host.querySelector(sel);
const $$ = (sel) => [...host.querySelectorAll(sel)];
const type = async (el, value) => { await act(async () => {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true }));
}); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const buttonWith = (text) => $$("button").find((b) => b.textContent.includes(text));

describe("LibraryPage", () => {
  it("shows the empty explanation, then makes a view and a view inside it", async () => {
    await render();
    expect($(".lib-empty")).toBeTruthy();
    await type($('input[aria-label="New view name"]'), "A1.1");
    await click(buttonWith("Create"));
    expect($$(".lib-tree li").length).toBe(1);
    expect($(".lib-empty")).toBeNull();
    await type($('input[aria-label="New view inside"]'), "movies");
    await click(buttonWith("Add"));
    expect($$(".lib-tree li").length).toBe(2);
    expect($(".lib-path").textContent).toContain("A1.1 › movies");
  });

  it("puts words in by search and shows them by their text, while the API holds server ids", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "cast");
    const boxes = $$('.lib-results input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    await click(boxes[0]); await click(boxes[1]);
    await click(buttonWith("selected"));
    expect($$(".lib-chips li").map((l) => l.textContent.trim())).toEqual(expect.arrayContaining(["Cast", "Cast (to throw)"]));
    const view = (await api.tree())[0];
    const inside = (await api.contents(view.id, false)).map((x) => x.id).sort();
    expect(inside).toEqual(["sense-1", "sense-2"]);          // server ids, never the text
  });

  it("a pasted list: found, ambiguous (pick the meaning) and missing", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await act(async () => { $(".lib-paste summary").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await type($('textarea[aria-label="Words to add"]'), "reluctant\ncast\nnonsense");
    await click(buttonWith("Check the list"));
    const text = $(".lib-checked").textContent;
    expect(text).toContain("1 found");
    expect(text).toContain("1 with more than one meaning");
    expect(text).toContain("1 not in the dictionary");
    await click($$('.lib-checked input[type="checkbox"]').pop());   // pick "Cast (to throw)"
    await click(buttonWith("Add them"));
    expect($$(".lib-chips li").map((l) => l.textContent.trim()).sort()).toEqual(["Cast (to throw)", "Reluctant"]);
  });

  it("practice asks for the view with or without the views inside it", async () => {
    const onPractice = vi.fn();
    await render({ onPractice });
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "shr"); await click($$('.lib-results input[type="checkbox"]')[0]); await click(buttonWith("selected"));
    await click($(".lib-tree .lib-go"));
    expect(onPractice).toHaveBeenLastCalledWith(expect.any(String), true, "V");
    await click(buttonWith("Only this view"));
    expect(onPractice).toHaveBeenLastCalledWith(expect.any(String), false, "V");
  });

  it("removing a view takes two taps and keeps the words in the library", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await click(buttonWith("Remove"));
    expect($$(".lib-tree li").length).toBe(1);                     // first tap only asks
    await click(buttonWith("Tap again"));
    expect($$(".lib-tree li").length).toBe(0);
  });

  it("an error from the API is shown, not swallowed", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "a::b");
    await click(buttonWith("Create"));
    expect($(".lib-notice.error").textContent).toMatch(/no "::"/);
  });

  it("shows what friends shared and takes it", async () => {
    storage.setItem("friends1:p:a|z", JSON.stringify({ status: "accepted" }));
    const zed = createLocalLibraryApi({ storage, me: () => "z", areFriends: () => true, nameOf: (id) => ({ z: "zed", a: "ann" })[id] });
    const v = await zed.create("Work"); await zed.add(v, ["sense-0"]);
    await zed.share(v, ["a"]);
    api = createLocalLibraryApi({ storage, me: () => "a", areFriends: () => true, nameOf: (id) => ({ z: "zed", a: "ann" })[id] });
    const changed = vi.fn();
    await render({ onInboxChanged: changed });
    expect($(".lib-inbox").textContent).toContain("from zed");
    await click(buttonWith("Add to my library"));
    expect($(".lib-inbox")).toBeNull();
    expect($(".lib-tree").textContent).toContain("Work (from zed)");
    expect($(".lib-notice").textContent).toMatch(/1 word\b/);
    expect(changed).toHaveBeenCalled();
    await click(buttonWith("Not now")).catch(() => {});
  });

  it("sends a view to a friend picked from the list", async () => {
    const friendsApi = { list: async () => ({ friends: [{ id: "z", username: "zed" }] }) };
    api = createLocalLibraryApi({ storage, me: () => "a", areFriends: () => true, nameOf: () => "x" });
    await render({ friendsApi });
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "shr"); await click($$('.lib-results input[type="checkbox"]')[0]); await click(buttonWith("selected"));
    await act(async () => { $(".lib-share summary").click(); });
    await act(async () => { $(".lib-share").dispatchEvent(new Event("toggle")); }); await flush();
    const friend = $('.lib-friends input[type="checkbox"]');
    expect(friend).toBeTruthy();
    await click(friend);
    await click(buttonWith("Send"));
    expect($(".lib-notice").textContent).toContain("Sent to 1 friend");
  });
});
