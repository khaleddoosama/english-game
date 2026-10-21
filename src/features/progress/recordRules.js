// Rules for what an answer and the end of a round record in the player's progress: the day's count, streaks and
// points, the pools' variants, confusions between words, read sentences, the round log, a lesson's stats and star,
// stories. No state. Docs: docs/modules/progress/answer-recording.md.
import { V2 } from "../../engine/v2";
import { confusionCount, todayProgress, updateLevelStat } from "../../engine/data";
import { LOCK_DAYS, findWordByLabel, getWordPools, poolNeedsGeneration } from "../../engine/questions";
import { addToDailyHistory, pruneConfusions } from "../../engine/progress";

export const POINTS_PER_ANSWER = 10;
const SEEN_SENTENCES_MAX = 4000;
const COMPLETED_SESSIONS_MAX = 500;
const ROUND_LOG_MAX = 50;
export const STAR_ACCURACY = 70;

// Every sentence the learner has read (answered or reported), with when, so practice keeps it away for a while. The
// newest 4000 are kept.
export function withSeenSentences(seen, keys, now) {
  const next = { ...(seen || {}) };
  keys.forEach((key) => { next[key] = now; });
  const entries = Object.entries(next);
  return entries.length > SEEN_SENTENCES_MAX ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, SEEN_SENTENCES_MAX)) : next;
}

// The sentences of an answered question are remembered, except in a Speed Round.
export function marksSentences(q, result, session) {
  return !!(q && result && session?.kind !== "speed");
}

// An answer counts (day's count, streak, points, pools, confusions) unless it was reported, not graded, or the AI
// check failed, or the question asks not to count.
export function countsAnswer(q, result) {
  return !(!q || !result || result.reported || result.unverified || result.aiFailed || q.noTelemetry);
}

// One answer per question of a session (a question answered again after a reload is not counted twice).
export function answerKey(session) {
  return `${session?.id || "session"}:${session?.index ?? -1}`;
}

// The day's count after one more answer (a new day starts from zero).
export function dayAfterAnswer(dailyProgress, correct) {
  const prev = todayProgress(dailyProgress);
  return { ...prev, answered: prev.answered + 1, correct: prev.correct + (correct ? 1 : 0) };
}

// The answer that reaches the day's goal (only that one).
export function goalJustReached(dailyProgress, nextDay, goal) {
  return todayProgress(dailyProgress).answered < goal && nextDay.answered >= goal;
}

// The answer streak: one more for a right answer without help, else back to zero.
export function nextStreak(current, independentCorrect) {
  return independentCorrect ? current + 1 : 0;
}

// One pool item answered: its attempts and right answers; two right answers lock it for LOCK_DAYS.
function answeredItem(item, independentCorrect, now) {
  const attempts = Number(item.attempts || 0) + 1;
  const correctCount = Number(item.correctCount || 0) + (independentCorrect ? 1 : 0);
  return { ...item, attempts, correctCount, lockedUntil: correctCount >= 2 ? now + LOCK_DAYS * 86400000 : item.lockedUntil };
}

// A combo's or grammar rule's written variant answered (`key` is its progress key). Returns the new pools and whether
// any variant is still free (not locked) to show.
export function withVariantAnswer(pools, key, itemId, independentCorrect, now) {
  const existing = pools[key]?.variant?.length ? pools[key].variant : [{ id: "seed", attempts: 0, correctCount: 0, lockedUntil: null }];
  let found = false;
  const items = existing.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return answeredItem(item, independentCorrect, now);
  });
  if (!found) items.push({ id: itemId, attempts: 1, correctCount: independentCorrect ? 1 : 0, lockedUntil: null });
  const next = { ...pools, [key]: { ...pools[key], variant: items } };
  return { pools: next, stillFresh: items.some((it) => !it.lockedUntil || it.lockedUntil <= now) };
}

// A word's sentence (of one pool type) answered. Returns the new pools, and whether a new sentence should be written
// now: the pool needs more, or after a right answer nothing besides the sentence just shown is still free.
export function withWordPoolAnswer(pools, wordObj, poolType, itemId, independentCorrect, now) {
  const wordPools = getWordPools(pools, wordObj);
  const items = wordPools[poolType].map((item) => (item.id !== itemId ? item : answeredItem(item, independentCorrect, now)));
  const nextWordPools = { ...wordPools, [poolType]: items }, next = { ...pools, [wordObj.word]: nextWordPools };
  const freshOthers = items.some((it) => it.id !== itemId && (!it.lockedUntil || it.lockedUntil <= now));
  return { pools: next, generate: poolNeedsGeneration(nextWordPools, poolType) || (independentCorrect && !freshOthers) };
}

