// In-memory stand-in for the parts of supabase-js the repo uses, with the
// database functions from supabase/migrations reimplemented in JS. Records
// every RPC call so tests can assert what went over the wire.
export function createFakeSupabase({ userId = "u1", admin = true } = {}) {
  const tables = {
    content_items: [],
    content_meta: [{ id: 1, level_order: [], note: "", version: 0 }],
    progress: [],
    mastery: [],
    reports: [],
    profiles: [{ id: userId, username: "khaled", role: admin ? "admin" : "player" }],
  };
  const calls = [];
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // Postgres jsonb stores object keys shorter-first, then alphabetically.
  const jsonb = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(jsonb);
    const out = {};
    for (const k of Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))) out[k] = jsonb(v[k]);
    return out;
  };

  function query(table) {
    const filters = [];
    let orders = [], range = null, single = false, op = "select", payload = null;
    const q = {
      select() { return q; },
      eq(col, v) { filters.push((r) => r[col] === v); return q; },
      neq(col, v) { filters.push((r) => r[col] !== v); return q; },
      gt(col, v) { filters.push((r) => r[col] > v); return q; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return q; },
      order(col) { orders.push(col); return q; },
      range(a, b) { range = [a, b]; return q; },
      single() { single = true; return q; },
      upsert(rows) { op = "upsert"; payload = rows; return q; },
      update(patch) { op = "update"; payload = patch; return q; },
      delete() { op = "delete"; return q; },
      then(resolve, reject) {
        try {
          calls.push({ table, op, payload: clone(payload) });
          let rows = tables[table].filter((r) => filters.every((f) => f(r)));
          if (op === "upsert") {
            for (const row of [].concat(payload)) {
              const i = tables[table].findIndex((r) => r.id === row.id);
              const next = { user_id: userId, ...row };
              if (i >= 0) tables[table][i] = next; else tables[table].push(next);
            }
            return resolve({ data: null, error: null });
          }
          if (op === "update") { rows.forEach((r) => Object.assign(r, payload)); return resolve({ data: null, error: null }); }
          if (op === "delete") { tables[table] = tables[table].filter((r) => !rows.includes(r)); return resolve({ data: null, error: null }); }
          rows = [...rows].sort((a, b) => { for (const c of orders) { if (a[c] < b[c]) return -1; if (a[c] > b[c]) return 1; } return 0; });
          if (range) rows = rows.slice(range[0], range[1] + 1);
          rows = clone(rows);
          if (table === "reports") rows = rows.map((r) => ({ ...r, profiles: { username: tables.profiles.find((p) => p.id === r.user_id)?.username || "p" } }));
          resolve({ data: single ? rows[0] : rows, error: null });
        } catch (e) { reject(e); }
      },
    };
    return q;
  }

  const rpcs = {
    apply_content_changes({ p_upserts, p_removes, p_level_order, p_note }) {
      if (!admin) return { error: { message: "only the admin can change content" } };
      for (const u of p_upserts) {
        const row = tables.content_items.find((r) => r.kind === u.kind && r.key === u.key);
        const next = { kind: u.kind, key: u.key, data: jsonb(u.data), position: u.position ?? 0, deleted: false, updated_at: now() };
        if (row) Object.assign(row, next); else tables.content_items.push(next);
      }
      for (const r of p_removes) {
        const row = tables.content_items.find((x) => x.kind === r.kind && x.key === r.key && !x.deleted);
        if (row) Object.assign(row, { deleted: true, data: {}, updated_at: now() });
      }
      const meta = tables.content_meta[0];
      if (p_level_order) meta.level_order = p_level_order;
      if (p_note != null) meta.note = p_note;
      meta.version += 1;
      return { data: meta.version };
    },
    // Same rules as supabase/migrations/0016_progress_merge.sql.
    save_progress_v2({ p_sections, p_expected, p_mastery, p_mastery_removes, p_profile, p_replace }) {
      const mine = (section) => tables.progress.find((r) => r.user_id === userId && r.section === section);
      if (!p_replace && p_expected) {
        const conflict = Object.keys(p_sections || {}).filter((name) => { const row = mine(name); return row && row.rev !== (p_expected[name] ?? null); }).sort();
        if (conflict.length) return { data: { conflict, sections: Object.fromEntries(conflict.map((n) => [n, { data: clone(mine(n).data), rev: mine(n).rev }])) } };
      }
      const oldScore = Math.floor(Number(mine("core")?.data?.score) || 0);
      for (const [section, data] of Object.entries(p_sections || {})) {
        const row = mine(section);
        if (row) { row.data = jsonb(data); row.rev += 1; } else tables.progress.push({ user_id: userId, section, data: jsonb(data), rev: 1 });
      }
      for (const [item_key, stats] of Object.entries(p_mastery || {})) {
        const row = tables.mastery.find((r) => r.user_id === userId && r.item_key === item_key);
        const at = now();
        if (!row) tables.mastery.push({ user_id: userId, item_key, stats: jsonb(stats), updated_at: at });
        else { if (p_replace || (Number(stats.total) || 0) >= (Number(row.stats.total) || 0)) row.stats = jsonb(stats); row.updated_at = at; }
      }
      tables.mastery = tables.mastery.filter((r) => !(r.user_id === userId && (p_mastery_removes || []).includes(r.item_key)));
      const profile = tables.profiles.find((x) => x.id === userId);
      if (p_sections?.core && profile) {
        const score = Math.max(0, Math.floor(Number(p_sections.core.score) || 0));
        const gain = p_replace ? 0 : Math.max(0, score - oldScore);
        const week = p_profile?.week_start || null;
        Object.assign(profile, { score, study_streak: Number(p_sections.core.studyStreak) || 0, best_study_streak: Number(p_sections.core.bestStudyStreak) || 0 });
        if (week && !p_replace) { profile.week_score = profile.week_start !== week ? gain : (profile.week_score || 0) + gain; profile.week_start = week; }
      }
      if (profile && Number.isFinite(p_profile?.mastered_count)) profile.mastered_count = p_profile.mastered_count;
      return { data: { revs: Object.fromEntries(Object.keys(p_sections || {}).map((n) => [n, mine(n).rev])) } };
    },
    reset_my_progress() {
      tables.progress = tables.progress.filter((r) => r.user_id !== userId);
      tables.mastery = tables.mastery.filter((r) => r.user_id !== userId);
      const profile = tables.profiles.find((x) => x.id === userId);
      if (profile) Object.assign(profile, { score: 0, mastered_count: 0, study_streak: 0, week_score: 0 });
      return { data: null };
    },
  };

  return {
    tables,
    calls,
    from: (table) => query(table),
    async rpc(name, args) {
      calls.push({ rpc: name, args: clone(args ?? {}) });
      const out = rpcs[name](clone(args ?? {}));
      return { data: out.data ?? null, error: out.error ?? null };
    },
  };
}
