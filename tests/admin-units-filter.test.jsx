// @vitest-environment jsdom
// The Unit filter of the admin's Words and Grammar lists: options from the list, All units and Without unit,
// items in several units, the address (?unit=), the other filters and the search, page 1 again, and the empty state.
// Made-up content only.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Words } from "../src/features/admin/sections/Words.jsx";
import { Grammar } from "../src/features/admin/sections/Grammar.jsx";

const word = (name, extra = {}) => ({ word: name, type: "vocab", category: "Food", meaning: `${name} meaning`, situation: `A ${name} here.`, gap: "A ______ here.", hints: ["h"], ...extra });
// 26 words in Food, unit "Unit 10", so the list has two pages of 25; then the ones that matter.
const filler = Array.from({ length: 26 }, (_, i) => word(`Filler${String(i).padStart(2, "0")}`, { units: ["Unit 10"] }));
const WORDS = [
  ...filler,
  word("Apple", { units: ["Unit 2", "Unit 10"] }),             // two units
  word("Bread", { units: ["Unit 2"], category: "Bakery" }),
  word("Cheese", { units: [] }),                                 // empty list
  word("Dates"),                                                 // no units
  word("Eggs", { units: ["Unit 1"], category: "Unit 2" }),       // a lesson called "Unit 2" is not the unit
];
const RULES = [
  { id: "g-1", rule: "Past simple", category: "Grammar A", units: ["Unit 2", "Unit 3"], questions: [{ type: "choose", prompt: "I ___ it.", options: ["saw", "see"], answer: "saw" }] },
  { id: "g-2", rule: "Articles", category: "Grammar A", questions: [{ type: "choose", prompt: "___ apple", options: ["an", "a"], answer: "an" }] },
  { id: "g-3", rule: "Plurals", category: "Grammar B", units: ["Unit 3"], questions: [{ type: "choose", prompt: "two ___", options: ["cats", "cat"], answer: "cats" }] },
];
const content = { words: WORDS, grammar: RULES, levels: [{ id: "cat-Food", title: "Food" }] };
const stats = { data: [], loading: false, error: null };

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); });
// The router keeps the address it last saw; a popstate makes it read the new one.
const goTo = (url) => { window.history.replaceState({}, "", url); window.dispatchEvent(new PopStateEvent("popstate")); };
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); goTo("/"); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const render = async (ui, url) => {
  goTo(url);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(ui));
  await flush();
};
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const choose = async (label, value) => { await act(async () => {
  const el = $(`select[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}); await flush(); };
const search = async (text) => { await act(async () => {
  const el = $(".adm-search input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}); await flush(); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const params = () => Object.fromEntries(new URLSearchParams(window.location.search));
const shownWords = () => $$("tbody .adm-word b").map((b) => b.textContent);
const unitOptionsShown = () => [...$('select[aria-label="Unit"]').options].map((o) => o.textContent);

describe("Admin Words: the Unit filter", () => {
  const onUpdate = vi.fn();
  const words = (url = "/admin/words") => render(<Words content={content} wordStats={stats} mastery={{}} onUpdate={onUpdate} onOpen={() => {}} openWord={null} />, url);

  it("offers All units, Without unit, then each unit once in natural order", async () => {
    await words();
    expect(unitOptionsShown()).toEqual(["All units", "Without unit", "Unit 1", "Unit 2", "Unit 10"]);
    expect($('select[aria-label="Unit"]').value).toBe("");
  });

  it("a unit shows every word in it, also words in other units too; it goes in the address", async () => {
    await words();
    await choose("Unit", "Unit 2");
    expect(params().unit).toBe("Unit 2");
    expect(shownWords()).toEqual(["Apple", "Bread"]);              // not Eggs, whose lesson is called "Unit 2"
    await choose("Unit", "Unit 10");
    expect($(".adm-pager-info").textContent).toContain("of 27");     // the 26 fillers and Apple
    await search("bread");
    expect(shownWords()).toEqual([]);                                 // Bread is not in Unit 10
  });

  it("Without unit: no units field or an empty list", async () => {
    await words();
    await choose("Unit", "__none__");
    expect(params().unit).toBe("__none__");
    expect(shownWords()).toEqual(["Cheese", "Dates"]);
  });

  it("opens with the unit from the address, and works with the category filter and the search", async () => {
    await words("/admin/words?unit=Unit%202");
    expect($('select[aria-label="Unit"]').value).toBe("Unit 2");
    expect(shownWords()).toEqual(["Apple", "Bread"]);
    await choose("Category", "Bakery");
    expect(shownWords()).toEqual(["Bread"]);
    expect(params()).toMatchObject({ unit: "Unit 2", category: "Bakery" });
    await choose("Category", "");
    await search("apple");
    expect(shownWords()).toEqual(["Apple"]);
    expect(params()).toMatchObject({ unit: "Unit 2", q: "apple" });
  });

  it("a new unit goes back to page 1", async () => {
    await words("/admin/words?page=2");
    expect($(".adm-pager-info").textContent).toContain("26–31 of 31");
    await choose("Unit", "Unit 10");
    expect(params().page).toBeUndefined();
    expect($(".adm-pager-info").textContent).toContain("1–25 of 27");
  });

  it("nothing matches: says so, and Show all units clears only the unit", async () => {
    await words("/admin/words?unit=Unit%201&category=Bakery");
    expect($(".adm-empty").textContent).toContain("No words match these filters.");
    await click([...$(".adm-empty").querySelectorAll("button")].find((b) => b.textContent === "Show all units"));
    expect(params()).toEqual({ category: "Bakery" });
    expect(shownWords()).toEqual(["Bread"]);
  });

  it("the search empties a unit's list: the same way out", async () => {
    await words("/admin/words?unit=Unit%202&q=zzz");
    expect($(".adm-empty").textContent).toContain("No rows match your search.");
    await click([...$(".adm-empty").querySelectorAll("button")].find((b) => b.textContent === "Show all units"));
    expect(params()).toEqual({ q: "zzz" });
  });

  it("a unit in the address that no word has: still shown as picked, with the way out", async () => {
    await words("/admin/words?unit=Gone");
    expect($('select[aria-label="Unit"]').value).toBe("Gone");
    expect($(".adm-empty").textContent).toContain("Show all units");
  });

  it("filtering changes no content", async () => {
    await words();
    await choose("Unit", "Unit 2"); await choose("Unit", "__none__"); await choose("Unit", "");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("Admin Grammar: the Unit filter", () => {
  const onUpdate = vi.fn();
  const grammar = (url = "/admin/grammar") => render(<Grammar content={content} wordStats={stats} onUpdate={onUpdate} onOpen={() => {}} openId={null} />, url);
  const shownRules = () => $$("tbody .adm-word b").map((b) => b.textContent);

  it("options from the rules; a rule in two units shows under each; Without unit", async () => {
    await grammar();
    expect(unitOptionsShown()).toEqual(["All units", "Without unit", "Unit 2", "Unit 3"]);
    await choose("Unit", "Unit 3");
    expect(params().unit).toBe("Unit 3");
    expect(shownRules().sort()).toEqual(["Past simple", "Plurals"]);
    await choose("Unit", "Unit 2");
    expect(shownRules()).toEqual(["Past simple"]);
    await choose("Unit", "__none__");
    expect(shownRules()).toEqual(["Articles"]);
  });

  it("works with the lesson filter and the search; nothing left offers Show all units", async () => {
    await grammar("/admin/grammar?unit=Unit%203");
    await choose("Lesson", "Grammar B");
    expect(shownRules()).toEqual(["Plurals"]);
    await search("past");
    expect($(".adm-empty").textContent).toContain("No rows match your search.");
    await click([...$(".adm-empty").querySelectorAll("button")].find((b) => b.textContent === "Show all units"));
    expect(params()).toEqual({ lesson: "Grammar B", q: "past" });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
