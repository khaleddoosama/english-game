// The Live realtime channel (src/features/live/transport.js), online side, with a fake Supabase Realtime client:
// messages sent before the channel is subscribed (the "joined" sent right after opening it) or while it reconnects
// wait and go out once it is (after giving up they go to the library, which sends them over HTTP); the status goes
// connecting -> live, with three retries (1 s, 3 s, 8 s) before "offline"; events and presence from others reach
// the screen; closing drops what is waiting. Made-up players. NOT proven: the real Supabase Realtime service.
// Docs: docs/modules/live/README.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ client: null }));
vi.mock("../src/lib/supabase", () => ({ isLocalMode: false, get supabase() { return env.client; } }));
const { openLiveChannel } = await import("../src/features/live/transport");

// A fake client: every channel made is kept with what it was asked to send; the test decides when it subscribes.
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
const sentEvents = (ch) => ch.sent.map((m) => [m.event, m.payload]);

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
  it("a message sent right after opening the channel goes out once it is subscribed", async () => {
    const { link } = open();
    link.send("joined", { user_id: SAM.id });
    await settle();
    const [ch] = env.client.channels;
    expect(ch.name).toBe("live:K7M2QX");
    expect(ch.sent).toEqual([]);
    await ch.status("SUBSCRIBED");
    expect(sentEvents(ch)).toEqual([["joined", { user_id: SAM.id }]]);
  });

  it("waiting messages go out once each, in the order they were sent", async () => {
    const { link } = open();
    link.send("joined", { user_id: SAM.id });
    link.send("progress", { user_id: SAM.id, answered: 1 });
    await settle();
    const [ch] = env.client.channels;
    await ch.status("SUBSCRIBED");
    link.send("end", {});
    expect(sentEvents(ch)).toEqual([["joined", { user_id: SAM.id }], ["progress", { user_id: SAM.id, answered: 1 }], ["end", {}]]);
  });

  it("a message sent while the channel reconnects goes out on the new channel", async () => {
    const { link } = open();
    await settle();
    const [first] = env.client.channels;
    await first.status("SUBSCRIBED");
    first.status("CHANNEL_ERROR", { message: "dropped" });
    link.send("progress", { user_id: SAM.id, answered: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    const second = env.client.channels[1];
    expect(env.client.removed).toContain(first);
    expect(first.sent).toEqual([]);
    await second.status("SUBSCRIBED");
    expect(sentEvents(second)).toEqual([["progress", { user_id: SAM.id, answered: 2 }]]);
  });

  it("nothing is sent after closing", async () => {
    const { link } = open();
    await settle();
    const [ch] = env.client.channels;
    await ch.status("SUBSCRIBED");
    link.close();
    link.send("progress", { user_id: SAM.id, answered: 5 });
    expect(ch.sent).toEqual([]);
  });

  it("closing drops the waiting messages", async () => {
    const { link } = open();
    link.send("joined", { user_id: SAM.id });
    await settle();
    const [ch] = env.client.channels;
    link.close();
    await ch.status("SUBSCRIBED");
    expect(ch.sent).toEqual([]);
    expect(env.client.removed).toContain(ch);
  });

  it("after giving up, waiting and new messages go to the library on the last channel, as before", async () => {
    const { link, calls } = open();
    await settle();
    link.send("joined", { user_id: SAM.id });
    for (const wait of [1000, 3000, 8000]) {
      env.client.channels.at(-1).status("TIMED_OUT");
      await vi.advanceTimersByTimeAsync(wait);
    }
    const last = env.client.channels.at(-1);
    expect(env.client.channels.flatMap((ch) => ch.sent)).toEqual([]);
    last.status("TIMED_OUT");
    expect(calls.status.at(-1)).toBe("offline");
    link.send("progress", { user_id: SAM.id, answered: 3 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(env.client.channels).toHaveLength(4);
    expect(sentEvents(last)).toEqual([["joined", { user_id: SAM.id }], ["progress", { user_id: SAM.id, answered: 3 }]]);
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

  it("retries after 1, 3 and 8 seconds, then says offline", async () => {
    const { calls } = open();
    await settle();
    const made = [];
    for (const wait of [1000, 3000, 8000]) {
      env.client.channels.at(-1).status("CHANNEL_ERROR", { message: "MissingPartition" });
      await vi.advanceTimersByTimeAsync(wait - 1);
      made.push(env.client.channels.length);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(made).toEqual([1, 2, 3]);
    env.client.channels.at(-1).status("CHANNEL_ERROR", { message: "MissingPartition" });
    expect(env.client.channels).toHaveLength(4);
    expect(calls.status.at(-1)).toBe("offline");
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
