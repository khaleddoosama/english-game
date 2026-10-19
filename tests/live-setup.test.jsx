// @vitest-environment jsdom
// Before and around a Live challenge (src/features/live/liveSetup.js, useLivePlayer): the player per tab in local
// mode (kept in the tab's storage, new when it cannot be kept), the account online, the limits and defaults of a new
// challenge for the admin and for players, and the words whose gap sentences have all been read. Made-up data.
// Docs: docs/modules/live/live-setup.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V2 } from "../src/engine/v2";
import { GAP_REFRESH_MAX, TAB_PLAYER_KEY, gapRefreshBatch, liveLimits, playerOf, tabPlayer } from "../src/features/live/liveSetup";
import { useLivePlayer } from "../src/features/live";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
const numbers = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

describe("the player", () => {
  it("local mode: a made-up player for the tab, kept in its storage", () => {
    const s = memory();
    const p = tabPlayer(() => s, numbers(0.123456789, 0.5));
    expect(p).toEqual({ id: `tab-${(0.123456789).toString(36).slice(2, 8)}`, name: "Player 55" });
    expect(JSON.parse(s.m.get(TAB_PLAYER_KEY))).toEqual(p);
    expect(tabPlayer(() => s, numbers(0.9))).toEqual(p);
  });

  it("a saved value without an id, or one that cannot be read, makes a new player", () => {
    const s = memory();
    s.setItem(TAB_PLAYER_KEY, JSON.stringify({ name: "x" }));
    expect(tabPlayer(() => s, numbers(0.25, 0)).name).toBe("Player 10");
    s.setItem(TAB_PLAYER_KEY, "{");
    expect(tabPlayer(() => s, numbers(0.25, 0.999)).name).toBe("Player 99");
  });

  it("storage that cannot be used: a new player each time", () => {
    expect(tabPlayer(() => blocked, numbers(0.5, 0.1)).name).toBe("Player 19");
    expect(tabPlayer(() => blocked, numbers(0.5, 0.2)).name).toBe("Player 28");
  });

  it("online: the account; local mode's own profile and no profile: the tab's player", () => {
    const tab = () => ({ id: "tab-x", name: "Player 10" });
    expect(playerOf({ id: "u-sam", username: "sam_01", role: "player" }, tab)).toEqual({ id: "u-sam", name: "sam_01" });
    expect(playerOf({ id: "local", username: "local" }, tab)).toEqual({ id: "tab-x", name: "Player 10" });
    expect(playerOf(null, tab)).toEqual({ id: "tab-x", name: "Player 10" });
  });
});

describe("useLivePlayer", () => {
  let root, host, out;
  function Probe({ profile }) { out = useLivePlayer(profile); return null; }
  beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; sessionStorage.clear(); });
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); });

  it("the same player while the account stays; a new one when it changes; the tab's player in local mode", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<Probe profile={{ id: "u-sam", username: "sam_01" }} />));
    const first = out;
    await act(async () => root.render(<Probe profile={{ id: "u-sam", username: "sam_01", role: "player" }} />));
    expect(out).toBe(first);
    await act(async () => root.render(<Probe profile={{ id: "u-ada", username: "ada" }} />));
    expect(out).toEqual({ id: "u-ada", name: "ada" });
    await act(async () => root.render(<Probe profile={{ id: "local", username: "local" }} />));
    expect(out.id).toMatch(/^tab-/);
    expect(JSON.parse(sessionStorage.getItem(TAB_PLAYER_KEY))).toEqual(out);
  });
});

describe("limits and defaults of a new challenge", () => {
  const app = { liveMaxPlayers: 4, liveCreate: "admin", liveDefaultQuestions: 15, liveDefaultSeconds: 45, liveMaxHours: 6 };
  it("a player is held to the app's limits", () => {
    expect(liveLimits(app, {}, false)).toEqual({ maxPlayers: 4, canCreate: false, defaultCount: 15, defaultSeconds: 45, maxHours: 6 });
    expect(liveLimits({ ...app, liveCreate: "everyone" }, {}, false).canCreate).toBe(true);
  });
  it("the admin is not; the defaults still apply", () => {
    expect(liveLimits(app, {}, true)).toEqual({ maxPlayers: 10, canCreate: true, defaultCount: 15, defaultSeconds: 45, maxHours: 168 });
  });
  it("the player's own settings come before the app's, a 0 (no time limit) too", () => {
    expect(liveLimits(app, { liveQuestions: 20, liveSeconds: 0 }, false)).toMatchObject({ defaultCount: 20, defaultSeconds: 0 });
    expect(liveLimits(app, { liveQuestions: null, liveSeconds: null }, false)).toMatchObject({ defaultCount: 15, defaultSeconds: 45 });
  });
});

describe("words whose gap sentences have all been read", () => {
  const now = Date.now();
  const read = (...texts) => Object.fromEntries(texts.map((t) => [V2.questionSentences({ mode: "gap", prompt: t })[0], now - 3600000]));
  const W = (word, gap = `We saw the ${"_".repeat(6)} today ${word}.`) => ({ word, gap });

  it("every gap sentence read in the last 20 hours: asked for, as gap pool requests", () => {
    const a = W("drizzle"), b = W("gust");
    expect(gapRefreshBatch([a, b], {}, read(a.gap))).toEqual([{ word: "drizzle", poolType: "gap" }]);
  });

  it("a written sentence not read yet keeps the word fresh", () => {
    const a = W("drizzle");
    const pools = { drizzle: { gap: [{ id: "g1", text: "A light ______ fell." }] } };
    expect(gapRefreshBatch([a], pools, read(a.gap))).toEqual([]);
    expect(gapRefreshBatch([a], pools, read(a.gap, "A light ______ fell."))).toEqual([{ word: "drizzle", poolType: "gap" }]);
  });

  it("read long ago counts as fresh; a word without a blank is left out", () => {
    const a = W("drizzle");
    expect(gapRefreshBatch([a], null, { [V2.questionSentences({ mode: "gap", prompt: a.gap })[0]]: now - 30 * 3600000 })).toEqual([]);
    expect(gapRefreshBatch([W("mist", "No blank here."), W("hail", "One _ only.")], null, read("No blank here.", "One _ only."))).toEqual([]);
  });

  it("at most 8, in the words' order", () => {
    const words = Array.from({ length: 11 }, (_, i) => W(`w${i}`));
    const batch = gapRefreshBatch(words, {}, read(...words.map((w) => w.gap)));
    expect(GAP_REFRESH_MAX).toBe(8);
    expect(batch.map((b) => b.word)).toEqual(["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]);
  });
});
