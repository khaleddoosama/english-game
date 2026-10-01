// Live Challenge realtime channel: presence (who has the challenge open)
// and small "something changed" events (joined, left, start, progress,
// end). The game itself runs through liveApi RPCs, so if the channel can't
// connect the challenge still works; the screen just refreshes by polling.
// Local mode uses BroadcastChannel so several tabs can play together.
import { isLocalMode, supabase } from "../../lib/supabase";

export const LIVE_EVENTS = ["joined", "left", "start", "progress", "end"];
const RETRY_MS = [1000, 3000, 8000];

// Returns { send(event, payload), close() }. onStatus gets "connecting",
// "live" or "offline" (gave up; polling only).
export function openLiveChannel(code, me, { onEvent, onPresence, onStatus = () => {} }) {
  return isLocalMode ? localChannel(code, me, onEvent, onPresence, onStatus) : realtimeChannel(code, me, onEvent, onPresence, onStatus);
}

function realtimeChannel(code, me, onEvent, onPresence, onStatus) {
  let channel = null, closed = false, attempt = 0, timer = null;
  const connect = async () => {
    if (closed) return;
    onStatus("connecting");
    try { await supabase.realtime.setAuth(); } catch {}
    channel = supabase.channel(`live:${code}`, { config: { private: true, broadcast: { self: false }, presence: { key: me.id } } });
    for (const event of LIVE_EVENTS) channel.on("broadcast", { event }, ({ payload }) => onEvent(event, payload));
    channel.on("presence", { event: "sync" }, () => onPresence(Object.values(channel.presenceState()).map((metas) => metas[0]).filter(Boolean)));
    channel.subscribe(async (status, err) => {
      if (closed) return;
      if (status === "SUBSCRIBED") { attempt = 0; onStatus("live"); await channel.track({ id: me.id, name: me.name }); return; }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // e.g. "MissingPartition" on a project's very first connection, or
        // a dropped network: try again a few times, then rely on polling.
        console.warn("Live channel:", status, err?.message || "");
        supabase.removeChannel(channel);
        if (attempt < RETRY_MS.length) { timer = setTimeout(connect, RETRY_MS[attempt++]); onStatus("connecting"); }
        else onStatus("offline");
      }
    });
  };
  connect();
  return {
    send(event, payload) { if (channel && !closed) channel.send({ type: "broadcast", event, payload }).catch(() => {}); },
    close() { closed = true; clearTimeout(timer); if (channel) supabase.removeChannel(channel); },
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
