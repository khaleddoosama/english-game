// The social rules (src/features/social/socialRules.js): the leaderboard tabs, the friends board's order, a player's
// friend status, the badge counts, when Ranks is shown, and the texts of the Friends page and the profile's Live
// history. Made-up players. Docs: docs/modules/social/friends-and-ranks.md.
import { describe, expect, it } from "vitest";
import { weekStart } from "../src/lib/repo";
import { formatMs } from "../src/lib/format";
import { formatMs as liveFormatMs } from "../src/features/live/liveRules";
import {
  FIRST_RANK_TAB, NO_COUNTS, RANK_TABS, emptyRanksText, friendStatusOf, friendsBoardOrder, historyPlace, historyScore,
  navBadges, nextCounts, ranksHiddenFromPlayers, ranksShown, requestDoneText, socialStorageKey, thisWeekPoints,
} from "../src/features/social/socialRules";

const NOW = weekStart(), OLD = "2025-01-06";
const p = (id, score, week, weekStart = NOW, extra = {}) => ({ id, username: id, score, week_score: week, week_start: weekStart, live_wins: 0, live_played: 0, ...extra });
const tab = (id) => RANK_TABS.find((t) => t.id === id);

describe("leaderboard tabs", () => {
  it("four tabs in order, This week first", () => {
    expect(RANK_TABS.map((t) => t.label)).toEqual(["Friends", "This week", "All time", "Live wins"]);
    expect(FIRST_RANK_TAB).toBe("week");
  });

  it("each tab's value, unit and extra", () => {
    const sam = p("sam_01", 600, 90, NOW, { live_wins: 3, live_played: 5 });
    expect([tab("week").value(sam), tab("week").unit, tab("week").extra]).toEqual([90, "pts", undefined]);
    expect([tab("all").value(sam), tab("all").unit]).toEqual([600, "pts"]);
    expect([tab("live").value(sam), tab("live").unit, tab("live").extra(sam)]).toEqual([3, "wins", "5 played"]);
    expect([tab("friends").value(sam), tab("friends").extra(sam)]).toEqual([90, "600 all time"]);
  });

  it("the Friends tab counts this week's points only: another week counts 0", () => {
    expect(tab("friends").value(p("zed", 50, 999, OLD))).toBe(0);
    expect(thisWeekPoints(p("zed", 50, 999, OLD))).toBe(0);
    expect(thisWeekPoints(p("zed", 50, 999, OLD), OLD)).toBe(999);
  });

  it("the notes say who counted the numbers", () => {
    expect(tab("week").note).toMatch(/counted by each player's game/);
    expect(tab("live").note).toMatch(/creator made its questions/);
    expect(tab("friends").note).toBe("You and your friends, by this week's practice points.");
  });

  it("empty tabs", () => {
    expect(emptyRanksText("week")).toBe("No points yet this week — play a round to take first place.");
    expect(emptyRanksText("live")).toBe("No live matches yet.");
    expect(emptyRanksText("all")).toBe("Nobody has scored yet.");
  });
});

describe("the friends board", () => {
  it("this week's points first, then all-time score; the rows given are not changed", () => {
    const rows = [p("zed", 50, 999, OLD), p("sam", 600, 90), p("lina", 400, 120), p("omar", 900, 120), p("noor", 10, 0)];
    const copy = JSON.stringify(rows);
    expect(friendsBoardOrder(rows).map((r) => r.id)).toEqual(["omar", "lina", "sam", "zed", "noor"]);
    expect(JSON.stringify(rows)).toBe(copy);
  });

  it("the week can be given", () => {
    expect(friendsBoardOrder([p("a", 1, 5), p("b", 1, 9, OLD)], OLD).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("friend status", () => {
  const list = { friends: [{ id: "omar" }], outgoing: [{ id: "tariq" }], incoming: [{ id: "lina" }] };
  it("friend, sent, incoming, none; unknown before the list is read", () => {
    expect(["omar", "tariq", "lina", "noor"].map((id) => friendStatusOf(list, id))).toEqual(["friend", "sent", "incoming", "none"]);
    expect(friendStatusOf(null, "omar")).toBe("unknown");
  });
  it("a friend wins over a request in the same list", () => {
    expect(friendStatusOf({ friends: [{ id: "x" }], outgoing: [{ id: "x" }], incoming: [{ id: "x" }] }, "x")).toBe("friend");
    expect(friendStatusOf({ friends: [], outgoing: [{ id: "x" }], incoming: [{ id: "x" }] }, "x")).toBe("sent");
  });
});

describe("badge counts", () => {
  it("numbers from the server; the same object when nothing changed", () => {
    const old = { requests: 2, invites: 1 };
    expect(nextCounts(old, { requests: 2, invites: 1 })).toBe(old);
    expect(nextCounts(old, { requests: "3", invites: null })).toEqual({ requests: 3, invites: 0 });
    expect(nextCounts(NO_COUNTS, { requests: undefined, invites: "x" })).toEqual({ requests: 0, invites: 0 });
  });
  it("invitations on Live, requests on Profile", () => {
    expect(navBadges({ requests: 2, invites: 5 })).toEqual({ live: 5, profile: 2 });
  });
  it("another tab's change to friends or Live data counts again (local mode)", () => {
    expect(["friends1:p:a|b", "live3:K7M2QX", null, ""].map(socialStorageKey)).toEqual([true, true, true, true]);
    expect(["wh-settings", "friends", "Live3:x"].map(socialStorageKey)).toEqual([false, false, false]);
  });
});

describe("who sees Ranks", () => {
  it("players while ranks are on; the admin always, with a note when they are off", () => {
    expect([ranksShown({ leaderboard: true }, false), ranksShown({ leaderboard: false }, false), ranksShown({ leaderboard: false }, true)]).toEqual([true, false, true]);
    expect([ranksHiddenFromPlayers({ leaderboard: false }, true), ranksHiddenFromPlayers({ leaderboard: true }, true), ranksHiddenFromPlayers({ leaderboard: false }, false)]).toEqual([true, false, false]);
  });
});

describe("texts", () => {
  it("after a friend request", () => {
    expect(requestDoneText({ status: "accepted", username: "rami_b" })).toBe("You and rami_b are friends now.");
    expect(requestDoneText({ status: "pending", username: "kai_m" })).toBe("Request sent to kai_m. They'll see it next time they open the game.");
  });

  it("a recent Live match: a trophy only for a win against others; the time, or points without one", () => {
    expect(historyPlace({ rank: 1, players: 3 })).toBe("🏆 ");
    expect(historyPlace({ rank: 1, players: 1 })).toBe("#1 ");
    expect(historyPlace({ rank: 2, players: 4 })).toBe("#2 ");
    expect(historyScore({ total_ms: 42500, finished: true })).toBe("42.5s");
    expect(historyScore({ total_ms: 65000 })).toBe("1:05");
    expect(historyScore({ total_ms: null, points: 70, finished: false })).toBe("70 pts · unfinished");
    expect(historyScore({ total_ms: 0, points: 0, finished: null })).toBe("0 pts");
  });

  it("formatMs moved to lib; Live still offers it", () => {
    expect([formatMs(0), formatMs(999), formatMs(59949), formatMs(60000), formatMs(3725000)]).toEqual(["0.0s", "1.0s", "59.9s", "1:00", "62:05"]);
    expect(liveFormatMs).toBe(formatMs);
  });
});
