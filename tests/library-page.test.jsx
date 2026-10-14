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

  it("/library?new=1&parent=<id> makes the new view inside that one", async () => {
    const top = await api.create("A1.1");
    window.history.replaceState({}, "", `/library?new=1&parent=${encodeURIComponent(top)}`);
    await render(); await flush();
    expect($(".lib-make").textContent).toContain("New view inside A1.1");
    await type($('input[aria-label="New view name"]'), "Articles");
    await click($$(".lib-make button").find((b) => b.textContent.includes("Create")));
    const tree = await api.tree();
    expect(tree.find((v) => v.name === "Articles").parent).toBe(top);
    window.history.replaceState({}, "", "/");
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

describe("words the dictionary doesn't have yet", () => {
  it("offers Ask AI for a missing word in a pasted list and for a search with no result", async () => {
    const onAskWord = vi.fn();
    await render({ onAskWord });
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "zebra");
    await click($$("button").find((b) => b.textContent.includes("Ask AI about it")));
    expect(onAskWord).toHaveBeenLastCalledWith("zebra");
    await act(async () => { $(".lib-paste summary").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await type($('textarea[aria-label="Words to add"]'), "reluctant\nquokka");
    await click(buttonWith("Check the list"));
    await click($('button[aria-label="Ask AI about quokka"]'));
    expect(onAskWord).toHaveBeenLastCalledWith("quokka");
  });

  it("a word added after the app started: the id map is reloaded once, then it is added", async () => {
    let map = idsFromMaps(new Map(WORDS.map((w, i) => [w.word, `sense-${i}`])), new Map());
    const words = [...WORDS, { word: "Quokka", meaning: "A small marsupial" }];
    const onRefreshIds = vi.fn(async () => { map = idsFromMaps(new Map([...WORDS.map((w, i) => [w.word, `sense-${i}`]), ["Quokka", "sense-9"]]), new Map()); return map; });
    await render({ words, ids: map, onRefreshIds });
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "quokka");
    await click($$('.lib-results input[type="checkbox"]')[0]);
    await click(buttonWith("selected"));
    expect(onRefreshIds).toHaveBeenCalledTimes(1);
    const view = (await api.tree())[0];
    expect((await api.contents(view.id, false)).map((x) => x.id)).toEqual(["sense-9"]);
  });

  it("still unknown after the reload: nothing is added and the notice says why", async () => {
    const words = [...WORDS, { word: "Quokka", meaning: "A small marsupial" }];
    const onRefreshIds = vi.fn(async () => ids);
    await render({ words, onRefreshIds });
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "quokka");
    await click($$('.lib-results input[type="checkbox"]')[0]);
    await click(buttonWith("selected"));
    expect($(".lib-notice.error").textContent).toMatch(/not in the library yet \(Quokka\)/);
    const view = (await api.tree())[0];
    expect(await api.contents(view.id, false)).toEqual([]);
  });
});

describe("a view with many items", () => {
  it("shows rules that share a title as one chip with a count, and caps the word list", async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ word: `Word${i}`, meaning: "m" }));
    const rules = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, rule: "Subject pronouns" })).concat([{ id: "g9", rule: "Articles" }]);
    const mapIds = idsFromMaps(new Map(many.map((w) => [w.word, `s-${w.word}`])), new Map(rules.map((r) => [r.id, `r-${r.id}`])));
    const view = await api.create("Big");
    await api.add(view, many.map((w) => `s-${w.word}`));
    await api.addRules(view, rules.map((r) => `r-${r.id}`));
    await render({ words: many, grammar: rules, ids: mapIds });
    await click($(".lib-tree .lib-name"));
    expect($$(".lib-chips li:not(.rule)").length).toBe(60);
    expect($$(".lib-chips li.rule").map((l) => l.textContent.trim()).sort()).toEqual(["Articles", "Subject pronouns ×5"]);
    await click($(".lib-panel .lib-link"));
    expect($$(".lib-chips li:not(.rule)").length).toBe(70);
  });
});

