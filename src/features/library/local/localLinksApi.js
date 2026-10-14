// Sharing a view by link: the owner makes one, anyone signed in can look at
// it and take their own copy; it can be taken back and it runs out.
import { LINK_DAYS, MAX_LINKS, MSG } from "../libraryRules";
import { copyViewForPlayer } from "./localCopy";
import { deepSummary, findView } from "./localViews";

const DAY = 86400000;

export function createLocalLinksApi(ctx) {
  const { me, load, read, write, fail, nameOf, now } = ctx;
  const links = () => read("library1:links", () => []);
  const takes = () => read("library1:takes", () => []);
  const good = (l) => !l.revoked && l.expires > now();
  const newToken = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 12)).join("");

  return {
    async linkCreate(view) {
      if (!findView(load(), view)) fail(MSG.noView);
      const all = links();
      let l = all.filter((x) => x.view === view && x.owner === me() && good(x)).sort((a, b) => b.at - a.at)[0];
      if (!l) {
        if (all.filter((x) => x.owner === me() && good(x)).length >= MAX_LINKS) fail(MSG.linkTooMany);
        l = { token: newToken(), view, owner: me(), at: now(), expires: now() + LINK_DAYS * DAY, revoked: false, uses: 0 };
        all.push(l); write("library1:links", all);
      }
      return { token: l.token, expires_at: new Date(l.expires).toISOString(), uses: l.uses };
    },
    async linkInfo(token) {
      const l = links().find((x) => x.token === token);
      if (!l) return { valid: false, reason: "not_found" };
      if (l.revoked) return { valid: false, reason: "taken_back" };
      if (l.expires <= now()) return { valid: false, reason: "expired" };
      const theirs = load(l.owner), v = findView(theirs, l.view);
      if (!v) return { valid: false, reason: "removed" };
      return { valid: true, name: v.name, from: nameOf(l.owner), mine: l.owner === me(), ...deepSummary(theirs, v), taken: takes().some((t) => t.token === token && t.user === me()) };
    },
    async linkAccept(token) {
      const all = links(), l = all.find((x) => x.token === token);
      const theirs = l && load(l.owner), src = l && findView(theirs, l.view);
      if (!l || !good(l) || !src) fail(MSG.linkGone);
      if (l.owner === me()) fail(MSG.linkOwn);
      const done = takes(), had = done.find((t) => t.token === token && t.user === me());
      const mine = load();
      if (had && findView(mine, had.copy)) return { view: had.copy, name: findView(mine, had.copy).name, already: true, views: 0, words: 0, rules: 0, skipped: 0 };
      const res = copyViewForPlayer(ctx, { theirs, src, fromName: nameOf(l.owner) });
      write("library1:takes", [...done.filter((t) => !(t.token === token && t.user === me())), { token, user: me(), copy: res.view }]);
      l.uses += 1; write("library1:links", all);
      return res;
    },
    async linkRevoke(token) {
      const all = links(), l = all.find((x) => x.token === token && x.owner === me());
      if (l && !l.revoked) { l.revoked = true; write("library1:links", all); }
    },
  };
}
