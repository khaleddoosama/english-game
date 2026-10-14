import { useMemo, useState } from "react";
import { Plus, Play, Trash2, X } from "lucide-react";
import { moveTargets } from "../libraryTree";
import AddWords from "./AddWords";
import SharePanel from "./SharePanel";
import { SHOWN } from "./format";

// The open view: its path, what can be done to it, what is in it, and adding more.
// Shown with key={view.id}, so everything in it starts fresh for each view.
export default function ViewPanel({ view, roots, inside, libraryKeys, api, ids, words, wordByKey, ruleByKey, friendsApi, busy, act, setNotice, onPractice, onRemoved, onCreated, onRefreshIds, onAskWord }) {
  const [rename, setRename] = useState(null);
  const [sub, setSub] = useState("");
  const [sure, setSure] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const total = view.words + view.rules;
  const inViewKeys = useMemo(() => new Set(inside.words), [inside.words]);

  // Rules that share a title (a set of questions on one topic) show as one chip with a count.
  const ruleGroups = useMemo(() => {
    const by = new Map();
    for (const k of inside.rules) { const label = ruleByKey.get(k)?.rule || k; by.set(label, (by.get(label) || 0) + 1); }
    return [...by];
  }, [inside.rules, ruleByKey]);

  async function createInside(e) {
    e.preventDefault();
    const id = await act(() => api.create(sub, view.id), `Created “${sub.trim()}”.`);
    if (id) { setSub(""); onCreated(id); }
  }
  async function saveName(e) {
    e.preventDefault();
    if (await act(() => api.rename(view.id, rename), "Renamed.")) setRename(null);
  }
  async function remove() {
    if (!sure) { setSure(true); return; }
    await act(() => api.remove(view.id), "Removed. Your words are still in your library.");
    onRemoved();
  }
  const send = (userIds) => act(() => api.share(view.id, userIds), (n) => (n ? `Sent to ${n} ${n === 1 ? "friend" : "friends"}. They'll see it next time they open My library.` : "They already have this one waiting."));

  return (
    <div className="lib-panel">
      <h3 className="lib-path">{view.path.split("::").join(" › ")}</h3>
      <div className="lib-actions">
        <button className="ui-row-btn" disabled={!total} onClick={() => onPractice(view.id, false, view.name)}><Play size={14} /> Only this view</button>
        {rename === null
          ? <button className="ui-row-btn" onClick={() => setRename(view.name)}>Rename</button>
          : <form className="lib-inline" onSubmit={saveName}>
              <input value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} aria-label="New name" autoFocus />
              <button className="ui-row-btn" disabled={busy || !rename.trim()}>Save</button>
              <button type="button" className="ui-row-btn" onClick={() => setRename(null)}><X size={14} /></button>
            </form>}
        <select value="" aria-label="Move to" onChange={(e) => { const v = e.target.value; if (v) act(() => api.move(view.id, v === "__top" ? null : v), "Moved."); }}>
          <option value="">Move to…</option>
          {view.parent && <option value="__top">Top level</option>}
          {moveTargets(roots, view.id).filter((t) => t.id !== view.parent).map((t) => <option key={t.id} value={t.id}>{"— ".repeat(t.depth)}{t.name}</option>)}
        </select>
        <button className={`ui-row-btn ${sure ? "lib-danger" : ""}`} disabled={busy} onClick={remove}><Trash2 size={14} /> {sure ? "Tap again to remove" : "Remove"}</button>
      </div>
      <form className="lib-inline" onSubmit={createInside}>
        <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={60} placeholder={`A view inside “${view.name}”`} aria-label="New view inside" />
        <button className="ui-row-btn" disabled={busy || !sub.trim()}><Plus size={14} /> Add</button>
      </form>

      <SharePanel api={api} friendsApi={friendsApi} view={view} empty={!total && !view.children.length} busy={busy} onSend={send} />

      <h4 className="lib-sub">In this view</h4>
      {!inside.words.length && !inside.rules.length && <p className="ui-muted">Nothing yet. Add words below.</p>}
      <ul className="lib-chips">
        {(showAll ? inside.words : inside.words.slice(0, SHOWN)).map((k) => <li key={k}><span>{k}</span><button aria-label={`Take ${k} out`} onClick={() => act(() => api.drop(view.id, ids.senseOf(k)))}><X size={12} /></button></li>)}
        {ruleGroups.map(([label, n]) => <li key={label} className="rule"><span>{label}{n > 1 ? ` ×${n}` : ""}</span></li>)}
      </ul>
      {inside.words.length > SHOWN && <button className="lib-link" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${inside.words.length} words`}</button>}

      <AddWords words={words} libraryKeys={libraryKeys} inView={inViewKeys} wordByKey={wordByKey} ids={ids} busy={busy} setNotice={setNotice} onAskWord={onAskWord} onRefreshIds={onRefreshIds}
        onAdd={(senseIds, okText) => act(() => (senseIds.length ? api.add(view.id, senseIds) : 0), okText)} />
    </div>
  );
}
