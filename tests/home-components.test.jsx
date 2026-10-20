// @vitest-environment jsdom
// The pieces of Home on their own: the card, the tab row, the Gateway course and the lessons.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CourseLevelsView from "../src/features/home/CourseLevelsView.jsx";
import HomeTabs from "../src/features/home/HomeTabs.jsx";
import LessonsView from "../src/features/home/LessonsView.jsx";
import StageCard from "../src/features/home/StageCard.jsx";

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const render = async (el) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(el)); };
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const w = (word, extra = {}) => ({ kind: "word", obj: { word, ...extra } });
const g = (id) => ({ kind: "grammar", obj: { id } });
const mastery = { a: { correct: 10, total: 10 } };

describe("StageCard", () => {
  it("shows the title, what it holds, the counts and a Practice button that plays", async () => {
    const onPlay = vi.fn();
    await render(<StageCard title="Pronouns" meta="48 grammar rules" items={[w("a"), w("b")]} mastery={{}} onPlay={onPlay} />);
    expect($(".wh-level-title").textContent).toBe("Pronouns");
    expect($(".wh-level-meta").textContent).toBe("48 grammar rules");
    expect($(".wh-level-stage-detail").textContent).toBe("0 mastered · 0 learned · 0 familiar · 2 new");
    await click($("button.wh-level-btn"));
    expect(onPlay).toHaveBeenCalled();
  });
  it("can be disabled and takes extra buttons before Practice", async () => {
    await render(<StageCard title="T" meta="m" items={[]} mastery={{}} disabled actions={<button className="extra">e</button>} onPlay={() => {}} />);
    expect($("button.wh-level-btn").disabled).toBe(true);
    expect($(".wh-level-card").children[2].className).toBe("extra");
  });
});

describe("HomeTabs", () => {
  const tabs = [["lesson", "By lesson"], ["view:a", "Gateway"]];
  it("marks the open tab, picks another, and has + and Catalog when the library is on", async () => {
    const onSelect = vi.fn(), onNew = vi.fn(), onCatalog = vi.fn();
    await render(<HomeTabs tabs={tabs} active="lesson" libraryReady onSelect={onSelect} onNew={onNew} onCatalog={onCatalog} />);
    expect($$("button").map((b) => b.textContent)).toEqual(["By lesson", "Gateway", "+", "Catalog"]);
    expect($$("button")[0].getAttribute("aria-pressed")).toBe("true");
    await click($$("button")[1]); expect(onSelect).toHaveBeenCalledWith("view:a");
    await click($("button[aria-label='New view']")); expect(onNew).toHaveBeenCalled();
    await click($(".lib-catalog-tab")); expect(onCatalog).toHaveBeenCalled();
  });
  it("only the tabs while the library is off", async () => {
    await render(<HomeTabs tabs={[["lesson", "By lesson"]]} active="lesson" libraryReady={false} onSelect={() => {}} />);
    expect($$("button").length).toBe(1);
  });
});

describe("CourseLevelsView", () => {
  const level = { id: "A1.1", gateway: 3, items: [w("a"), g("g1")], sessions: [{ unit: "Articles", title: "Articles", items: [g("g1")] }], unsorted: [w("a")] };
  it("a level is a heading with an All card, a card for each session and one for what is in none", async () => {
    await render(<CourseLevelsView levels={[level]} none={[]} mastery={mastery} onPlay={() => {}} onStartLevel={() => {}} />);
    expect($("h3").textContent).toContain("A1.1");
    expect($("h3").textContent).toContain("Gateway level 3");
    expect($$(".wh-level-title").map((t) => t.textContent)).toEqual(["All of A1.1", "Articles", "Other words"]);
  });
  it("Practice starts the level or the session", async () => {
    const onStartLevel = vi.fn();
    await render(<CourseLevelsView levels={[level]} none={[]} mastery={{}} onPlay={() => {}} onStartLevel={onStartLevel} />);
    const btns = $$("button.wh-level-btn");
    await click(btns[1]); expect(onStartLevel).toHaveBeenLastCalledWith(level, { unit: "Articles", title: "Articles" });
    await click(btns[0]); expect(onStartLevel).toHaveBeenLastCalledWith(level);
  });
  it("a player who sees only their library practises the items of the card instead", async () => {
    const onPlay = vi.fn();
    await render(<CourseLevelsView levels={[level]} none={[]} mastery={{}} limited onPlay={onPlay} onStartLevel={() => {}} />);
    await click($$("button.wh-level-btn")[1]);
    expect(onPlay).toHaveBeenCalledWith("Articles", level.sessions[0].items);
  });
  it("says so when there is nothing", async () => {
    await render(<CourseLevelsView levels={[]} none={[]} mastery={{}} onPlay={() => {}} onStartLevel={() => {}} />);
    expect($(".wh-course-empty")).toBeTruthy();
  });
});

