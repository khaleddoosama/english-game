// Making, renaming, moving and removing views, and what is inside them.
import { MAX_DEPTH, MAX_PER_CALL, MAX_VIEWS, MSG, cleanViewName, validViewName } from "../libraryRules";
import { activeKeys, depthOf, descendantIds, findView, heightBelow, liveViews, nameTaken, pathFor, summaryOf, deepSummary } from "./localViews";

export function createLocalViewsApi(ctx) {
  const { load, save, fail, now } = ctx;
  const edit = async (id, { name, move = false, parent = null } = {}) => {
    const db = load(), v = findView(db, id);
    if (!v) fail(MSG.noView);
    const n = cleanViewName(name) || v.name;
    const to = move ? parent : v.parent;
    if (!validViewName(n)) fail(MSG.badName);
    if (to) {
      if (!findView(db, to)) fail(MSG.noView);
      if (to === id || descendantIds(db, id).includes(to)) fail(MSG.intoItself);
      if (depthOf(db, to) + heightBelow(db, id) + 1 > MAX_DEPTH) fail(MSG.tooDeep);
    }
    if (nameTaken(db, to, n, id)) fail(MSG.nameTaken(n));
    const oldPath = v.path;
    v.name = n; v.parent = to || null; v.path = pathFor(db, to, n);
    for (const c of liveViews(db)) if (c.id !== id && c.path.startsWith(`${oldPath}::`)) c.path = v.path + c.path.slice(oldPath.length);
    save(db);
  };
  return {
    async tree() {
      const db = load();
      return liveViews(db)
        .map((v) => ({ id: v.id, parent: v.parent || null, name: v.name, path: v.path, position: v.position, source: v.source || null, ...summaryOf(v), deep_words: deepSummary(db, v).words, deep_rules: deepSummary(db, v).rules }))
        .sort((a, b) => (a.path < b.path ? -1 : 1));
    },
    async create(name, parent = null, source = null) {
      const db = load(), n = cleanViewName(name);
      if (!validViewName(n)) fail(MSG.badName);
      if (liveViews(db).length >= MAX_VIEWS) fail(MSG.tooManyViews);
      if (parent) {
        if (!findView(db, parent)) fail(MSG.noView);
        if (depthOf(db, parent) >= MAX_DEPTH) fail(MSG.tooDeep);
      }
      if (nameTaken(db, parent, n)) fail(MSG.nameTaken(n));
      const id = `v${++db.seq}-${now()}`;
      db.views.push({ id, parent: parent || null, source: source || null, name: n, path: pathFor(db, parent, n), position: liveViews(db).filter((v) => (v.parent || null) === (parent || null)).length + 1, senses: {}, rules: {} });
      save(db);
      return id;
    },
    edit,
    rename: (id, name) => edit(id, { name }),
    move: (id, parent = null) => edit(id, { move: true, parent }),
    async remove(id) {
      const db = load();
      if (!findView(db, id)) return;
      for (const x of [id, ...descendantIds(db, id)]) findView(db, x).removed = true;
      save(db);
    },
    async addRules(view, ruleIds) {
      const db = load(), v = findView(db, view);
      if (!v) fail(MSG.noView);
      if (ruleIds.length > MAX_PER_CALL) fail(MSG.tooManyRules);
      let n = 0;
      for (const r of ruleIds) if (!v.rules[r] || v.rules[r].removed) { v.rules[r] = { at: now() }; n++; }
      save(db);
      return n;
    },
    async drop(view, senseId) {
      const db = load(), v = findView(db, view);
      if (v?.senses[senseId]) { v.senses[senseId].removed = true; save(db); }
    },
    async contents(view, deep = true) {
      const db = load();
      if (!findView(db, view)) return [];
      const out = new Map();
      for (const id of [view, ...(deep ? descendantIds(db, view) : [])]) {
        const v = findView(db, id);
        for (const s of activeKeys(v.senses)) out.set(`sense:${s}`, { kind: "sense", id: s });
        for (const r of activeKeys(v.rules)) out.set(`rule:${r}`, { kind: "rule", id: r });
      }
      return [...out.values()];
    },
  };
}
