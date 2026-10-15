// Sharing a view with friends: the offer is kept apart from both libraries;
// accepting copies the view, and what is inside it, into the friend's own.
import { MAX_SHARES_WAITING, MAX_SHARE_USERS, MSG } from "../libraryRules";
import { copyViewForPlayer } from "./localCopy";
import { deepSummary, findView } from "./localViews";

export function createLocalSharingApi(ctx) {
  const { me, load, loadShares, saveShares, fail, areFriends, nameOf, now } = ctx;
  // The friendship an offer was made under. Without a stamp (no friends store to ask) the check is just "are friends".
  const since = (x, y) => ctx.friendSince?.(x, y) ?? null;
  const sameFriendship = (sh) => areFriends(sh.to, sh.from) && (sh.since ?? null) === since(sh.to, sh.from);

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
        shares.push({ id: `s${shares.length + 1}-${now()}`, view, from: me(), to: u, status: "pending", at: now(), since: since(me(), u) });
        sent++;
      }
      saveShares(shares);
      return sent;
    },
    async inbox() {
      // Like the server (migration 0040): an offer from someone who is no longer a friend ends on sight, so a new
      // friendship does not bring it back (the stamp tells a new friendship from the one the offer was made under). (Local mode has no "friend removed" event to end it earlier.)
      const all = loadShares();
      const stale = all.filter((x) => x.to === me() && x.status === "pending" && !sameFriendship(x));
      if (stale.length) { for (const x of stale) x.status = "expired"; saveShares(all); }
      return all.filter((x) => x.to === me() && x.status === "pending").flatMap((x) => {
        const theirs = load(x.from), v = findView(theirs, x.view);
        if (!v) return [];
        return [{ id: x.id, name: v.name, from: nameOf(x.from), from_id: x.from, at: new Date(x.at).toISOString(), ...deepSummary(theirs, v) }];
      }).sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    async accept(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me());
      if (!sh || sh.status !== "pending") fail(MSG.shareGone);
      const theirs = load(sh.from), src = findView(theirs, sh.view);
      if (!src) fail(MSG.shareRemoved);
      if (!sameFriendship(sh)) fail(MSG.shareUnfriended);
      const res = copyViewForPlayer(ctx, { theirs, src, fromName: nameOf(sh.from) });
      sh.status = "accepted"; sh.copy = res.view;
      saveShares(shares);
      return res;
    },
    async dismiss(shareId) {
      const shares = loadShares(), sh = shares.find((x) => x.id === shareId && x.to === me() && x.status === "pending");
      if (sh) { sh.status = "dismissed"; saveShares(shares); }
    },
  };
}