describe("LessonsView", () => {
  const level = { id: "cat-A", title: "Personality", items: [w("a", { units: ["Unit-1"] }), w("b")] };
  const props = { levels: [level], indexOf: () => 0, mastery, isAdmin: false, isUnlocked: () => true, clearedSet: new Set(), starsOf: () => 0, onStart: () => {}, onDelete: () => {}, onOpenLibrary: () => {}, onOpenCatalog: () => {} };
  it("a lesson card: number, title, count and progress, and Practice (no Final Case since 2026-10-20)", async () => {
    await render(<LessonsView {...props} />);
    expect($(".wh-level-num").textContent).toBe("01");
    expect($(".wh-level-title").textContent).toContain("Personality");
    expect($(".wh-level-meta").textContent).toContain("2 words");
    expect($(".wh-level-stage-detail").textContent).toBe("0 mastered · 0 learned · 1 familiar · 1 new");
    expect($$("button").some((b) => b.textContent === "Practice")).toBe(true);
    expect($$("button").some((b) => b.textContent === "Final Case")).toBe(false);
  });
  it("Practice starts the lesson, a unit starts that unit, and a locked lesson can't be started", async () => {
    const onStart = vi.fn();
    await render(<LessonsView {...props} onStart={onStart} />);
    expect($(".wh-level-units summary").textContent).toBe("1 unit");
    await click($$("button").find((b) => b.textContent === "Practice" && !b.closest(".wh-level-units")));
    expect(onStart).toHaveBeenLastCalledWith(0);
    await click($(".wh-level-units button"));
    expect(onStart.mock.calls.at(-1)[0]).toBe(0); expect(onStart.mock.calls.at(-1)[1].id).toBe("Unit-1");
    await act(async () => root.unmount()); host.remove();
    await render(<LessonsView {...props} isUnlocked={() => false} />);
    expect($$("button").find((b) => b.textContent === "Locked").disabled).toBe(true);
  });
  it("only the admin can delete a lesson; a cleared one says Practice again", async () => {
    const onDelete = vi.fn();
    await render(<LessonsView {...props} isAdmin onDelete={onDelete} clearedSet={new Set(["cat-A"])} />);
    await click($(".wh-level-delete-btn")); expect(onDelete).toHaveBeenCalledWith(level);
    expect($$("button").some((b) => b.textContent === "Practice again")).toBe(true);
    await act(async () => root.unmount()); host.remove();
    await render(<LessonsView {...props} />);
    expect($(".wh-level-delete-btn")).toBeNull();
  });
  it("an empty library says so and points to the catalog and the library", async () => {
    const onOpenCatalog = vi.fn();
    await render(<LessonsView {...props} levels={[]} emptyLibrary onOpenCatalog={onOpenCatalog} />);
    expect($(".lib-empty").textContent).toContain("Your library is empty");
    await click($$("button").find((b) => b.textContent === "Browse the catalog"));
    expect(onOpenCatalog).toHaveBeenCalled();
  });
});
