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

// Activity log, filtered and paged on the server. action: an exact action
// ("content.update"), a group ending in ".*" ("report.*"), "all", or empty
// for everything except the per-save summary rows.
export const AUDIT_PAGE = 50;
export async function auditPage({ page = 1, size = AUDIT_PAGE, action = "", entity = "", q = "", adminId = "", from = "", to = "", batch = "" } = {}) {
  let query = supabase.from("admin_audit")
    .select("id, at, action, target, entity, item_key, batch_id, details, changes, before, after, admin:admin_id(username)", { count: "exact" })
    .order("at", { ascending: false }).order("id", { ascending: false });
  if (batch) query = query.eq("batch_id", batch);
  if (action.endsWith(".*")) query = query.like("action", `${action.slice(0, -1)}%`);
  else if (action && action !== "all") query = query.eq("action", action);
  else if (!action && !batch) query = query.neq("action", "content.save");
  if (entity) query = query.eq("entity", entity);
  if (adminId) query = query.eq("admin_id", adminId);
  if (from) query = query.gte("at", new Date(`${from}T00:00:00`).toISOString());
  if (to) query = query.lt("at", new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString());
  const term = String(q || "").trim().replace(/[,()%*\\]/g, " ").trim();
  if (term) query = query.or(`target.ilike.*${term}*,item_key.ilike.*${term}*`);
  const start = (Math.max(1, page) - 1) * size;
  const { data, error, count } = await query.range(start, start + size - 1);
  if (error) throw new Error(error.message);
  return { rows: data.map((r) => ({ ...r, admin: r.admin?.username || "system" })), count: count ?? data.length };
}

// The same checks analytics.word_quality makes, for local mode.
export function localWordQuality(content, mastery = {}) {
  const order = new Set((content?.levels || []).map((l) => l.title));
  return (content?.words || []).map((w) => {
    const gap = String(w.gap || ""), hints = (w.hints || []).length;
    const has = { meaning: !!w.meaning, example: !!w.situation, gap: !!gap, blank: /_{3,}/.test(gap), picture: !!(w.image || w.illustration) };
    const problems = [w._autoStub && "stub (needs real content)", !has.meaning && "no meaning", !has.example && "no example sentence", !has.gap ? "no gap sentence" : !has.blank && "gap has no ___ blank", !hints && "no hints", !has.picture && "no picture", (!w.category || (order.size && !order.has(w.category))) && "category not in the level list"].filter(Boolean);
    const score = Math.round(100 * (has.meaning * 25 + has.example * 15 + (has.gap && has.blank) * 15 + Math.min(hints, 2) * 5 + has.picture * 10 + ((w.synonyms || []).length > 0) * 5 + ((w.antonyms || []).length > 0 || !!w.opposite) * 5 + ((w.collocations || []).length > 0) * 5 + ((w.wordFamily || []).length > 0) * 5) / 95);
    const st = mastery[w.word] || {};
    const issues = [
      w._autoStub && ["high", "Stub word without real content", "Fill it with AI or by hand."], !has.meaning && ["high", "No meaning", "Add a meaning."],
      has.gap && !has.blank && ["medium", "Gap sentence has no ___ blank", "Put ___ where the word goes."], !has.gap && ["medium", "No gap sentence", "Add a sentence with ___."],
      !has.example && ["low", "No example sentence", "Add an example."], !hints && ["low", "No hints", "Add one or two hints."],
    ].filter(Boolean).map(([severity, issue, fix]) => ({ severity, area: "words", item: w.word, issue, fix }));
    return { word: w.word, category: w.category || "(none)", problems, quality_score: score, has_picture: has.picture, attempts: Number(st.total) || 0, accuracy_pct: st.total ? Math.round((1000 * st.correct) / st.total) / 10 : null, open_reports: 0, issues };
  });
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
      liveChallenges: () => rpc("admin_live_challenges", { p_limit: 300 }),
      dataIssues: () => rpc("admin_data_issues"),
      analytics: (view) => rpc("admin_analytics", { p_view: view }),
      endChallenge: (code) => rpc("live_end", { p_code: code }),
      aiUsage: (days) => rpc("admin_ai_usage", { p_days: days }),
      audit: (filters) => auditPage(filters),
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
    liveChallenges: async () => [],
    // Local mode: the word checks only, from this device's content.
    async dataIssues() { return localWordQuality(L().content).flatMap((w) => w.issues); },
    async analytics(view) {
      if (view === "word_quality") return localWordQuality(L().content, L().mastery);
      if (view === "category_summary") {
        const m = new Map();
        for (const w of localWordQuality(L().content, L().mastery)) { const c = m.get(w.category) || { category: w.category, words: 0, words_with_problems: 0, avg_quality: 0, accuracy_pct: null, open_reports: 0 }; c.words++; if (w.problems.length) c.words_with_problems++; c.avg_quality += w.quality_score; m.set(w.category, c); }
        return [...m.values()].map((c) => ({ ...c, avg_quality: Math.round(c.avg_quality / c.words) }));
      }
      return [];
    },
    endChallenge: notOnline,
    aiUsage: async () => [],
    audit: async () => ({ rows: [], count: 0 }),
    setRole: notOnline, setPassword: notOnline, resetPlayer: notOnline, deletePlayer: notOnline,
  };
}
