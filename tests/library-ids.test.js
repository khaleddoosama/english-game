import { describe, expect, it } from "vitest";
import { idsFromMaps, identityIds, loadIds, loadKeyMap } from "../src/features/library/libraryIds.js";

// A stand-in for the Supabase client: from(table).select().not().range()
const fakeClient = (tables, { fail = null } = {}) => ({
  calls: [],
  from(table) {
    const self = this;
    // tables["senses:owner_id"] answers the query for the player's own words
    return { select: () => ({ not: (col) => ({ range: async (a, b) => {
      self.calls.push([table, a, b]);
      if (fail === table) return { data: null, error: new Error("relation does not exist") };
      return { data: (tables[`${table}:${col}`] ?? (col === "legacy_key" ? tables[table] : []) ?? []).slice(a, b + 1), error: null };
    } }) }) };
  },
});
const rows = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-id-${i}`, legacy_key: `${prefix} ${i}` }));

describe("key <-> id", () => {
  it("maps both ways, and answers undefined for what it doesn't know", () => {
    const ids = idsFromMaps(new Map([["Cast", "u1"]]), new Map([["g-1", "r1"]]));
    expect([ids.senseOf("Cast"), ids.keyOfSense("u1"), ids.ruleOf("g-1"), ids.keyOfRule("r1")]).toEqual(["u1", "Cast", "r1", "g-1"]);
    expect(ids.senseOf("Nope")).toBeUndefined();
    expect(ids.keyOfSense("zzz")).toBeUndefined();
  });
  it("local mode: the key is the id", () => {
    expect(identityIds.senseOf("Cast")).toBe("Cast");
    expect(identityIds.keyOfRule("g-1")).toBe("g-1");
  });
});

describe("loading the maps", () => {
  it("pages through more than a thousand rows", async () => {
    const client = fakeClient({ senses: rows(2500, "w"), grammar_rules: rows(3, "g") });
    const { ids, words, rules } = await loadIds(client);
    expect(words).toBe(2500); expect(rules).toBe(3);
    expect(ids.senseOf("w 2499")).toBe("w-id-2499");
    expect(ids.keyOfSense("w-id-1000")).toBe("w 1000");
    expect(client.calls.filter(([t, from]) => t === "senses" && from > 0).map(([, from]) => from)).toEqual([1000, 2000]);   // pages of 1000 until a short one
  });
  it("exactly one full page ends with one more empty request, not an endless loop", async () => {
    const client = fakeClient({ senses: rows(1000, "w") });
    const map = await loadKeyMap(client, "senses");
    expect(map.size).toBe(1000);
    expect(client.calls.length).toBe(2);
  });
  it("an empty table means nothing moved yet (0 words)", async () => {
    const { words } = await loadIds(fakeClient({}));
    expect(words).toBe(0);
  });
  it("the player's own words are mapped by their text, and the dictionary's word wins a clash", async () => {
    const client = fakeClient({
      senses: [{ id: "pub-1", legacy_key: "Cast" }],
      "senses:owner_id": [
        { id: "own-1", label: null, headwords: { text: "Quokka" } },
        { id: "own-2", label: "cartoon", headwords: { text: "Quokka" } },
        { id: "own-3", label: null, headwords: { text: "Cast" } },
      ],
    });
    const { ids, words } = await loadIds(client);
    expect(ids.senseOf("Quokka")).toBe("own-1");
    expect(ids.senseOf("Quokka (cartoon)")).toBe("own-2");
    expect(ids.senseOf("Cast")).toBe("pub-1");
    expect(ids.keyOfSense("own-2")).toBe("Quokka (cartoon)");
    expect(words).toBe(3);
  });
  it("an error from the server is thrown, so the library stays off", async () => {
    await expect(loadIds(fakeClient({}, { fail: "senses" }))).rejects.toThrow(/does not exist/);
  });
});
