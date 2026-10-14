// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMyViews, useViewScope } from "../src/features/library/useViewScope.js";

let root, host, seen;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });
function Probe({ library, viewId }) {
  seen = { views: useMyViews(library), scope: useViewScope(library, viewId) };
  return null;
}
const mount = async (props) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe {...props} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const ids = { keyOfSense: (id) => `key-${id}`, keyOfRule: (id) => `rule-${id}` };

describe("useMyViews / useViewScope", () => {
  it("no library: no views and no scope", async () => {
    await mount({ library: null, viewId: "v1" });
    expect(seen.views).toEqual([]);
    expect(seen.scope).toBeNull();
  });
  it("lists my views, and turns a view's rows into a scope of keys", async () => {
    const api = { tree: vi.fn(async () => [{ id: "v1", name: "A" }]), contents: vi.fn(async () => [{ kind: "sense", id: "1" }, { kind: "rule", id: "2" }]) };
    await mount({ library: { api, ids }, viewId: "v1" });
    expect(seen.views).toEqual([{ id: "v1", name: "A" }]);
    expect([...seen.scope.words]).toEqual(["key-1"]);
    expect([...seen.scope.rules]).toEqual(["rule-2"]);
    expect(api.contents).toHaveBeenCalledWith("v1", true);
  });
  it("no view picked: no scope, and nothing is fetched", async () => {
    const api = { tree: async () => [], contents: vi.fn() };
    await mount({ library: { api, ids }, viewId: null });
    expect(seen.scope).toBeNull();
    expect(api.contents).not.toHaveBeenCalled();
  });
  it("a view that can't be read is an empty scope, not a crash", async () => {
    const api = { tree: async () => { throw new Error("offline"); }, contents: async () => { throw new Error("offline"); } };
    await mount({ library: { api, ids }, viewId: "v1" });
    expect(seen.views).toEqual([]);
    expect(seen.scope.words.size + seen.scope.rules.size).toBe(0);
  });
});
