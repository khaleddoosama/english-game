import UnitFilter from "../../../lib/UnitFilter";
import { matchesUnit } from "../../../lib/unitFilter";
import { useMemo, useState } from "react";
import { Plus, Play, Trash2, X } from "lucide-react";
import { moveTargets } from "../libraryTree";
import AddRules from "./AddRules";
import AddWords from "./AddWords";
import SharePanel from "./SharePanel";
import { SHOWN } from "./format";

// The open view: its path, what can be done to it, what is in it, and adding more.
// Shown with key={view.id}, so everything in it starts fresh for each view.
export default function ViewPanel({ view, roots, inside, libraryKeys, libraryRuleKeys = new Set(), grammar = [], api, ids, words, wordByKey, ruleByKey, friendsApi, busy, act, setNotice, onPractice, onRemoved, onCreated, onRefreshIds, onAskWord }) {
  const [rename, setRename] = useState(null);
  const [sub, setSub] = useState("");
  const [sure, setSure] = useState(false);
  const [wordUnit, setWordUnit] = useState("");
  const [ruleUnit, setRuleUnit] = useState("");
  const [showAll, setShowAll] = useState(false);
  const viewWords = inside.words.map((k) => wordByKey.get(k)).filter(Boolean);
  const viewRules = inside.rules.map((k) => ruleByKey.get(k)).filter(Boolean);
  const filteredWords = inside.words.filter((k) => matchesUnit(wordByKey.get(k), wordUnit));
  const filteredRules = inside.rules.filter((k) => matchesUnit(ruleByKey.get(k), ruleUnit));
  const total = view.words + view.rules;
  const inViewKeys = useMemo(() => new Set(inside.words), [inside.words]);

  const inViewRuleKeys = useMemo(() => new Set(inside.rules), [inside.rules]);

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
      {!inside.words.length && !inside.rules.length && <p className="ui-muted">Nothing yet. Add words or grammar rules below.</p>}
      {inside.words.length > 0 && <div className="lib-filters"><span>Words</span><UnitFilter items={viewWords} value={wordUnit} label="Word units" onChange={(v) => { setWordUnit(v); setShowAll(false); }} /></div>}
      {inside.words.length > 0 && !filteredWords.length && <p className="ui-muted">No words match this unit.</p>}
      <ul className="lib-chips">
        {(showAll ? filteredWords : filteredWords.slice(0, SHOWN)).map((k) => <li key={k}><span>{k}</span><button aria-label={`Take ${k} out`} onClick={() => act(() => api.drop(view.id, ids.senseOf(k)))}><X size={12} /></button></li>)}
      </ul>
      {filteredWords.length > SHOWN && <button className="lib-link" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${filteredWords.length} words`}</button>}
      {inside.rules.length > 0 && <div className="lib-filters"><span>Grammar</span><UnitFilter items={viewRules} value={ruleUnit} label="Grammar units" onChange={setRuleUnit} /></div>}
      {inside.rules.length > 0 && !filteredRules.length && <p className="ui-muted">No rules match this unit.</p>}
      <ul className="lib-chips">
        {filteredRules.map((k) => { const name = ruleByKey.get(k)?.rule || k; return <li key={k} className="rule"><span>{name}</span><button aria-label={`Take ${name} out`} onClick={() => act(() => api.dropRule(view.id, ids.ruleOf(k)))}><X size={12} /></button></li>; })}
      </ul>

      <AddWords words={words} libraryKeys={libraryKeys} inView={inViewKeys} wordByKey={wordByKey} ids={ids} busy={busy} setNotice={setNotice} onAskWord={onAskWord} onRefreshIds={onRefreshIds}
        onAdd={(senseIds, okText) => act(() => (senseIds.length ? api.add(view.id, senseIds) : 0), okText)} />
      <AddRules grammar={grammar} libraryRuleKeys={libraryRuleKeys} inView={inViewRuleKeys} busy={busy}
        onAdd={(keys) => act(() => api.addRules(view.id, keys.map(ids.ruleOf).filter(Boolean)), (n) => (n ? `Added ${n === 1 ? "1 rule" : `${n} rules`}.` : "Those are already here."))} />
    </div>
  );
}
