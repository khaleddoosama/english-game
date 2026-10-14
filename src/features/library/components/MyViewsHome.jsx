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
export default function MyViewsHome({ api, rootId = null, offers = 0, onPractice, ids, mastery = {}, words = [], grammar = [] }) {
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

  const tree = useMemo(() => buildTree(flat || []), [flat]);
  const root = rootId ? tree.find((v) => v.id === rootId) || null : null;
  const edit = (v) => <button className="lib-icon" aria-label={`Edit ${v.name}`} title="Edit in my library" onClick={() => navigate(`/library?view=${encodeURIComponent(v.id)}`)}><Pencil size={14} /></button>;
  // A view as a lesson-style card: its own progress and a Practice button.
  const card = (v, title, key) => {
    const items = itemsOf(v.id);
    const c = levelStageBreakdown({ items }, mastery);
    const pct = (n) => `${items.length ? (n / items.length) * 100 : 0}%`;
    return (
      <div key={key || v.id} className="wh-level-card">
        <div className="wh-level-icon"><GraduationCap size={20} /></div>
        <div className="wh-level-info">
          <div className="wh-level-title">{title}</div>
          <div className="wh-level-meta">{describe(items)}</div>
          <div className="wh-level-stage-bar" aria-hidden="true">
            <span className="wh-level-stage-seg mastered" style={{ width: pct(c.Mastered) }} />
            <span className="wh-level-stage-seg learned" style={{ width: pct(c.Learned) }} />
            <span className="wh-level-stage-seg familiar" style={{ width: pct(c.Familiar) }} />
          </div>
          <div className="wh-level-meta wh-level-stage-detail">{c.Mastered} mastered · {c.Learned} learned · {c.Familiar} familiar · {c.New} new</div>
        </div>
        {!v.children.length && <>{edit(v)}{add(v)}</>}
        <button className="wh-level-btn lib-go" disabled={!v.words && !v.rules && !v.children.length} onClick={() => onPractice(v.id, true, v.name)}><Play size={13} /> Practice</button>
      </div>
    );
  };
  const add = (v) => <button className="lib-plus lib-plus-sm" aria-label={`New view inside ${v.name}`} title={`New view inside ${v.name}`} onClick={() => navigate(`/library?new=1&parent=${encodeURIComponent(v.id)}`)}><Plus size={14} /></button>;
  // Like Gateway > A1.1 > Articles, at any depth: a view with views inside is a
  // heading (its name, a + to add a view inside it, a pencil), with "All of …"
  // and one block for each view inside it; a view with none is a card.
  function Group({ v, depth }) {
    if (!v.children.length) return card(v, v.name);
    return (
      <div className={`wh-level-group-block lib-depth-${Math.min(depth, 3)}`}>
        <h3 className="wh-level-group-heading">{v.name} <small>{describe(itemsOf(v.id))}</small> {edit(v)} {add(v)}</h3>
        {card(v, `All of ${v.name}`, `${v.id}-all`)}
        {v.children.map((c) => <Group key={c.id} v={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div className="lib-home">
      <div className="lib-home-head">
        <span>{root && root.children.length > 0 && <>{edit(root)}{add(root)}</>}</span>
        <span>
          <button className="ui-row-btn" onClick={() => navigate("/catalog")}>Catalog</button>
          <button className="ui-row-btn" onClick={() => navigate("/library")}>My library</button>
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
        {root
          ? (root.children.length
            ? <>{card(root, `All of ${root.name}`, `${root.id}-all`)}{root.children.map((c) => <Group key={c.id} v={c} depth={1} />)}</>
            : card(root, root.name))
          : tree.map((v) => <Group key={v.id} v={v} depth={0} />)}
      </div>
    </div>
  );
}
