// @vitest-environment jsdom
// Picking words from a list: search, lesson and level filters, select all, what is already in, paging.
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
});
