import { useCallback, useEffect, useRef, useState } from "react";
import { openLiveChannel } from "./transport";
import { REMATCH_POLL_MS, keepShown, myRow, roomPollMs, someoneNew, watchesRematch, withProgress, withQuestion } from "./roomRules";

// One challenge room as this player sees it: the challenge (read again on signals and by polling, questions already
// shown never taken back), who has it open, the channel's state, my row, and the actions' busy state and message.
// `api` is the Live API, `player` { id, name }. Docs: docs/modules/live/challenge-room.md.
export function useChallengeRoom({ api, code, player }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState([]);
  const [channelState, setChannelState] = useState("connecting");
  const [localMe, setLocalMe] = useState(null); // newest of my own rows, from answer results
  const channelRef = useRef(null), viewRef = useRef(null);
  const keep = (v) => { v = keepShown(viewRef.current, v); viewRef.current = v; setView(v); };
  const addQuestion = (i, q) => { const v = withQuestion(viewRef.current, i, q); if (v) keep(v); };

  const refresh = useCallback(async () => {
    try { keep(await api.view(code)); setLoadError(null); }
    catch (e) { if (!viewRef.current) setLoadError(e.message); }
  }, [api, code]);
  useEffect(() => { refresh(); }, [refresh]);

  // Realtime while I'm in it; polling covers a missing channel.
  const member = !!view?.member;
  useEffect(() => {
    if (!member) return;
    const ch = openLiveChannel(code, { id: player.id, name: player.name }, {
      onEvent(event, payload) {
        if (event === "progress" && payload?.user_id) {
          const cur = viewRef.current;
          if (cur) keep(withProgress(cur, payload));
          if (payload.finished_at) refresh();
        } else refresh();
      },
      onPresence(list) {
        setOnline(list.map((p) => p.id));
        if (someoneNew(viewRef.current, list)) refresh();
      },
      onStatus: setChannelState,
    });
    channelRef.current = ch;
    ch.send("joined", { user_id: player.id });
    return () => { ch.close(); channelRef.current = null; };
  }, [member, code, player.id]);
  useEffect(() => {
    if (!view || view.state === "done") return;
    const t = setInterval(refresh, roomPollMs(channelState));
    return () => clearInterval(t);
  }, [view?.state, channelState, refresh]);

  // A finished challenge is checked for a rematch the creator made, for half an hour.
  useEffect(() => {
    if (!watchesRematch(view)) return;
    const t = setInterval(refresh, REMATCH_POLL_MS);
    return () => clearInterval(t);
  }, [view?.state, view?.member, view?.settings?.next_code, view?.ended_at, refresh]);

  const send = (event, payload = {}) => channelRef.current?.send(event, payload);
  // From the results: go to the rematch, joining it first unless I made it. If it can't be joined
  // (full, already started) its own page says why.
  async function openNext(next, mine, onOpen) {
    if (!mine) { setBusy(true); try { await api.join(next); } catch { /* the invite page explains */ } setBusy(false); }
    onOpen(next);
  }
  async function act(fn, after) {
    setBusy(true); setError(null);
    try { const r = await fn(); if (r && typeof r === "object" && r.code) keep(r); after?.(r); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }

  const me = view ? myRow(view, player.id, localMe) : null;
  return { view, loadError, error, busy, online, channelState, me, isHost: !!view && view.host_id === player.id, refresh, addQuestion, setLocalMe, send, act, openNext };
}