// A wrong choice question (one or more options): each wrong option that is a word is paired with the word that was
// asked (in order; the last asked word takes the rest). Returns [[asked word, chosen word's name], ...].
export function wrongWordChoices(q, result, words) {
  if (result.correct || !["mcq", "multi"].includes(q.type)) return [];
  const selected = Array.isArray(result.value) ? result.value : [result.value];
  const answerSet = new Set((q.answers || []).map(V2.norm));
  const missingTargets = (q.targets || []).map((label) => V2.findWord(words, label)).filter(Boolean);
  const wrongChoices = selected.map((value) => {
    if (q.mode === "meaning") return words.find((word) => V2.norm(word.meaning) === V2.norm(value));
    return V2.findWord(words, value);
  }).filter((word) => word && !answerSet.has(V2.norm(q.mode === "meaning" ? word.meaning : word.word)));
  const pairs = [];
  wrongChoices.forEach((choice, index) => {
    const target = missingTargets[Math.min(index, missingTargets.length - 1)];
    if (target) pairs.push([target, choice.word]);
  });
  return pairs;
}

// One more confusion between the asked word and the chosen one (null when the choice is no other word).
export function withConfusion(confusions, content, targetWord, selectedValue, now) {
  const selectedWord = findWordByLabel(content, selectedValue);
  if (!targetWord || !selectedWord || selectedWord.word === targetWord.word) return null;
  const key = `${targetWord.word}|${selectedWord.word}`;
  const prevAll = confusions || {};
  return pruneConfusions({ ...prevAll, [key]: { count: confusionCount(prevAll[key]) + 1, lastAt: now } });
}

// The rounds already recorded (the newest 500), so a round is never recorded twice.
export function withCompleted(completed, id) {
  return [...(completed || []), id].slice(-COMPLETED_SESSIONS_MAX);
}

// Every question of the round was answered.
export function isWholeRound(session) {
  return !!(session.queue.length && session.answers.length === session.queue.length);
}

// The round log shows the newest 50 rounds; the daily totals keep every day.
export function roundLogEntry(session, now) {
  return { id: session.id, kind: session.kind, title: session.title || session.kind, correct: session.answers.filter((a) => a.correct).length, total: session.queue.length, at: now };
}
export function afterRoundLog(extras, entry) {
  return { sessionLogs: [entry, ...(extras.sessionLogs || [])].slice(0, ROUND_LOG_MAX), dailyHistory: addToDailyHistory(extras.dailyHistory, entry) };
}

// A whole practice round of a lesson (found by its title): the lesson's id and the round's accuracy (0-100).
export function lessonRound(session, levels) {
  if (session.kind !== "practice" || !isWholeRound(session)) return null;
  const level = levels.find((l) => l.title === session.title);
  return level ? { levelId: level.id, accuracy: session.answers.filter((a) => a.correct).length / session.queue.length * 100 } : null;
}
export function withLessonStat(levelStats, levelId, accuracy) {
  return { ...levelStats, [levelId]: updateLevelStat(levelStats[levelId], accuracy) };
}
export function withLessonCleared(cleared, levelId) {
  return [...new Set([...cleared, levelId])];
}

// A whole story round: its best result so far (the story list shows the high score, not the last replay).
export function withSolvedStory(solved, session) {
  if (session.kind !== "story" || !session.sourceStoryId || !isWholeRound(session)) return null;
  const correct = session.answers.filter((a) => a.correct).length, total = session.queue.length;
  const existing = (solved || []).filter((e) => e && e.id);
  const prior = existing.find((e) => e.id === session.sourceStoryId);
  const record = (!prior || correct > prior.correct) ? { id: session.sourceStoryId, correct, total } : prior;
  return [...existing.filter((e) => e.id !== session.sourceStoryId), record];
}

// New words shown on their learning cards are marked introduced (the first time only).
export function withIntroduced(mastery, words, now) {
  const next = { ...mastery };
  words.forEach((w) => { next[w.word] = { ...next[w.word], introducedAt: next[w.word]?.introducedAt || now }; });
  return next;
}
