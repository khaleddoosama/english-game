import { V2 } from "../../engine/v2";
import { imageLinkOk } from "../media/media";
import { WORDS } from "../../engine/data";
import { shuffle } from "../../engine/questions";
// Live Challenge scoring and question building (no transport here; see
// transport.js for the realtime channel and LiveChallenge.jsx for the flow).
export const LIVE_REVEAL_MS = 4000, LIVE_GRACE_MS = 2500;
// Multiple-choice questions only: typed answers would turn a spelling slip
// into a lost match. Each question carries everything it needs, because the
// other players don't have the host's words.
// Fresh first: sentences come from the word's pools (the AI-written ones
// too), and a question whose sentence the host never read beats one read
// long ago, which beats one read in the last 20 hours. Definition questions
// (meaning / reverse) aren't tracked, so they count as fresh.
export function liveQuestions(words, count, { pools = null, seen = {}, rng = Math.random } = {}) {
  const build = (w, kind) => {
    try {
      return kind === "picture" ? V2.pictureQuestion(w, WORDS, rng, false, imageLinkOk)
        : kind === "collocation" ? V2.collocationQuestion(w, WORDS, rng, false)
        : kind === "family" ? V2.familyQuestion(w, rng, false)
        : kind === "gap" && !/_{2,}/.test(w.gap || "") && !(pools?.[w.word]?.gap || []).length ? null
        : V2.makeQuestion(w, kind, WORDS, rng, 2, pools, null, seen);
    } catch { return null; }
  };
  const now = Date.now();
  const freshness = (q) => { // 0 never read · 1 read over 20h ago · 2 read recently
    const keys = V2.questionSentences(q);
    if (!keys.length) return 0;
    const last = Math.max(...keys.map((k) => Number(seen?.[k] || 0)));
    return !last ? 0 : now - last >= V2.SEEN_FRESH_HOURS * 3600000 ? 1 : 2;
  };
  const picks = [];
  for (const w of shuffle(words)) {
    const options = ["meaning", "reverse", "gap", "picture", "collocation", "family"]
      .map((kind) => build(w, kind))
      .filter((q) => q && q.type === "mcq" && q.prompt && Array.isArray(q.options) && q.options.length >= 3 && q.answers?.[0])
      .map((q) => ({ q, tier: freshness(q), last: Math.max(0, ...V2.questionSentences(q).map((k) => Number(seen?.[k] || 0))) }));
    if (!options.length) continue;
    const best = Math.min(...options.map((o) => o.tier));
    const pool = options.filter((o) => o.tier === best);
    const pick = best === 0 ? pool[Math.floor(rng() * pool.length)] : pool.sort((a, b) => a.last - b.last)[0];
    picks.push({ w, ...pick });
  }
  // Words with a fresh question first; stale ones only fill the gaps.
  picks.sort((a, b) => a.tier - b.tier);
  return picks.slice(0, count).map(({ w, q }) => ({ mode: q.mode, prompt: q.prompt, options: q.options, answer: q.answers[0], word: w.word, explanation: q.explanation || "", picture: q.picture || null, photo: q.photo || null, sentences: V2.questionSentences(q) }));
}
// Word options start with a capital, as in the normal question box.
export function liveOption(opt, q) { const t = String(opt); return q.mode !== "meaning" && q.mode !== "collocation" && t.trim().split(/\s+/).length <= 4 && /^[a-z]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
// Kahoot-style: a right answer is worth 500, plus up to 500 more for speed.
export function livePoints(a, perMs) { return a?.correct ? 500 + Math.round(500 * Math.max(0, 1 - (a.ms || 0) / perMs)) : 0; }
export function liveBoard(room, upTo) {
  const per = (room.seconds || 20) * 1000;
  return (room.players || []).map((p) => {
    let points = 0, correct = 0;
    for (let i = 0; i <= upTo; i++) { const a = p.answers?.[i]; points += livePoints(a, per); if (a?.correct) correct++; }
    return { id: p.id, name: p.name, points, correct };
  }).sort((a, b) => b.points - a.points);
}
