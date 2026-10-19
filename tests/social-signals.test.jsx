// @vitest-environment jsdom
// The database's signals to one player (src/features/social/socialSignals.js, migration 0043), with a fake Supabase
// Realtime client: the private channel user:<id>, "friends" and "invite" reach every listener, a failed channel is
// tried again after 1, 3 and 8 s and then left to the checks, closing (even before it is open) leaves nothing open,
// nothing in local mode; the badge counts and Live's invitations list ask again at once. Made-up players.
// Docs: docs/modules/social/friends-and-ranks.md, docs/modules/live/README.md.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ local: false, client: null }));
vi.mock("../src/lib/supabase", () => ({ get isLocalMode() { return env.local; }, get supabase() { return env.client; } }));
const { SOCIAL_SIGNALS, onSocialSignal, openPersonalChannel } = await import("../src/features/social/socialSignals");
const { useSocialCounts } = await import("../src/features/social/useSocialCounts");
const { Invitations } = await import("../src/features/live/LiveFriends");

function fakeClient() {
  const c = {
    channels: [], removed: [], auth: 0,
    realtime: { setAuth: async () => { c.auth++; } },
    channel(name, opts) {
      const ch = { name, opts, handlers: {}, status: null,
        on(type, filter, fn) { ch.handlers[`${type}:${filter.event}`] = fn; return ch; },
        subscribe(fn) { ch.status = fn; return ch; },
        emit(event, payload = {}) { ch.handlers[`broadcast:${event}`]?.({ payload }); } };
      c.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { c.removed.push(ch); },
  };
  return c;
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

let stops = [];
beforeEach(() => { vi.useFakeTimers(); env.local = false; env.client = fakeClient(); globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { stops.forEach((s) => s()); stops = []; vi.useRealTimers(); });

describe("the player's channel", () => {
  it("private user:<id>; friends and invite reach every listener; other events are not listened to", async () => {
    const heard = [], also = [];
    stops.push(onSocialSignal((e, p) => heard.push([e, p])), onSocialSignal((e) => also.push(e)));
    stops.push(openPersonalChannel("u-sam"));
    await settle();
    const [ch] = env.client.channels;
    expect([ch.name, ch.opts, env.client.auth]).toEqual(["user:u-sam", { config: { private: true } }, 1]);
    expect(SOCIAL_SIGNALS).toEqual(["friends", "invite"]);
    expect(Object.keys(ch.handlers)).toEqual(["broadcast:friends", "broadcast:invite"]);
    ch.emit("friends"); ch.emit("invite", { x: 1 });
    expect(heard).toEqual([["friends", {}], ["invite", { x: 1 }]]);
    expect(also).toEqual(["friends", "invite"]);
  });

  it("a listener that stops hears nothing more", async () => {
    const heard = [];
    const stop = onSocialSignal((e) => heard.push(e));
    stops.push(openPersonalChannel("u-sam"));
    await settle();
    stop();
    env.client.channels[0].emit("friends");
    expect(heard).toEqual([]);
  });

  it("a failed channel is tried again after 1, 3 and 8 seconds, then left to the checks", async () => {
    stops.push(openPersonalChannel("u-sam"));
    await settle();
    for (const wait of [1000, 3000, 8000]) {
      env.client.channels.at(-1).status("CHANNEL_ERROR");
      await act(async () => { await vi.advanceTimersByTimeAsync(wait - 1); });
      const before = env.client.channels.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(env.client.channels.length).toBe(before + 1);
    }
    env.client.channels.at(-1).status("TIMED_OUT");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(env.client.channels).toHaveLength(4);
    expect(env.client.removed).toHaveLength(4);
  });

  it("closing removes the channel; closing before it opens leaves none", async () => {
    const close = openPersonalChannel("u-sam");
    await settle();
    close();
    expect(env.client.removed).toEqual([env.client.channels[0]]);
    const early = openPersonalChannel("u-ada");
    early();
    await settle();
    expect(env.client.channels).toHaveLength(1);
  });

  it("nothing in local mode or without a player", async () => {
    env.local = true;
    stops.push(openPersonalChannel("tab-abc123"));
    env.local = false;
    stops.push(openPersonalChannel(undefined));
    await settle();
    expect(env.client.channels).toEqual([]);
  });
});

describe("listeners", () => {
  let root, host;
  const mount = async (el) => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root.render(el)); };
  afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = host = undefined; });

  it("the badge counts ask again at once on a signal", async () => {
    const api = { counts: vi.fn(async () => ({ requests: api.counts.mock.calls.length, invites: 0 })) };
    let out;
    function Probe() { out = useSocialCounts(api, true); return null; }
    stops.push(openPersonalChannel("u-sam"));
    await mount(<Probe />); await settle();
    expect([api.counts.mock.calls.length, out.counts.requests]).toEqual([1, 1]);
    await act(async () => { env.client.channels[0].emit("friends"); await vi.advanceTimersByTimeAsync(0); });
    expect([api.counts.mock.calls.length, out.counts.requests]).toEqual([2, 2]);
  });

  it("Live's invitations list asks again on an invitation, not on a friends signal", async () => {
    const friendsApi = { myInvites: vi.fn(async () => (friendsApi.myInvites.mock.calls.length > 1
      ? [{ code: "K7M2QX", title: "Weather words", from: "omar_k", players: 1, max_players: 4, question_count: 10, seconds: 20 }] : [])) };
    stops.push(openPersonalChannel("u-sam"));
    await mount(<Invitations friendsApi={friendsApi} api={{}} onOpenCode={() => {}} />); await settle();
    expect(friendsApi.myInvites).toHaveBeenCalledTimes(1);
    await act(async () => { env.client.channels[0].emit("friends"); await vi.advanceTimersByTimeAsync(0); });
    expect(friendsApi.myInvites).toHaveBeenCalledTimes(1);
    await act(async () => { env.client.channels[0].emit("invite"); await vi.advanceTimersByTimeAsync(0); });
    expect(friendsApi.myInvites).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Weather words");
  });
});
