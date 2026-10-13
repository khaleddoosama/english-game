// Sharing a view with friends: the offer is kept apart from both libraries;
// accepting copies the view, and what is inside it, into the friend's own.
import { MAX_SHARES_WAITING, MAX_SHARE_USERS, MAX_VIEWS, MSG } from "../libraryRules";
import { activeKeys, descendants, findView, liveViews, nameTaken, summaryOf } from "./localViews";

export function createLocalSharingApi(ctx) {
  const { me, load, save, loadShares, saveShares, fail, canSee, areFriends, nameOf, now } = ctx;

  // A copy of a view's tree under new ids, at the top level of my library.
  function copyTree(mine, src, tree, name) {
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

  return {
    async share(view, userIds) {
      if (!findView(load(), view)) fail(MSG.noView);
      const to = [...new Set(userIds || [])];
      if (to.length > MAX_SHARE_USERS) fail(MSG.shareTooMany);
      const shares = loadShares();
      let sent = 0;
      for (const u of to) {
        if (u === me()) continue;
        if (!areFriends(me(), u)) fail(MSG.shareNotFriend);
        if (shares.filter((x) => x.to === u && x.status === "pending").length >= MAX_SHARES_WAITING) fail(MSG.shareFriendFull);
        if (shares.some((x) => x.view === view && x.from === me() && x.to === u && x.status === "pending")) continue;
        shares.push({ id: `s${shares.length + 1}-${now()}`, view, from: me(), to: u, status: "pending", at: now() });
        sent++;
      }
      saveShares(shares);
      return sent;
    },
    async inbox() {
      return loadShares().filter((x) => x.to === me() && x.status === "pending").flatMap((x) => {
        const theirs = load(x.from), v = findView(theirs, x.view);
        if (!v || !areFriends(me(), x.from)) return [];
        return [{ id: x.id, name: v.name, from: nameOf(x.from), from_id: x.from, at: new Date(x.at).toISOString(), ...summaryOf(v), views: descendants(theirs, v).length + 1 }];
      }).sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    async accept(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me());
      if (!sh || sh.status !== "pending") fail(MSG.shareGone);
      const theirs = load(sh.from), src = findView(theirs, sh.view);
      if (!src) fail(MSG.shareRemoved);
      if (!areFriends(me(), sh.from)) fail(MSG.shareUnfriended);
      const mine = load();
      const tree = [src, ...descendants(theirs, src)];
      if (liveViews(mine).length + tree.length > MAX_VIEWS) fail(MSG.shareNoRoom(tree.length));
      const base = `${src.name.slice(0, 30)} (from ${nameOf(sh.from).slice(0, 15)})`;
      let name = base, n = 1;
      while (nameTaken(mine, null, name)) name = `${base} ${++n}`;
      const { root, words, rules } = copyTree(mine, src, tree, name);
      save(mine);
      sh.status = "accepted"; sh.copy = root;
      saveShares(shares);
      return { view: root, name, views: tree.length, words, rules, skipped: 0 };
    },
    async dismiss(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me() && x.status === "pending");
      if (sh) { sh.status = "dismissed"; saveShares(shares); }
    },
  };
}
