// Rules for starting a round: which words a lesson, a unit or a course level holds, how many new words the next
// round brings, which words need new sentences written, a lesson's stars, the Speed Round's queue, and the one extra
// question style per word in a practice round. No state. Docs: docs/modules/practice/starting-rounds.md.
import { V2 } from "../../engine/v2";
import { buildQuestion, buildSelectTwoQuestion, buildSpeedQuestion, buildTwoPeopleQuestion, getAllowedModes, legacyQuestionToV2, situationLeaks, speedQuestionV2 } from "../../engine/questions";
import { normalizeAnswerText } from "../../engine/text";

// The Speed Round needs this many mastered words.
export const MIN_MASTERED_FOR_SPEED = 5;
// At most this many words get new gap sentences written when a round starts.
export const GAP_REFRESH_MAX = 8;

// A lesson, or one group of it (a unit or a sub-category, from levelGroups): the round's title, its category, how
// the engine narrows it, and which words are in it.
export function lessonStart(level, group = null) {
  const title = group ? `${level.title} · ${group.title}` : level.title;
  const narrow = group ? { title, ...(group.id ? { [group.field === "unit" ? "unit" : "subCategory"]: group.id } : { noGroup: group.field }) } : {};
  return { title, category: level.title, narrow, inRound: (w) => w.category === level.title };
}

// A course level (A1.2 …) from every lesson: the whole level, one of its sessions ({ unit }), or its words in no
// session ({ noUnit }). No level: the words that have no course level yet.
export function courseLevelStart(level, part = null) {
  const title = !level ? "No course level" : part?.unit ? `${level.id} · ${part.title || part.unit}` : part?.noUnit ? `${level.id} · Other words` : level.id;
  const opts = !level ? { noCourseLevel: true } : { courseLevel: level.id, ...(part?.unit ? { unit: part.unit } : part?.noUnit ? { noGroup: "unit" } : {}) };
  const unitsOf = (w) => (Array.isArray(w.units) ? w.units : []);
  const inRound = (w) => (level ? V2.courseLevelOf(w) === level.id && (!part?.unit || unitsOf(w).includes(part.unit)) && (!part?.noUnit || !unitsOf(w).length) : !V2.courseLevelOf(w));
  return { title, narrow: { title, ...opts }, inRound };
}

// New-word intake follows the last round with the same title: a strong round (90%+) earns two extra new words (up to
// 10), a rough one (under 60%) holds back two (at least one). 0 in Settings still means none.
export function newWordsFor(base, sessionLogs, title) {
  const lastRound = (sessionLogs || []).find((log) => log.kind === "practice" && log.title === title && log.total > 0);
  const lastAccuracy = lastRound ? lastRound.correct / lastRound.total : null;
  return base === 0 || lastAccuracy === null ? base : lastAccuracy >= 0.9 ? Math.min(10, base + 2) : lastAccuracy < 0.6 ? Math.max(1, base - 2) : base;
}

// The message when a strong last round brought more new words this time (null otherwise).
export function moreNewWordsText(base, newWords, introduced) {
  return newWords > base && introduced > base ? `Strong last round here — ${introduced} new words this time.` : null;
}

// Known words of the round whose gap sentences have all been read recently: new ones are written now, so the next
// rounds have fresh sentences instead of shrinking (the first 8).
export function usedUpGapWords(words, inRound, mastery, pools, seen) {
  return words.filter((w) => inRound(w) && V2.known(mastery[w.word]) && /_{2,}/.test(w.gap || "") && V2.poolItems(w, "gap", pools?.[w.word]?.gap).every((it) => V2.seenRecently(seen, it.text))).slice(0, GAP_REFRESH_MAX);
}

// A lesson's stars: its best, and at least one once it is cleared.
export function lessonStars(levelStats, clearedSet, levelId) {
  return Math.max(Number(levelStats[levelId]?.stars || 0), clearedSet.has(levelId) ? 1 : 0);
}

// The Speed Round's questions from mastered words: up to `size`, never the same word twice in a row (six tries),
// stopping when none can be built.
export function speedQueue(content, masteredWords, size) {
  const queue = [];
  for (let i = 0; i < size; i++) {
    let raw = null;
    for (let tries = 0; tries < 6; tries++) { raw = buildSpeedQuestion(content, masteredWords); if (!raw || raw.answer !== queue.at(-1)?.answers[0]) break; }
    if (!raw) break;
    queue.push(speedQuestionV2(raw, i));
  }
  return queue;
}
export function speedSession(queue, seconds, now) {
  return { kind: "speed", id: `speed-${now}`, title: "Speed Round", queue, index: 0, answers: [], introductions: [], seconds, deadline: now + seconds * 1000 };
}

