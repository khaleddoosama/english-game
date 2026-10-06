import { V2 } from "../../engine/v2";
import { imageLinkOk } from "../media/media";
import { WORDS, levelGroups } from "../../engine/data";
import { buildQuestion, canBuildWhoAmI, legacyQuestionToV2 } from "../../engine/questions";
// Live Challenge question building (rules and scoring: liveRules.js;
// server calls: liveApi.js; the screens: LiveChallenge.jsx).
export const LIVE_KINDS = [
  { id: "meaning", label: "Meaning" },
  { id: "reverse", label: "Word from meaning" },
  { id: "gap", label: "Fill the gap" },
  { id: "whoami", label: "Who am I?" },
  { id: "opposite", label: "Opposites" },
  { id: "antonym", label: "Opposite clue" },
  { id: "picture", label: "Picture" },
  { id: "collocation", label: "Word partners" },
  { id: "family", label: "Word family" },
  { id: "grammar", label: "Grammar" },
];
// What a Live match remembers about the host's earlier play, in the same
// "seen" record as practice: a sentence read in the last 20 hours, and also
// (new) each word and each question type of a word asked in Live, so a
// definition question that has no sentence is rotated too.
export const liveKey = (kind, name) => V2.sentence(`live ${kind} ${String(name).toLowerCase()}`);

