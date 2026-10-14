import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Pencil, Play, Plus } from "lucide-react";
import { navigate } from "../../../lib/router";
import { buildTree, flattenTree } from "../libraryTree";
import { count } from "./format";
import "../../../styles/library.css";

// My views on the home screen: read only. Browse, and practise. Anything that
// changes a view (rename, move, remove, add words, share) lives in the library
// page, a tap away from the pencil on each view; the + makes a new one there.
export default function MyViewsHome({ api, offers = 0, onPractice }) {
  const [flat, setFlat] = useState(null);
  const load = useCallback(() => api.tree().then(setFlat, () => setFlat([])), [api]);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => flattenTree(buildTree(flat || [])), [flat]);

  return (
    <div className="lib-home">
      <div className="lib-home-head">
        <h3>My views</h3>
        <span>
          <button className="ui-row-btn" onClick={() => navigate("/library")}>My library</button>
          <button className="lib-plus" aria-label="New view" title="New view" onClick={() => navigate("/library?new=1")}><Plus size={16} /></button>
        </span>
      </div>
      {offers > 0 && (
        <button className="lib-offers" onClick={() => navigate("/library")}><Inbox size={15} /> {count(offers, "view")} shared with you · open</button>
      )}
      {flat === null && <div className="ui-skeleton-row" />}
      {flat && !rows.length && (
        <div className="lib-empty"><p><b>You have no views yet.</b> A view is a way to pick some of your library’s words, like “A1.1 › sports”. Tap <b>+</b> to make one.</p></div>
      )}
      <ul className="lib-tree lib-readonly" aria-label="Your views">
        {rows.map((v) => (
          <li key={v.id} style={{ "--depth": v.depth }}>
            <span className="lib-name static"><b>{v.name}</b><small>{count(v.words, "word")} · {count(v.rules, "rule")}</small></span>
            <button className="lib-icon" aria-label={`Edit ${v.name}`} title="Edit in my library" onClick={() => navigate(`/library?view=${encodeURIComponent(v.id)}`)}><Pencil size={14} /></button>
            <button className="ui-row-btn lib-go" disabled={!v.words && !v.rules && !v.children.length} onClick={() => onPractice(v.id, true, v.name)}><Play size={14} /> Practise</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
