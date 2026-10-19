// The dictionary rules: how a word is named and found, its senses, which words may not be options together, antonyms
// and opposites, stubs for words that are named but missing, renames, and merging content. No React, no network, no
// player data. Moved unchanged out of the V2 object (engine/v2.js), which still offers every one of them under the same
// name. Docs: docs/modules/content/dictionary-rules.md.

// Option picking normalises every word's meaning for every question, so the
// same few thousand strings come back constantly; the cache is capped.
const normCache = new Map();
const norm = v => {
  const s = String(v ?? '');
  let r = normCache.get(s);
  if (r === undefined) { r = s.trim().replace(/\s+/g, ' ').toLowerCase(); if (normCache.size > 20000) normCache.clear(); normCache.set(s, r); }
  return r;
};

const fields = ['words','combos','stories','grammar','challenges'];

// Fields removed from the game, dropped wherever content comes in:
// - Sentence Build (the word field and buildSentence challenges).
// - `example`: `situation` is the example sentence now. An example is only
//   kept, as the situation, when the word has no situation at all.
// - Puns.
function withoutRemovedFields(content) {
  const out = {...content};
  delete out.puns;
  // An entry that is not an object (null, a number) is left for validateContent to report.
  const dropRemoved = ({sentenceBuild, example, ...w}) => (!w.situation && example ? {...w, situation: example} : w);
  if (Array.isArray(out.words)) out.words = out.words.map(x => x && typeof x === 'object' ? dropRemoved(x) : x);
  if (Array.isArray(out.challenges)) out.challenges = out.challenges.filter(c => !['buildSentence','build-sentence'].includes(c?.type || c?.mode));
  return out;
}

const bareWord = w => String(w ?? '').replace(/\s*\([^)]*\)\s*$/, '');

// Apply word and category renames to existing content, including every
// reference to a renamed word, so a merge afterwards updates in place.
function applyRenames(content = {}, renames) {
  if (!renames || (!renames.words.length && !renames.categories.length)) return content;
  const wmap = new Map(renames.words.map(r => [norm(r.from), r.to]));
  const cmap = new Map(renames.categories.map(r => [r.from, r.to]));
  const rw = x => (typeof x === 'string' && wmap.has(norm(x)) ? wmap.get(norm(x)) : x);
  const rc = it => (it && cmap.has(it.category) ? { ...it, category: cmap.get(it.category) } : it);
  const out = { ...content };
  out.words = (content.words || []).map(w => {
    const n = rc({ ...w, word: rw(w.word) });
    if (n.opposite) n.opposite = rw(n.opposite);
    if (Array.isArray(n.excludeFromSameOptionsWith)) n.excludeFromSameOptionsWith = n.excludeFromSameOptionsWith.map(rw);
    if (n.relations?.confusableWords) n.relations = { ...n.relations, confusableWords: n.relations.confusableWords.map(rw) };
    return n;
  });
  out.combos = (content.combos || []).map(c => rc({ ...c, words: (c.words || []).map(rw) }));
  out.stories = (content.stories || []).map(st => rc({ ...st, targetWords: (st.targetWords || []).map(rw), questions: (st.questions || []).map(q => ({ ...q, ...(q.targetWord ? { targetWord: rw(q.targetWord) } : {}), ...(q.targetWords ? { targetWords: q.targetWords.map(rw) } : {}) })) }));
  out.challenges = (content.challenges || []).map(c => rc(c.linkedWords ? { ...c, linkedWords: c.linkedWords.map(rw) } : c));
  out.grammar = (content.grammar || []).map(rc);
  return out;
}

function mergeContent(old = {}, incoming = {}) {
  old = withoutRemovedFields(old); incoming = withoutRemovedFields(incoming);
  const out = {...old};
  for (const field of fields) {
    const key = field === 'words' ? 'word' : 'id';
    const list = [...(old[field] || [])];
    for (const item of incoming[field] || []) {
      const i = list.findIndex(x => norm(x[key]) === norm(item[key]));
      if (i < 0) list.push({...item}); else list[i] = {...list[i], ...item, [key]:list[i][key]};
    }
    out[field] = list;
  }
  out.words = healOpposites(linkAntonyms(out.words || []));
  out.words = healMissingWordRefs(out);
  return out;
}
// Any other field that names a word by string (excludeFromSameOptionsWith,
// combo/story target words) can go stale the same way an `opposite` can:
// the word it points to was renamed or removed after the reference was
// authored. Rather than reject the whole import, create a minimal stub
// entry for every dangling reference so it always resolves — marked
// `_autoStub` so a content review pass can find and flesh it out later.
function healMissingWordRefs(merged) {
  const words = merged.words || [];
  const byName = new Map(words.map(w => [norm(w.word), w]));
  const extra = [];
  const ensure = (name, category) => {
    if (typeof name !== 'string' || !name.trim()) return;
    const key = norm(name);
    if (byName.has(key)) return;
    const stub = { word: name.trim(), type: 'vocab', category: category || 'General', meaning: 'Imported reference — needs a real definition.', _autoStub: true };
    extra.push(stub);
    byName.set(key, stub);
  };
  for (const w of words) for (const ref of w.excludeFromSameOptionsWith || []) ensure(ref, w.category);
  for (const c of merged.combos || []) for (const ref of c.words || []) ensure(ref, c.category);
  for (const s of merged.stories || []) {
    for (const ref of s.targetWords || []) ensure(ref, s.category);
    for (const q of s.questions || []) {
      if (typeof q.targetWord === 'string') ensure(q.targetWord, s.category);
      for (const ref of q.targetWords || []) ensure(ref, s.category);
    }
  }
  return extra.length ? [...words, ...extra] : words;
}

