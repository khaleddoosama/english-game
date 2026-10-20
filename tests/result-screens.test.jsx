// @vitest-environment jsdom
// The screens after a round and the "are you sure" boxes, on their own.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeedResults } from "../src/features/results/ResultScreens.jsx";
import { DeleteCategoryConfirm, ResetConfirm } from "../src/features/shell/ConfirmDialogs.jsx";

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
const render = async (el) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(el)); };
const $ = (s) => host.querySelector(s);
const $$ = (s) => [...host.querySelectorAll(s)];
const btn = (text) => $$("button").find((b) => b.textContent === text);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const level = { title: "Personality" };

describe("SpeedResults", () => {
  it("a new best score is announced only when it beats the old one", async () => {
    const props = { score: 120, correct: 8, answered: 10, bestCombo: 5, onAgain: vi.fn(), onBack: vi.fn() };
    await render(<SpeedResults {...props} best={100} />);
    expect($(".wh-results-score").textContent).toContain("120 points — 8/10 correct · best combo x5");
    expect($(".wh-results-unlock")).toBeTruthy();
    await click(btn("Play again")); expect(props.onAgain).toHaveBeenCalled();
    await act(async () => root.unmount()); host.remove();
    await render(<SpeedResults {...props} best={500} />);
    expect($(".wh-results-unlock")).toBeNull();
  });
});

describe("confirm dialogs", () => {
  it("reset and wipe say different things, run the action, then close", async () => {
    const onConfirm = vi.fn(async () => {}), onClose = vi.fn();
    await render(<ResetConfirm action="reset" onConfirm={onConfirm} onClose={onClose} />);
    expect($("p").textContent).toContain("Reset all progress?");
    await click(btn("Yes, reset progress"));
    expect(onConfirm).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount()); host.remove();
    await render(<ResetConfirm action="wipe" onConfirm={onConfirm} onClose={onClose} />);
    expect($("p").textContent).toContain("Clear everything?");
    expect(btn("Yes, delete everything")).toBeTruthy();
  });
  it("Cancel and a tap outside close it without doing anything", async () => {
    const onConfirm = vi.fn(), onClose = vi.fn();
    await render(<DeleteCategoryConfirm level={level} onConfirm={onConfirm} onClose={onClose} />);
    expect($("p").textContent).toContain('Delete the category "Personality"?');
    await click(btn("Cancel")); expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { $(".wh-modal-overlay").dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("deleting a category hands the level back", async () => {
    const onConfirm = vi.fn(), onClose = vi.fn();
    await render(<DeleteCategoryConfirm level={level} onConfirm={onConfirm} onClose={onClose} />);
    await click(btn("Yes, delete category"));
    expect(onConfirm).toHaveBeenCalledWith(level); expect(onClose).toHaveBeenCalled();
  });
});
