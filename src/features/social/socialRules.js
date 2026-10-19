// Social rules: no React, no I/O. The leaderboard tabs, the friends board's order, a player's friend status, the
// badge counts, when Ranks is shown, and the texts of the Friends page and the profile's Live history.
// Docs: docs/modules/social/friends-and-ranks.md.
import { weekStart } from "../../lib/repo";
import { formatMs } from "../../lib/format";

// This week's practice points: 0 when the profile's week is another one (the browser's local week).
export const thisWeekPoints = (p, week = weekStart()) => (p.week_start === week ? p.week_score : 0);

// Practice points are counted by each player's game and sent with their
// progress; Live answers are checked by the server. Each tab says which.
export const RANK_TABS = [
  { id: "friends", label: "Friends", value: (p) => thisWeekPoints(p), unit: "pts", extra: (p) => `${p.score} all time`, note: "You and your friends, by this week's practice points." },
  { id: "week", label: "This week", value: (p) => p.week_score, unit: "pts", note: "Practice points, counted by each player's game. For fun between friends; Live wins are checked by the server." },
  { id: "all", label: "All time", value: (p) => p.score, unit: "pts", note: "Practice points, counted by each player's game. For fun between friends; Live wins are checked by the server." },
  { id: "live", label: "Live wins", value: (p) => p.live_wins, unit: "wins", extra: (p) => `${p.live_played} played`, note: "Answers checked and timed by the server. A challenge's creator made its questions, so their own result doesn't count as a win." },
];
export const FIRST_RANK_TAB = "week";

// What an empty tab says (the Friends tab has its own line with a button).
export const emptyRanksText = (tab) => (tab === "week" ? "No points yet this week — play a round to take first place." : tab === "live" ? "No live matches yet." : "Nobody has scored yet.");

// You and your friends: this week's points, then all-time score, highest first.
export const friendsBoardOrder = (rows, week = weekStart()) => rows.slice().sort((a, b) => thisWeekPoints(b, week) - thisWeekPoints(a, week) || b.score - a.score);

// Ranks for players only while the admin has them on; the admin always sees the page (with a note when they are off).
export const ranksShown = (app, isAdmin) => isAdmin || app.leaderboard;
export const ranksHiddenFromPlayers = (app, isAdmin) => isAdmin && !app.leaderboard;

// Where another player stands with me, from friends_list: "unknown" until the list is read.
export function friendStatusOf(list, id) {
  if (!list) return "unknown";
  if (list.friends.some((p) => p.id === id)) return "friend";
  if (list.outgoing.some((p) => p.id === id)) return "sent";
  if (list.incoming.some((p) => p.id === id)) return "incoming";
  return "none";
}

// The navigation badges.
export const NO_COUNTS = { requests: 0, invites: 0 };
// New counts from social_counts; the same object when nothing changed, so nothing re-renders.
export const nextCounts = (old, c) => (old.requests === c.requests && old.invites === c.invites ? old : { requests: Number(c.requests) || 0, invites: Number(c.invites) || 0 });
export const navBadges = (counts) => ({ live: counts.invites, profile: counts.requests });
// Local mode: another tab changed friends or Live data (a storage event with no key clears everything).
export const socialStorageKey = (key) => !key || key.startsWith("friends1:") || key.startsWith("live3:");

// The Friends page's message after a request: friends at once when they had already asked.
export const requestDoneText = (r) => (r.status === "accepted" ? `You and ${r.username} are friends now.` : `Request sent to ${r.username}. They'll see it next time they open the game.`);

// One of the profile's recent Live matches: a trophy for a win against others, else the place; the time or points.
export const historyPlace = (h) => (h.rank === 1 && h.players > 1 ? "🏆 " : `#${h.rank} `);
export const historyScore = (h) => `${h.total_ms ? formatMs(h.total_ms) : `${h.points} pts`}${h.finished === false ? " · unfinished" : ""}`;
