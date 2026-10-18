// What an admin creates joins their own library: found by key, added in batches, only the new ones.
import { describe, expect, it } from "vitest";
import { addNewToLibrary } from "../src/lib/saveToLibrary.js";

function fakeClient({ senses = {}, rules = {}, failRpc = null } = {}) {
  const calls = [];
  return {
    calls,
    from: (table) => ({ select: () => ({ in: async (col, keys) => { calls.push(["lookup", table, col, keys.length]); const src = table === "senses" ? senses : rules; return { data: keys.filter((k) => src[k]).map((k) => ({ id: src[k] })), error: null }; } }) }),
    rpc: async (fn, args) => { calls.push([fn, Object.values(args)[0].length]); return failRpc === fn ? { error: new Error("nope") } : { data: 1, error: null }; },
  };
}

describe("addNewToLibrary", () => {
  it("finds the new words and rules by key and puts them in the library", async () => {
    const sb = fakeClient({ senses: { Spa: "s1", Lobby: "s2" }, rules: { "g-1": "r1" } });
    const n = await addNewToLibrary(sb, [{ kind: "words", key: "Spa" }, { kind: "words", key: "Lobby" }, { kind: "grammar", key: "g-1" }]);
    expect(n).toBe(3);
    expect(sb.calls.filter((c) => c[0] === "library_add")).toEqual([["library_add", 2]]);
    expect(sb.calls.filter((c) => c[0] === "library_add_rules")).toEqual([["library_add_rules", 1]]);
  });
  it("a key the dictionary doesn't have yet is skipped, not an error", async () => {
    const sb = fakeClient({ senses: { Spa: "s1" } });
    expect(await addNewToLibrary(sb, [{ kind: "words", key: "Spa" }, { kind: "words", key: "Missing" }])).toBe(1);
  });
  it("nothing new makes no calls at all", async () => {
    const sb = fakeClient();
    expect(await addNewToLibrary(sb, [])).toBe(0);
    expect(sb.calls).toEqual([]);
  });
  it("long lists go in batches: 100 keys a lookup, 200 a library call", async () => {
    const senses = Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`w${i}`, `id${i}`]));
    const sb = fakeClient({ senses });
    await addNewToLibrary(sb, Object.keys(senses).map((key) => ({ kind: "words", key })));
    expect(sb.calls.filter((c) => c[0] === "lookup").map((c) => c[3])).toEqual([100, 100, 100, 100, 50]);
    expect(sb.calls.filter((c) => c[0] === "library_add").map((c) => c[1])).toEqual([200, 200, 50]);
  });
  it("a failing call is reported to the caller (which logs it)", async () => {
    const sb = fakeClient({ senses: { Spa: "s1" }, failRpc: "library_add" });
    await expect(addNewToLibrary(sb, [{ kind: "words", key: "Spa" }])).rejects.toThrow("nope");
  });
});
