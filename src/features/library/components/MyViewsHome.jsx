import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Pencil, Plus } from "lucide-react";
import { StageCard, describeItems } from "../../home";
import { scopeFromContents } from "../scope";
import { navigate } from "../../../lib/router";
import { buildTree, flattenTree } from "../libraryTree";
import ViewFold from "./ViewFold";
import { useViewExpansion } from "./useViewExpansion";
import { count } from "./format";
import "../../../styles/library.css";

// My views on the home screen: read only. Browse, and practise. Anything that
// changes a view (rename, move, remove, add words, share) lives in the library
// page, a tap away from the pencil on each view; the + makes a new one there.
export default function MyViewsHome({ api, rootId = null, offers = 0, onPractice, ids, mastery = {}, words = [], grammar = [] }) {
  const { folded, toggle } = useViewExpansion();
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
  const describe = (items) => describeItems(items) || "Empty";

  const tree = useMemo(() => buildTree(flat || []), [flat]);
  const root = rootId ? tree.find((v) => v.id === rootId) || null : null;
  const edit = (v) => <button className="lib-icon" aria-label={`Edit ${v.name}`} title="Edit in my library" onClick={() => navigate(`/library?view=${encodeURIComponent(v.id)}`)}><Pencil size={14} /></button>;
  const add = (v) => <button className="lib-plus lib-plus-sm" aria-label={`New view inside ${v.name}`} title={`New view inside ${v.name}`} onClick={() => navigate(`/library?new=1&parent=${encodeURIComponent(v.id)}`)}><Plus size={14} /></button>;
  // A view as a lesson-style card: its own progress and a Practice button.
  const card = (v, title, key) => {
    const items = itemsOf(v.id);
    return (
      <StageCard key={key || v.id} title={title} meta={describe(items)} items={items} mastery={mastery} playClass="wh-level-btn lib-go"
        actions={!v.children.length && <>{edit(v)}{add(v)}</>}
        disabled={!(v.deep_words ?? v.words) && !(v.deep_rules ?? v.rules)} onPlay={() => onPractice(v.id, true, v.name)} />
    );
  };
  // Like Gateway > A1.1 > Articles, at any depth: a view with views inside is a
  // heading (its name, a + to add a view inside it, a pencil), with "All of …"
  // and one block for each view inside it; a view with none is a card.
  function group(v, depth) {
    if (!v.children.length) return card(v, v.name);
    return (
      <div key={v.id} className={`wh-level-group-block lib-depth-${Math.min(depth, 3)}`}>
        <h3 className="wh-level-group-heading"><ViewFold view={v} folded={folded.has(v.id)} onToggle={toggle} />{v.name} <small>{describe(itemsOf(v.id))}</small> {edit(v)} {add(v)}</h3>
        {card(v, `All of ${v.name}`, `${v.id}-all`)}
        {!folded.has(v.id) && v.children.map((c) => group(c, depth + 1))}
      </div>
    );
  }

  return (
    <div className="lib-home">
      <div className="lib-home-head">
        <span>{root && root.children.length > 0 && <><ViewFold view={root} folded={folded.has(root.id)} onToggle={toggle} /><b>{root.name}</b>{edit(root)}{add(root)}</>}</span>
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
        {rootId && flat && !root && <p className="ui-muted">That view isn’t here any more. Pick another tab.</p>}
        {rootId && !root
          ? null
          : root
          ? (root.children.length
            ? <>{card(root, `All of ${root.name}`, `${root.id}-all`)}{!folded.has(root.id) && root.children.map((c) => group(c, 1))}</>
            : card(root, root.name))
          : tree.map((v) => group(v, 0))}
      </div>
    </div>
  );
}
