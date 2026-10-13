import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, FolderPlus, Inbox, Play, Plus, Send, Trash2, X } from "lucide-react";
import { navigate } from "../../lib/router";
import { buildTree, flattenTree, matchPasted, moveTargets, searchWords } from "./libraryTree";
import "../../styles/library.css";

const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// My library: views (folders) that can sit inside each other, the words and
// grammar rules in each, and a practice round from any of them.
//   api  - libraryApi (online or local)     ids  - key <-> server id (useLibrary)
//   words / grammar - the dictionary         levels - course levels, to start a view from one
//   onPractice(viewId, deep, name) - starts a round    friendsApi - to pick who a view is shared with
//   onInboxChanged() - the number of offers waiting changed
export default function LibraryPage({ api, ids, words, grammar, levels = [], friendsApi = null, onPractice, onInboxChanged }) {
  const [flat, setFlat] = useState(null);
  const [selected, setSelected] = useState(null);
  const [inside, setInside] = useState({ words: [], rules: [] });
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [rename, setRename] = useState(null);
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [friends, setFriends] = useState(null);
  const [shareTo, setShareTo] = useState(() => new Set());

  const wordByKey = useMemo(() => new Map(words.map((w) => [w.word, w])), [words]);
  const ruleByKey = useMemo(() => new Map(grammar.map((g) => [g.id, g])), [grammar]);
  const roots = useMemo(() => buildTree(flat || []), [flat]);
  const rows = useMemo(() => flattenTree(roots), [roots]);
  const view = rows.find((v) => v.id === selected) || null;

  const loadTree = useCallback(async () => {
    try { setFlat(await api.tree()); } catch (e) { setNotice({ kind: "error", text: e.message }); setFlat([]); }
  }, [api]);
  useEffect(() => { loadTree(); }, [loadTree]);
  const loadInbox = useCallback(async () => {
    try { setInbox(await api.inbox()); } catch { setInbox([]); }
  }, [api]);
  useEffect(() => { loadInbox(); }, [loadInbox]);
  const openShare = async () => {
    if (friends || !friendsApi) return;
    try { setFriends((await friendsApi.list()).friends || []); } catch { setFriends([]); }
  };

  const loadInside = useCallback(async () => {
    if (!selected) { setInside({ words: [], rules: [] }); return; }
    try {
      const list = await api.contents(selected, false);
      setInside({
        words: list.filter((x) => x.kind === "sense").map((x) => ids.keyOfSense(x.id)).filter(Boolean),
        rules: list.filter((x) => x.kind === "rule").map((x) => ids.keyOfRule(x.id)).filter(Boolean),
      });
    } catch (e) { setNotice({ kind: "error", text: e.message }); }
  }, [api, ids, selected]);
  useEffect(() => { loadInside(); setSure(false); setRename(null); setPicked(new Set()); setPasted(null); }, [loadInside]);

  async function act(fn, okText) {
    setBusy(true); setNotice(null);
    try {
      const out = await fn();
      await loadTree(); await loadInside();
      if (okText) setNotice({ kind: "ok", text: typeof okText === "function" ? okText(out) : okText });
      return out;
    } catch (e) { setNotice({ kind: "error", text: e.message }); return undefined; }
    finally { setBusy(false); }
  }

  async function answer(offer, accept) {
    setBusy(true); setNotice(null);
    try {
      const out = accept ? await api.accept(offer.id) : await api.dismiss(offer.id);
      await Promise.all([loadTree(), loadInbox()]);
      onInboxChanged?.();
      if (accept) {
        setSelected(out.view);
        setNotice({ kind: "ok", text: `Added “${out.name}”: ${count(out.words, "word")}${out.rules ? `, ${count(out.rules, "rule")}` : ""}${out.skipped ? ` (${out.skipped} private ${out.skipped === 1 ? "word was" : "words were"} not shared)` : ""}.` });
      }
    } catch (e) { setNotice({ kind: "error", text: e.message }); await loadInbox(); onInboxChanged?.(); }
    finally { setBusy(false); }
  }
  async function sendShare() {
    const to = [...shareTo];
    if (!view || !to.length) return;
    const sent = await act(() => api.share(view.id, to), (n) => (n ? `Sent to ${n} ${n === 1 ? "friend" : "friends"}. They'll see it next time they open My library.` : "They already have this one waiting."));
    if (sent !== undefined) setShareTo(new Set());
  }
  const create = async (e, parent = null) => {
    e.preventDefault();
    const text = parent ? sub : name;
    const id = await act(() => api.create(text, parent), `Created “${text.trim()}”.`);
    if (id) { (parent ? setSub : setName)(""); setSelected(id); }
  };
  async function fromLevel() {
    const lv = levels.find((l) => l.id === level);
    if (!lv) return;
    const id = await act(async () => {
      const made = await api.create(lv.id);
      const w = lv.items.filter((i) => i.kind === "word").map((i) => ids.senseOf(i.obj.word)).filter(Boolean);
      const r = lv.items.filter((i) => i.kind === "grammar").map((i) => ids.ruleOf(i.obj.id)).filter(Boolean);
      for (let i = 0; i < w.length; i += 200) await api.add(made, w.slice(i, i + 200));
      for (let i = 0; i < r.length; i += 200) await api.addRules(made, r.slice(i, i + 200));
      return made;
    }, `Made a view from ${lv.id}.`);
    if (id) { setSelected(id); setLevel(""); }
  }
  const addWords = (keys) => act(() => api.add(selected, keys.map(ids.senseOf).filter(Boolean)), (n) => (n ? `Added ${n}.` : "Those are already here."));
  const total = (v) => (v.words || 0) + (v.rules || 0);

  const results = useMemo(() => searchWords(words, query, 30), [words, query]);
  const runPaste = () => setPasted(matchPasted(paste, words));
  const toggle = (k) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  if (flat === null) return <section className="ui-page"><div className="ui-skeleton-row" /></section>;
  return (
    <section className="ui-page lib">
      <header className="ui-page-head lib-head">
        <h2><BookOpen size={20} /> My library</h2>
        <button className="wh-back-btn" onClick={() => navigate("/profile")}>Back</button>
      </header>
      {notice && <p className={`lib-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}

      {inbox.length > 0 && (
        <div className="lib-inbox" aria-label="Views friends shared with you">
          <h3 className="lib-sub"><Inbox size={14} /> Shared with you</h3>
          <ul>
            {inbox.map((o) => (
              <li key={o.id}>
                <span><b>{o.name}</b> from {o.from}<small>{count(o.words, "word")}{o.rules ? ` · ${count(o.rules, "rule")}` : ""}{o.views > 1 ? ` · ${o.views} views` : ""}</small></span>
                <span className="lib-actions">
                  <button className="ui-row-btn lib-primary" disabled={busy} onClick={() => answer(o, true)}>Add to my library</button>
                  <button className="ui-row-btn" disabled={busy} onClick={() => answer(o, false)}>Not now</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!flat.length && (
        <div className="lib-empty">
          <p><b>Your library is empty.</b> Make a view (a folder), like “A1.1” or “movies”, put the words you want in it, and practise just that. Views can sit inside each other.</p>
        </div>
      )}

      <div className="lib-make">
        <form onSubmit={(e) => create(e)} className="lib-inline">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New view, e.g. A1.1" aria-label="New view name" />
          <button className="ui-row-btn" disabled={busy || !name.trim()}><FolderPlus size={15} /> Create</button>
        </form>
        {levels.length > 0 && (
          <div className="lib-inline">
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Start from a course level">
              <option value="">…or start from a course level</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.id} · {l.items.length} items</option>)}
            </select>
            <button className="ui-row-btn" disabled={busy || !level} onClick={fromLevel}>Make it</button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="lib-tree" aria-label="Your views">
          {rows.map((v) => (
            <li key={v.id} className={v.id === selected ? "on" : ""} style={{ "--depth": v.depth }}>
              <button className="lib-name" onClick={() => setSelected(v.id === selected ? null : v.id)} aria-pressed={v.id === selected}>
                <ChevronRight size={14} className="lib-chev" /> <b>{v.name}</b><small>{count(v.words, "word")} · {count(v.rules, "rule")}</small>
              </button>
              <button className="ui-row-btn lib-go" disabled={!total(v) && !v.children.length} onClick={() => onPractice(v.id, true, v.name)} title="Practise this view and the views inside it"><Play size={14} /> Practise</button>
            </li>
          ))}
        </ul>
      )}

      {view && (
        <div className="lib-panel">
          <h3 className="lib-path">{view.path.split("::").join(" › ")}</h3>
          <div className="lib-actions">
            <button className="ui-row-btn" disabled={!total(view)} onClick={() => onPractice(view.id, false, view.name)}><Play size={14} /> Only this view</button>
            {rename === null
              ? <button className="ui-row-btn" onClick={() => setRename(view.name)}>Rename</button>
              : <form className="lib-inline" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.rename(view.id, rename), "Renamed.")) setRename(null); }}>
                  <input value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} aria-label="New name" autoFocus />
                  <button className="ui-row-btn" disabled={busy || !rename.trim()}>Save</button>
                  <button type="button" className="ui-row-btn" onClick={() => setRename(null)}><X size={14} /></button>
                </form>}
            <select value="" aria-label="Move to" onChange={(e) => { const v = e.target.value; if (v) act(() => api.move(view.id, v === "__top" ? null : v), "Moved."); }}>
              <option value="">Move to…</option>
              {view.parent && <option value="__top">Top level</option>}
              {moveTargets(roots, view.id).filter((t) => t.id !== view.parent).map((t) => <option key={t.id} value={t.id}>{"— ".repeat(t.depth)}{t.name}</option>)}
            </select>
            <button className={`ui-row-btn ${sure ? "lib-danger" : ""}`} disabled={busy} onClick={() => { if (!sure) { setSure(true); return; } act(() => api.remove(view.id), "Removed. Your words are still in your library.").then(() => setSelected(null)); }}>
              <Trash2 size={14} /> {sure ? "Tap again to remove" : "Remove"}
            </button>
          </div>
          <form className="lib-inline" onSubmit={(e) => create(e, view.id)}>
            <input value={sub} onChange={(e) => setSub(e.target.value)} maxLength={60} placeholder={`A view inside “${view.name}”`} aria-label="New view inside" />
            <button className="ui-row-btn" disabled={busy || !sub.trim()}><Plus size={14} /> Add</button>
          </form>

          {friendsApi && (
            <details className="lib-share" onToggle={(e) => e.currentTarget.open && openShare()}>
              <summary><Send size={14} /> Share with friends</summary>
              {friends === null ? <p className="ui-muted">Loading…</p> : !friends.length ? <p className="ui-muted">Add friends first, then you can share views with them.</p> : (
                <>
                  <ul className="lib-friends">
                    {friends.map((f) => <li key={f.id}><label><input type="checkbox" checked={shareTo.has(f.id)} onChange={() => setShareTo((cur) => { const n = new Set(cur); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} /> {f.username}</label></li>)}
                  </ul>
                  <button className="ui-row-btn" disabled={busy || !shareTo.size || !total(view) && !view.children.length} onClick={sendShare}>Send “{view.name}”{shareTo.size ? ` to ${shareTo.size}` : ""}</button>
                  <p className="ui-muted">They get their own copy. Words only you made stay private.</p>
                </>
              )}
            </details>
          )}

          <h4 className="lib-sub">In this view</h4>
          {!inside.words.length && !inside.rules.length && <p className="ui-muted">Nothing yet. Add words below.</p>}
          <ul className="lib-chips">
            {inside.words.map((k) => <li key={k}><span>{k}</span><button aria-label={`Take ${k} out`} onClick={() => act(() => api.drop(view.id, ids.senseOf(k)))}><X size={12} /></button></li>)}
            {inside.rules.map((k) => <li key={k} className="rule"><span>{ruleByKey.get(k)?.rule || k}</span></li>)}
          </ul>

          <h4 className="lib-sub">Add words</h4>
          <input className="lib-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by word or meaning" aria-label="Search words" />
          {results.length > 0 && (
            <>
              <ul className="lib-results">
                {results.map((w) => (
                  <li key={w.word}>
                    <label><input type="checkbox" checked={picked.has(w.word)} onChange={() => toggle(w.word)} /> <b>{w.word}</b><small>{w.meaning}</small></label>
                  </li>
                ))}
              </ul>
              <button className="ui-row-btn" disabled={busy || !picked.size} onClick={async () => { await addWords([...picked]); setPicked(new Set()); }}>Add {picked.size || ""} selected</button>
            </>
          )}
          <details className="lib-paste">
            <summary>Add a list (one word per line, up to 200)</summary>
            <textarea rows={5} value={paste} onChange={(e) => { setPaste(e.target.value); setPasted(null); }} placeholder={"reluctant\nonce in a blue moon\ncast"} aria-label="Words to add" />
            <button className="ui-row-btn" disabled={!paste.trim()} onClick={runPaste}>Check the list</button>
            {pasted && (
              <div className="lib-checked">
                <p>{pasted.matched.length} found{pasted.ambiguous.length ? `, ${pasted.ambiguous.length} with more than one meaning` : ""}{pasted.missing.length ? `, ${pasted.missing.length} not in the dictionary` : ""}.</p>
                {pasted.ambiguous.map((a) => (
                  <fieldset key={a.token}><legend>“{a.token}” has several meanings</legend>
                    {a.options.map((k) => <label key={k}><input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} /> {k} <small>{wordByKey.get(k)?.meaning}</small></label>)}
                  </fieldset>
                ))}
                {pasted.missing.length > 0 && <p className="ui-muted">Not found: {pasted.missing.join(", ")}</p>}
                <button className="ui-row-btn" disabled={busy || (!pasted.matched.length && !picked.size)} onClick={async () => { await addWords([...new Set([...pasted.matched, ...picked])].slice(0, 200)); setPasted(null); setPaste(""); setPicked(new Set()); }}>Add them</button>
              </div>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
