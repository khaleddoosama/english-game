// Live Challenge transport. Online: a private Supabase Realtime channel per
// room (presence for who is here, broadcast for game events) plus the
// live_rooms/live_results tables. Local mode: the same interface over
// BroadcastChannel + localStorage, so two tabs can play for testing.
import { isLocalMode, supabase } from "../../lib/supabase";

export const LIVE_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomCode = () => Array.from({ length: 4 }, () => LIVE_CODE_CHARS[Math.floor(Math.random() * LIVE_CODE_CHARS.length)]).join("");
const EVENTS = ["room", "answer", "sync"];

/* ------------------------------------------------------------ rooms */

export const liveRooms = isLocalMode ? {
  async create({ title, seconds, questions, hostId }) {
    for (let i = 0; i < 8; i++) {
      const code = randomCode();
      if (localStorage.getItem(`live-room:${code}`)) continue;
      localStorage.setItem(`live-room:${code}`, JSON.stringify({ code, host_id: hostId, title, seconds, questions, state: "lobby" }));
      return code;
    }
    throw new Error("Couldn't find a free code. Try again.");
  },
  async get(code) { try { return JSON.parse(localStorage.getItem(`live-room:${code}`) || "null"); } catch { return null; } },
  async setState(code, state) { const r = await this.get(code); if (r) localStorage.setItem(`live-room:${code}`, JSON.stringify({ ...r, state })); },
  async saveResult() {},
} : {
  async create({ title, seconds, questions }) {
    // Old rooms of mine free their codes.
    await supabase.from("live_rooms").delete().lt("created_at", new Date(Date.now() - 86400000).toISOString());
    for (let i = 0; i < 8; i++) {
      const code = randomCode();
      const { error } = await supabase.from("live_rooms").insert({ code, title, seconds, questions });
      if (!error) return code;
      if (error.code !== "23505") throw new Error(error.message);
    }
    throw new Error("Couldn't find a free code. Try again.");
  },
  async get(code) {
    const { data, error } = await supabase.from("live_rooms").select("code, host_id, title, seconds, questions, state").eq("code", code).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },
  async setState(code, state) { await supabase.from("live_rooms").update({ state }).eq("code", code); },
  async saveResult(row) {
    const { error } = await supabase.from("live_results").insert(row);
    if (error) console.error("Couldn't save the live result:", error.message);
  },
};

/* ---------------------------------------------------------- channel */

// Returns { ready, send(event, payload), close() }. `onPresence` gets the
// list of { id, name, host } currently in the room.
export function openLiveChannel(code, me, { onEvent, onPresence }) {
  return isLocalMode ? localChannel(code, me, onEvent, onPresence) : realtimeChannel(code, me, onEvent, onPresence);
}

function realtimeChannel(code, me, onEvent, onPresence) {
  let channel = null, closed = false;
  const ready = (async () => {
    await supabase.realtime.setAuth();
    channel = supabase.channel(`live:${code}`, { config: { private: true, broadcast: { self: false }, presence: { key: me.id } } });
    for (const event of EVENTS) channel.on("broadcast", { event }, ({ payload }) => onEvent(event, payload));
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      onPresence(Object.values(state).map((metas) => metas[0]).filter(Boolean));
    });
    await new Promise((resolve, reject) => {
      channel.subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") { await channel.track({ id: me.id, name: me.name, host: !!me.host }); resolve(); }
        else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !closed) reject(err || new Error(`Live connection failed (${status}).`));
      });
    });
  })();
  return {
    ready,
    send(event, payload) { return channel?.send({ type: "broadcast", event, payload }); },
    close() { closed = true; if (channel) supabase.removeChannel(channel); },
  };
}

// Same-browser stand-in: BroadcastChannel for events, a heartbeat for presence.
function localChannel(code, me, onEvent, onPresence) {
  const bc = new BroadcastChannel(`live:${code}`);
  const seen = new Map([[me.id, { ...me, at: Date.now() }]]);
  const publish = () => onPresence([...seen.values()].filter((p) => p.id === me.id || Date.now() - p.at < 4000).map(({ at, ...p }) => p));
  bc.onmessage = ({ data }) => {
    if (data.kind === "presence") { const known = seen.has(data.me.id); seen.set(data.me.id, { ...data.me, at: Date.now() }); if (!known) publish(); return; }
    if (data.kind === "leave") { seen.delete(data.id); publish(); return; }
    onEvent(data.event, data.payload);
  };
  const beat = () => bc.postMessage({ kind: "presence", me });
  const timer = setInterval(() => { beat(); publish(); }, 1000);
  beat(); publish();
  return {
    ready: Promise.resolve(),
    send(event, payload) { bc.postMessage({ kind: "event", event, payload }); },
    close() { clearInterval(timer); bc.postMessage({ kind: "leave", id: me.id }); bc.close(); },
  };
}