describe("the library (all my words) and the views", () => {
  const pre = async () => {
    const v = await api.create("V");
    await api.add(v, ["sense-0", "sense-3"]);        // Reluctant, Shrink: in a view
    await api.libraryAdd(["sense-1"]);                // Cast: in my library, in no view
    return v;
  };
  const tab = (name) => $$('[role="tab"]').find((t) => t.textContent.startsWith(name));

  it("two tabs: Views (default) and Library, each with a count", async () => {
    await pre(); await render();
    expect($$('[role="tab"]').map((t) => t.textContent.replace(/\s+/g, " ").trim())).toEqual(["Views 1", "Library 3"]);
    expect(tab("Views").getAttribute("aria-selected")).toBe("true");
  });

  it("the Library tab lists every word I have, how many views each is in, and those in no view", async () => {
    await pre(); await render();
    await click(tab("Library"));
    expect($(".lib-summary").textContent).toContain("3 words in your library · 1 not in any view");
    const rows = $$(".lib-results li").map((li) => li.textContent.replace(/\s+/g, " "));
    expect(rows.some((r) => r.includes("Reluctant") && r.includes("in 1 view"))).toBe(true);
    expect(rows.some((r) => r.includes("Cast") && r.includes("no view"))).toBe(true);
    await click($$(".lib-source .chip").find((b) => b.textContent.startsWith("Not in a view")));
    expect($$(".lib-results li").length).toBe(1);
    await type($('input[aria-label="Search your library"]'), "zzz");
    expect($(".lib-words").textContent).toContain("Nothing matches");
  });

  it("tick words and put them in a view; words already in it are marked", async () => {
    const v = await pre();
    const w = await api.create("W");
    await render();
    await click(tab("Library"));
    expect($(".lib-actionbar")).toBeNull();                                   // nothing picked, no bar
    await click($$('.lib-results input[type="checkbox"]').find((c) => c.closest("li").textContent.includes("Cast")));
    expect($(".lib-actionbar").textContent).toContain("1 word selected");
    await act(async () => { const sel = $('select[aria-label="Add to view"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(sel, w); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await click($$(".lib-actionbar button").find((b) => b.textContent === "Add"));
    expect($(".lib-notice").textContent).toContain("Added 1 to the view.");
    expect((await api.contents(w, false)).map((x) => x.id)).toEqual(["sense-1"]);
    expect($(".lib-actionbar")).toBeNull();                                   // the selection is cleared
    expect(v).toBeTruthy();
  });

  it("Select all shown picks everything on the screen, and Clear shown undoes it", async () => {
    await pre(); await render();
    await click(tab("Library"));
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    expect($(".lib-actionbar").textContent).toContain("3 words selected");
    await click($$("button").find((b) => b.textContent === "Clear shown"));
    expect($(".lib-actionbar")).toBeNull();
  });

  it("make a new view from the ticked words", async () => {
    await pre(); await render();
    await click(tab("Library"));
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    await click($$(".lib-actionbar button").find((b) => b.textContent === "New view…"));
    await type($('input[aria-label="New view from these words"]'), "Fresh");
    await click($$(".lib-actionbar button").find((b) => b.textContent === "Create and add"));
    expect($(".lib-notice").textContent).toContain("Made “Fresh” with 3 words.");
    expect(tab("Views").getAttribute("aria-selected")).toBe("true");          // it opens the new view
    const fresh = (await api.tree()).find((x) => x.name === "Fresh");
    expect((await api.contents(fresh.id, false)).length).toBe(3);
  });

  it("removing the ticked words from the library takes two taps and takes them out of their views too", async () => {
    const v = await pre(); await render();
    await click(tab("Library"));
    await click($$('.lib-results input[type="checkbox"]').find((c) => c.closest("li").textContent.includes("Reluctant")));
    await click($$(".lib-actionbar button").find((b) => b.textContent === "Remove from library"));
    expect($(".lib-actionbar").textContent).toContain("Tap again to remove from library");   // the first tap only asks
    await click($$(".lib-actionbar button").find((b) => b.textContent.startsWith("Tap again")));
    expect($(".lib-notice").textContent).toContain("Removed 1 word from your library.");
    expect((await api.contents(v, false)).map((x) => x.id)).toEqual(["sense-3"]);
    expect((await api.libraryList()).words.map((w) => w.id).sort()).toEqual(["sense-1", "sense-3"]);
  });

  it("an empty library says how to fill it", async () => {
    await render();
    await click(tab("Library"));
    expect($(".lib-empty").textContent).toContain("no words yet");
  });

  it("adding words to a view starts from my library, and can switch to the dictionary", async () => {
    const v = await pre(); await render();
    await click($(".lib-tree .lib-name"));
    expect($('.lib-source .chip.on').textContent).toContain("From my library (3)");
    await type($('input[aria-label="Search words"]'), "shrink");
    expect($$(".lib-results li").length).toBe(1);
    expect($(".lib-results li").textContent).toContain("in this view");               // Shrink is already in V
    expect($('.lib-results input[type="checkbox"]').disabled).toBe(true);
    await type($('input[aria-label="Search words"]'), "none");
    await type($('input[aria-label="Search words"]'), "zzzz");
    expect($(".lib-panel").textContent).toContain("in your library");
    await click($$("button").find((b) => b.textContent === "Search the dictionary"));
    expect($('.lib-source .chip.on').textContent).toContain("From the dictionary");
    expect(v).toBeTruthy();
  });

  it("with nothing in my library yet, adding starts from the dictionary", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    expect($('.lib-source .chip.on').textContent).toContain("From the dictionary");
  });
});

describe("sharing by link", () => {
  const sharePanel = async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "V"); await click(buttonWith("Create"));
    await type($('input[aria-label="Search words"]'), "shr"); await click($$('.lib-results input[type="checkbox"]')[0]); await click(buttonWith("selected"));
    await act(async () => { $(".lib-share summary").click(); await new Promise((r) => setTimeout(r, 0)); });
  };

  it("Get a link shows it with Copy and Take it back; taking it back stops it", async () => {
    await sharePanel();
    await click(buttonWith("Get a link"));
    const url = $('input[aria-label="Link to this view"]').value;
    expect(url).toMatch(/\/join\/[a-z0-9]{20,}$/);
    expect($(".lib-link-box").textContent).toContain("works for 30 days");
    const token = url.split("/join/")[1];
    expect((await api.linkInfo(token)).valid).toBe(true);
    await click(buttonWith("Take it back"));
    expect($('input[aria-label="Link to this view"]')).toBeNull();
    expect((await api.linkInfo(token)).reason).toBe("taken_back");
  });

  it("asking again shows the same link", async () => {
    await sharePanel();
    await click(buttonWith("Get a link"));
    const first = $('input[aria-label="Link to this view"]').value;
    expect((await api.linkCreate((await api.tree())[0].id)).token).toBe(first.split("/join/")[1]);
  });

  it("a view with nothing in it can't get a link", async () => {
    await render();
    await type($('input[aria-label="New view name"]'), "Empty"); await click(buttonWith("Create"));
    await act(async () => { $(".lib-share summary").click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(buttonWith("Get a link").disabled).toBe(true);
  });
});
