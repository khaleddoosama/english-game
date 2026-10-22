// What the Realtime service delivers, through the real stack: the triggers of migration 0043 call realtime.send(), the
// Realtime service (CI job "realstack", WITH_REALTIME=1) delivers the message on a private channel, and its policies
// decide who may listen. Players sign in through GoTrue and listen with supabase-js, as the app does
// (src/features/social/socialSignals.js, src/features/live/transport.js). Made-up players only.
//
// Needs the real stack with Realtime (REALSTACK_REALTIME=1 and the variables of stack.js); otherwise it is skipped,
// and tests/realstack/run-ci.sh fails a run in which it was skipped. See docs/integration-tests.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENABLED, cleanup, newTag, promote, signUp, sql } from "./stack";

const REALTIME = ENABLED && process.env.REALSTACK_REALTIME === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// What the trigger sent, from a message that must have arrived (Realtime adds the message's own id; it is left out).
// A missing message fails here, so an empty payload can never pass for a delivered one.
const sent = (message) => {
  expect(message, "the message did not arrive").not.toBeNull();
  const { id: _id, ...rest } = message.payload || {};
  return rest;
};
const QUESTIONS = [1, 2, 3].map((n) => ({ mode: "meaning", prompt: `p${n}`, options: ["Apple", "Bread", "Cheese"], answer: "Apple", word: "apple" }));

// Listens on a private topic as the app does; `status` is SUBSCRIBED, or CHANNEL_ERROR when the policies refuse.
async function listen(player, topic, events) {
  await player.client.realtime.setAuth();
  const got = [];
  const channel = player.client.channel(topic, { config: { private: true } });
  for (const event of events) channel.on("broadcast", { event }, ({ payload }) => got.push({ event, payload }));
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("NO ANSWER"), 15000);
    channel.subscribe((s) => { if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") { clearTimeout(timer); resolve(s); } });
  });
  const waitFor = async (event, ms = 10000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
      const hit = got.find((m) => m.event === event);
      if (hit) return hit;
    }
    return null;
  };
  return { channel, got, status, waitFor, close: () => player.client.removeChannel(channel) };
}

describe.skipIf(!REALTIME)("Realtime delivers the database's signals, only to who may read them", () => {
  const tag = newTag();
  let ann, bob, cat;
  const open = [];
  beforeAll(async () => {
    [ann, bob, cat] = await Promise.all([signUp(`${tag}ann`), signUp(`${tag}bob`), signUp(`${tag}cat`)]);
    promote(ann); // Live challenges are made by the admin in this test (the app's switch for players is not the point)
    // Realtime starts streaming the database's messages when the first channel joins, and a message written before
    // that stream runs is not delivered (seen in CI: the first friend request never arrived). So a test message is
    // sent until one reaches a player: the tests below measure delivery, not Realtime starting up.
    const probe = await listen(cat, `user:${cat.id}`, ["probe"]);
    let sent = 0;
    for (; sent < 30 && !probe.got.length; sent++) {
      sql(`select realtime.send('{}'::jsonb, 'probe', 'user:${cat.id}', true)`);
      await sleep(1000);
    }
    await probe.close();
    if (!probe.got.length) throw new Error("Realtime delivered no test message in 30 s");
    console.log(`Realtime delivered a test message after ${sent} sent, ${probe.got.length} received`);
  }, 60000);
  afterAll(async () => {
    for (const l of open) await l.close();
    for (const p of [ann, bob, cat]) p?.client.realtime.disconnect();
    cleanup(tag);
  });

  it("a friend request reaches the asked player's own channel; another player cannot listen there", async () => {
    const bobs = await listen(bob, `user:${bob.id}`, ["friends", "invite"]); open.push(bobs);
    const spy = await listen(cat, `user:${bob.id}`, ["friends", "invite"]); open.push(spy);
    expect(bobs.status).toBe("SUBSCRIBED");
    expect(spy.status).toBe("CHANNEL_ERROR");

    const r = await ann.client.rpc("friend_request", { p_username: bob.username });
    expect(r.error).toBeNull();
    expect(sent(await bobs.waitFor("friends"))).toEqual({}); // a signal only: no name, no answer
    expect(spy.got).toEqual([]);
  }, 30000);

  it("the answer reaches the player who asked", async () => {
    const anns = await listen(ann, `user:${ann.id}`, ["friends"]); open.push(anns);
    expect(anns.status).toBe("SUBSCRIBED");
    const r = await bob.client.rpc("friend_respond", { p_user: ann.id, p_accept: true });
    expect(r.error).toBeNull();
    expect(sent(await anns.waitFor("friends"))).toEqual({});
  }, 30000);

  it("a Live invitation reaches the invited friend; a player joining reaches the challenge's members, not an outsider", async () => {
    const made = await ann.client.rpc("live_create", { p_title: "Made-up", p_seconds: 20, p_max_players: 3, p_start_mode: "together", p_settings: {}, p_questions: QUESTIONS });
    expect(made.error).toBeNull();
    const code = made.data;

    const bobs = await listen(bob, `user:${bob.id}`, ["invite"]); open.push(bobs);
    const inv = await ann.client.rpc("live_invite_friends", { p_code: code, p_users: [bob.id] });
    expect(inv.error).toBeNull();
    expect(sent(await bobs.waitFor("invite"))).toEqual({});

    const room = await listen(ann, `live:${code}`, ["joined"]); open.push(room);
    const outsider = await listen(cat, `live:${code}`, ["joined"]); open.push(outsider);
    expect(room.status).toBe("SUBSCRIBED");
    expect(outsider.status).toBe("CHANNEL_ERROR");

    const joined = await bob.client.rpc("live_join", { p_code: code });
    expect(joined.error).toBeNull();
    expect(sent(await room.waitFor("joined"))).toEqual({ user_id: bob.id });
    expect(outsider.got).toEqual([]);
  }, 45000);
});
