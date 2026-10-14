import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Inbox, Pencil, Play, Plus } from "lucide-react";
import { levelStageBreakdown } from "../../../engine/data";
import { scopeFromContents } from "../scope";
import { navigate } from "../../../lib/router";
import { buildTree, flattenTree } from "../libraryTree";
import { count } from "./format";
import "../../../styles/library.css";

// My views on the home screen: read only. Browse, and practise. Anything that
// changes a view (rename, move, remove, add words, share) lives in the library
// page, a tap away from the pencil on each view; the + makes a new one there.
export default function MyViewsHome({ api, offers = 0, onPractice, ids, mastery = {}, words = [], grammar = [] }) {
  const [flat, setFlat] = useState(null);
  const load = useCallback(() => api.tree().then(setFlat, () => setFlat([])), [api]);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => flattenTree(buildTree(flat || [])), [flat]);
  // What is inside each view (with the views inside it), for the progress on its card.
  const [inside, setInside] = useState({});
  useEffect(() => {
    let live = true;
    Promise.all(rows.map((v) => api.contents(v.id, true).then((c) => [v.id, scopeFromContents(c, { resolveKey: ids?.keyOfSense, resolveRule: ids?.keyOfRule })], () => [v.id, null]))).then((all) => { if (live) setInside(Object.fromEntries(all)); });
    return () => { live = false; };
  }, [api, rows, ids]);
  const itemsOf = (id) => {
    const sc = inside[id]; if (!sc) return [];
    return [...[...sc.words].map((k) => words.find((w) => w.word === k)).filter(Boolean).map((obj) => ({ kind: "word", obj })),
      ...[...sc.rules].map((k) => grammar.find((g) => g.id === k)).filter(Boolean).map((obj) => ({ kind: "grammar", obj }))];
  };
  const describe = (items) => { const w = items.filter((i) => i.kind === "word").length, g = items.length - w; return [w && count(w, "word"), g && count(g, "grammar rule")].filter(Boolean).join(" · ") || "Empty"; };

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
      <div className="wh-levels-list lib-readonly" aria-label="Your views">
        {rows.map((v) => {
          const items = itemsOf(v.id);
          const c = levelStageBreakdown({ items }, mastery);
          const pct = (n) => `${items.length ? (n / items.length) * 100 : 0}%`;
          return (
            <div key={v.id} className="wh-level-card" style={{ marginLeft: `${v.depth * 18}px` }}>
              <div className="wh-level-icon"><GraduationCap size={20} /></div>
              <div className="wh-level-info">
                <div className="wh-level-title">{v.name}</div>
                <div className="wh-level-meta">{describe(items)}</div>
                <div className="wh-level-stage-bar" aria-hidden="true">
                  <span className="wh-level-stage-seg mastered" style={{ width: pct(c.Mastered) }} />
                  <span className="wh-level-stage-seg learned" style={{ width: pct(c.Learned) }} />
                  <span className="wh-level-stage-seg familiar" style={{ width: pct(c.Familiar) }} />
                </div>
                <div className="wh-level-meta wh-level-stage-detail">{c.Mastered} mastered · {c.Learned} learned · {c.Familiar} familiar · {c.New} new</div>
              </div>
              <button className="lib-icon" aria-label={`Edit ${v.name}`} title="Edit in my library" onClick={() => navigate(`/library?view=${encodeURIComponent(v.id)}`)}><Pencil size={14} /></button>
              <button className="wh-level-btn lib-go" disabled={!v.words && !v.rules && !v.children.length} onClick={() => onPractice(v.id, true, v.name)}><Play size={13} /> Practice</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
