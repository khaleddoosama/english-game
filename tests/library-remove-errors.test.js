// Removing a view from the app's side: what is a quiet success, and what is
// never swallowed. (The server answers the same for a view that is not there and
// one that belongs to someone else: tests/integration/isolation.test.js.)
import { describe, expect, it } from "vitest";
import { createLocalLibraryApi } from "../src/features/library/libraryApi.js";
import { createOnlineLibraryApi } from "../src/features/library/onlineLibraryApi.js";

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe("online", () => {
  it("an answer with no error is a success, whatever the view was", async () => {
    await expect(createOnlineLibraryApi({ rpc: async () => ({ data: null, error: null }) }).remove("any-id")).resolves.toBeNull();
  });
  it("the server's error is thrown with its message and code", async () => {
    const api = createOnlineLibraryApi({ rpc: async () => ({ data: null, error: { message: "permission denied", code: "42501" } }) });
    await expect(api.remove("v")).rejects.toMatchObject({ message: "permission denied", code: "42501" });
  });
  it("a lost connection is thrown as 'offline', not taken for a success", async () => {
    const api = createOnlineLibraryApi({ rpc: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(api.remove("v")).rejects.toMatchObject({ code: "offline", message: expect.stringMatching(/offline/) });
  });
});

describe("local mirror", () => {
  it("a view that is not there, or was already removed, is a quiet success; nobody else's views are touched", async () => {
    const storage = memory();
    const mine = createLocalLibraryApi({ storage, me: () => "a" });
    const theirs = createLocalLibraryApi({ storage, me: () => "b" });
    const id = await mine.create("Trip");
    await expect(theirs.remove(id)).resolves.toBeUndefined();
    await expect(theirs.remove("nope")).resolves.toBeUndefined();
    expect((await mine.tree()).map((v) => v.id)).toEqual([id]);
    await mine.remove(id);
    await expect(mine.remove(id)).resolves.toBeUndefined();
    expect(await mine.tree()).toEqual([]);
  });
});
