// The catalog over localStorage: views their owners published for everyone.
// Mirrors migration 0032: one open entry per view, 20 open per player, take
// a copy (the same copy as a link), take an entry down.
import { MAX_CATALOG, MAX_DESCRIPTION, MAX_TITLE, MSG } from "../libraryRules";
import { copyViewForPlayer } from "./localCopy";
import { deepSummary, findView } from "./localViews";

export function createLocalCatalogApi(ctx) {
  const { me, load, read, write, fail, nameOf, now, isAdmin } = ctx;
  const entries = () => read("library1:catalog", () => []);
  const takes = () => read("library1:catalogTakes", () => []);
  const live = (e) => !e.down && findView(load(e.owner), e.view);

  return {
    async catalogPublish(view, title, description = "") {
      const t = String(title || "").trim(), d = String(description || "").trim();
      if (!findView(load(), view)) fail(MSG.noView);
      if (!t || t.length > MAX_TITLE) fail(MSG.catalogTitle);
      if (d.length > MAX_DESCRIPTION) fail(MSG.catalogDescription);
      const all = entries();
      let e = all.find((x) => x.view === view && x.owner === me() && !x.down);
      if (e) { e.title = t; e.description = d; e.edited = now(); }
      else {
        if (all.filter((x) => x.owner === me() && live(x)).length >= MAX_CATALOG) fail(MSG.catalogTooMany);
        e = { id: `c${all.length + 1}-${now()}`, view, owner: me(), title: t, description: d, at: now(), edited: now(), down: false, takes: 0 };
        all.push(e);
      }
      write("library1:catalog", all);
      return { id: e.id, title: e.title, description: e.description };
    },
    async catalogEdit(id, title, description = "") {
      const t = String(title || "").trim(), d = String(description || "").trim();
      if (!t || t.length > MAX_TITLE) fail(MSG.catalogTitle);
      if (d.length > MAX_DESCRIPTION) fail(MSG.catalogDescription);
      const all = entries(), e = all.find((x) => x.id === id && !x.down && (x.owner === me() || isAdmin()));
      if (!e) fail(MSG.catalogNotYours);
      e.title = t; e.description = d; e.edited = now(); write("library1:catalog", all);
      return { id: e.id, title: e.title, description: e.description, updated_at: new Date(e.edited).toISOString() };
    },
    async catalogUnpublish(id) {
      const all = entries(), e = all.find((x) => x.id === id && !x.down);
      if (e && (e.owner === me() || isAdmin())) { e.down = true; write("library1:catalog", all); }
    },
    async catalogList(query = "", limit = 50) {
      const q = String(query || "").trim().toLowerCase(), had = takes();
      return entries().filter((e) => live(e) && (!q || [e.title, e.description, nameOf(e.owner)].some((s) => String(s).toLowerCase().includes(q))))
        .sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(limit || 50, 100)))
        .map((e) => ({ id: e.id, title: e.title, description: e.description, from: nameOf(e.owner), mine: e.owner === me(), at: new Date(e.at).toISOString(), updated_at: new Date(e.edited || e.at).toISOString(), view: e.owner === me() ? e.view : null, takes: e.takes,
          ...deepSummary(load(e.owner), findView(load(e.owner), e.view)), taken: had.some((t) => t.entry === e.id && t.user === me()) }));
    },
    async catalogTake(id) {
      const all = entries(), e = all.find((x) => x.id === id);
      const theirs = e && load(e.owner), src = e && findView(theirs, e.view);
      if (!e || e.down || !src) fail(MSG.catalogGone);
      if (e.owner === me()) fail(MSG.linkOwn);
      const done = takes(), had = done.find((t) => t.entry === id && t.user === me());
      const mine = load();
      if (had && findView(mine, had.copy)) return { view: had.copy, name: findView(mine, had.copy).name, already: true, views: 0, words: 0, rules: 0, skipped: 0 };
      const res = copyViewForPlayer(ctx, { theirs, src, fromName: nameOf(e.owner) });
      write("library1:catalogTakes", [...done.filter((t) => !(t.entry === id && t.user === me())), { entry: id, user: me(), copy: res.view }]);
      e.takes += 1; write("library1:catalog", all);
      return res;
    },
  };
}
