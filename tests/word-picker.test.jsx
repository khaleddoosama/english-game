// @vitest-environment jsdom
// Picking words from a list: search, lesson, level and unit filters, select all, what is already in, paging.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WordPicker from "../src/features/library/components/WordPicker.jsx";
import { useSelection } from "../src/features/library/components/useSelection.js";

const WORDS = [
  { word: "Reluctant", meaning: "Unwilling", category: "Personality", level: "A1.1" },
  { word: "Ambitious", meaning: "Wants to succeed", category: "Personality", level: "A1.2" },
  { word: "Campaign", meaning: "A planned series of actions", category: "Marketing", level: "A1.1" },
  { word: "Brand", meaning: "A name for a product", category: "Marketing" },
];
let root, host, picked;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
function Harness({ words = WORDS, disabled, many }) {
  const sel = useSelection();
  picked = sel.set;
  return <WordPicker words={many || words} selected={sel.set} disabled={disabled} onToggle={sel.toggle} onSetMany={sel.setMany} tagOf={(k) => (k === "Brand" ? "no view" : null)} empty={(q) => <p className="none">none for “{q}”</p>} />;
}
const render = async (props) => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness {...props} />));
};
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const change = async (el, v) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set; set.call(el, v); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); };
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const names = () => $$(".lib-results li b").map((b) => b.textContent);

describe("WordPicker", () => {
  it("shows every word, with how many are shown and picked", async () => {
    await render();
    expect(names()).toEqual(["Reluctant", "Ambitious", "Campaign", "Brand"]);
    expect($(".lib-pickbar").textContent).toContain("4 words shown · 0 selected");
  });
  it("searches by word or meaning", async () => {
    await render();
    await change($('input[aria-label="Search words"]'), "planned");
    expect(names()).toEqual(["Campaign"]);
    await change($('input[aria-label="Search words"]'), "zzz");
    expect($(".none").textContent).toContain("none for “zzz”");
  });
  it("narrows by lesson and by course level, and the two together", async () => {
    await render();
    await change($('select[aria-label="Lesson"]'), "Marketing");
    expect(names()).toEqual(["Campaign", "Brand"]);
    await change($('select[aria-label="Course level"]'), "A1.1");
    expect(names()).toEqual(["Campaign"]);
    await change($('select[aria-label="Lesson"]'), "");
    expect(names()).toEqual(["Reluctant", "Campaign"]);
  });
  it("ticks one by one, and Select all shown / Clear shown work on what is on screen only", async () => {
    await render();
    await click($$('.lib-results input[type="checkbox"]')[0]);
    expect([...picked]).toEqual(["Reluctant"]);
    await change($('select[aria-label="Lesson"]'), "Marketing");
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    expect([...picked].sort()).toEqual(["Brand", "Campaign", "Reluctant"]);     // Reluctant stays picked from before
    await click($$("button").find((b) => b.textContent === "Clear shown"));
    expect([...picked]).toEqual(["Reluctant"]);
  });
  it("words that are already in are shown ticked, can't be changed and are not picked by Select all", async () => {
    await render({ disabled: new Set(["Brand"]), });
    const brand = $$(".lib-results li").find((li) => li.textContent.includes("Brand"));
    expect(brand.querySelector("input").checked).toBe(true);
    expect(brand.querySelector("input").disabled).toBe(true);
    expect(brand.textContent).toContain("already in");
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    expect([...picked].sort()).toEqual(["Ambitious", "Campaign", "Reluctant"]);
  });
  it("a small note after a word, from the caller", async () => {
    await render();
    expect($$(".lib-results li").find((li) => li.textContent.includes("Brand")).textContent).toContain("no view");
  });
  it("a long list is shown 60 at a time", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ word: `Word${String(i).padStart(3, "0")}`, meaning: "m", category: "L" }));
    await render({ many });
    expect($$(".lib-results li").length).toBe(60);
    await click($$("button").find((b) => b.textContent === "Show 60 more"));
    expect($$(".lib-results li").length).toBe(120);
    await click($$("button").find((b) => b.textContent === "Show 10 more"));
    expect($$(".lib-results li").length).toBe(130);
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    expect(picked.size).toBe(130);                                             // all of them, not only the 60 on screen
  });

  it("no word has a unit: no Unit list", async () => {
    await render();
    expect($('select[aria-label="Unit"]')).toBeNull();
  });
});

