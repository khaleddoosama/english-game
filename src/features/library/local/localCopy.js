// Giving a player their own copy of someone's view: the view and the views
// inside it, with the words and rules, at the top level of their library.
// Both ways of sharing (a friend's offer, a link) end here, as on the server.
import { MAX_VIEWS, MSG } from "../libraryRules";
import { activeKeys, descendants, liveViews, nameTaken } from "./localViews";

// A copy of a view's tree under new ids, into `mine` (not saved here).
function copyTree(ctx, mine, src, tree, name) {
  const { canSee, now } = ctx;
  const ids = new Map(tree.map((v) => [v.id, `v${++mine.seq}-${now()}`]));
  let words = 0, rules = 0;
  for (const v of tree) {
    const top = v.id === src.id;
    const copy = { id: ids.get(v.id), parent: top ? null : ids.get(v.parent) || null, source: null, name: top ? name : v.name, path: top ? name : null, position: v.position, senses: {}, rules: {} };
    for (const k of activeKeys(v.senses)) {
      if (!canSee(k)) continue;
      copy.senses[k] = { at: now() };
      mine.entries[k] = { patch: mine.entries[k]?.patch || {}, note: mine.entries[k]?.note || null };
      words++;
    }
    for (const k of activeKeys(v.rules)) { copy.rules[k] = { at: now() }; rules++; }
    mine.views.push(copy);
  }
  // paths follow the parents, top down
  const fixPaths = (v) => { for (const c of mine.views.filter((x) => x.parent === v.id)) { c.path = `${v.path}::${c.name}`; fixPaths(c); } };
  fixPaths(mine.views.find((v) => v.id === ids.get(src.id)));
  return { root: ids.get(src.id), words, rules };
}

// src: the view in `theirs` (their db). Saves my library. Returns what the
// server returns: { view, name, views, words, rules, skipped }.
export function copyViewForPlayer(ctx, { theirs, src, fromName }) {
  const { load, save, fail, me } = ctx;
  const mine = load(me());
  const tree = [src, ...descendants(theirs, src)];
  if (liveViews(mine).length + tree.length > MAX_VIEWS) fail(MSG.shareNoRoom(tree.length));
  const base = `${src.name.slice(0, 30)} (from ${fromName.slice(0, 15)})`;
  let name = base, n = 1;
  while (nameTaken(mine, null, name)) name = `${base} ${++n}`;
  const { root, words, rules } = copyTree(ctx, mine, src, tree, name);
  save(mine);
  return { view: root, name, views: tree.length, words, rules, skipped: 0 };
}