// Multiple-choice questions only: typed answers would turn a spelling slip
// into a lost match. Each question carries everything it needs, because the
// other players don't have the host's words.
//
// Variety: the questions are picked one at a time, each time the one whose
// type has been used least so far, so a match is a mix of types and not
// mostly definitions. Fresh first: a question nobody on this device read
// recently beats one read long ago, which beats one read in the last 20
// hours, and a word asked in the last 20 hours (any type) waits behind words
// that weren't. `grammar` is a list of grammar rules to draw questions from.
export function liveQuestions(words, count, { pools = null, seen = {}, rng = Math.random, kinds = null, grammar = [] } = {}) {
  const allowed = new Set(kinds?.length ? kinds : LIVE_KINDS.map((k) => k.id));
  const shuffle = (list) => V2.shuffleCopy(list, rng);
  const now = Date.now(), window = V2.SEEN_FRESH_HOURS * 3600000;
  const lastSeen = (keys) => Math.max(0, ...keys.map((k) => Number(seen?.[k] || 0)));
  // 0 never read · 1 read over 20h ago · 2 read in the last 20h
  const tierOf = (keys) => { const last = lastSeen(keys); return !last ? 0 : now - last >= window ? 1 : 2; };

  // A question from the practice builders (Who am I?, Opposites): a single
  // multiple-choice question that doesn't spell out its own answer.
  const fromLegacy = (kind, w) => {
    const built = legacyQuestionToV2(buildQuestion(kind, w, pools, { difficulty: 2 }), { kind: "word", wordObj: w }, kind);
    const q = built.length === 1 ? built[0] : null;
    if (!q || q.type !== "mcq" || q.noMastery) return null;
    if ((q.answers || []).some((a) => String(a).length > 2 && V2.norm(q.prompt).includes(V2.norm(a)))) return null;
    // Practice shows its own heading above an Opposites word; Live shows only the prompt.
    return kind === "opposite" ? { ...q, prompt: `What is the opposite of “${q.prompt}”?` } : q;
  };
  // Opposite clue: an antonym from outside the game points at this word.
  const antonym = (w) => {
    const clues = V2.outsideAntonyms(w, WORDS);
    if (!clues.length) return null;
    const clue = clues[Math.floor(rng() * clues.length)];
    // The word itself stays; the others must not also be opposites of the clue.
    const others = V2.optionWords([w], WORDS, 6, rng).filter((x) => x.word !== w.word && !V2.antonymsOf(x).some((a) => V2.norm(a) === V2.norm(clue))).slice(0, 3).map((x) => x.word);
    if (others.length < 2) return null;
    const options = shuffle([w.word, ...others]);
    return { mode: "antonym", type: "mcq", prompt: `The opposite of “${clue}” is…`, options, answers: [w.word], explanation: `${w.word} ↔ ${clue}. ${w.meaning || ""}`.trim() };
  };
  const build = (w, kind) => {
    try {
      return kind === "picture" ? V2.pictureQuestion(w, WORDS, rng, false, imageLinkOk)
        : kind === "collocation" ? V2.collocationQuestion(w, WORDS, rng, false)
        : kind === "family" ? V2.familyQuestion(w, rng, false)
        : kind === "whoami" ? (canBuildWhoAmI(w) ? fromLegacy("whoami", w) : null)
        : kind === "opposite" ? (w.opposite ? fromLegacy("opposite", w) : null)
        : kind === "antonym" ? antonym(w)
        : kind === "gap" && !/_{2,}/.test(w.gap || "") && !(pools?.[w.word]?.gap || []).length ? null
        : kind === "meaning" || kind === "reverse" || kind === "gap" ? V2.makeQuestion(w, kind, WORDS, rng, 2, pools, null, seen)
        : null;
    } catch { return null; }
  };
  const usable = (q) => q && q.type === "mcq" && q.prompt && Array.isArray(q.options) && q.options.length >= 3 && q.answers?.[0];

  // Candidates: the words (a limited, freshest-first sample, so a big mixed
  // lesson doesn't build a question of every type for every word) and the
  // grammar rules.
  const sample = Math.max(count * 2, 24);
  const wordEntries = shuffle(words)
    .map((w) => ({ w, wordTier: tierOf([liveKey("word", w.word)]) }))
    .sort((a, b) => a.wordTier - b.wordTier)
    .slice(0, sample)
    .map(({ w }) => {
      const wordKey = liveKey("word", w.word);
      const options = [...allowed].filter((k) => k !== "grammar").map((kind) => {
        const q = build(w, kind);
        if (!usable(q)) return null;
        const keys = [...new Set([...V2.questionSentences(q), liveKey(kind, w.word), wordKey])];
        return { kind, q, keys, name: w.word, tier: tierOf(keys), exact: tierOf(keys.filter((k) => k !== wordKey)) };
      }).filter(Boolean);
      return { name: w.word, options };
    });
  const grammarEntries = allowed.has("grammar") ? (grammar || []).filter((g) => g?.id).map((g) => {
    const own = V2.grammarQuestions(g).map((item, i) => V2.grammarQuestion(g, item, i, rng));
    const written = V2.writtenGrammarVariants(pools, g).map((item) => ({ mode: "grammarChoose", type: "mcq", prompt: item.prompt, answers: [item.answer], options: shuffle(item.options), explanation: item.explanation }));
    const ruleKey = liveKey("rule", g.id);
    const options = [...own, ...written].filter(usable).map((q) => {
      const keys = [...new Set([...V2.questionSentences(q), ruleKey])];
      return { kind: "grammar", q: { ...q, mode: "grammar", options: q.options.slice(0, 4) }, keys, name: g.rule || g.id, tier: tierOf(keys), exact: tierOf(keys.filter((k) => k !== ruleKey)) };
    });
    return { name: g.rule || g.id, options: options.filter((o) => o.q.options.includes(o.q.answers[0])) };
  }) : [];

  // One at a time: lowest score first. A stale word costs as much as using a
  // type four more times, a recent one eight more; asking the very same
  // question again (not just the same word) costs a further two or four, so
  // with few words a repeat comes back as a different type.
  const used = {}, picks = [];
  let remaining = shuffle([...wordEntries, ...grammarEntries].filter((e) => e.options.length));
  while (picks.length < count && remaining.length) {
    let best = null;
    for (const e of remaining) for (const o of e.options) {
      const score = o.tier * 4 + o.exact * 2 + (used[o.kind] || 0) + rng() * 0.5;
      if (!best || score < best.score) best = { score, e, o };
    }
    picks.push(best.o); used[best.o.kind] = (used[best.o.kind] || 0) + 1;
    remaining = remaining.filter((e) => e !== best.e);
  }
  return picks.map((o) => ({ mode: o.q.mode, prompt: o.q.prompt, options: o.q.options, answer: o.q.answers[0], word: o.name, explanation: o.q.explanation || "", picture: o.q.picture || null, photo: o.q.photo || null, sentences: o.keys }));
}
// Word options start with a capital, as in the normal question box.
export function liveOption(opt, q) { const t = String(opt); return q.mode !== "meaning" && q.mode !== "collocation" && q.mode !== "grammar" && t.trim().split(/\s+/).length <= 4 && /^[a-z]/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

// The name a challenge gets when its creator doesn't type one.
export const liveAutoTitle = (level, groups, unit) => (level ? `${level.title}${unit ? ` · ${groups.find((g) => g.id === unit)?.title || unit}` : ""}` : "Mixed lessons");

// "Retry challenge": the settings of a finished challenge, as the values of
// the new-challenge form (the form checks them against what it offers). What
// no longer exists, like a deleted lesson, falls back to the form's default.
export function retryDefaults(view, levels) {
  const s = view.settings || {};
  const at = s.lesson ? levels.findIndex((l) => l.title === s.lesson) : -1;
  const level = at >= 0 ? levels[at] : null;
  const groups = level ? levelGroups(level).filter((g) => g.id) : [];
  const unit = level && s.unit && groups.some((g) => g.id === s.unit) ? s.unit : "";
  const kinds = (Array.isArray(s.kinds) ? s.kinds : []).filter((k) => LIVE_KINDS.some((x) => x.id === k));
  return {
    from: view.code, sourceTitle: view.title,
    lesson: level ? String(at) : "all", unit,
    count: s.requested || view.question_count, seconds: view.seconds, maxPlayers: view.max_players, startMode: view.start_mode,
    kinds: kinds.length ? kinds : null, reveal: s.reveal !== false,
    // A name the creator typed carries over; the automatic one follows the lesson.
    title: view.title && view.title !== liveAutoTitle(level, groups, unit) ? view.title : "",
  };
}
