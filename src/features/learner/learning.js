export const HEART_LIMIT = 5;
export const HEART_INTERVAL = 30 * 60 * 1000;
export const REVIEW_INTERVALS = { again: 60000, hard: 600000, good: 86400000, easy: 345600000 };

export function heartsAt(state, now = Date.now()) {
  if (!state || !Number.isFinite(state.count)) return { count: HEART_LIMIT, at: now };
  const at=Number.isFinite(state.at) ? Math.min(now,state.at) : now;
  const elapsed = Math.max(0, now - at);
  const added = Math.floor(elapsed / HEART_INTERVAL);
  const count = Math.min(HEART_LIMIT, Math.max(0, Math.floor(state.count)) + added);
  return { count, at: count === HEART_LIMIT ? now : at + added * HEART_INTERVAL };
}
export function spendHeart(state, now = Date.now()) {
  const current = heartsAt(state, now);
  return { ...current, count: Math.max(0, current.count - 1) };
}
export function earnHeart(state, now = Date.now()) {
  const current = heartsAt(state, now);
  return { ...current, count: Math.min(HEART_LIMIT, current.count + 1) };
}
export function scheduleReview(schedule, word, rating, now = Date.now()) {
  if (!(rating in REVIEW_INTERVALS)) return schedule;
  return { ...schedule, [word]: { rating, reviewedAt: now, dueAt: now + REVIEW_INTERVALS[rating] } };
}
export function dueWords(words, mastery, schedule = {}, now = Date.now()) {
  return words.filter(w => {
    const entry = schedule[w.word];
    return entry ? entry.dueAt <= now : !!mastery[w.word]?.total && (mastery[w.word].nextReviewAt || 0) <= now;
  });
}
export function posOf(word) { return word.partsOfSpeech || word.partOfSpeech || []; }
export function speak(text, rate = 1) {
  if (!window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
  return true;
}
