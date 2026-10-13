import { useMemo, useState } from "react";
import { matchPasted, searchWords } from "../libraryTree";
import { count } from "./format";

// Put words in the open view: search the dictionary and tick, or paste a list.
// A word the id map doesn't know was added after the app started: the map is
// reloaded once and it is tried again.
export default function AddWords({ words, wordByKey, ids, busy, onAdd, onAskWord, onRefreshIds, setNotice }) {
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const results = useMemo(() => searchWords(words, query, 30), [words, query]);
  const toggle = (k) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
      <input className="lib-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by word or meaning" aria-label="Search words" />
      {!results.length && query.trim().length > 1 && onAskWord && (
        <p className="ui-muted">Nothing called “{query.trim()}”. <button className="lib-link" onClick={() => onAskWord(query.trim())}>Ask AI about it</button></p>
      )}
      {results.length > 0 && (
        <>
          <ul className="lib-results">
            {results.map((w) => (
              <li key={w.word}>
                <label><input type="checkbox" checked={picked.has(w.word)} onChange={() => toggle(w.word)} /> <b>{w.word}</b><small>{w.meaning}</small></label>
              </li>
            ))}
          </ul>
          <button className="ui-row-btn" disabled={busy || !picked.size} onClick={async () => { await add([...picked]); setPicked(new Set()); }}>Add {picked.size || ""} selected</button>
        </>
      )}
      <details className="lib-paste">
        <summary>Add a list (one word per line, up to 200)</summary>
        <textarea rows={5} value={paste} onChange={(e) => { setPaste(e.target.value); setPasted(null); }} placeholder={"reluctant\nonce in a blue moon\ncast"} aria-label="Words to add" />
        <button className="ui-row-btn" disabled={!paste.trim()} onClick={() => setPasted(matchPasted(paste, words))}>Check the list</button>
        {pasted && (
          <div className="lib-checked">
            <p>{pasted.matched.length} found{pasted.ambiguous.length ? `, ${pasted.ambiguous.length} with more than one meaning` : ""}{pasted.missing.length ? `, ${pasted.missing.length} not in the dictionary` : ""}.</p>
            {pasted.ambiguous.map((a) => (
              <fieldset key={a.token}><legend>“{a.token}” has several meanings</legend>
                {a.options.map((k) => <label key={k}><input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} /> {k} <small>{wordByKey.get(k)?.meaning}</small></label>)}
              </fieldset>
            ))}
            {pasted.missing.length > 0 && (
              <div className="lib-missing"><p className="ui-muted">Not in the dictionary:</p>
                <ul className="lib-chips">{pasted.missing.map((t) => <li key={t}><span>{t}</span>{onAskWord && <button aria-label={`Ask AI about ${t}`} onClick={() => onAskWord(t)}>Ask AI</button>}</li>)}</ul>
              </div>
            )}
            <button className="ui-row-btn" disabled={busy || (!pasted.matched.length && !picked.size)} onClick={async () => { await add([...new Set([...pasted.matched, ...picked])].slice(0, 200)); setPasted(null); setPaste(""); setPicked(new Set()); }}>Add them</button>
          </div>
        )}
      </details>
    </>
  );
}
