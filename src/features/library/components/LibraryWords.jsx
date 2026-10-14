import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { count } from "./format";

// My library: every word I have, whether or not it is in a view. A view is a
// way to pick some of these; taking a word out of the library takes it out of
// every view too.
export default function LibraryWords({ items, ruleByKey, wordByKey, busy, onRemove }) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState("all");           // all | loose (not in any view)
  const [sure, setSure] = useState(null);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.words
      .map((w) => ({ ...w, entry: wordByKey.get(w.key) }))
      .filter((w) => w.entry)
      .filter((w) => only === "all" || w.views === 0)
      .filter((w) => !q || w.key.toLowerCase().includes(q) || String(w.entry.meaning || "").toLowerCase().includes(q));
  }, [items.words, wordByKey, query, only]);
  const loose = items.words.filter((w) => w.views === 0).length;
  const ruleGroups = useMemo(() => {
    const by = new Map();
    for (const r of items.rules) { const label = ruleByKey.get(r.key)?.rule || r.key; by.set(label, (by.get(label) || 0) + 1); }
    return [...by];
  }, [items.rules, ruleByKey]);

  if (!items.words.length && !items.rules.length) {
    return <div className="lib-empty"><p><b>Your library has no words yet.</b> Add words from a view (search the dictionary, paste a list, or start from a course level), or open a link a friend sent you.</p></div>;
  }
  return (
    <div className="lib-words">
      <p className="lib-summary">{count(items.words.length, "word")}{items.rules.length ? ` · ${count(items.rules.length, "rule")}` : ""} in your library{loose ? ` · ${loose} not in any view` : ""}</p>
      <div className="lib-inline">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your library" aria-label="Search your library" />
        <button className={`chip ${only === "loose" ? "on" : ""}`} aria-pressed={only === "loose"} onClick={() => setOnly(only === "loose" ? "all" : "loose")}>Not in a view</button>
      </div>
      {!rows.length && <p className="ui-muted">Nothing matches.</p>}
      <ul className="lib-wordlist">
        {rows.map((w) => (
          <li key={w.id}>
            <span><b>{w.key}</b><small>{w.entry.meaning}</small></span>
            <span className="lib-wordmeta">
              <i>{w.views ? `in ${count(w.views, "view")}` : "no view"}</i>
              <button className={`lib-x ${sure === w.id ? "danger" : ""}`} disabled={busy} aria-label={sure === w.id ? `Tap again to remove ${w.key}` : `Remove ${w.key} from my library`}
                onClick={() => { if (sure !== w.id) { setSure(w.id); return; } setSure(null); onRemove(w); }}>
                {sure === w.id ? "Tap again" : <X size={13} />}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {ruleGroups.length > 0 && (
        <>
          <h4 className="lib-sub">Grammar rules</h4>
          <ul className="lib-chips">{ruleGroups.map(([label, n]) => <li key={label} className="rule"><span>{label}{n > 1 ? ` ×${n}` : ""}</span></li>)}</ul>
        </>
      )}
    </div>
  );
}
