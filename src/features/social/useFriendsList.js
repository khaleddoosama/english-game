import { useCallback, useEffect, useState } from "react";
import { useRefreshOnActivity } from "./useSocialCounts";
import { requestDoneText } from "./socialRules";

// The Friends page's state and actions. `api` is the friends API; `onChanged` lets the app count the badges again.
// The list is read on open, after every change and on the same events as the badges (someone may answer meanwhile).
export function useFriendsList(api, onChanged) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);       // what is being saved right now
  const [notice, setNotice] = useState(null);   // { kind: "ok" | "error", text }
  const [sure, setSure] = useState(null);       // the friend whose Remove is waiting for a second tap

  const load = useCallback(async () => {
    try { setData(await api.list()); setLoadError(null); }
    catch (e) { setLoadError(e.message); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  const reloadAll = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);
  useRefreshOnActivity(reloadAll);

  async function act(key, fn, okText) {
    setBusy(key); setNotice(null); setSure(null);
    try {
      const result = await fn();
      await load(); onChanged?.();
      const text = typeof okText === "function" ? okText(result) : okText;
      if (text) setNotice({ kind: "ok", text });
      return true;
    } catch (e) { setNotice({ kind: "error", text: e.message }); return false; }
    finally { setBusy(null); }
  }

  return {
    data, loadError, busy, notice, sure,
    clearNotice: () => setNotice(null),
    askSure: setSure,
    request: (username) => act("add", () => api.request(username), requestDoneText),
    accept: (p) => act(`yes-${p.id}`, () => api.respond(p.id, true), `You and ${p.username} are friends now.`),
    decline: (p) => act(`no-${p.id}`, () => api.respond(p.id, false)),
    remove: (f) => act(`rm-${f.id}`, () => api.remove(f.id), `${f.username} is no longer your friend.`),
    cancel: (p) => act(`cancel-${p.id}`, () => api.remove(p.id), "Request taken back."),
  };
}