// Made-up words with course units (the `units` field), for the Unit list.
const UNITS = [
  { word: "Dream", meaning: "Something you hope for", category: "Goals", units: ["Unit 2", "Unit 10"] },   // two units
  { word: "Goal", meaning: "An aim", category: "Goals", units: ["Unit 2"] },
  { word: "Fear", meaning: "A bad feeling about danger", category: "Feelings", units: ["Unit 1"] },
  { word: "Hope", meaning: "To want something good", category: "Feelings", units: [] },                  // empty list
  { word: "Memory", meaning: "Something you remember", category: "Feelings" },                            // no units
  { word: "Unit", meaning: "A part of a course", category: "Unit 2" },                                    // a lesson called "Unit 2" is not the unit
];
describe("WordPicker: the Unit list", () => {
  const unitSelect = () => $('select[aria-label="Unit"]');
  it("All units, Without unit, then each unit of the list once, in natural order", async () => {
    await render({ words: UNITS });
    expect([...unitSelect().options].map((o) => o.textContent)).toEqual(["All units", "Without unit", "Unit 1", "Unit 2", "Unit 10"]);
    expect(names()).toEqual(UNITS.map((w) => w.word));
  });
  it("a unit shows each word in it, also a word in several units; Without unit shows the ones with none", async () => {
    await render({ words: UNITS });
    await change(unitSelect(), "Unit 2");
    expect(names()).toEqual(["Dream", "Goal"]);
    await change(unitSelect(), "Unit 10");
    expect(names()).toEqual(["Dream"]);
    await change(unitSelect(), "__none__");
    expect(names()).toEqual(["Hope", "Memory", "Unit"]);
    await change(unitSelect(), "");
    expect(names().length).toBe(UNITS.length);
  });
  it("works with the search and the lesson list; Select all shown takes only what the unit shows", async () => {
    await render({ words: UNITS });
    await change(unitSelect(), "Unit 2");
    await change($('input[aria-label="Search words"]'), "aim");
    expect(names()).toEqual(["Goal"]);
    await change($('input[aria-label="Search words"]'), "");
    await change($('select[aria-label="Lesson"]'), "Goals");
    expect(names()).toEqual(["Dream", "Goal"]);
    await change(unitSelect(), "Unit 1");
    expect(names()).toEqual([]);                                                // Fear is in Feelings
    await change($('select[aria-label="Lesson"]'), "");
    await change(unitSelect(), "Unit 2");
    await click($$("button").find((b) => b.textContent.startsWith("Select all shown")));
    expect([...picked].sort()).toEqual(["Dream", "Goal"]);
  });
  it("nothing left: says so instead of the caller's note, and Show all units clears only the unit", async () => {
    await render({ words: UNITS });
    await change(unitSelect(), "Unit 1");
    await change($('input[aria-label="Search words"]'), "dream");
    expect($(".none")).toBeNull();
    expect(host.textContent).toContain("No words match in “Unit 1”.");
    await click($$("button").find((b) => b.textContent === "Show all units"));
    expect(unitSelect().value).toBe("");
    expect($('input[aria-label="Search words"]').value).toBe("dream");         // the search stays
    expect(names()).toEqual(["Dream"]);
    await change(unitSelect(), "__none__");
    expect(host.textContent).toContain("No words match without a unit.");
  });
  it("a new unit goes back to the first page of a long list", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ word: `Word${String(i).padStart(3, "0")}`, meaning: "m", category: "L", units: [i % 2 ? "Odd" : "Even"] }));
    await render({ many });
    await click($$("button").find((b) => b.textContent === "Show 60 more"));
    expect($$(".lib-results li").length).toBe(120);
    await change(unitSelect(), "Even");
    expect($$(".lib-results li").length).toBe(60);                              // 65 even words, the first 60 of them
    expect($$("button").find((b) => b.textContent === "Show 5 more")).toBeTruthy();
  });
  it("the options follow the list it is given: a unit no word in it has is not offered", async () => {
    await render({ words: UNITS.filter((w) => w.word !== "Fear") });
    expect([...unitSelect().options].map((o) => o.textContent)).toEqual(["All units", "Without unit", "Unit 2", "Unit 10"]);
  });
});

