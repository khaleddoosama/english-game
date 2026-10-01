// Numbers for the Study Dashboard, from a player's own progress: stages,
// accuracy, the last two weeks, question types, weak words, mix-ups and
// every level. No React, so it can be tested on its own.
import { CHALLENGE_MODE_META, MODE_META, confusionCount, getMasteryStage, levelItemKey, localDateKey } from "../../engine/data";

export const STAGES = ["Mastered", "Learned", "Familiar", "New"];
const DAY = 86400000;

export function itemName(item) {
  if (item.kind === "word") return item.obj.word;
  if (item.kind === "grammar") return item.obj.rule || item.obj.id;
  if (item.kind === "challenge") return item.obj.label || item.obj.title || item.obj.id;
  return item.obj.word || item.obj.id;
}
// Question types the game's own tables don't name.
const MORE_MODES = { reverse: "Word from its meaning", mcq: "Multiple choice", multi: "Pick all that fit", transform: "Transform the sentence" };
export function modeLabel(id) {
  return MODE_META[id]?.label || CHALLENGE_MODE_META?.[id]?.label || MORE_MODES[id] || String(id).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
const emptyStages = () => ({ Mastered: 0, Learned: 0, Familiar: 0, New: 0 });
const ratio = (correct, total) => (total > 0 ? correct / total : null);

// Days (local dates) from `days - 1` days ago up to today.
export function lastDays(days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(localDateKey(new Date(now - i * DAY)));
  return out;
}

export function studyStats({ levels = [], mastery = {}, sessionLogs = [], confusions = {}, levelStats = {}, now = Date.now(), days = 14 } = {}) {
  const stages = emptyStages();
  let items = 0, practised = 0, answers = 0, correct = 0;
  const seen = new Set();
  const byLevel = levels.map((level, index) => {
    const ls = emptyStages();
    let lAnswers = 0, lCorrect = 0, lPractised = 0;
    const rows = level.items.map((item) => {
      const key = levelItemKey(item);
      const m = mastery[key] || {};
      const stage = getMasteryStage(m, item);
      const total = Number(m.total) || 0, right = Number(m.correct) || 0;
      ls[stage]++; lAnswers += total; lCorrect += right; if (total) lPractised++;
      // An item listed in two levels counts once in the totals.
      if (!seen.has(key)) { seen.add(key); items++; stages[stage]++; answers += total; correct += right; if (total) practised++; }
      return { key, kind: item.kind, name: itemName(item), stage, total, correct: right, accuracy: ratio(right, total) };
    });
    const st = levelStats[level.id] || {};
    const status = ls.Mastered === rows.length && rows.length ? "done" : lPractised ? "started" : "new";
    return { index, id: level.id, title: level.title, total: rows.length, stages: ls, practised: lPractised, answers: lAnswers, accuracy: ratio(lCorrect, lAnswers), stars: st.stars || 0, bestAccuracy: st.bestAccuracy ?? null, lastPlayedAt: st.lastPlayedAt || null, status, items: rows };
  });

  // Rounds per day from the round log (it keeps the last 50 rounds).
  const dayKeys = lastDays(days, now);
  const perDay = new Map(dayKeys.map((d) => [d, { day: d, rounds: 0, answered: 0, correct: 0 }]));
  for (const s of sessionLogs || []) {
    const d = perDay.get(localDateKey(new Date(s.at)));
    if (!d) continue;
    d.rounds++; d.answered += Number(s.total) || 0; d.correct += Number(s.correct) || 0;
  }
  const activity = [...perDay.values()];

  // Accuracy by question type, over every word's per-type record.
  const modeTotals = {};
  for (const [key, m] of Object.entries(mastery)) {
    if (/^(grammar|combo|challenge|pun):/.test(key) || !m?.modes) continue;
    for (const [id, x] of Object.entries(m.modes)) {
      const t = modeTotals[id] || (modeTotals[id] = { id, label: modeLabel(id), total: 0, correct: 0 });
      t.total += Number(x?.total) || 0; t.correct += Number(x?.correct) || 0;
    }
  }
  const modes = Object.values(modeTotals).filter((m) => m.total > 0).map((m) => ({ ...m, accuracy: m.correct / m.total })).sort((a, b) => b.total - a.total);

  const allRows = byLevel.flatMap((l) => l.items.map((r) => ({ ...r, level: l.title })));
  const unique = [...new Map(allRows.map((r) => [r.key, r])).values()];
  const weak = unique.filter((r) => r.kind === "word" && r.total >= 2 && r.stage !== "Mastered" && r.accuracy < 0.75)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total).slice(0, 8);
  const close = unique.filter((r) => r.stage === "Learned" && r.total >= 4 && r.accuracy >= 0.75).length;
  const mixups = Object.entries(confusions || {}).map(([pair, v]) => ({ pair: pair.split("|"), count: confusionCount(v) }))
    .filter((x) => x.count > 0 && x.pair.length === 2).sort((a, b) => b.count - a.count).slice(0, 6);

  const week = activity.slice(-7), prevWeek = activity.slice(-14, -7);
  const sum = (list, k) => list.reduce((n, d) => n + d[k], 0);
  return {
    items, practised, stages, answers, correct, accuracy: ratio(correct, answers), close,
    activity, activeDays: activity.filter((d) => d.rounds).length,
    week: { answered: sum(week, "answered"), rounds: sum(week, "rounds"), prevAnswered: sum(prevWeek, "answered") },
    modes, weak, mixups, levels: byLevel,
  };
}

// Level filters on the dashboard (?show=).
export const LEVEL_FILTERS = [
  { id: "", label: "All" },
  { id: "started", label: "In progress" },
  { id: "new", label: "Not started" },
  { id: "done", label: "Mastered" },
];
export function filterLevels(levels, show, query = "") {
  const q = query.trim().toLowerCase();
  return levels
    .filter((l) => l.total > 0 && (!show || l.status === show))
    .map((l) => (q ? { ...l, matches: l.items.filter((r) => r.name.toLowerCase().includes(q)) } : l))
    .filter((l) => !q || l.title.toLowerCase().includes(q) || l.matches.length);
}
