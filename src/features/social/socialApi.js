// Leaderboard and match history reads. Profiles expose only a username and
// summary numbers to other players (see RLS in migration 0001).
import { isLocalMode, supabase } from "../../lib/supabase";
import { weekStart } from "../../lib/repo";

const COLS = "id, username, score, week_score, week_start, mastered_count, study_streak, best_study_streak, live_wins, live_played";

export async function fetchLeaderboard(kind) {
  if (isLocalMode) return [];
  let q = supabase.from("profiles").select(COLS).limit(50);
  if (kind === "week") q = q.eq("week_start", weekStart()).gt("week_score", 0).order("week_score", { ascending: false });
  else if (kind === "live") q = q.gt("live_played", 0).order("live_wins", { ascending: false }).order("live_played", { ascending: true });
  else q = q.order("score", { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

// You and your friends, by this week's practice points.
export async function fetchFriendsBoard(ids) {
  if (isLocalMode || !ids.length) return [];
  const { data, error } = await supabase.from("profiles").select(COLS).in("id", ids);
  if (error) throw new Error(error.message);
  const week = weekStart();
  const points = (p) => (p.week_start === week ? p.week_score : 0);
  return data.slice().sort((a, b) => points(b) - points(a) || b.score - a.score);
}

export async function fetchLiveHistory(userId, limit = 10) {
  if (isLocalMode) return [];
  const { data, error } = await supabase.from("live_results").select("room_code, title, points, correct, total, rank, players, played_at, total_ms, finished").eq("user_id", userId).order("played_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data;
}
