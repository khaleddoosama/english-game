// Live Challenge realtime channel: presence (who has the challenge open)
// and small "something changed" events (joined, left, start, progress,
// end, rematch). The game itself runs through liveApi RPCs, so if the channel
// can't connect the challenge still works; the screen just refreshes by polling.
// Online the database sends the events (migration 0043) and the browser only
// listens; local mode uses BroadcastChannel, where the tabs send them.
import { isLocalMode, supabase } from "../../lib/supabase";

// The names the database sends (migration 0043).
const LIVE_EVENTS = ["joined", "left", "start", "progress", "end", "rematch"];

// Returns { send(event, payload), close() }. send() reaches the other tabs in
// local mode and does nothing online (the database has sent it already).
// onStatus gets "connecting" (not joined yet, or lost; the room polls often) or "live".
export function openLiveChannel(code, me, { onEvent, onPresence, onStatus = () => {} }) {
  return isLocalMode ? localChannel(code, me, onEvent, onPresence, onStatus) : realtimeChannel(code, me, onEvent, onPresence, onStatus);
}

// One channel for as long as the room is open. When it is lost (e.g. "MissingPartition" on a project's very first
// connection, or a dropped network) realtime-js joins this same channel again by itself: after 1, 2 and 5 s, then
// every 10 s while the socket is up, and at once when the socket reconnects. Until 2026-10-22 it was removed and
// replaced up to 3 times, then given up: after a long loss the server kept sending to a join the room no longer
// listened to, so the room stayed on polling until it was opened again (docs/modules/live/README.md, Fixed).
function realtimeChannel(code, me, onEvent, onPresence, onStatus) {
  let channel = null, closed = false;
  const connect = async () => {
    onStatus("connecting");
    try { await supabase.realtime.setAuth(); } catch {}
    if (closed) return;
    channel = supabase.channel(`live:${code}`, { config: { private: true, broadcast: { self: false }, presence: { key: me.id } } });
    for (const event of LIVE_EVENTS) channel.on("broadcast", { event }, ({ payload }) => onEvent(event, payload));
    channel.on("presence", { event: "sync" }, () => onPresence(Object.values(channel.presenceState()).map((metas) => metas[0]).filter(Boolean)));
    channel.subscribe(async (status, err) => {
      if (closed) return;
      // Presence is tracked again on every join: the server forgets it with the lost join.
      if (status === "SUBSCRIBED") { onStatus("live"); await channel.track({ id: me.id, name: me.name }); return; }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { console.warn("Live channel:", status, err?.message || ""); onStatus("connecting"); }
    });
  };
  connect();
  return {
    // The database sends every signal after the change is written (migration 0043), so the browser sends none.
    // Before 2026-10-20 it sent its own too, which doubled the billed messages.
    send() {},
    close() { closed = true; if (channel) supabase.removeChannel(channel); },
  };
}

function localChannel(code, me, onEvent, onPresence, onStatus) {
  const bc = new BroadcastChannel(`live3:${code}`);
  const seen = new Map([[me.id, { ...me, at: Date.now() }]]);
  const publish = () => onPresence([...seen.values()].filter((p) => p.id === me.id || Date.now() - p.at < 4000).map(({ at, ...p }) => p));
  bc.onmessage = ({ data }) => {
    if (data.kind === "presence") { const known = seen.has(data.me.id); seen.set(data.me.id, { ...data.me, at: Date.now() }); if (!known) publish(); return; }
    if (data.kind === "leave") { seen.delete(data.id); publish(); return; }
    onEvent(data.event, data.payload);
  };
  const beat = () => bc.postMessage({ kind: "presence", me });
  const timer = setInterval(() => { beat(); publish(); }, 1000);
  beat(); publish(); onStatus("live");
  return {
    send(event, payload) { bc.postMessage({ kind: "event", event, payload }); },
    close() { clearInterval(timer); bc.postMessage({ kind: "leave", id: me.id }); bc.close(); },
  };
}
