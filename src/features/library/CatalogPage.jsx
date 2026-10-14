import { useCallback, useEffect, useState } from "react";
import { BookCopy, Search } from "lucide-react";
import { navigate } from "../../lib/router";
import { count } from "./components/format";
import "../../styles/library.css";

// /catalog: views people published for everyone. Search, and take a copy of
// one into your own library with one tap.
export default function CatalogPage({ api, isAdmin = false, onTaken }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = useCallback((q) => api.catalogList(q, 50).then(setList, (e) => { setList([]); setNotice({ kind: "error", text: e.message }); }), [api]);
  useEffect(() => { const t = setTimeout(() => load(query), query ? 250 : 0); return () => clearTimeout(t); }, [query, load]);

  async function take(e) {
    setBusy(e.id); setNotice(null);
    try {
      const out = await api.catalogTake(e.id);
      setNotice({ kind: "ok", text: out.already ? `You already have “${out.name}”.` : `Added “${out.name}”: ${count(out.words, "word")}${out.rules ? `, ${count(out.rules, "rule")}` : ""}${out.skipped ? ` (${out.skipped} private ${out.skipped === 1 ? "word was" : "words were"} not shared)` : ""}.` });
      onTaken?.(out);
      load(query);
    } catch (err) { setNotice({ kind: "error", text: err.message }); }
    finally { setBusy(null); }
  }
  async function takeDown(e) {
    setBusy(e.id);
    try { await api.catalogUnpublish(e.id); load(query); } catch (err) { setNotice({ kind: "error", text: err.message }); }
    finally { setBusy(null); }
  }

  return (
    <section className="ui-page lib lib-catalog">
      <header className="ui-page-head"><h2><BookCopy size={20} /> Catalog</h2></header>
      <p className="ui-muted">Views other players published. Take one and you get your own copy in your library.</p>
      <label className="lib-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" /></label>
      {notice && <p className={`lib-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      {list === null && <div className="ui-skeleton-row" />}
      {list && !list.length && <div className="lib-empty"><p>{query ? <>Nothing matches “{query}”.</> : <><b>The catalog is empty.</b> Publish one of your views from its Share menu in your library.</>}</p></div>}
      <ul className="lib-catalog-list">
        {(list || []).map((e) => (
          <li key={e.id} className="wh-level-card">
            <div className="wh-level-info">
              <div className="wh-level-title">{e.title}</div>
              {e.description && <div className="wh-level-meta">{e.description}</div>}
              <div className="wh-level-meta">by {e.from} · {count(e.words, "word")}{e.rules ? ` · ${count(e.rules, "rule")}` : ""}{e.views > 1 ? ` · ${e.views} views` : ""}{e.takes ? ` · taken ${count(e.takes, "time")}` : ""}</div>
            </div>
            {(e.mine || isAdmin) && <button className="ui-row-btn" disabled={busy === e.id} onClick={() => takeDown(e)}>{e.mine ? "Take it down" : "Remove"}</button>}
            {!e.mine && <button className="wh-level-btn" disabled={busy === e.id} onClick={() => take(e)}>{e.taken ? "Add again" : "Add to my library"}</button>}
          </li>
        ))}
      </ul>
      <div className="lib-actions"><button className="ui-row-btn" onClick={() => navigate("/library")}>My library</button></div>
    </section>
  );
}
