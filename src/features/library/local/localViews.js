// The shape of a player's local library and the questions asked of it. Pure
// functions over one player's db: { views: [...], entries: { key: {...} }, seq }.
// A view: { id, parent, source, name, path, position, senses: {key: {at, removed?}}, rules: {…}, removed? }.
export const emptyDb = () => ({ views: [], entries: {}, seq: 0 });

export const liveViews = (db) => db.views.filter((v) => !v.removed);
export const findView = (db, id) => liveViews(db).find((v) => v.id === id);
export const childrenOf = (db, id) => liveViews(db).filter((v) => v.parent === id);
export const descendantIds = (db, id) => childrenOf(db, id).flatMap((v) => [v.id, ...descendantIds(db, v.id)]);
export const descendants = (db, view) => liveViews(db).filter((d) => d.path.startsWith(`${view.path}::`));

// Levels from the top down to this view (a top-level view is 1).
export function depthOf(db, id) {
  let d = 0;
  for (let v = findView(db, id); v; v = v.parent && findView(db, v.parent)) d++;
  return d;
}
// Levels below this view (0 for a view with nothing inside it).
export function heightBelow(db, id) {
  const kids = childrenOf(db, id);
  return kids.length ? 1 + Math.max(...kids.map((k) => heightBelow(db, k.id))) : 0;
}
export const pathFor = (db, parent, name) => (parent ? `${findView(db, parent).path}::${name}` : name);
export const nameTaken = (db, parent, name, except = null) =>
  liveViews(db).some((v) => v.id !== except && (v.parent || null) === (parent || null) && v.name.toLowerCase() === name.toLowerCase());

// The keys of the words or rules that are in, not taken out.
export const activeKeys = (items) => Object.entries(items || {}).filter(([, e]) => !e.removed).map(([key]) => key);

// What the tree and the inbox say about a view.
export const summaryOf = (v) => ({ words: activeKeys(v.senses).length, rules: activeKeys(v.rules).length });
