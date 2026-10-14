import { useMemo, useState } from "react";
import { matchPasted } from "../libraryTree";
import WordPicker from "./WordPicker";
import { useSelection } from "./useSelection";
import { count } from "./format";

// Put words in the open view: search the dictionary and tick, or paste a list.
// A word the id map doesn't know was added after the app started: the map is
// reloaded once and it is tried again.
export default function AddWords({ words, libraryKeys, inView, wordByKey, ids, busy, onAdd, onAskWord, onRefreshIds, setNotice }) {
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState(null);
  const sel = useSelection();
  // Where the words come from: the ones already in my library, or the whole dictionary (which also adds them to my library).
  const [source, setSource] = useState(libraryKeys.size ? "library" : "dictionary");
  const pool = useMemo(() => (source === "library" ? words.filter((w) => libraryKeys.has(w.word)) : words), [source, words, libraryKeys]);

  async function add(keys) {
    let map = ids, unknown = keys.filter((k) => map.senseOf(k) === undefined);
    if (unknown.length && onRefreshIds) { map = await onRefreshIds().catch(() => map); unknown = keys.filter((k) => map.senseOf(k) === undefined); }
    const known = keys.filter((k) => !unknown.includes(k));
    const out = await onAdd(known.map(map.senseOf), (n) => (n ? `Added ${n}.` : "Those are already here."));
    if (unknown.length) setNotice({ kind: "error", text: `${count(unknown.length, "word")} not in the library yet (${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}). New words reach it after the next content save.` });
    return out;
  }

  return (
    <>
      <h4 className="lib-sub">Add words</h4>
      <div className="lib-source" role="group" aria-label="Where to take words from">
        <button className={`chip ${source === "library" ? "on" : ""}`} aria-pressed={source === "library"} onClick={() => setSource("library")}>From my library ({libraryKeys.size})</button>
        <button className={`chip ${source === "dictionary" ? "on" : ""}`} aria-pressed={source === "dictionary"} onClick={() => setSource("dictionary")}>From the dictionary</button>
      </div>
      <WordPicker words={pool} selected={sel.set} disabled={inView} disabledLabel="in this view" onToggle={sel.toggle} onSetMany={sel.setMany}
        empty={(q) => (q.length > 1 && source === "library"
          ? <p className="ui-muted">Nothing called “{q}” in your library. <button className="lib-link" onClick={() => setSource("dictionary")}>Search the dictionary</button></p>
          : q.length > 1 && source === "dictionary" && onAskWord
            ? <p className="ui-muted">Nothing called “{q}”. <button className="lib-link" onClick={() => onAskWord(q)}>Ask AI about it</button></p>
            : source === "library" ? <p className="ui-muted">Your library has no words yet. <button className="lib-link" onClick={() => setSource("dictionary")}>Pick from the dictionary</button></p> : null)} />
      {sel.set.size > 0 && (
        <div className="lib-actionbar">
          <button className="ui-row-btn lib-primary" disabled={busy} onClick={async () => { await add([...sel.set]); sel.clear(); }}>Add {sel.set.size} selected</button>
          <button className="lib-link" onClick={sel.clear}>Clear</button>
        </div>
      )}
      <details className="lib-paste">
        <summary>Add a list (one word per line, up to 200){source === "library" ? " from your library" : ""}</summary>
        <textarea rows={5} value={paste} onChange={(e) => { setPaste(e.target.value); setPasted(null); }} placeholder={"reluctant\nonce in a blue moon\ncast"} aria-label="Words to add" />
        <button className="ui-row-btn" disabled={!paste.trim()} onClick={() => setPasted(matchPasted(paste, pool))}>Check the list</button>
        {pasted && (
          <div className="lib-checked">
            <p>{pasted.matched.length} found{pasted.ambiguous.length ? `, ${pasted.ambiguous.length} with more than one meaning` : ""}{pasted.missing.length ? `, ${pasted.missing.length} not in the dictionary` : ""}.</p>
            {pasted.ambiguous.map((a) => (
              <fieldset key={a.token}><legend>“{a.token}” has several meanings</legend>
                {a.options.map((k) => <label key={k}><input type="checkbox" checked={sel.set.has(k)} onChange={() => sel.toggle(k)} /> {k} <small>{wordByKey.get(k)?.meaning}</small></label>)}
              </fieldset>
            ))}
            {pasted.missing.length > 0 && (
              <div className="lib-missing"><p className="ui-muted">Not in the dictionary:</p>
                <ul className="lib-chips">{pasted.missing.map((t) => <li key={t}><span>{t}</span>{onAskWord && <button aria-label={`Ask AI about ${t}`} onClick={() => onAskWord(t)}>Ask AI</button>}</li>)}</ul>
              </div>
            )}
            <button className="ui-row-btn" disabled={busy || (!pasted.matched.length && !sel.set.size)} onClick={async () => { await add([...new Set([...pasted.matched, ...sel.set])].slice(0, 200)); setPasted(null); setPaste(""); sel.clear(); }}>Add them</button>
          </div>
        )}
      </details>
    </>
  );
}
