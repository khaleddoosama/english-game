import { useCallback, useEffect, useState } from "react";
import { BookCopy, Pencil, Search } from "lucide-react";
import { navigate } from "../../lib/router";
import { count } from "./components/format";
import "../../styles/library.css";

const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

// /catalog: views people published for everyone. Search, and take a copy of
// one into your own library with one tap. Your own entries can be edited and
// deleted; an admin can delete anyone's.
export default function CatalogPage({ api, isAdmin = false, onTaken }) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null);     // { id, title, description }
  const [sure, setSure] = useState(null);           // the entry whose delete asked "tap again"
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
  async function remove(e) {
    if (sure !== e.id) { setSure(e.id); return; }
    setBusy(e.id); setSure(null);
    try { await api.catalogUnpublish(e.id); setNotice({ kind: "ok", text: `Deleted “${e.title}” from the catalog. Copies people already took stay theirs.` }); load(query); }
    catch (err) { setNotice({ kind: "error", text: err.message }); }
    finally { setBusy(null); }
  }
  async function save(ev) {
    ev.preventDefault();
    setBusy(editing.id);
    try { await api.catalogEdit(editing.id, editing.title, editing.description); setEditing(null); setNotice({ kind: "ok", text: "Saved." }); load(query); }
    catch (err) { setNotice({ kind: "error", text: err.message }); }
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
          <li key={e.id} className="wh-level-card lib-entry">
            {editing?.id === e.id ? (
              <form className="lib-entry-edit" onSubmit={save}>
                <input value={editing.title} maxLength={60} onChange={(x) => setEditing({ ...editing, title: x.target.value })} aria-label="Catalog title" />
                <textarea value={editing.description} maxLength={300} rows={3} onChange={(x) => setEditing({ ...editing, description: x.target.value })} aria-label="Catalog description" />
                <div className="lib-actions">
                  <button className="ui-row-btn lib-primary" disabled={busy === e.id || !editing.title.trim()}>Save</button>
                  <button type="button" className="ui-row-btn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <div className="wh-level-info">
                  <div className="wh-level-title">{e.title}</div>
                  {e.description && <div className="wh-level-meta">{e.description}</div>}
                  <dl className="lib-entry-meta">
                    <div><dt>By</dt><dd>{e.from}{e.mine ? " (you)" : ""}</dd></div>
                    <div><dt>Published</dt><dd>{when(e.at)}</dd></div>
                    {e.updated_at && e.updated_at !== e.at && <div><dt>Edited</dt><dd>{when(e.updated_at)}</dd></div>}
                    <div><dt>Taken</dt><dd>{e.takes ? count(e.takes, "time") : "not yet"}</dd></div>
                    <div><dt>Holds</dt><dd>{count(e.words, "word")}{e.rules ? ` · ${count(e.rules, "rule")}` : ""} · {count(e.views, "view")}</dd></div>
                  </dl>
                </div>
                <div className="lib-entry-actions">
                  {!e.mine && <button className="wh-level-btn" disabled={busy === e.id} onClick={() => take(e)}>{e.taken ? "Add again" : "Add to my library"}</button>}
                  {e.mine && <button className="ui-row-btn" onClick={() => setEditing({ id: e.id, title: e.title, description: e.description })}><Pencil size={13} /> Edit</button>}
                  {e.mine && e.view && <button className="ui-row-btn" onClick={() => navigate(`/library?view=${encodeURIComponent(e.view)}`)}>Open in my library</button>}
                  {(e.mine || isAdmin) && <button className="ui-row-btn" disabled={busy === e.id} onClick={() => remove(e)}>{sure === e.id ? "Tap again to delete" : "Delete"}</button>}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="lib-actions"><button className="ui-row-btn" onClick={() => navigate("/library")}>My library</button></div>
    </section>
  );
}
