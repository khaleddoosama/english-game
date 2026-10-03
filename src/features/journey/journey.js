import { V2 } from '../../engine/v2';

export const PASS_MARK = 70;
export const unitKey = (level, unit) => JSON.stringify([level, unit]);
export const itemKey = (kind, item) => kind === 'words' ? item.word : `grammar:${item.id}`;
const label = s => String(s).replace(/-/g, ' ');

// Course metadata wins over linguistic CEFR difficulty. Missing metadata
// remains visible as Unassigned rather than inventing a course placement.
export function courseOf(item) {
  const tags = Array.isArray(item.tags) ? item.tags : String(item.tags || '').split(/\s+/);
  const tag = tags.find(t => /^English::Gateway::Level-/.test(t));
  return String(item.courseLevel || item.gatewayLevel || tag?.split('::').at(-1) || item.level || 'Unassigned');
}
export function buildJourney(content) {
  const levels = new Map();
  for (const kind of ['words', 'grammar']) for (const item of content[kind] || []) {
    const id = courseOf(item);
    if (!levels.has(id)) levels.set(id, { id, title: label(id), units: new Map() });
    const names = item.units?.length ? [...new Set(item.units)] : ['Unassigned'];
    for (const name of names) {
      const units = levels.get(id).units;
      if (!units.has(name)) units.set(name, { id: name, title: label(name), words: [], grammar: [] });
      units.get(name)[kind].push(item);
    }
  }
  return [...levels.values()].sort((a,b) => a.id === 'Unassigned' ? 1 : b.id === 'Unassigned' ? -1 : a.id.localeCompare(b.id, undefined, { numeric: true })).map(l => ({ ...l, units: [...l.units.values()] }));
}
export function coverage(unit, mastery) {
  if (!unit) return {done:0,total:0,ready:false};
  const keys = [...unit.words.map(w => w.word), ...unit.grammar.map(g => `grammar:${g.id}`)];
  const done = keys.filter(k => Number(mastery[k]?.total) > 0).length;
  return { done, total: keys.length, ready: keys.length > 0 && done === keys.length };
}
export function levelUnlocked(levels, index, progress) {
  if (index < 0) return false;
  return index === 0 || !!progress.levels?.[levels[index - 1]?.id]?.passed;
}
export function unitUnlocked(level, index, progress) {
  return index === 0 || !!progress.units?.[unitKey(level.id, level.units[index - 1].id)]?.passed;
}
export function finalReady(level, progress) {
  return level.units.length > 0 && level.units.every(u => progress.units?.[unitKey(level.id, u.id)]?.passed);
}
export function examScore(session) {
  const total = session.queue.length;
  const complete = total > 0 && session.index >= total && session.queue.every((_, i) => !!session.answers[i]);
  const correct = session.queue.filter((_, i) => {
    const a = session.answers[i];
    return a?.correct && !a.assisted && !a.reported && !a.unverified && !a.aiFailed;
  }).length;
  return { complete, total, correct, accuracy: total ? correct / total * 100 : 0, passed: complete && correct / total * 100 >= PASS_MARK };
}
export function saveJourneyAttempt(progress, session, level, mastery, now = Date.now()) {
  if (!session.journey || !examScore(session).complete) return progress;
  if ((progress.completed || []).includes(session.id)) return progress;
  const score = examScore(session), { kind, unitId } = session.journey;
  if (kind === 'training') return progress;
  const allowed = kind === 'final' ? finalReady(level, progress) : coverage(level.units.find(u => u.id === unitId), mastery).ready;
  const field = kind === 'final' ? 'levels' : 'units';
  const key = kind === 'final' ? level.id : unitKey(level.id, unitId);
  const previous = progress[field]?.[key] || {};
  const record = { ...previous, attempts: (previous.attempts || 0) + 1, bestAccuracy: Math.max(previous.bestAccuracy || 0, score.accuracy), lastAccuracy: score.accuracy, passed: !!previous.passed || (allowed && score.passed), at: now };
  return { ...progress, [field]: { ...progress[field], [key]: record }, completed: [...(progress.completed || []), session.id] };
}
function wordQuestion(word, words, exam, rng, quarantine) {
  const modes = exam ? ['gapTyping', 'typing'] : ['gap', 'reverse', 'meaning', 'typing'];
  for (const mode of modes) {
    if (quarantine?.has(`${word.word.trim().toLowerCase()}|${mode}`)) continue;
    if (mode.startsWith('gap') && !/_{2,}/.test(word.gap || '')) continue;
    if (mode === 'typing' && !word.meaning) continue;
    const q = V2.makeQuestion(word, mode, words, rng, exam ? 3 : 1);
    if (q?.prompt && !V2.norm(q.prompt).includes(V2.norm(word.word))) return q;
  }
  return null;
}
function ruleQuestion(rule, exam, rng, quarantine) {
  const list = V2.grammarQuestions(rule);
  const ordered = exam ? [...list].sort((a,b) => (b.type === 'fix') - (a.type === 'fix')) : list;
  for (const item of ordered) {
    const q = V2.grammarQuestion(rule, item, list.indexOf(item), rng);
    if (q && !quarantine?.has(`${String(rule.id).toLowerCase()}|${q.mode}`)) return { ...q, modelOnly: exam ? false : q.modelOnly };
  }
  return null;
}
export function journeySession(content, level, unit, kind, mastery, count = 12, rng = Math.random, quarantine = null) {
  const exam = kind !== 'training', groups = kind === 'final' ? level.units : [unit];
  const queue = [], introductions = [], covered = new Set();
  const add = (q, group) => { if (q && !queue.some(p => p.id === q.id)) { queue.push(q); covered.add(group.id); } };
  for (const group of groups) {
    const words = V2.shuffleCopy(group.words, rng).sort((a,b) => (mastery[a.word]?.total || 0) - (mastery[b.word]?.total || 0));
    const rules = [...group.grammar].sort((a,b) => (mastery[`grammar:${a.id}`]?.total || 0) - (mastery[`grammar:${b.id}`]?.total || 0));
    // Every final exam represents every unit. Unit exams test each rule;
    // normal training rotates untouched content first.
    const selected = kind === 'final' ? words.slice(0, 3) : exam ? words : words.slice(0, Math.max(1, count - Math.min(rules.length, 2)));
    for (const word of selected) {
      const q = wordQuestion(word, content.words, exam, rng, quarantine);
      add(q, group);
      if (!exam && q && !mastery[word.word]?.introducedAt) introductions.push(word);
    }
    for (const rule of exam ? rules : rules.slice(0, 2)) add(ruleQuestion(rule, exam, rng, quarantine), group);
  }
  if (!queue.length || (kind === 'final' && groups.some(g => !covered.has(g.id)))) throw Error('This round needs more valid questions. Review the content before starting.');
  if (kind === 'unit' && queue.length !== unit.words.length + unit.grammar.length) throw Error('Some unit content has no valid test question. It must be corrected before the unit test.');
  return { id: `journey-${Date.now()}-${rng()}`, kind: 'journey', title: kind === 'final' ? `${level.title} · Final challenge` : `${unit.title} · ${exam ? 'Unit test' : 'Training'}`, journey: { kind, levelId: level.id, unitId: unit?.id }, queue: V2.shuffleCopy(queue, rng), introductions, answers: [], index: 0, initialLength: queue.length, targetLength: queue.length };
}
