// Question reports, the pure rules: what a report holds, which report is which, how many are kept, which
// (word, mode) pairs are held back, and how a renamed word is followed. No state, no I/O, no React.
// Moved unchanged out of the app shell (src/app/WordHunter.jsx); see docs/modules/question-reports.md.
import { V2 } from "../../engine/v2";

// Resolved reports are history, not work: keep every unresolved one and only the newest 150 resolved ones.
export const KEEP_RESOLVED = 150;

// Older saved reports have no id, so object identity stays the fallback.
export const sameReport = (a, b) => a === b || (!!a?.id && a.id === b?.id);

// What the player answered, as one line of text (a list becomes "a + b", a picked set "x + y").
export const answerTextOf = (learnerAnswer) => (learnerAnswer == null ? null : Array.isArray(learnerAnswer) ? learnerAnswer.join(" + ") : typeof learnerAnswer === "object" ? (learnerAnswer.text ?? (learnerAnswer.selected || []).join(" + ")) : String(learnerAnswer));

// One report. It carries everything needed to judge it later without the round: the full question (prompt, options, right answers), what the player answered and whether it was
// marked right, the reason and note, the round it came from, who sent it and when. The server also records the
// sender and time itself (reports.user_id / created_at). reporter: the signed-in profile, or null in local mode.
export function buildReport(q, session, reason, learnerAnswer, details, prior, reporter, now = Date.now(), random = Math.random) {
  const answerText = answerTextOf(learnerAnswer);
  return {
    id: `rep-${now}-${random().toString(36).slice(2, 8)}`, questionId: q.id, sessionId: session.id, prompt: q.prompt, targetWords: q.targets || [], mode: q.mode, type: q.type || null, options: q.options || null, answers: q.answers || null, poolType: q.poolType || null, poolItemId: q.poolItemId || null, reason: reason || null, details: details || null, learnerAnswer: learnerAnswer ?? null, learnerAnswerText: answerText || null, wasCorrect: prior && typeof prior.correct === "boolean" && !prior.reported ? prior.correct : null, answerSubmitted: !!prior, at: now, reportedAt: new Date(now).toISOString(),
    question: { id: q.id, mode: q.mode, type: q.type || null, prompt: q.prompt, options: q.options || null, answers: q.answers || null, targets: q.targets || [], explanation: q.explanation || null, sentences: V2.questionSentences(q), hasPicture: !!(q.picture || q.photo), poolType: q.poolType || null, poolItemId: q.poolItemId || null },
    session: { id: session.id, title: session.title || null, kind: session.kind || null, index: session.index ?? null, total: session.queue?.length ?? null },
    reporter: { id: reporter?.id || "local", username: reporter?.username || "local" },
    timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
  };
}

// The list after adding one. Unbounded growth here was pushing the saved payload toward the storage size limit
// over months of testing: keep every unresolved report plus the most recent KEEP_RESOLVED resolved ones (they come
// first in the list); older resolved history isn't actionable and doesn't need to persist.
export function withReport(reports, report) {
  const merged = [...(reports || []), report];
  const unresolved = merged.filter((r) => !r.resolvedAt);
  const resolved = merged.filter((r) => r.resolvedAt).slice(-KEEP_RESOLVED);
  return [...resolved, ...unresolved];
}

// The same list with the matching report(s) changed / left out.
export const mapReport = (reports, report, change) => (reports || []).map((item) => (sameReport(item, report) ? change(item) : item));
export const withoutReport = (reports, report) => (reports || []).filter((item) => !sameReport(item, report));

// Reported (word, mode) pairs are quarantined, so the adaptive question choosers don't pick them again, until an
// admin resolves or retires the report. Keyed `word|mode`, the word trimmed and lowercased.
export function quarantineOf(reports) {
  const set = new Set();
  for (const r of reports) {
    if (r.resolvedAt) continue;
    const words = r.targetWords?.length ? r.targetWords : [null];
    for (const w of words) if (w) set.add(`${String(w).trim().toLowerCase()}|${r.mode}`);
  }
  return set;
}

// A renamed word: its reports follow it. wmap: Map(old word -> new word).
export const followRenames = (reports, wmap) => (reports || []).map((r) => ({ ...r, targetWords: (r.targetWords || []).map((t) => wmap.get(t) || t) }));
