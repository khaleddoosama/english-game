// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionView } from "../src/features/session/SessionView.jsx";

let root, host, props;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  props = {
    session: { id: "round", kind: "practice", title: "Practice", index: 0, initialLength: 1, targetLength: 1, answers: [], draft: {}, queue: [{ id: "q", mode: "typing", type: "typing", prompt: "A clue", answers: ["word"], targets: ["word"] }] },
    words: [], onChange: vi.fn(), onBack: vi.fn(), onReport: vi.fn(() => ({ id: "report" })),
    onReviewReport: vi.fn(() => new Promise(() => {})),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function click(text) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text);
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function report() {
  await act(async () => root.render(<SessionView {...props} />));
  await click("Report question"); await click("Typo or grammar mistake"); await click("Submit report");
  expect(host.textContent).toContain("AI is checking");
}
describe("reported question waiting screen", () => {
  it("can close immediately while the review hangs, retaining the report", async () => {
    await report();
    await click("Close and continue");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(props.onReport).toHaveBeenCalledTimes(1);
    expect(props.onChange.mock.calls[0][0].answers[0]).toMatchObject({ reported: true, correct: false });
  });
  it.each(["Escape", "backdrop"])("closes via %s while reviewing", async (method) => {
    await report();
    await act(async () => {
      if (method === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else host.querySelector(".wh-modal-overlay").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(props.onBack).not.toHaveBeenCalled();
  });
  it("leaves a recoverable state when review never finishes", async () => {
    vi.useFakeTimers(); await report();
    await act(async () => { await vi.advanceTimersByTimeAsync(50000); });
    expect(host.textContent).toContain("AI couldn't check it right now");
    await click("Continue");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
  it("a late verdict does not reopen a closed modal", async () => {
    let resolve;
    props.onReviewReport = vi.fn(() => new Promise(r => { resolve = r; }));
    await report(); await click("Close and continue");
    await act(async () => { resolve({ verdict: "fine" }); });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
