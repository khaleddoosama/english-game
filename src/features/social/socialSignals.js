// Signals the database sends to one player (migration 0043), online only: "friends" (a friend request, an answer, a
// removal) and "invite" (a Live invitation), on the private channel user:<id>. Screens that show these lists listen
// with onSocialSignal and ask the server again at once; their 30-45 s checks stay as the safety net.
// Docs: docs/modules/social/friends-and-ranks.md.
import { isLocalMode, supabase } from "../../lib/supabase";

export const SOCIAL_SIGNALS = ["friends", "invite"];
const RETRY_MS = [1000, 3000, 8000];
const listeners = new Set();

// fn(event, payload) for every signal; returns the function that stops listening.
export function onSocialSignal(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = (event, payload) => listeners.forEach((fn) => fn(event, payload));

// Opens the player's channel (nothing in local mode, where other tabs' changes arrive as storage events); returns
// close(). A failed channel is tried again after 1, 3 and 8 seconds, then left to the checks.
export function openPersonalChannel(userId, client = supabase) {
  if (isLocalMode || !client || !userId) return () => {};
  let channel = null, closed = false, attempt = 0, timer = null;
  const connect = async () => {
    try { await client.realtime.setAuth(); } catch {}
    if (closed) return;
    channel = client.channel(`user:${userId}`, { config: { private: true } });
    for (const event of SOCIAL_SIGNALS) channel.on("broadcast", { event }, ({ payload }) => emit(event, payload));
    channel.subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") { attempt = 0; return; }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        client.removeChannel(channel);
        if (attempt < RETRY_MS.length) timer = setTimeout(connect, RETRY_MS[attempt++]);
      }
    });
  };
  connect();
  return () => { closed = true; clearTimeout(timer); if (channel) client.removeChannel(channel); };
}
