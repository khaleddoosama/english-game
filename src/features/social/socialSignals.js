// Signals the database sends to one player (migration 0043), online only: "friends" (a friend request, an answer, a
// removal) and "invite" (a Live invitation), on the private channel user:<id>. Screens that show these lists listen
// with onSocialSignal and ask the server again at once; their 30-45 s checks stay as the safety net.
// Docs: docs/modules/social/friends-and-ranks.md.
import { isLocalMode, supabase } from "../../lib/supabase";

export const SOCIAL_SIGNALS = ["friends", "invite"];
const listeners = new Set();

// fn(event, payload) for every signal; returns the function that stops listening.
export function onSocialSignal(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = (event, payload) => listeners.forEach((fn) => fn(event, payload));

// Opens the player's channel (nothing in local mode, where other tabs' changes arrive as storage events); returns
// close(). A lost channel is kept: realtime-js joins it again by itself for as long as the game is open (as Live's
// channel, src/features/live/transport.js), and the checks carry on meanwhile. Until 2026-10-22 it was replaced up to
// 3 times and then given up, which lost every signal after a long loss until the game was opened again.
export function openPersonalChannel(userId, client = supabase) {
  if (isLocalMode || !client || !userId) return () => {};
  let channel = null, closed = false;
  const connect = async () => {
    try { await client.realtime.setAuth(); } catch {}
    if (closed) return;
    channel = client.channel(`user:${userId}`, { config: { private: true } });
    for (const event of SOCIAL_SIGNALS) channel.on("broadcast", { event }, ({ payload }) => emit(event, payload));
    channel.subscribe();
  };
  connect();
  return () => { closed = true; if (channel) client.removeChannel(channel); };
}