// One extra question style per word for Level Practice, built with the adaptive-engine builders and converted to the
// V2 question shape. `pools` and `seen` are the player's sentence pools and read sentences; `imageOk(url)` says
// whether a picture may be shown.
export function practiceExtra(content, wordObj, stage, { pools, seen, imageOk }, rng = Math.random) {
  const allowed = new Set(getAllowedModes(content, wordObj));
  const byStage = stage === "Familiar" ? ["whoami", "idiomDetective", "story", "opposite"] : ["whoami", "idiomDetective", "story", "opposite", "twopeople", "selecttwo"];
  const clues = V2.outsideAntonyms(wordObj, content.words);
  // Word Partners / Word Family come from collocations and wordFamily;
  // typed once the word is Learned.
  const typed = stage === "Learned" || stage === "Mastered";
  const partners = V2.collocationQuestion(wordObj, content.words, rng, typed) || (typed ? V2.collocationQuestion(wordObj, content.words, rng, false) : null);
  const family = V2.familyQuestion(wordObj, rng, typed) || (typed ? V2.familyQuestion(wordObj, rng, false) : null);
  const picture = V2.pictureQuestion(wordObj, content.words, rng, typed, imageOk);
  const modes = [...byStage.filter((m) => allowed.has(m) && (m !== "opposite" || wordObj.opposite)), ...(clues.length ? ["antonym"] : []), ...(partners ? ["collocation"] : []), ...(family ? ["family"] : []), ...(picture ? ["picture"] : [])];
  if (!modes.length) return null;
  const mode = modes[Math.floor(rng() * modes.length)];
  if (mode === "collocation") return partners;
  if (mode === "family") return family;
  if (mode === "picture") return picture;
  // Opposite Clue: an antonym from outside the game points at this word
  // ("The opposite of “shrink” is…" → Swell). Typed once the word is Learned.
  if (mode === "antonym") {
    const clue = clues[Math.floor(rng() * clues.length)];
    const base = { id: `${wordObj.word}:antonym`, mode: "antonym", targets: [wordObj.word], answers: [wordObj.word], prompt: `The opposite of “${clue}” is…`, explanation: `${wordObj.word} ↔ ${clue}. ${wordObj.meaning || ""}`.trim(), hints: wordObj.hints || [], difficulty: 2 };
    if (stage === "Learned" || stage === "Mastered") return { ...base, type: "typing" };
    // No other word the clue is also the opposite of.
    const options = V2.optionWords([wordObj], content.words, 6, rng).filter((x) => x.word === wordObj.word || !V2.antonymsOf(x).some((a) => V2.norm(a) === V2.norm(clue))).slice(0, 4).map((x) => x.word);
    if (!options.includes(wordObj.word)) return null;
    return options.length >= 2 ? { ...base, type: "mcq", options } : null;
  }
  try {
    // Two People / Select Two only use sentences never shown before: any
    // gap sentence of the word (authored or AI-written) not yet seen.
    let raw;
    if (mode === "twopeople" || mode === "selecttwo") {
      const fresh = (w) => V2.poolItems(w, "gap", pools?.[w.word]?.gap).map((it) => it.text).find((t) => t && /_{2,}/.test(t) && !situationLeaks(w, t) && !V2.seenRecently(seen || {}, t, Infinity)) || null;
      const pair = mode === "twopeople" ? buildTwoPeopleQuestion(content, wordObj, fresh) : buildSelectTwoQuestion(content, wordObj, fresh);
      if (!pair) return null;
      raw = { ...pair, modeId: mode, difficulty: 2 };
    } else raw = buildQuestion(content, mode, wordObj, pools, { difficulty: 2 });
    // Multi-step authored challenges don't fit a single practice slot.
    const built = legacyQuestionToV2(content, raw, { kind: "word", wordObj }, mode);
    const q = built.length === 1 ? { ...built[0], ...(raw.sentences ? { sentences: raw.sentences } : {}) } : null;
    if (!q || q.noMastery || !q.targets?.length) return null;
    // Last line of defence: never show a prompt that spells out an answer.
    if ((q.answers || []).some((a) => String(a).length > 2 && normalizeAnswerText(q.prompt).includes(normalizeAnswerText(a)))) return null;
    return { ...q, id: `${wordObj.word}:${q.mode}` };
  } catch {
    return null;
  }
}
