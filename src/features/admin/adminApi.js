// Admin data access. Online it calls the admin_* database functions (each
// one refuses non-admins). In local mode it derives the same shapes from
// this browser's own data, so the panel works offline and in tests.
import { isLocalMode, supabase } from "../../lib/supabase";
import { V2 } from "../../engine/v2";
import { isWordKey } from "../../engine/data";

export const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function lastDays(n) {
  const out = [], today = new Date();
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); out.push(dayKey(d)); }
  return out;
}

// local = { content, mastery, sessionLogs, profile, reports, score, studyStreak, bestStudyStreak }
export function createAdminApi(local) {
  if (!isLocalMode) {
    return {
      online: true,
      overview: () => rpc("admin_overview"),
      activity: (days) => rpc("admin_activity", { p_days: days, p_tz: TZ }),
      players: () => rpc("admin_players", { p_tz: TZ }),
      playerDetail: (id) => rpc("admin_player_detail", { p_user: id }),
      wordStats: () => rpc("admin_word_stats"),
      liveMatches: () => rpc("admin_live_matches", { p_limit: 500 }),
      aiUsage: (days) => rpc("admin_ai_usage", { p_days: days }),
      audit: async () => {
        const { data, error } = await supabase.from("admin_audit").select("id, at, action, target, details, admin:admin_id(username)").order("at", { ascending: false }).limit(1000);
        if (error) throw new Error(error.message);
        return data.map((r) => ({ ...r, admin: r.admin?.username || "—" }));
      },
      setRole: (id, role) => rpc("admin_set_role", { p_user: id, p_role: role }),
      setPassword: (id, password) => rpc("admin_set_password", { p_user: id, p_password: password }),
      resetPlayer: (id) => rpc("admin_reset_player", { p_user: id }),
      deletePlayer: (id) => rpc("admin_delete_player", { p_user: id }),
    };
  }
  const L = () => local.current;
  const logs = () => (L().sessionLogs || []).map((s) => ({ ...s, day: dayKey(new Date(s.at)) }));
  const notOnline = async () => { throw new Error("Player management needs the online version."); };
  return {
    online: false,
    async overview() {
      const c = L().content;
      const m = L().mastery || {};
      return {
        players: 1, admins: 1, new_7d: 0, active_1d: 1, active_7d: 1, active_30d: 1,
        content: { words: c.words.length, grammar: c.grammar.length, challenges: c.challenges.length, stories: c.stories.length, combos: c.combos.length },
        open_reports: (L().reports || []).filter((r) => !r.resolvedAt).length, reports: (L().reports || []).length,
        ai_calls_today: 0, ai_calls_7d: 0, live_matches_7d: 0, live_matches: 0,
        mastered_total: Object.entries(m).filter(([k, s]) => isWordKey(k) && V2.stage(s) === "Mastered").length,
        mastery_rows: Object.keys(m).length, storage: {},
      };
    },
    async activity(days) {
      const byDay = new Map(lastDays(days).map((d) => [d, { day: d, sessions: 0, answers: 0, correct: 0, active_players: 0, new_players: 0, ai_calls: 0, live_matches: 0 }]));
      for (const s of logs()) { const row = byDay.get(s.day); if (row) { row.sessions++; row.answers += s.total || 0; row.correct += s.correct || 0; row.active_players = 1; } }
      return [...byDay.values()];
    },
    async players() {
      const recent = logs().filter((s) => Date.now() - s.at < 30 * 86400000);
      const m = L().mastery || {};
      return [{
        id: "local", username: L().profile?.username || "local", role: "admin", score: L().score || 0, week_score: 0, mastered_count: Object.entries(m).filter(([k, s]) => isWordKey(k) && V2.stage(s) === "Mastered").length,
        study_streak: L().studyStreak || 0, best_study_streak: L().bestStudyStreak || 0, live_wins: 0, live_played: 0, created_at: null,
        last_active: L().sessionLogs?.[0] ? new Date(L().sessionLogs[0].at).toISOString() : null, words_seen: Object.keys(m).length,
        sessions_30d: recent.length, answers_30d: recent.reduce((a, s) => a + (s.total || 0), 0), correct_30d: recent.reduce((a, s) => a + (s.correct || 0), 0),
        ai_today: 0, ai_total: 0, reports: (L().reports || []).length,
      }];
    },
    async playerDetail() {
      return { profile: { username: L().profile?.username || "local", role: "admin", score: L().score || 0, week_score: 0, study_streak: L().studyStreak || 0, best_study_streak: L().bestStudyStreak || 0, live_wins: 0, live_played: 0, created_at: null }, sessions: L().sessionLogs || [], core: { score: L().score }, mastery: L().mastery || {}, live: [], ai_days: [] };
    },
    async wordStats() {
      return Object.entries(L().mastery || {}).map(([item_key, s]) => ({ item_key, players: 1, attempts: Number(s?.total) || 0, correct: Number(s?.correct) || 0 }));
    },
    liveMatches: async () => [],
    aiUsage: async () => [],
    audit: async () => [],
    setRole: notOnline, setPassword: notOnline, resetPlayer: notOnline, deletePlayer: notOnline,
  };
}
