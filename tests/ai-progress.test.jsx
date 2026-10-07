// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AiProgress } from "../src/features/media/AiProgress.jsx";
import { cancelAiTasks, dismissAiOperation, getAiOperations, runAiOperation, updateAiOperation } from "../src/lib/aiOperations.js";
let host, root;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); cancelAiTasks(null, { includeBackground: true }); for (const job of getAiOperations()) dismissAiOperation(job.id); });
it("shows real completed counts, hides without cancellation, and cancels from the panel", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AiProgress />));
  let signal;
  let pending, checked;
  await act(async () => {
    pending = runAiOperation("Batch", s => { signal = s; updateAiOperation(s, { done: 2, total: 20, phase: "Reviewing" }); return new Promise(() => {}); });
    checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(host.textContent).toContain("2/20");
  expect(host.querySelector("progress").value).toBe(2);
  await act(async () => host.querySelector("button").click());
  expect(signal.aborted).toBe(false); expect(host.querySelector("progress")).toBeNull();
  await act(async () => host.querySelector("button").click());
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Cancel").click());
  await checked; expect(signal.aborted).toBe(true); expect(host.textContent).toContain("Cancelled");
});
