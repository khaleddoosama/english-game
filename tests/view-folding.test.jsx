// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ViewTree from "../src/features/library/components/ViewTree";
import MyViewsHome from "../src/features/library/components/MyViewsHome";
import { buildTree, flattenTree } from "../src/features/library/libraryTree";
const flat = [
  { id: "a", name: "Root", parent: null, words: 1, rules: 0 },
  { id: "b", name: "Branch", parent: "a", words: 1, rules: 0 },
  { id: "c", name: "Leaf", parent: "b", words: 1, rules: 0 },
];
let host, root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const $ = (s) => host.querySelector(s);
const click = async (el) => act(async () => el.click());
const arrow = (name) => $(`button[aria-label$="views inside ${name}"]`);
function Panel() { const [on, setOn] = useState(false); return <input aria-label="Keep selection" type="checkbox" checked={on} onChange={() => setOn(!on)} />; }
it("nested tree folding keeps selected view and panel selection, separates name actions, and leaves practice scope untouched", async () => {
  const onSelect = vi.fn(), onPractice = vi.fn();
  await act(async () => root.render(<ViewTree rows={flattenTree(buildTree(flat))} selected="c" onSelect={onSelect} onPractice={onPractice} panel={<Panel />} />));
  await click($('input[aria-label="Keep selection"]'));
  expect(arrow("Leaf")).toBeNull();
  await click(arrow("Branch"));
  await click(arrow("Root"));
  await click(arrow("Root"));
  expect(arrow("Branch").getAttribute("aria-expanded")).toBe("false");
  expect($('li.on').hidden).toBe(true);
  await click(arrow("Branch"));
  expect($('li.on').hidden).toBe(false);
  expect($('input[aria-label="Keep selection"]').checked).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onPractice).not.toHaveBeenCalled();
  await click($(".lib-name"));
  expect(onSelect).toHaveBeenCalledWith("a");
  expect(arrow("Root").getAttribute("aria-expanded")).toBe("true");
  await click($(".lib-go"));
  expect(onPractice).toHaveBeenCalledWith("a", true, "Root");
});
for (const rootId of [null, "a"]) {
  it(`Home folds nested groups and the selected root (${rootId}), without fetching a different scope`, async () => {
    const api = { tree: vi.fn(async () => flat), contents: vi.fn(async () => []) }, onPractice = vi.fn();
    await act(async () => root.render(<MyViewsHome api={api} rootId={rootId} onPractice={onPractice} />));
    const reads = api.contents.mock.calls.length;
    await click(arrow("Branch"));
    await click(arrow("Root"));
    expect(arrow("Branch")).toBeNull();
    await click(arrow("Root"));
    expect(arrow("Branch").getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Leaf");
    await click(arrow("Branch"));
    expect(host.textContent).toContain("Leaf");
    expect(arrow("Leaf")).toBeNull();
    expect(api.contents.mock.calls.length).toBe(reads);
    expect(onPractice).not.toHaveBeenCalled();
  });
}
