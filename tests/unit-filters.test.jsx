// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { unitOptions, matchesUnit } from "../src/lib/unitFilter";
import { Words } from "../src/features/admin/sections/Words";
import { Grammar } from "../src/features/admin/sections/Grammar";
import WordPicker from "../src/features/library/components/WordPicker";
import ViewPanel from "../src/features/library/components/ViewPanel";

const words = [
  { word: "Alpha", meaning: "first", category: "Travel", units: ["Unit 10", "Unit 2", "Unit 2"] },
  { word: "Beta", meaning: "second", category: "Travel", units: [] },
  { word: "Gamma", meaning: "third", category: "Other" },
  { word: "Delta", meaning: "fourth", category: "Other", units: ["Unit 2"] },
];
const grammar = words.map((w) => ({ ...w, id: w.word, rule: w.word }));
let host, root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; window.history.replaceState({}, "", "/"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (el) => act(async () => root.render(el));
const $ = (s) => host.querySelector(s);
const change = async (el, value) => act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
const click = async (el) => act(async () => el.click());
const tableNames = () => [...host.querySelectorAll("tbody .adm-word b")].map((e) => e.textContent);

it("uses exact units, naturally sorted and distinct; absent/empty units match Without unit without mutating items", () => {
  const before = JSON.stringify(words);
  expect(unitOptions(words)).toEqual(["Unit 2", "Unit 10"]);
  expect(words.filter((w) => matchesUnit(w, "none")).map((w) => w.word)).toEqual(["Beta", "Gamma"]);
  expect(matchesUnit(words[0], "unit:Unit 2")).toBe(true);
  expect(matchesUnit(words[0], "unit:Unit 10")).toBe(true);
  expect(matchesUnit({ units: ["none"] }, "unit:none")).toBe(true);
  expect(matchesUnit(words[0], "unit:Travel")).toBe(false);
  expect(JSON.stringify(words)).toBe(before);
});
for (const kind of ["words", "grammar"]) {
  it(`${kind}: units combine with search and category/lesson, persist in URL, reset page, and can be cleared`, async () => {
    window.history.replaceState({}, "", `/admin/${kind}?page=3`);
    const onUpdate = vi.fn();
    const props = { content: { words, grammar }, wordStats: { data: [] }, mastery: {}, onUpdate, onOpen: () => {} };
    await render(kind === "words" ? <Words {...props} /> : <Grammar {...props} />);
    await change($('select[aria-label="Units"]'), "unit:Unit 2");
    expect(new URLSearchParams(window.location.search).get("page")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("unit")).toBe("unit:Unit 2");
    expect(tableNames()).toEqual(["Alpha", "Delta"]);
    await change($(`select[aria-label="${kind === "words" ? "Category" : "Lesson"}"]`), "Travel");
    expect(tableNames()).toEqual(["Alpha"]);
    await change($(".adm-search input"), "Beta");
    expect(tableNames()).toEqual([]);
    expect($(".adm-empty").textContent).toContain("No rows match");
    await click($('button[aria-label="Clear units filter"]'));
    expect(tableNames()).toEqual(["Beta"]);
    await change($(".adm-search input"), "");
    await change($('select[aria-label="Units"]'), "none");
    expect(tableNames()).toEqual(["Beta"]);
    expect(onUpdate).not.toHaveBeenCalled();
  });
}
it("picker: unit changes reset the shown page and retain selection; options come only from its pool", async () => {
  const pool = Array.from({ length: 125 }, (_, i) => ({ word: `Word${i}`, units: ["Unit 2", "Unit 10"] }));
  const selected = new Set(["Word0"]), onToggle = vi.fn();
  await render(<WordPicker filterUnits words={pool} selected={selected} onToggle={onToggle} onSetMany={() => {}} />);
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Show 60 more"));
  expect(host.querySelectorAll(".lib-results li")).toHaveLength(120);
  await change($('select[aria-label="Units"]'), "unit:Unit 2");
  expect(host.querySelectorAll(".lib-results li")).toHaveLength(60);
  expect($(".lib-results input").checked).toBe(true);
  expect([...$('select[aria-label="Units"]').options].map((o) => o.text)).toEqual(["All units", "Without unit", "Unit 2", "Unit 10"]);
  expect(onToggle).not.toHaveBeenCalled();
});
it("In this view filters words and rules independently, clears empty results and does not change practice scope or membership", async () => {
  const onPractice = vi.fn(), actChange = vi.fn();
  await render(<ViewPanel view={{ id: "v", name: "Travel", path: "Travel", words: 4, rules: 4, children: [] }} roots={[]} inside={{ words: words.map((w) => w.word), rules: grammar.map((g) => g.id) }} libraryKeys={new Set()} grammar={grammar} api={{}} ids={{}} words={words} wordByKey={new Map(words.map((w) => [w.word, w]))} ruleByKey={new Map(grammar.map((g) => [g.id, g]))} act={actChange} onPractice={onPractice} />);
  await change($('select[aria-label="Word units"]'), "unit:Unit 10");
  await change($('select[aria-label="Grammar units"]'), "none");
  expect([...host.querySelectorAll(".lib-chips li span")].map((x) => x.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
  await click([...host.querySelectorAll("button")].find((b) => b.textContent.trim() === "Only this view"));
  expect(onPractice).toHaveBeenCalledWith("v", false, "Travel");
  expect(actChange).not.toHaveBeenCalled();
});