// antonyms is the source of opposites: an antonym that is another word in
// the game becomes that word's `opposite`, both ways (Opposite Battle,
// Opposite Chain). Other antonyms stay plain text for the Opposite Clue
// question. An older stored `opposite` counts as an antonym.
const antonymsOf = w => (Array.isArray(w?.antonyms) ? w.antonyms : []).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
function linkAntonyms(words) {
  // An antonym names a word exactly ("Unrestrained (media)") or by headword ("Unrestrained"). The exact
  // entry wins; a headword alone goes to the entry named just that, not to whichever meaning came last.
  const byKey = new Map(words.map(w => [norm(w.word), w]));
  const byHeadword = new Map();
  for (const w of words) { const k = norm(bareWord(w.word)); if (!byHeadword.has(k) || norm(w.word) === k) byHeadword.set(k, w); }
  const byName = { get: a => byKey.get(norm(a)) || byHeadword.get(norm(bareWord(a))) };
  const all = words.map(w => [...new Set([...antonymsOf(w), ...(typeof w.opposite === 'string' && w.opposite.trim() && norm(w.opposite) !== 'none' ? [w.opposite.trim()] : [])])]);
  const pair = new Map();
  words.forEach((w, i) => {
    for (const a of all[i]) {
      const hit = byName.get(a);
      if (!hit || hit === w) continue;
      if (!pair.has(w.word)) pair.set(w.word, hit.word);
      if (!pair.has(hit.word)) pair.set(hit.word, w.word);
    }
  });
  return words.map((w, i) => {
    const { opposite, ...rest } = w;
    const out = all[i].length ? { ...rest, antonyms: all[i] } : rest;
    return pair.has(w.word) ? { ...out, opposite: pair.get(w.word) } : out;
  });
}
// Antonyms that aren't words in the game and don't give the word away.
function outsideAntonyms(w, words) {
  const self = norm(bareWord(w.word));
  return antonymsOf(w).filter(a => !findWord(words, a) && !findWord(words, bareWord(a)) && !norm(a).includes(self) && !self.includes(norm(a)));
}

// A word's `opposite` is just a string label pointing at another word's name.
// If that name has no entry of its own, nothing crashes for MCQ opposite
// questions (the label is shown as-is), but Opposite Chain and any mode that
// looks the word up (V2.findWord) silently comes up empty. Rather than reject
// the import, add a minimal stub entry so the reference always resolves —
// marked `_autoStub` so a content review pass can find and flesh it out later.
// A literal "None" is treated as a data-entry mistake (no real opposite),
// not a word to create, so the field is dropped instead.
function healOpposites(words) {
  const byName = new Map(words.map(w => [norm(w.word), w]));
  const extra = [];
  const healed = words.map(w => {
    if (!w.opposite || typeof w.opposite !== 'string') return w;
    if (norm(w.opposite) === 'none') { const { opposite, ...rest } = w; return rest; }
    if (byName.has(norm(w.opposite))) return w;
    if (!extra.some(e => norm(e.word) === norm(w.opposite))) {
      const stub = { word: w.opposite, type: w.type || 'vocab', category: w.category || 'General', meaning: `Opposite of "${w.word}".`, opposite: w.word, _autoStub: true };
      extra.push(stub);
      byName.set(norm(stub.word), stub);
    }
    return w;
  });
  return [...healed, ...extra];
}

function contentOnly(data) {
  return {schemaVersion:2, kind:'content', note:data.note || 'Content only. word and existing ids remain progress keys.', ...Object.fromEntries(fields.map(f=>[f, JSON.parse(JSON.stringify(data[f] || []))]))};
}
const findWord = (words, name) => words.find(w=>norm(w.word)===norm(name));
// A word with several meanings is one entry per meaning: "Cast" and
// "Cast (to throw)". They share a headword (the text without the trailing
// qualifier); the entry's own text stays its key, so progress and links keep
// working and one meaning never overrides another.
const headword = w => norm(bareWord(typeof w === 'string' ? w : w?.word));
const sensesOf = (words, w) => (words || []).filter(x => x && x !== w && headword(x) === headword(w) && norm(x.word) !== norm(w?.word));

// A synonym that is itself a word in the game would be a second right
// answer, so it counts like an exclusion.
const synonymsOf = w => (Array.isArray(w.synonyms) ? w.synonyms : Array.isArray(w.relations?.synonyms) ? w.relations.synonyms : []);
function compatible(a,b) {
  if (!a || !b) return false;
  // Two meanings of one word can't sit in the same question: the option would read the same.
  if (headword(a)===headword(b)) return false;
  const syn=(x,y)=>synonymsOf(x).some(s=>norm(bareWord(s))===norm(bareWord(y.word)));
  return !(Array.isArray(a.excludeFromSameOptionsWith)?a.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(b.word)) && !(Array.isArray(b.excludeFromSameOptionsWith)?b.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(a.word)) && !syn(a,b) && !syn(b,a);
}

export { norm, fields, withoutRemovedFields, bareWord, applyRenames, mergeContent, healMissingWordRefs, antonymsOf, linkAntonyms, outsideAntonyms, healOpposites, contentOnly, findWord, headword, sensesOf, synonymsOf, compatible };
