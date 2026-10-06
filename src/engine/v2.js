import { PRODUCTION_GATE_STEP } from "./constants";
// Embedded offline engine; isolated names preserve the existing game.
export const V2 = (() => {
// Content v2 and offline session engine. No network calls or player state in content.
// Option picking normalises every word's meaning for every question, so the
// same few thousand strings come back constantly; the cache is capped.
const normCache = new Map();
const norm = v => {
  const s = String(v ?? '');
  let r = normCache.get(s);
  if (r === undefined) { r = s.trim().replace(/\s+/g, ' ').toLowerCase(); if (normCache.size > 20000) normCache.clear(); normCache.set(s, r); }
  return r;
};
const sentence = v => norm(v).replace(/\s+([,.!?;:])/g, '$1');
const shuffleCopy = (a, rng = Math.random) => { const b = [...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1)); [b[i],b[j]]=[b[j],b[i]];} return b; };
const topic = s => norm(s).replace(/\s+[ivxlcdm]+$/i, '');
const fields = ['words','combos','stories','grammar','challenges'];
// Generic "answer it right twice, get a fresh example next time" pool —
// same idea as the word content pools, reused here for combos/grammar so
// a mastered combo/rule keeps testing the concept with new situations
// instead of either repeating the same fixed example forever or just
// going quiet. `seed` supplies the original authored content for the
// synthetic "seed" entry; AI-generated variants carry their own content.
function variantItems(pools,key,seed){
  const stored=pools?.[key]?.variant;
  return (stored&&stored.length?stored:[{id:'seed',attempts:0,correctCount:0,lockedUntil:null}]).map(item=>item.id==='seed'?{...item,...seed}:item);
}
function pickPoolVariant(pools,key,seed){
  const arr=variantItems(pools,key,seed);
  const now=Date.now();
  const unlocked=arr.filter(it=>!it.lockedUntil||it.lockedUntil<=now);
  const candidates=unlocked.length?unlocked:arr;
  return candidates.reduce((a,b)=>(a.attempts<=b.attempts?a:b));
}
// Fields removed from the game, dropped wherever content comes in:
// - Sentence Build (the word field and buildSentence challenges).
// - `example`: `situation` is the example sentence now. An example is only
//   kept, as the situation, when the word has no situation at all.
// - Puns.
function withoutRemovedFields(content) {
  const out = {...content};
  delete out.puns;
  if (Array.isArray(out.words)) out.words = out.words.map(({sentenceBuild, example, ...w}) => (!w.situation && example ? {...w, situation: example} : w));
  if (Array.isArray(out.challenges)) out.challenges = out.challenges.filter(c => !['buildSentence','build-sentence'].includes(c?.type || c?.mode));
  return out;
}
// ---- Content v3 ----
// v3 files give every word a stable `id`, name categories by id (with titles
// listed once in `categories`), link words by id (`links`), and use lists
// for sentences and mistakes. The rest of the app still keys words by their
// display text, so a v3 file is converted to that shape on the way in:
// ids resolve to words, category ids to titles, and the first list item
// fills the single legacy field (situation, gap, commonMistake).
// A word whose id is already known under a different spelling is a rename:
// the existing entry is renamed before merging so no duplicate appears, and
// the caller moves its progress (see renames).
const bareWord = w => String(w ?? '').replace(/\s*\([^)]*\)\s*$/, '');
function normalizeV3(data, existing = {}) {
  const empty = { content: data, errors: [], warnings: [], renames: { words: [], categories: [] }, levelOrder: null };
  if (!data || data.schemaVersion !== 3) return empty;
  const errors = [], warnings = [];
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const strings = a => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  const cats = Array.isArray(data.categories) ? data.categories.filter(isObj) : [];
  const catTitle = new Map(), subTitle = new Map();
  for (const c of cats) {
    if (!c.id) { errors.push('categories: every category needs an id'); continue; }
    catTitle.set(norm(c.id), String(c.title || c.id).trim());
    for (const sc of Array.isArray(c.subCategories) ? c.subCategories : []) if (sc && sc.id) subTitle.set(norm(sc.id), String(sc.title || sc.id).trim());
  }
  const oldWords = existing.words || [];
  const oldById = new Map(oldWords.filter(w => w.id).map(w => [norm(w.id), w]));
  const incoming = Array.isArray(data.words) ? data.words : [];
  const idToWord = new Map();
  oldWords.forEach(w => { if (w.id) idToWord.set(norm(w.id), w.word); });
  const seenIds = new Set();
  incoming.forEach((w, i) => {
    if (!isObj(w)) return;
    if (typeof w.id !== 'string' || !w.id.trim()) { errors.push(`words[${i}].id: v3 words need a stable id`); return; }
    if (seenIds.has(norm(w.id))) errors.push(`words[${i}].id: duplicate id "${w.id}"`);
    seenIds.add(norm(w.id));
    idToWord.set(norm(w.id), w.word);
  });
  const resolve = (id, path, selfId) => {
    if (id === undefined || id === null || id === '') return null;
    if (norm(id) === norm(selfId)) { warnings.push(`${path}: a word can't link to itself — skipped`); return null; }
    const hit = idToWord.get(norm(id));
    if (!hit) warnings.push(`${path}: no word with id "${id}" — link skipped`);
    return hit || null;
  };
  const wordRenames = [];
  const words = incoming.filter(isObj).map((w, i) => {
    const p = `words[${i}]`;
    const prev = w.id ? oldById.get(norm(w.id)) : null;
    if (prev && typeof w.word === 'string' && norm(prev.word) !== norm(w.word)) {
      if (oldWords.some(o => o !== prev && norm(o.word) === norm(w.word))) errors.push(`${p}: renaming "${prev.word}" to "${w.word}" clashes with an existing word`);
      else wordRenames.push({ from: prev.word, to: w.word });
    }
    const out = { ...w };
    delete out.links;
    if (w.category !== undefined) {
      const title = catTitle.get(norm(w.category));
      if (!title && cats.length) warnings.push(`${p}.category: "${w.category}" isn't listed in categories — used as the title`);
      out.categoryId = w.category;
      out.category = title || String(w.category);
    }
    if (w.subCategory) out.subCategoryTitle = subTitle.get(norm(w.subCategory)) || String(w.subCategory);
    const situations = strings(w.situations !== undefined ? w.situations : [w.situation]);
    const gaps = strings(w.gaps !== undefined ? w.gaps : [w.gap]);
    const commonMistakes = (Array.isArray(w.commonMistakes) ? w.commonMistakes : w.commonMistake ? [w.commonMistake] : []).filter(m => isObj(m) && m.sentence && m.correction && m.why);
    out.situations = situations; out.gaps = gaps; out.commonMistakes = commonMistakes;
    if (situations[0]) out.situation = situations[0]; else delete out.situation;
    if (gaps[0]) out.gap = gaps[0]; else delete out.gap;
    if (commonMistakes[0]) out.commonMistake = commonMistakes[0]; else delete out.commonMistake;
    const links = isObj(w.links) ? w.links : {};
    // antonyms is the only source of opposites. An older links.opposite is
    // folded in; an antonym written as a word id becomes that word.
    const opposite = resolve(links.opposite, `${p}.links.opposite`, w.id);
    const antonyms = [...new Set([...strings(w.antonyms).map(a => idToWord.get(norm(a)) || a), ...(opposite ? [opposite] : [])])];
    if (antonyms.length) out.antonyms = antonyms; else delete out.antonyms;
    delete out.opposite;
    const excl = strings(links.excludeWith).map((id, j) => resolve(id, `${p}.links.excludeWith[${j}]`, w.id)).filter(Boolean);
    if (excl.length) out.excludeFromSameOptionsWith = excl; else delete out.excludeFromSameOptionsWith;
    const conf = strings(links.confusableWith).map((id, j) => resolve(id, `${p}.links.confusableWith[${j}]`, w.id)).filter(Boolean);
    out.relations = { ...(isObj(w.relations) ? w.relations : {}) };
    if (conf.length) out.relations.confusableWords = conf;
    if (!Object.keys(out.relations).length) delete out.relations;
    return out;
  });
  // Grammar rules point at a category id too.
  const grammar = (Array.isArray(data.grammar) ? data.grammar : []).map((g, i) => {
    if (!isObj(g) || g.category === undefined) return g;
    const title = catTitle.get(norm(g.category));
    if (!title && cats.length) warnings.push(`grammar[${i}].category: "${g.category}" isn't listed in categories — used as the title`);
    return { ...g, categoryId: g.category, category: title || String(g.category) };
  });
  // Same category id, new title → rename that category everywhere.
  const catRenames = [];
  const oldTitleById = new Map();
  for (const f of fields) for (const it of existing[f] || []) if (it && it.categoryId) oldTitleById.set(norm(it.categoryId), it.category);
  for (const [id, title] of catTitle) { const old = oldTitleById.get(id); if (old && old !== title) catRenames.push({ from: old, to: title }); }
  const { categories, words: _w, ...rest } = data;
  const content = { ...rest, schemaVersion: 2, kind: data.kind || 'content', words, ...(Array.isArray(data.grammar) ? { grammar } : {}) };
  return { content, errors, warnings, renames: { words: wordRenames, categories: catRenames }, levelOrder: cats.length ? cats.map(c => catTitle.get(norm(c.id))).filter(Boolean) : null };
}
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
// One entry point for importing any content/backup file: v3 is converted,
// renames are applied to the existing content, and warnings are returned
// for the Import Center to show. Merge with mergeContent(existing, data).
function prepareImport(data, existing = {}) {
  const n = normalizeV3(withoutRemovedFields(data || {}), existing);
  const levels = list => Array.isArray(list) ? list.map(x => x && typeof x === 'object' && x.level != null && normalizeLevel(x.level) !== x.level ? { ...x, level: normalizeLevel(x.level) } : x) : list;
  n.content = { ...n.content, ...(n.content?.words ? { words: levels(n.content.words) } : {}), ...(n.content?.grammar ? { grammar: levels(n.content.grammar) } : {}) };
  return { data: n.content, existing: applyRenames(withoutRemovedFields(existing), n.renames), errors: n.errors, warnings: n.warnings, renames: n.renames, levelOrder: n.levelOrder };
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
  const byName = new Map(words.map(w => [norm(bareWord(w.word)), w]));
  const all = words.map(w => [...new Set([...antonymsOf(w), ...(typeof w.opposite === 'string' && w.opposite.trim() && norm(w.opposite) !== 'none' ? [w.opposite.trim()] : [])])]);
  const pair = new Map();
  words.forEach((w, i) => {
    for (const a of all[i]) {
      const hit = byName.get(norm(bareWord(a)));
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
// Part of speech family and shape of a word, for picking look-alike options.
// Idioms and other expressions without a part of speech group by type.
const posKey = w => basePos((w.partsOfSpeech || [])[0]) || (['idiom', 'binomial', 'fyi'].includes(w.type) ? 'expression' : 'other');
const wordCount = w => Math.min(3, bareWord(w.word).trim().split(/\s+/).length);
const isPluralNoun = w => wordCount(w) === 1 && /[^s]s$/i.test(bareWord(w.word).trim());
const DEF_STOP = new Set('a an the of to or and in on for with that is are be as by it its your you someone something when which who from at this very often usually'.split(' '));
// Both run over every word in the game for each Meaning question, so the
// results are kept by text (a pure function of it; edits just add entries).
const memoByText = fn => { const cache = new Map(); return s => { const k = String(s ?? ''); if (!cache.has(k)) { if (cache.size > 5000) cache.clear(); cache.set(k, fn(k)); } return cache.get(k); }; };
const defTokens = memoByText(s => new Set(norm(s).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !DEF_STOP.has(t))));
const firstWord = memoByText(s => norm(s).split(/\s+/)[0] || '');
// "noun phrase" → noun, "phrasal verb" → verb, "adverbial phrase" → adverb.
function basePos(pos) {
  const p = norm(pos);
  return p.includes('adverb') ? 'adverb' : p.includes('adjective') ? 'adjective' : p.includes('verb') ? 'verb' : p.includes('noun') ? 'noun' : null;
}
// Word Partners: an authored sentence where the blank is the word that goes
// WITH the lesson word ("I need to ______ an appointment" → make, not do /
// take / give). The wrong options were checked to be wrong in that exact
// sentence, so nothing is built from the collocation list automatically.
// Typed once the word is Learned.
function collocationChecks(w) {
  return (Array.isArray(w.collocationChecks) ? w.collocationChecks : []).filter(c => c && typeof c.sentence === 'string' && (c.sentence.match(/_{2,}/g) || []).length === 1 && typeof c.answer === 'string' && c.answer.trim() && Array.isArray(c.wrong) && c.wrong.filter(x => typeof x === 'string' && x.trim()).length >= 2);
}
function collocationQuestion(w, words, rng = Math.random, typing = false) {
  const checks = collocationChecks(w);
  if (!checks.length) return null;
  const i = Math.floor(rng() * checks.length), c = checks[i];
  const base = { id: `${w.word}:collocation:${i}`, mode: 'collocation', targets: [w.word], answers: [c.answer.trim()], prompt: `Which word fits?\n${c.sentence.trim()}`, explanation: [c.explanation, c.sentence.replace(/_{2,}/, c.answer.trim())].filter(Boolean).join(' '), hints: [], difficulty: 2 };
  if (typing) return { ...base, type: 'typing' };
  return { ...base, type: 'mcq', options: shuffleCopy([c.answer.trim(), ...c.wrong.map(x => x.trim()).filter(Boolean).slice(0, 3)], rng) };
}
// Picture Hunter: the word's picture, pick or type the word. A picture
// uploaded in Admin (a data: URI in \`image\`) always shows, so it counts; an
// outside photo link counts when it was seen to load here (linkOk), or when a
// drawing can stand in if it's blocked.
// Options never include a word the picture could also show (pictureAvoid:
// Needles / Injection, Knee / Joint) or another word from the same group.
function pictureQuestion(w, words, rng = Math.random, typing = false, linkOk = () => false) {
  const uploaded = typeof w.image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(w.image);
  const link = typeof w.image === 'string' && /^https?:\/\//i.test(w.image) && linkOk(w.image);
  if (!isIllustration(w.illustration) && !uploaded && !link) return null;
  const avoid = new Set((Array.isArray(w.pictureAvoid) ? w.pictureAvoid : []).map(norm));
  const base = { id: `${w.word}:picture`, mode: 'picture', targets: [w.word], answers: [w.word], prompt: typing ? 'Type the word for this picture.' : 'Which word matches the picture?', picture: isIllustration(w.illustration) ? w.illustration : null, photo: typeof w.image === 'string' ? w.image : null, sentences: [`picture: ${w.word}`], explanation: w.meaning || '', hints: w.hints || [], difficulty: 2 };
  if (typing) return { ...base, type: 'typing' };
  const pool = words.filter(x => x.word === w.word || (!avoid.has(norm(x.word)) && !(w.subCategory && x.subCategory === w.subCategory)));
  const options = optionWords([w], pool, 4, rng).map(x => x.word);
  return options.length >= 3 ? { ...base, type: 'mcq', options } : null;
}
// An inline SVG drawing stored on a word (never a script).
function isIllustration(x) { return typeof x === 'string' && /^\s*<svg[\s>]/i.test(x) && !/<script|on\w+\s*=|javascript:/i.test(x) && x.length <= 12000; }
// Word Family: the word and its family members (Surgery, surgeon,
// surgical); ask for the part of speech only one of them has, so every
// option — they all share the stem — has to be read. Typed version: write
// that family member.
function familyQuestion(w, rng = Math.random, typing = false) {
  const own = basePos((w.partsOfSpeech || [])[0]);
  const seen = new Set();
  const opts = [...(own ? [{ word: w.word, pos: own, self: true }] : []), ...(Array.isArray(w.wordFamily) ? w.wordFamily : []).filter(f => f && typeof f.word === 'string' && f.word.trim()).map(f => ({ word: f.word.trim(), pos: basePos(f.pos) }))]
    .filter(o => o.pos && !seen.has(norm(o.word)) && seen.add(norm(o.word)));
  // A member that is just part of the word (benign / Benign tumor, dozen /
  // Dozens of times) is too easy to spot, so it's left out.
  const letters = x => norm(x).replace(/[^a-z]/g, '');
  const self = letters(w.word);
  const family = opts.filter(o => o.self || !(self.includes(letters(o.word)) || letters(o.word).includes(self)));
  if (family.length < (typing ? 2 : 3)) return null;
  const count = {}; family.forEach(o => { count[o.pos] = (count[o.pos] || 0) + 1; });
  // The answer is always a family member: the word itself is in the prompt.
  const unique = shuffleCopy(family.filter(o => count[o.pos] === 1 && !o.self), rng);
  const pick = unique[0];
  if (!pick) return null;
  const base = { id: `${w.word}:family`, mode: 'family', targets: [w.word], answers: [pick.word], explanation: family.map(o => `${o.word} (${o.pos})`).join(' · '), hints: [], difficulty: 2 };
  if (typing) return { ...base, type: 'typing', prompt: `Write the ${pick.pos} in the word family of “${w.word}”.` };
  return { ...base, type: 'mcq', prompt: `Word family of “${w.word}”: which one is the ${pick.pos}?`, options: shuffleCopy(family.map(o => o.word), rng) };
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
// A synonym that is itself a word in the game would be a second right
// answer, so it counts like an exclusion.
const synonymsOf = w => (Array.isArray(w.synonyms) ? w.synonyms : Array.isArray(w.relations?.synonyms) ? w.relations.synonyms : []);
function compatible(a,b) {
  if (!a || !b) return false;
  if (norm(a.word)===norm(b.word)) return false;
  const syn=(x,y)=>synonymsOf(x).some(s=>norm(bareWord(s))===norm(bareWord(y.word)));
  return !(Array.isArray(a.excludeFromSameOptionsWith)?a.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(b.word)) && !(Array.isArray(b.excludeFromSameOptionsWith)?b.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(a.word)) && !syn(a,b) && !syn(b,a);
}
// opts: {boost(t,w) → extra rank, sameGroupMax → how many distractors may
// come from the target's own subCategory (easier questions mix groups).
// A plain function is accepted as boost for older callers.
function optionWords(targets, words, count=4, rng=Math.random, opts=null) {
  const o=typeof opts==='function'?{boost:opts}:(opts||{});
  const boost=o.boost||null, sameGroupMax=o.sameGroupMax??Infinity;
  const group=w=>w.subCategory||w.distractorGroup||null;
  const chosen = targets.map(t=>typeof t==='string'?findWord(words,t):t);
  // Correct targets only need to be distinct from each other. Exclusions
  // (excludeFromSameOptionsWith) exist to stop an ambiguous *distractor*
  // sitting next to a correct answer; two words that are BOTH correct in a
  // multi-select don't create that ambiguity, so they may be a combo pair.
  if(chosen.some(x=>!x) || chosen.some((a,i)=>chosen.slice(i+1).some(b=>norm(a.word)===norm(b.word)))) throw Error('Correct targets are missing or duplicated.');
  // Ranking: authored confusable pairs (relations.confusableWords) beat the
  // distractorGroup, which beats the mapper's cluster, which beats plain
  // type/category. A pair is confusable in either direction.
  const confusable=(t,w)=>(t.relations?.confusableWords||[]).some(x=>norm(x)===norm(w.word));
  // Options that can be ruled out by their form alone make a question easy,
  // so the same part of speech ranks above the subCategory, and the same
  // shape (one word vs a phrase, singular vs plural noun) counts too.
  const shape=(t,w)=>(posKey(t)===posKey(w)?130:0)+(wordCount(t)===wordCount(w)?60:0)+(posKey(t)==='noun'&&posKey(w)==='noun'&&isPluralNoun(t)===isPluralNoun(w)?30:0);
  // Words from the same course unit are about the same things (Clinic,
  // Pharmacy, Prescription), so they make closer options.
  const sameUnit=(t,w)=>Array.isArray(t.units)&&Array.isArray(w.units)&&t.units.some(u=>w.units.includes(u))?70:0;
  // Meaning Hunter shows definitions, so a wrong one should read like the
  // right one: shared content words, the same first word, a similar length.
  const defLike=o.definitionLike?(t,w)=>{const a=defTokens(t.meaning),b=defTokens(w.meaning);let n=0;a.forEach(x=>{if(b.has(x))n++;});const overlap=a.size&&b.size?n/Math.min(a.size,b.size):0;const la=String(t.meaning||'').length,lb=String(w.meaning||'').length;return Math.round(overlap*60)+(firstWord(t.meaning)&&firstWord(t.meaning)===firstWord(w.meaning)?30:0)+(la&&lb&&Math.abs(la-lb)<=0.4*Math.max(la,lb)?20:0);}:()=>0;
  const ranked = shuffleCopy(words,rng).map(w=>({w,rank:Math.max(...chosen.map(t=>(confusable(t,w)?150:confusable(w,t)?120:0)+shape(t,w)+sameUnit(t,w)+defLike(t,w)+(group(t) && group(t)===group(w)?100:0)+(t.learningData?.cluster && t.learningData.cluster===w.learningData?.cluster?40:0)+(t.type===w.type?10:0)+(topic(t.category)===topic(w.category)?5:0)+(boost?boost(t,w):0)))})).sort((a,b)=>b.rank-a.rank);
  const correct=[...chosen], fits=w=>chosen.every(t=>compatible(t,w) && norm(t.meaning)!==norm(w.meaning));
  const sameGroup=w=>correct.some(t=>group(t) && group(t)===group(w));
  let same=0; const later=[];
  for(const {w} of ranked) {
    if(chosen.length>=count) break;
    // Identical definitions are known alternatives; semantic synonyms require author review/exclusions.
    if(!fits(w)) continue;
    if(sameGroup(w)){ if(same>=sameGroupMax){ later.push(w); continue; } same++; }
    chosen.push(w);
  }
  // Not enough words outside the group: fill from it after all.
  for(const w of later){ if(chosen.length>=count) break; if(fits(w)) chosen.push(w); }
  return shuffleCopy(chosen,rng);
}
function validateContent(data, existing={}) {
  if(data && typeof data==='object' && !Array.isArray(data)){
    if(data.schemaVersion===3){const prep=prepareImport(data,existing);if(prep.errors.length)return prep.errors;data=prep.data;existing=prep.existing;}
    else data=withoutRemovedFields(data);
  }
  const errors=[]; const err=(p,m)=>errors.push(`${p}: ${m}`);
  const obj=x=>x && typeof x==='object' && !Array.isArray(x);
  const text=(v,p)=>{if(typeof v!=='string'||!v.trim())err(p,'expected non-empty string');};
  if(!obj(data)) return ['$: expected object'];
  const backup = data.kind==='backup' || (!data.kind && (data.mastery!==undefined||data.pools!==undefined));
  if(data.schemaVersion!==undefined && !(backup?[2,3,4,5,6]:[2]).includes(data.schemaVersion))err('schemaVersion','unsupported version');
  if(data.kind==='content')for(const key of Object.keys(data))if(![...fields,'schemaVersion','kind','note'].includes(key))err(key,'unrecognized content field; nothing was imported');
  if(data.kind && !['content','backup'].includes(data.kind))err('kind','unsupported kind');
  if(data.kind==='content') for(const k of ['score','mastery','pools','session','activeSession','levelStats','streak','attempted']) if(k in data)err(k,'player data is not allowed in content');
  if(!fields.some(f=>f in data))err('$','no content arrays');
  for(const f of fields){
    if(data[f]!==undefined&&!Array.isArray(data[f])){err(f,'expected array');continue;}
    const seen=new Set();
    (data[f]||[]).forEach((x,i)=>{const p=`${f}[${i}]`;if(!obj(x)){err(p,'expected object');return;} const key=f==='words'?'word':'id';text(x[key],`${p}.${key}`);if(seen.has(norm(x[key])))err(`${p}.${key}`,'duplicate key');seen.add(norm(x[key]));});
  }
  if(errors.length) return errors;
  const merged=mergeContent(existing,data), words=merged.words;
  const refs=(a,p,min=1)=>{if(!Array.isArray(a)||a.length<min){err(p,`expected at least ${min} word references`);return [];}
    if(new Set(a.map(norm)).size!==a.length)err(p,'duplicate targets');
    for(const [i,x] of a.entries())if(typeof x!=='string'||!findWord(words,x))err(`${p}[${i}]`,'unknown word');return a;};
  const pairs=(names,p)=>{const a=names.map(n=>findWord(words,n)).filter(Boolean);if(a.some((x,i)=>a.slice(i+1).some(y=>!compatible(x,y))))err(p,'targets/options violate exclusions');};
  (data.words||[]).forEach((w,i)=>{const p=`words[${i}]`;
    // Auto-created stub words (see healMissingWordRefs) are deliberately
    // minimal — they only promise word/type/category/meaning. Requiring
    // situation/gap from them would make every stub permanently unable to
    // survive an export → import round trip until someone manually
    // finishes it; the "_autoStub" flag + Content Manager badge already
    // flags them for follow-up, so the schema shouldn't also reject them.
    for(const k of (w._autoStub?['word','type','category','meaning']:['word','type','category','meaning','situation','gap']))text(w[k],`${p}.${k}`);
    if(!['vocab','idiom','binomial','phrasal','fyi'].includes(w.type))err(`${p}.type`,'unsupported type');
    if('id' in w)text(w.id,`${p}.id`);
    for(const k of ['opposite','chainGroup','distractorGroup','plainForm'])if(w[k]!==undefined)text(w[k],`${p}.${k}`);
    if(w.opposite && norm(w.opposite)!=='none')refs([w.opposite],`${p}.opposite`);
    if(w.excludeFromSameOptionsWith!==undefined)refs(w.excludeFromSameOptionsWith,`${p}.excludeFromSameOptionsWith`,0);
    if(w.illustration!==undefined&&!isIllustration(w.illustration))err(`${p}.illustration`,'expected an inline <svg> drawing (no scripts, at most 12000 characters)');if(w.pictureAvoid!==undefined&&(!Array.isArray(w.pictureAvoid)||w.pictureAvoid.some(x=>typeof x!=='string')))err(`${p}.pictureAvoid`,'expected an array of strings');if(w.collocationChecks!==undefined){if(!Array.isArray(w.collocationChecks))err(`${p}.collocationChecks`,'expected array');else w.collocationChecks.forEach((c,j)=>{const cp=`${p}.collocationChecks[${j}]`;if(!c||typeof c!=='object')return err(cp,'expected an object');if(typeof c.sentence!=='string'||(c.sentence.match(/_{2,}/g)||[]).length!==1)err(`${cp}.sentence`,'needs exactly one ______');text(c.answer,`${cp}.answer`);if(!Array.isArray(c.wrong)||c.wrong.filter(x=>typeof x==='string'&&x.trim()).length<2)err(`${cp}.wrong`,'expected at least two wrong options');else if(c.wrong.some(x=>norm(x)===norm(c.answer)))err(`${cp}.wrong`,'a wrong option equals the answer');});}if(w.units!==undefined&&(!Array.isArray(w.units)||w.units.some(u=>typeof u!=='string')))err(`${p}.units`,'expected an array of strings');if(w.antonyms!==undefined&&(!Array.isArray(w.antonyms)||w.antonyms.some(a=>typeof a!=='string')))err(`${p}.antonyms`,'expected an array of strings');if(w.hints!==undefined){if(!Array.isArray(w.hints))err(`${p}.hints`,'expected array');else w.hints.forEach((h,j)=>text(h,`${p}.hints[${j}]`));}
    for(const [f,ks] of [['transformExample',['before','after']],['commonMistake',['sentence','correction','why']]])if(w[f]!==undefined){if(!obj(w[f]))err(`${p}.${f}`,'expected object');else ks.forEach(k=>text(w[f][k],`${p}.${f}.${k}`));}
    if(w.transformExample&&!['phrasal','fyi'].includes(w.type))err(`${p}.transformExample`,'only phrasal/fyi');
  });
  (data.grammar||[]).forEach((g,i)=>{const p=`grammar[${i}]`;if(g&&typeof g.id==='string'&&g.id.includes(':'))err(`${p}.id`,'must not contain ":"');if(g&&Array.isArray(g.questions)){for(const k of ['category','rule','explanation'])text(g[k],`${p}.${k}`);if(!g.questions.length)err(`${p}.questions`,'expected at least one question');g.questions.forEach((q,j)=>{const qp=`${p}.questions[${j}]`;if(!q||typeof q!=='object')return err(qp,'expected an object');if(q.type==='choose'){text(q.prompt,`${qp}.prompt`);text(q.answer,`${qp}.answer`);if(!Array.isArray(q.options)||q.options.length<2||q.options.some(o=>typeof o!=='string'||!o.trim()))err(`${qp}.options`,'expected at least two strings');else{if(new Set(q.options.map(norm)).size!==q.options.length)err(`${qp}.options`,'duplicate options');if(!q.options.some(o=>norm(o)===norm(q.answer)))err(`${qp}.answer`,'answer missing from options');}}else if(q.type==='judge'){text(q.sentence,`${qp}.sentence`);if(typeof q.correct!=='boolean')err(`${qp}.correct`,'expected true or false');else if(q.correct)text(q.alternative,`${qp}.alternative`);else text(q.fix,`${qp}.fix`);const other=q.correct?q.alternative:q.fix;if(typeof other==='string'&&other.trim()&&sentence(other)===sentence(q.sentence))err(qp,'the other version must differ from the sentence');}else if(q.type==='fix'){text(q.sentence,`${qp}.sentence`);text(q.answer,`${qp}.answer`);if(typeof q.answer==='string'&&typeof q.sentence==='string'&&q.answer.trim()&&sentence(q.answer)===sentence(q.sentence))err(`${qp}.answer`,'must differ from the sentence');}else err(`${qp}.type`,'expected "choose", "judge" or "fix"');});return;}for(const k of ['category','rule','prompt','answer','explanation'])text(g[k],`${p}.${k}`);if(!Array.isArray(g.options)||g.options.length<2||g.options.some(o=>typeof o!=='string'||!o.trim()))err(`${p}.options`,'expected at least two strings');else {if(new Set(g.options.map(norm)).size!==g.options.length)err(`${p}.options`,'duplicate options');if(!g.options.some(o=>norm(o)===norm(g.answer)))err(`${p}.answer`,'answer missing from options');}});
  (merged.combos||[]).forEach((c,i)=>{const p=`combos[${i}]`;['category','situation','prompt','explanation'].forEach(k=>text(c[k],`${p}.${k}`));const a=refs(c.words,`${p}.words`,2);if(a.length!==2)err(`${p}.words`,'expected exactly two');else if(norm(a[0])===norm(a[1]))err(`${p}.words`,'the two words must be different');});
  (merged.stories||[]).forEach((s,i)=>{const p=`stories[${i}]`;['category','title','text'].forEach(k=>text(s[k],`${p}.${k}`));const targets=refs(s.targetWords,`${p}.targetWords`,5);if(targets.length>12)err(`${p}.targetWords`,'expected 5–12 targets');const covered=new Set();if(!Array.isArray(s.questions)||s.questions.length<5)err(`${p}.questions`,'expected at least five questions');
    (Array.isArray(s.questions)?s.questions:[]).forEach((q,j)=>{const qp=`${p}.questions[${j}]`;if(!obj(q)){err(qp,'expected object');return;}if(!['mcq','typing','multi'].includes(q.mode))err(`${qp}.mode`,'unsupported mode');text(q.prompt,`${qp}.prompt`);text(q.explanation,`${qp}.explanation`);const a=refs(q.mode==='multi'?q.targetWords:[q.targetWord],qp,q.mode==='multi'?2:1);if(q.mode==='multi'&&a.length!==2)err(qp,'multi requires exactly two targets');if(q.mode==='multi'&&q.targetWord!==undefined||q.mode!=='multi'&&q.targetWords!==undefined)err(qp,'conflicting target fields');if(q.options!==undefined||q.answer!==undefined)err(qp,'answers come from targetWord(s); options are generated');a.forEach(w=>{covered.add(norm(w));if(!targets.some(t=>norm(t)===norm(w)))err(qp,'question target not in story targets');});if(a.length===2&&norm(a[0])===norm(a[1]))err(qp,'multi targets must be different');});
    targets.forEach(t=>{if(!covered.has(norm(t)))err(p,`untested target: ${t}`);});
  });
  (data.challenges||[]).forEach((c,i)=>{const p=`challenges[${i}]`;text(c.prompt,`${p}.prompt`);if(c.linkedWords)refs(c.linkedWords,`${p}.linkedWords`,0);if(c.steps!==undefined&&!Array.isArray(c.steps)){err(`${p}.steps`,'expected array');return;}for(const [j,q] of [c,...(c.steps||[])].entries()){const qp=j?`${p}.steps[${j-1}]`:p;if(!obj(q)){err(qp,'expected object');continue;}if(q.options){if(!Array.isArray(q.options)||q.options.some(x=>typeof x!=='string'))err(qp,'invalid options');else{if(new Set(q.options.map(norm)).size!==q.options.length)err(qp,'duplicate options');pairs(q.options.filter(x=>findWord(words,x)),qp);for(const a of [q.answer,...(q.answers||[])].filter(x=>x!==undefined))if(!q.options.some(x=>norm(x)===norm(a)))err(qp,'answer missing from options');}}}});
  return errors;
}
function known(s) {return !!(s?.introducedAt || s?.correct>0 || s?.total>0);}
function stage(s={}) {if(s.everMastered && (s.regressionStrikes||0)<3)return 'Mastered';const modes=Object.values(s.modes||{}).filter(m=>m.correct>0).length;if(s.total>=5 && s.correct/s.total>=.8 && modes>=2 && s.productionCorrect>=1 && (!s.evidenceV2 || (s.independentSessions||[]).length>=3))return 'Mastered';return s.correct>=2&&modes>=2?'Learned':s.correct>0?'Familiar':'New';}
// Difficulty for the practice path (was always 1, so it never escalated):
// 1 New · 2 Familiar · 3 Learned or last 3 results all correct · 4 Mastered.
// Only changes MCQ option count for now; recorded on the question so
// recentResults reflect it.
function questionDifficulty(s={}){
  const st=stage(s);let d=st==='New'?1:st==='Familiar'?2:st==='Learned'?3:4;
  const recent=(s.recentResults||[]).slice(-3);
  if(recent.length===3&&recent.every(r=>r.correct))d=Math.max(d,3);
  if(recent.length>=2&&recent.filter(r=>r.correct).length<=1)d=Math.max(1,d-1);
  return Math.min(4,d);
}
// Which content pool a practice mode draws its text from. Pools hold the
// authored text (the "seed") plus AI-written variants, so the same word
// doesn't show the exact same sentence every time.
const POOL_FOR_MODE={meaning:'meaning',reverse:'meaning',typing:'typing',gap:'gap',gapTyping:'gap'};
// Least-used unlocked variant; ties broken at random so variants alternate.
// Retired variants carry a far-future lockedUntil, so they're never picked
// while anything else is available.
// Authored texts for a pool: the v3 list (gaps / situations) when present,
// otherwise the single field. They get ids seed, seed-2, seed-3… and keep
// any usage stats already stored under those ids; stored AI variants follow.
function authoredTexts(w,poolType){
  const list=poolType==='gap'?w.gaps:poolType==='situation'?w.situations:null;
  const single=poolType==='typing'?w.meaning:w[poolType];
  return (Array.isArray(list)&&list.length?list:[single]).filter(t=>typeof t==='string'&&t.trim());
}
function poolItems(w,poolType,stored){
  const byId=new Map((stored||[]).map(it=>[it.id,it]));
  const authored=authoredTexts(w,poolType).map((text,i)=>{const id=i?`seed-${i+1}`:'seed';return {attempts:0,correctCount:0,lockedUntil:null,flagged:false,...(byId.get(id)||{}),id,text};});
  return [...authored,...(stored||[]).filter(it=>!/^seed(-\d+)?$/.test(String(it.id)))];
}
// The sentences a question shows, normalized, so the game can remember
// what the learner has already read. Definitions (meaning / reverse /
// typing) aren't tracked: a word has one meaning. Grammar questions are.
const UNTRACKED_MODES=new Set(['meaning','reverse','typing','transform']);
function questionSentences(q){
  if(!q||UNTRACKED_MODES.has(q.mode))return [];
  const raw=Array.isArray(q.sentences)&&q.sentences.length?q.sentences:[q.prompt];
  return [...new Set(raw.map(sentence).filter(Boolean))];
}
// Seen within the last `hours` (or ever, when hours is Infinity).
const SEEN_FRESH_HOURS=20;
const PAIR_MODES=new Set(['twopeople','selecttwo']);
function seenRecently(seen,text,hours=SEEN_FRESH_HOURS,now=Date.now()){const at=seen?.[sentence(text)];return !!at&&(hours===Infinity||now-at<hours*3600000);}
function pickWordVariant(pools,w,poolType,rng=Math.random,seen=null){
  const all=poolItems(w,poolType,pools?.[w.word]?.[poolType]).filter(it=>it.text);
  if(!all.length)return null;
  // Sentences read recently go to the back; if every one was, the question
  // is built anyway and practice() drops it as stale.
  const unseen=all.filter(it=>!seenRecently(seen,it.text));
  const arr=unseen.length?unseen:all;
  const now=Date.now();
  const unlocked=arr.filter(it=>!it.lockedUntil||it.lockedUntil<=now);
  const candidates=unlocked.length?unlocked:arr;
  const least=Math.min(...candidates.map(it=>Number(it.attempts||0)));
  const tied=candidates.filter(it=>Number(it.attempts||0)===least);
  return tied[Math.floor(rng()*tied.length)];
}
function makeQuestion(w,mode,words,rng=Math.random,difficulty=1,pools=null,boost=null,seen=null) {
  const poolType=POOL_FOR_MODE[mode];
  const variant=poolType&&pools?pickWordVariant(pools,w,poolType,rng,seen):null;
  // A variant that leaks the answer or lost its blank falls back to the seed.
  const usable=variant&&variant.id!=='seed'&&!(mode!=='meaning'&&norm(variant.text).includes(norm(bareWord(w.word))))&&!(poolType==='gap'&&!/_{2,}/.test(variant.text));
  if(usable)w={...w,[poolType==='typing'?'meaning':poolType]:variant.text};
  const pool=poolType&&pools?{poolType,poolItemId:usable?variant.id:'seed'}:{};
  const q={id:`${w.word}:${mode}`,mode,targets:[w.word],hints:w.hints||[],explanation:w.meaning,type:'mcq',answers:[w.word],difficulty,...pool};
  if(mode==='transform')return {...q,type:'typing',prompt:`Use “${w.word}” to rewrite: ${w.transformExample.before}`,answers:[w.transformExample.after],explanation:w.transformExample.after,modelOnly:true};
  if(mode==='typing')return {...q,type:'typing',prompt:w.meaning};
  if(mode==='gapTyping')return {...q,type:'typing',prompt:w.gap};
  q.prompt=mode==='meaning'?w.word:mode==='reverse'?w.meaning:mode==='gap'?w.gap:w.situation;
  // Easier questions take at most one distractor from the word's own
  // subCategory; from difficulty 3 all of them may (Strain, Fracture, Bruise…).
  const choices=optionWords([w],words,difficulty>=3?(mode==='meaning'?5:6):4,rng,{boost,sameGroupMax:difficulty>=3?Infinity:2,definitionLike:mode==='meaning'});
  q.options=choices.map(x=>mode==='meaning'?x.meaning:x.word);
  if(mode==='meaning')q.answers=[w.meaning];
  if(q.options.length<2)return null;
  if(mode!=='meaning' && norm(q.prompt).includes(norm(bareWord(w.word))))return null;
  return q;
}
function activityQuestion(q,words,id,rng=Math.random){
  const targets=(q.mode==='multi'?q.targetWords:[q.targetWord]).map(x=>findWord(words,x)?.word||x);
  const out={...q,id,targets,answers:targets,type:q.mode==='typing'?'typing':q.mode==='multi'?'multi':'mcq',hints:[]};
  if(out.type!=='typing'){out.options=optionWords(targets,words,Math.max(4,targets.length+1),rng).map(w=>w.word);if(out.options.length<=targets.length)throw Error(`${id}: not enough safe distractors`);}
  return out;
}
// A grammar rule's questions. v3 rules carry questions[] (choose / judge /
// fix); an older rule is one choose question built from its own fields.
function grammarQuestions(g){
  if(!g)return [];
  if(!Array.isArray(g.questions))return g.prompt&&Array.isArray(g.options)&&g.answer?[{type:'choose',prompt:g.prompt,options:g.options,answer:g.answer,explanation:g.explanation}]:[];
  return g.questions.filter(q=>q&&(q.type==='choose'?q.prompt&&Array.isArray(q.options)&&q.options.length>=2&&q.answer:q.type==='judge'?q.sentence&&typeof q.correct==='boolean'&&(q.correct?q.alternative:q.fix):q.type==='fix'?q.sentence&&q.answer:false));
}
const JUDGE_OK="It's correct as it is";
function grammarQuestion(g,item,turn,rng=Math.random){
  if(!item)return null;
  const base={id:`grammar:${g.id}:q${turn}`,targets:[],progressKey:`grammar:${g.id}`,rule:g.rule,explanation:[item.explanation||g.explanation,g.rule&&`Rule: ${g.rule}`].filter(Boolean).join('\n')};
  if(item.type==='choose')return {...base,mode:'grammarChoose',type:'mcq',prompt:item.prompt,answers:[item.answer],options:shuffleCopy(item.options,rng)};
  // Judge: keep it as it is, or take the other version. For a correct
  // sentence the other version is a tempting wrong rewrite, so the choices
  // look the same either way and don't give the answer away.
  if(item.type==='judge')return {...base,mode:'grammarJudge',type:'mcq',prompt:`Is this sentence correct? If not, choose the fixed version.\n“${item.sentence}”`,answers:[item.correct?JUDGE_OK:item.fix],options:shuffleCopy([JUDGE_OK,item.correct?item.alternative:item.fix],rng)};
  if(item.type==='fix')return {...base,mode:'grammarFix',type:'typing',prompt:`Fix the mistake and write the whole sentence:\n“${item.sentence}”`,answers:[item.answer],sentence:item.sentence,modelOnly:true,freeformKind:'grammarFix'};
  return null;
}
// ---- Grammar questions written by the game ----
// After a grammar question is asked, the game keeps one fresh question ready
// for that rule, written by AI in the background (see grammarNeedsVariant),
// so the next round shows a new one instead of the same again. They live in
// the player's pools (grammar:<rule id> → variant), ids starting "gen-".
const GRAMMAR_VARIANT_MAX=20;
const isOpenVariant=(it,now)=>!it.lockedUntil||it.lockedUntil<=now;
function writtenGrammarVariants(pools,g,now=Date.now()){
  return variantItems(pools,`grammar:${g.id}`,{}).filter(it=>String(it.id).startsWith('gen-')&&it.prompt&&Array.isArray(it.options)&&it.options.length>=2&&it.answer&&!it.flagged&&isOpenVariant(it,now));
}
// How many questions of this rule could be shown next round: its own and the
// written ones, not read in the last SEEN_FRESH_HOURS.
function grammarReady(g,pools,seen,now=Date.now()){
  const unseen=t=>!seenRecently(seen,t,SEEN_FRESH_HOURS,now);
  if(Array.isArray(g.questions)){
    const own=grammarQuestions(g).filter((it,i)=>{const q=grammarQuestion(g,it,i,()=>0.5);return q&&!questionSentences(q).some(t=>!unseen(t));}).length;
    return own+writtenGrammarVariants(pools,g,now).filter(it=>unseen(it.prompt)).length;
  }
  return variantItems(pools,`grammar:${g.id}`,{prompt:g.prompt,options:g.options,answer:g.answer,explanation:g.explanation}).filter(it=>it.prompt&&isOpenVariant(it,now)&&unseen(it.prompt)).length;
}
// True when no question of this rule is ready for next time and there's room
// for another written one: time to write a new one.
function grammarNeedsVariant(g,pools,seen,now=Date.now()){
  if(!g||!g.id||!grammarQuestions(g).length)return false;
  const made=variantItems(pools,`grammar:${g.id}`,{}).filter(it=>String(it.id).startsWith('gen-')).length;
  return made<GRAMMAR_VARIANT_MAX&&grammarReady(g,pools,seen,now)<1;
}
// One of the rule's own questions as an example the AI imitates (the format
// of its question: fill the blank, or choose the correct sentence).
function grammarVariantBase(g){
  const list=grammarQuestions(g),c=list.find(q=>q.type==='choose');
  if(c)return {prompt:c.prompt,options:c.options,answer:c.answer,explanation:c.explanation||g.explanation||''};
  const j=list.find(q=>q.type==='judge'),f=list.find(q=>q.type==='fix');
  if(j)return {prompt:'Which sentence is correct?',options:j.correct?[j.sentence,j.alternative]:[j.sentence,j.fix],answer:j.correct?j.sentence:j.fix,explanation:j.explanation||g.explanation||''};
  if(f)return {prompt:'Which sentence is correct?',options:[f.sentence,f.answer],answer:f.answer,explanation:f.explanation||g.explanation||''};
  return {prompt:g.prompt,options:g.options,answer:g.answer,explanation:g.explanation||''};
}
// ---- Course levels ----
// The Gateway course's levels are named A1.1, A1.2, A1.3, A2.1 … C2.3 and
// sit in an item's `level` (a plain A1–C2 there is the item's own
// difficulty, not a course level). The level's sessions are its `units`
// (Memories-and-Fear …), as in the Anki tags.
const BANDS=['A1','A2','B1','B2','C1','C2'];
const COURSE_LEVEL=/^([ABC][12])\.(\d{1,2})$/i;
// The choices editors offer: A1.1 … C2.3 (three course levels a band).
const COURSE_LEVELS=BANDS.flatMap(b=>[1,2,3].map(n=>`${b}.${n}`));
function courseLevelOf(item){const m=COURSE_LEVEL.exec(String(item?.level??'').trim());return m&&Number(m[2])>0?`${m[1].toUpperCase()}.${Number(m[2])}`:null;}
// A1.1 < A1.2 < … < A2.1 < … < C2.3; anything else after.
function courseLevelRank(id){const m=COURSE_LEVEL.exec(String(id||''));return m?BANDS.indexOf(m[1].toUpperCase())*100+Number(m[2]):Infinity;}
// Gateway numbers its levels three to a band, from A1.1 = 3: A1.2 = 4,
// A1.3 = 5, A2.1 = 6 … B1.1 = 9.
function gatewayLevel(id){const m=COURSE_LEVEL.exec(String(id||''));const sub=m?Number(m[2]):0;return m&&sub>=1&&sub<=3?3+BANDS.indexOf(m[1].toUpperCase())*3+sub-1:null;}
function courseLevelFromGateway(n){n=Number(n);if(!Number.isInteger(n)||n<3||n>=3+BANDS.length*3)return null;return `${BANDS[Math.floor((n-3)/3)]}.${(n-3)%3+1}`;}
// A level written the Gateway way ("Level-7", "Gateway 7", the Anki tag
// "English::Gateway::Level-7") as its course level (A2.2); anything else
// as it was.
const GATEWAY_LEVEL=/^(?:english::)?(?:gateway(?:::|[\s_-]*))?(?:level)?[\s:_-]*(\d{1,2})$/i;
function normalizeLevel(value){if(typeof value!=='string'&&typeof value!=='number')return value;const v=String(value).trim();if(COURSE_LEVEL.test(v))return courseLevelOf({level:v});if(!/[a-z]/i.test(v))return value;const m=GATEWAY_LEVEL.exec(v);return m&&courseLevelFromGateway(m[1])||value;}
// How hard a word is, for the order new words come in: A1 < A2 < … and,
// for course levels, A1.2 < A1.3 < A2.1. Unknown sits in the middle.
function difficultyRank(item){const v=String(item?.level||'').trim().toUpperCase();const m=COURSE_LEVEL.exec(v);if(m)return BANDS.indexOf(m[1].toUpperCase())+Number(m[2])/10;const i=BANDS.indexOf(v);return i<0?2.5:i;}

function practice(content,mastery={},category=null,rng=Math.random,quarantine=null,opts={}){
  const isQuarantined=(word,mode)=>!!quarantine&&quarantine.has(`${String(word).trim().toLowerCase()}|${mode}`);
  const pools=opts.pools||{};
  const questionsPerRound=Math.max(4,opts.questionsPerRound||12);
  const newWordsPerRound=Math.max(0,Number.isFinite(opts.newWordsPerRound)?opts.newWordsPerRound:3);
  // Words this learner has actually picked by mistake for each other
  // (either direction) make the strongest distractors, ahead of authored
  // confusable pairs.
  const confusedPairs=new Set(Object.keys(opts.confusions||{}).flatMap(key=>{const [a,b]=key.split('|');return a&&b?[`${norm(a)}|${norm(b)}`,`${norm(b)}|${norm(a)}`]:[];}));
  const confusionBoost=confusedPairs.size?(t,w)=>confusedPairs.has(`${norm(t.word)}|${norm(w.word)}`)?200:0:null;
  // opts.unit narrows the round to one course unit of the lesson (a word
  // can be in more than one); opts.subCategory to one group; opts.noGroup
  // ("unit" / "subCategory") to the lesson's words that have none.
  const unitsOf=w=>Array.isArray(w.units)?w.units:[];
  const inGroup=w=>opts.unit?unitsOf(w).includes(opts.unit):opts.subCategory?w.subCategory===opts.subCategory:opts.noGroup==='unit'?!unitsOf(w).length:opts.noGroup?!w.subCategory:true;
  // opts.courseLevel narrows the round to one course level, from every
  // lesson (with opts.unit, to one of its sessions); opts.noCourseLevel
  // to the words with no course level.
  const courseRound=!!(opts.courseLevel||opts.noCourseLevel);
  const inCourse=w=>opts.courseLevel?courseLevelOf(w)===opts.courseLevel:opts.noCourseLevel?!courseLevelOf(w):true;
  const source=content.words.filter(w=>(!category||topic(w.category)===topic(category))&&inGroup(w)&&inCourse(w));
  const inSource=label=>source.some(w=>norm(w.word)===norm(label));
  // New words come in level order (A2 before B1…), random within a level.
  const fresh=shuffleCopy(source.filter(w=>!known(mastery[w.word])),rng).sort((a,b)=>difficultyRank(a)-difficultyRank(b)).slice(0,newWordsPerRound);
  // No spaced repetition: known words are picked in rotation. Words missed
  // last time come first; everything else goes least recently reviewed
  // first, so a word answered correctly goes to the back of the line and
  // doesn't return until the rest of the pool has had a turn.
  const old=shuffleCopy(source.filter(w=>known(mastery[w.word])),rng).sort((a,b)=>missed(b)-missed(a)||lastSeen(a)-lastSeen(b));
  function missed(w){const r=mastery[w.word]?.lastResult;return r&&r!=='correct'?1:0;}
  function lastSeen(w){return mastery[w.word]?.lastReviewedAt||0;}
  const oldCount=Math.max(questionsPerRound-newWordsPerRound,questionsPerRound-fresh.length);
  const chosen=[...old.slice(0,oldCount),...fresh];const candidates=[];
  for(const w of chosen){const s=mastery[w.word]||{};const st=stage(s);
    // Familiar words already get one production chance (gapTyping) once they
    // have a correct answer, so typing evidence starts before 'Learned'.
    // Once a word is Learned, "definition → pick the word" is too easy to
    // tell you anything, so known words lean on typing and context instead.
    // No "situation" mode: the situation is the word's example sentence and
    // contains the word, so the gap sentence is the context question.
    let modes=st==='New'?['meaning','reverse']:st==='Familiar'?['reverse','gap',...((s.correct||0)>=1?['gapTyping']:[])]:['typing','gapTyping','gap'];
    if(['Learned','Mastered'].includes(st)){if(['phrasal','fyi'].includes(w.type)&&w.transformExample)modes.push('transform');}
    // Production gate: a word held at PRODUCTION_GATE_STEP (or already
    // Learned/Mastered) with zero correct productions only gets typing modes
    // until it produces once — recognition questions would just re-confirm
    // what the gate already knows.
    const needsProduction=(s.productionCorrect||0)===0&&((s.reviewStep||0)>=PRODUCTION_GATE_STEP||['Learned','Mastered'].includes(st));
    if(needsProduction){const prod=modes.filter(m=>['typing','gapTyping'].includes(m)&&!isQuarantined(w.word,m)&&!(m==='gapTyping'&&!/_{2,}/.test(w.gap||'')));if(prod.length)modes=prod;}
    const difficulty=questionDifficulty(s);
    modes=modes.filter(m=>!isQuarantined(w.word,m));
    const weak=Object.entries(s.modes||{}).filter(([,v])=>v.total>0).sort((a,b)=>a[1].correct/a[1].total-b[1].correct/b[1].total)[0]?.[0];
    modes=shuffleCopy(modes,rng).sort((a,b)=>(b===weak)-(a===weak));
    const cm=Array.isArray(w.commonMistakes)&&w.commonMistakes.length?w.commonMistakes[Math.floor(rng()*w.commonMistakes.length)]:w.commonMistake;
    if(known(s)&&cm&&!isQuarantined(w.word,'grammarCourt'))candidates.push({id:`${w.word}:court`,mode:'grammarCourt',type:'mcq',prompt:'Which sentence is correct?',sentences:[cm.sentence,cm.correction],targets:[w.word],answers:[cm.correction],options:shuffleCopy([cm.sentence,cm.correction],rng),explanation:cm.why});
    for(const mode of modes){if(mode.includes('gap')&&!/_{2,}/.test(w.gap))continue;const q=makeQuestion(w,mode,content.words,rng,difficulty,pools,confusionBoost,opts.seen);if(q)candidates.push(q);}
    // Extra question styles (Who Am I, Opposites, Two People, …) come from
    // the caller so this module stays free of the legacy builders. Never for
    // brand-new words, and not while the production gate wants typing.
    if(opts.extraQuestion&&st!=='New'&&!needsProduction){const q=opts.extraQuestion(w,st,rng);if(q&&!isQuarantined(w.word,q.mode))candidates.push(q);}
  }
  // Combos and impostor challenges keep their own progress record
  // (progressKey, same as the grammar loop below). With no spaced
  // repetition they rotate like words: at most one of each per session,
  // least recently reviewed first.
  const lastSeenKey=key=>mastery[key]?.lastReviewedAt||0;
  const comboPool=(content.combos||[]).filter(c=>(!category||topic(c.category)===topic(category))&&(!courseRound||c.words.every(inSource))&&c.words.every(w=>known(mastery[findWord(content.words,w)?.word]))&&!c.words.some(w=>isQuarantined(w,'multi')));
  for(const c of shuffleCopy(comboPool,rng).sort((a,b)=>lastSeenKey(`combo:${a.id}`)-lastSeenKey(`combo:${b.id}`)).slice(0,1)){const comboKey=`combo:${c.id}`;const item=pickPoolVariant(pools,comboKey,{situation:c.situation,prompt:c.prompt});try{candidates.push(activityQuestion({mode:'multi',targetWords:c.words,prompt:`${item.situation}\n${item.prompt}`,explanation:c.explanation,progressKey:comboKey,poolType:'combo',poolItemId:item.id},content.words,`combo:${c.id}:${item.id}`,rng));}catch{}}
  const challengePool=[];
  for(const c of content.challenges||[])if(['impostor','reverseImpostor'].includes(c.type||c.mode)&&!c.steps&&c.options?.length>=2&&c.answer&&(!category||topic(c.category)===topic(category))&&(!courseRound||(c.linkedWords||[]).some(inSource))){const targets=(c.linkedWords||[]).filter(w=>norm(w)===norm(c.answer));if(targets.length&&targets.every(w=>['Learned','Mastered'].includes(stage(mastery[w])))&&!targets.some(w=>isQuarantined(w,'impostor'))){const refs=c.options.map(o=>findWord(content.words,o)).filter(Boolean);if(refs.every((a,i)=>refs.slice(i+1).every(b=>compatible(a,b))))challengePool.push({c,targets});}}
  for(const {c,targets} of shuffleCopy(challengePool,rng).sort((a,b)=>lastSeenKey(`challenge:${a.c.id}`)-lastSeenKey(`challenge:${b.c.id}`)).slice(0,1))candidates.push({id:`challenge:${c.id}`,mode:'impostor',type:'mcq',targets,progressKey:`challenge:${c.id}`,prompt:c.prompt,answers:[c.answer],options:shuffleCopy(c.options,rng),explanation:c.explanation});
  // Grammar lives inside word sessions: rules from the same lesson as this
  // session's words, one question per rule, 1–2 rules per session. Rules
  // rotate like words (missed last time first, then least recently
  // reviewed) and each rule steps through its own questions in turn.
  const grammarTopics=new Set((category?[category]:chosen.map(w=>w.category)).map(topic));
  const missedKey=key=>{const r=mastery[key]?.lastResult;return r&&r!=='correct'?1:0;};
  // A unit round only asks that unit's grammar rules; a course-level round
  // only the rules of that level (and session).
  const grammarPool=(content.grammar||[]).filter(g=>g&&g.id&&(courseRound?(opts.courseLevel?courseLevelOf(g)===opts.courseLevel:!courseLevelOf(g)&&grammarTopics.has(topic(g.category))):grammarTopics.has(topic(g.category)))&&(!opts.unit||unitsOf(g).includes(opts.unit))&&grammarQuestions(g).length);
  const grammarQueue=shuffleCopy(grammarPool,rng).sort((a,b)=>missedKey(`grammar:${b.id}`)-missedKey(`grammar:${a.id}`)||lastSeenKey(`grammar:${a.id}`)-lastSeenKey(`grammar:${b.id}`)).slice(0,questionsPerRound>=10?2:1).map(g=>{
    const grammarKey=`grammar:${g.id}`;
    // Old single-question rules keep their AI variant pool.
    // The rule's own question and the ones the game wrote for it (see
    // grammarNeedsVariant): the least-asked one not read in the last
    // SEEN_FRESH_HOURS. Nothing fresh → the rule sits this round out.
    if(!Array.isArray(g.questions)){
      const all=variantItems(pools,grammarKey,{prompt:g.prompt,options:g.options,answer:g.answer,explanation:g.explanation}).filter(it=>it.prompt&&Array.isArray(it.options)&&it.answer);
      const nowG=Date.now(),open=all.filter(it=>!it.lockedUntil||it.lockedUntil<=nowG);
      const ready=(open.length?open:all).filter(it=>!seenRecently(opts.seen,it.prompt));
      if(!ready.length)return null;
      const least=Math.min(...ready.map(it=>Number(it.attempts||0))),tied=ready.filter(it=>Number(it.attempts||0)===least);
      const item=tied[Math.floor(rng()*tied.length)];
      return {id:`grammar:${g.id}:${item.id}`,mode:'grammarChoose',type:'mcq',prompt:item.prompt,answers:[item.answer],options:shuffleCopy(item.options,rng),targets:[],progressKey:grammarKey,poolType:'grammar',poolItemId:item.id,explanation:item.explanation};
    }
    // From this rule's turn, the first question not read in the last
    // SEEN_FRESH_HOURS (the turn only moves when a session is completed, so
    // a left-early session would otherwise repeat it). All read recently →
    // the rule sits this round out.
    const list=grammarQuestions(g);const turn=(mastery[grammarKey]?.total||0)%list.length;
    for(let k=0;k<list.length;k++){const i=(turn+k)%list.length;const q=grammarQuestion(g,list[i],i,rng);if(q&&!questionSentences(q).some(t=>seenRecently(opts.seen,t)))return q;}
    // All of its own were read recently: one the game wrote for this rule.
    const written=writtenGrammarVariants(pools,g).filter(it=>!seenRecently(opts.seen,it.prompt));
    if(written.length){
      const least=Math.min(...written.map(it=>Number(it.attempts||0))),tied=written.filter(it=>Number(it.attempts||0)===least);
      const item=tied[Math.floor(rng()*tied.length)];
      return {id:`grammar:${g.id}:${item.id}`,mode:'grammarChoose',type:'mcq',prompt:item.prompt,answers:[item.answer],options:shuffleCopy(item.options,rng),targets:[],progressKey:`grammar:${g.id}`,poolType:'grammar',poolItemId:item.id,rule:g.rule,explanation:[item.explanation,g.rule&&`Rule: ${g.rule}`].filter(Boolean).join('\n')};
    }
    return null;
  }).filter(Boolean);
  const queue=[],counts={}, weights={meaning:3,reverse:3,gap:3,gapTyping:3,situation:2,typing:3,order:2,transform:2,multi:1,grammarCourt:1,whoami:2,opposite:2,antonym:2,collocation:2,family:2,picture:3,twopeople:2,selecttwo:2,idiomDetective:2,story:2};
  const wordSlots=questionsPerRound-grammarQueue.length;
  // Don't show a sentence the learner read in the last SEEN_FRESH_HOURS;
  // Two People / Select Two only ever use sentences never shown before.
  // A round with nothing fresh left is shorter instead of repetitive.
  const seen=opts.seen||{};const nowTs=Date.now();
  const stale=q=>questionSentences(q).some(t=>seenRecently(seen,t,PAIR_MODES.has(q.mode)?Infinity:SEEN_FRESH_HOURS,nowTs));
  for(let i=candidates.length-1;i>=0;i--)if(stale(candidates[i]))candidates.splice(i,1);
  const usedSentences=new Set();
  // Introductions are separate cards. Last introduced word is never the first test.
  const lastIntro=fresh.at(-1)?.word;
  const usedWords=new Set();
  // A word shows up at most twice per round; a small category ends the
  // round early instead of cycling the same few words over and over.
  const wordUses={};
  while(queue.length<wordSlots&&candidates.length){
    const eligible=candidates.map((q,i)=>({q,i})).filter(({q})=>!(queue.length===0&&q.targets.includes(lastIntro)) && !questionSentences(q).some(t=>usedSentences.has(t)) && !q.targets.some(t=>(wordUses[t]||0)>=2) && !queue.slice(-2).some(p=>p.targets.some(t=>q.targets.includes(t))) && !(queue.length>=2&&queue.slice(-2).every(p=>p.mode===q.mode)));
    if(!eligible.length)break;
    eligible.sort((a,b)=>{
      const aFresh=a.q.targets.some(t=>!usedWords.has(t))?0:1;
      const bFresh=b.q.targets.some(t=>!usedWords.has(t))?0:1;
      if(aFresh!==bFresh)return aFresh-bFresh;
      return ((counts[a.q.mode]||0)/(weights[a.q.mode]||1))-((counts[b.q.mode]||0)/(weights[b.q.mode]||1));
    });
    const {q,i}=eligible[0];queue.push(q);questionSentences(q).forEach(t=>usedSentences.add(t));counts[q.mode]=(counts[q.mode]||0)+1;q.targets.forEach(t=>{usedWords.add(t);wordUses[t]=(wordUses[t]||0)+1;});candidates.splice(i,1);
  }
  // At most one grammar question per 4 word questions, so a short round
  // (e.g. the very first one) stays about the words. Spread the rest
  // through the round (never first), e.g. at 1/3 and 2/3.
  grammarQueue.splice(Math.floor(queue.length/4));
  const spots=grammarQueue.map((_,k)=>Math.max(1,Math.round(queue.length*(k+1)/(grammarQueue.length+1))));
  for(let k=grammarQueue.length-1;k>=0;k--)queue.splice(Math.min(spots[k],queue.length),0,grammarQueue[k]);
  return {kind:'practice',id:`session-${Date.now()}-${rng()}`,title:opts.title||category||'Practice',queue,introductions:fresh,index:0,answers:[],initialLength:queue.length,targetLength:questionsPerRound,reserves:candidates,extraAdded:false};
}
function storySession(story,words,mastery={},rng=Math.random){const introductions=story.targetWords.map(w=>findWord(words,w)).filter(w=>!known(mastery[w.word]));const scoped=story.sourceCategories?.length?words.filter(w=>story.sourceCategories.includes(w.category)):words;const optionSource=scoped.length>=4?scoped:words;const queue=story.questions.map((q,i)=>activityQuestion(q,optionSource,`${story.id}:${i}`,rng));for(const g of story.grammarQuestions||[])queue.push({...g,options:shuffleCopy(g.options,rng)});return {id:`story-${story.id}-${Date.now()}`,sourceStoryId:story.id,kind:'story',title:story.title,text:story.text,queue,introductions,unfairTargets:introductions.map(w=>w.word),index:0,answers:[]};}
function chainSession(group,words,mastery={},rng=Math.random){const queue=shuffleCopy(words.filter(w=>w.chainGroup===group&&w.opposite&&known(mastery[w.word])&&known(mastery[findWord(words,w.opposite)?.word])),rng).map((w,i)=>{const target=findWord(words,w.opposite);if(!target)return null;const options=optionWords([target],words,4,rng).map(x=>x.word);return options.length<2?null:{id:`chain:${i}`,mode:'opposite',type:'mcq',prompt:`What is the opposite of “${w.word}”?`,answers:[target.word],targets:[target.word],options,explanation:`${w.word} ↔ ${target.word}`};}).filter(Boolean);return {id:`chain-${Date.now()}`,kind:'chain',title:group,queue,introductions:[],index:0,answers:[]};}
function grade(q,value,words=[]){const a=Array.isArray(value)?value:[value];const correct=a.length===q.answers.length&&q.answers.every(x=>a.some(v=>sentence(v)===sentence(x)||sentence(v)===sentence(bareWord(x))));let spelling=false;if(!correct&&q.type==='typing'&&!q.modelOnly&&!findWord(words,value)){const x=norm(value),y=norm(bareWord(q.answers[0]));if(x.length>=3){const d=Array.from({length:x.length+1},(_,i)=>[i]);for(let j=0;j<=y.length;j++)d[0][j]=j;for(let i=1;i<=x.length;i++)for(let j=1;j<=y.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(x[i-1]!==y[j-1]));spelling=d[x.length][y.length]<=1;}}return {correct,spelling,unverified:!correct&&q.modelOnly};}
function sessionEvidence(mastery,session,now=Date.now()){
  const next={...mastery};const grouped={};
  session.queue.forEach((q,i)=>{const a=session.answers[i];if(!a||a.reported||a.unverified||a.aiFailed||q.noMastery||session.kind==='speed')return;for(const key of q.progressKeys?.length?q.progressKeys:q.progressKey?[q.progressKey]:q.targets){if(session.unfairTargets?.includes(key))continue;(grouped[key] ||= []).push({...a,mode:q.mode,type:q.type,difficulty:q.difficulty||1});}});
  for(const [key,results] of Object.entries(grouped)){
    const s=next[key]||{};if((s.appliedSessions||[]).includes(session.id))continue;
    const independent=results.filter(a=>!a.assisted);const ok=independent.length>0&&results.every(a=>a.correct&&!a.assisted);
    const recall=independent.some(a=>a.correct&&a.type==='typing'&&a.mode!=='transform');
    const productionCorrect=(s.productionCorrect||0)+(ok&&recall?1:0);
    const stepCap=productionCorrect>0?4:PRODUCTION_GATE_STEP;
    const step=ok?Math.min(stepCap,(s.reviewStep||0)+1):0;
    // Bounded: only "3 or more" matters, and a round is never applied twice
    // within the last 50 (see progressMerge.mergeMasteryRecord).
    const sessions=[...new Set([...(s.independentSessions||[]),...(ok?[session.id]:[])])].slice(-20);
    const spellingMisses=results.filter(a=>a.spelling).length;
    const lastResult=ok?'correct':spellingMisses?'spelling':results.some(a=>a.assisted)?'assisted':'wrong';
    const modes={...(s.modes||{})};
    const recent=[...(s.recentResults||[])];
    results.forEach(result=>{
      const modeId=result.mode;
      const previous=modes[modeId]||{};
      const correct=!!result.correct&&!result.assisted;
      modes[modeId]={...previous,total:(previous.total||0)+1,correct:(previous.correct||0)+(correct?1:0),spellingMisses:(previous.spellingMisses||0)+(result.spelling?1:0),lastResult:correct?'correct':result.spelling?'spelling':result.assisted?'assisted':'wrong',lastDifficulty:result.difficulty||1};
      recent.push({correct,modeId,difficulty:result.difficulty||1,at:now,spelling:!!result.spelling});
    });
    const record={...s,everMastered:s.everMastered===true||stage(s)==='Mastered',evidenceV2:true,correct:(s.correct||0)+(ok?1:0),total:(s.total||0)+1,modes,productionCorrect:(s.productionCorrect||0)+(ok&&recall?1:0),productionAttempts:(s.productionAttempts||0)+(results.some(a=>a.type==='typing')?1:0),assistedAttempts:(s.assistedAttempts||0)+results.filter(a=>a.assisted).length,spellingMisses:(s.spellingMisses||0)+spellingMisses,aiEvaluatedAttempts:(s.aiEvaluatedAttempts||0)+results.filter(a=>a.aiEvaluated).length,independentSessions:sessions,appliedSessions:[...(s.appliedSessions||[]),session.id].slice(-50),lastReviewedAt:now,nextReviewAt:0,reviewStep:step,lastResult,recentResults:recent.slice(-8),regressionStrikes:s.everMastered?(ok?Math.max(0,(s.regressionStrikes||0)-1):(s.regressionStrikes||0)+1):(s.regressionStrikes||0)};
    if(stage(record)==='Mastered')record.everMastered=true;
    next[key]=record;
  }
  return next;
}
function reinforcement(s){if(s.extraAdded||s.kind!=='practice')return s;const wrong=s.queue.filter((q,i)=>s.answers[i]&&!s.answers[i].correct&&!s.answers[i].reported).flatMap(q=>q.targets);const added=[];for(const q of s.reserves||[]){if(added.length>=2)break;if(!q.targets.some(t=>wrong.includes(t)))continue;if([...s.queue,...added].slice(-2).some(p=>p.targets.some(t=>q.targets.includes(t))))continue;const shown=new Set([...s.queue,...added].flatMap(questionSentences));if(questionSentences(q).some(t=>shown.has(t)))continue;added.push(q);}return {...s,queue:[...s.queue,...added],extraAdded:true};}

return { COURSE_LEVELS, courseLevelOf, courseLevelRank, gatewayLevel, courseLevelFromGateway, normalizeLevel, difficultyRank, norm, sentence, makeQuestion, pictureQuestion, isIllustration, linkAntonyms, outsideAntonyms, antonymsOf, collocationQuestion, familyQuestion, shuffleCopy, topic, fields, withoutRemovedFields, normalizeV3, applyRenames, prepareImport, bareWord, poolItems, mergeContent, contentOnly, findWord, compatible, optionWords, validateContent, known, stage, activityQuestion, questionSentences, seenRecently, SEEN_FRESH_HOURS, grammarQuestions, grammarQuestion, grammarReady, grammarNeedsVariant, grammarVariantBase, writtenGrammarVariants, GRAMMAR_VARIANT_MAX, practice, storySession, chainSession, grade, sessionEvidence, reinforcement };
})();
