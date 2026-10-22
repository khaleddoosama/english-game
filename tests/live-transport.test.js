// The Live realtime channel (src/features/live/transport.js), online side, with a fake Supabase Realtime client:
// the browser sends no signal (the database sends them, migration 0043), whatever the channel's state; the status goes
// connecting -> live; a failed channel is kept (realtime-js joins it again by itself), never replaced and never given
// up, and is live again once joined; events and presence from others reach the screen; closing removes the one
// channel, and closing before it is made leaves none. Made-up players. NOT proven: the real Supabase Realtime service
// and realtime-js's own rejoining (e2e/realstack/live.cjs checks those).
// Docs: docs/modules/live/README.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ client: null }));
vi.mock("../src/lib/supabase", () => ({ isLocalMode: false, get supabase() { return env.client; } }));
const { openLiveChannel } = await import("../src/features/live/transport");

// A fake client: every channel made is kept with what it was asked to send; the test decides when it subscribes, and
// plays realtime-js's part: a lost channel reports CHANNEL_ERROR or TIMED_OUT, and SUBSCRIBED again once rejoined.
function fakeClient() {
  const c = {
    channels: [], removed: [],
    realtime: { setAuth: async () => {} },
    channel(name, opts) {
      const ch = {
        name, opts, handlers: [], sent: [], tracked: [], status: null, presence: {},
        on(type, filter, fn) { ch.handlers.push({ type, filter, fn }); return ch; },
        subscribe(fn) { ch.status = fn; return ch; },
        send(msg) { ch.sent.push(msg); return Promise.resolve("ok"); },
        track: async (meta) => { ch.tracked.push(meta); },
        presenceState: () => ch.presence,
        emit(type, event, payload) { ch.handlers.filter((h) => h.type === type && h.filter.event === event).forEach((h) => h.fn(payload)); },
      };
      c.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { c.removed.push(ch); },
  };
  return c;
}

const SAM = { id: "u-sam", name: "sam_01" };
const settle = () => vi.advanceTimersByTimeAsync(0);

function open(handlers = {}) {
  const calls = { events: [], presence: [], status: [] };
  const link = openLiveChannel("K7M2QX", SAM, {
    onEvent: (event, payload) => calls.events.push([event, payload]),
    onPresence: (list) => calls.presence.push(list),
    onStatus: (s) => calls.status.push(s),
    ...handlers,
  });
  return { link, calls };
}

beforeEach(() => { vi.useFakeTimers(); env.client = fakeClient(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("live channel: sending", () => {
  it("online the browser sends no signal, before or after the channel is subscribed (the database sends them)", async () => {
    const { link } = open();
    link.send("joined", { user_id: SAM.id });
    await settle();
    const [ch] = env.client.channels;
    await ch.status("SUBSCRIBED");
    for (const event of ["joined", "left", "start", "end"]) link.send(event, { user_id: SAM.id });
    link.send("progress", { user_id: SAM.id, answered: 1 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(ch.sent).toEqual([]);
  });

  it("nor while the channel is lost, nor once it is joined again", async () => {
    const { link } = open();
    await settle();
    const [ch] = env.client.channels;
    for (const status of ["TIMED_OUT", "CHANNEL_ERROR", "TIMED_OUT"]) {
      ch.status(status);
      link.send("progress", { user_id: SAM.id, answered: 2 });
      await vi.advanceTimersByTimeAsync(10000);
    }
    await ch.status("SUBSCRIBED");
    link.send("end", {});
    await vi.advanceTimersByTimeAsync(20000);
    expect(env.client.channels.flatMap((c) => c.sent)).toEqual([]);
  });

  it("closing removes the one channel, also while it is lost; a late status from it changes nothing", async () => {
    const { link, calls } = open();
    await settle();
    const [ch] = env.client.channels;
    await ch.status("SUBSCRIBED");
    ch.status("CHANNEL_ERROR", { message: "transport failure" });
    link.close();
    expect(env.client.removed).toEqual([ch]);
    const seen = calls.status.length;
    await ch.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(60000);
    expect([env.client.channels, calls.status.length, ch.tracked]).toEqual([[ch], seen, [SAM]]);
  });

  it("closing before the channel is made (the room left at once) leaves none", async () => {
    const { link, calls } = open();
    link.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect([env.client.channels, env.client.removed, calls.status]).toEqual([[], [], ["connecting"]]);
  });
});

describe("live channel: status, events and presence", () => {
  it("connecting, then live, and the player is tracked by id and name", async () => {
    const { calls } = open();
    await settle();
    const [ch] = env.client.channels;
    expect(ch.opts.config).toEqual({ private: true, broadcast: { self: false }, presence: { key: SAM.id } });
    await ch.status("SUBSCRIBED");
    expect(calls.status).toEqual(["connecting", "live"]);
    expect(ch.tracked).toEqual([SAM]);
  });

  it("a lost channel is kept, not replaced: connecting (polling) while it is lost, however long, then live again", async () => {
    const { calls } = open();
    await settle();
    const [ch] = env.client.channels;
    await ch.status("SUBSCRIBED");
    // A long loss (CI, 2026-10-22: 60 s offline): realtime-js reports the channel lost again and again for minutes.
    for (let i = 0; i < 12; i++) {
      ch.status(i % 3 ? "CHANNEL_ERROR" : "TIMED_OUT", { message: "transport failure" });
      await vi.advanceTimersByTimeAsync(10000);
    }
    expect([calls.status.at(-1), env.client.channels, env.client.removed]).toEqual(["connecting", [ch], []]);
    // The network is back: realtime-js joins the same channel again.
    await ch.status("SUBSCRIBED");
    expect(calls.status.at(-1)).toBe("live");
    expect(calls.status).not.toContain("offline");
    expect(ch.tracked).toEqual([SAM, SAM]);
    ch.emit("broadcast", "progress", { payload: { user_id: "u-ada", answered: 5 } });
    expect(calls.events).toEqual([["progress", { user_id: "u-ada", answered: 5 }]]);
    expect(env.client.channels).toEqual([ch]);
  });

  it("a channel that fails before its first join (e.g. MissingPartition) is kept too, and goes live when it joins", async () => {
    const { calls } = open();
    await settle();
    const [ch] = env.client.channels;
    for (let i = 0; i < 5; i++) { ch.status("CHANNEL_ERROR", { message: "MissingPartition" }); await vi.advanceTimersByTimeAsync(10000); }
    await ch.status("SUBSCRIBED");
    expect([calls.status.at(-1), env.client.channels, env.client.removed]).toEqual(["live", [ch], []]);
  });

  it("events and presence from others reach the screen", async () => {
    const { calls } = open();
    await settle();
    const [ch] = env.client.channels;
    ch.emit("broadcast", "start", { payload: {} });
    ch.emit("broadcast", "progress", { payload: { user_id: "u-ada", answered: 4 } });
    ch.emit("broadcast", "rematch", { payload: { next_code: "B2C3D4" } });
    ch.presence = { "u-ada": [{ id: "u-ada", name: "ada" }], "u-sam": [{ id: SAM.id, name: SAM.name }] };
    ch.emit("presence", "sync");
    expect(calls.events).toEqual([["start", {}], ["progress", { user_id: "u-ada", answered: 4 }], ["rematch", { next_code: "B2C3D4" }]]);
    expect(calls.presence).toEqual([[{ id: "u-ada", name: "ada" }, { id: SAM.id, name: SAM.name }]]);
  });
});
