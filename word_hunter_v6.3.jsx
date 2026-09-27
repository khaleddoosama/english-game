// Word Hunter V7.1 — category-driven leak-safe stories; Anki import and split-level merge removed.
// Paste the whole file into the existing Claude React artifact.
// React and lucide-react are the only imports; no local files or build setup.
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, PenLine, Compass, Keyboard, Flame, RotateCcw, Scale, Sparkles,
  Trophy, Award, Lock, X, Play, CheckCircle2, BarChart3, ArrowLeft, BookOpen, Flag,
  Users, Newspaper, ShoppingBag, Target, Angry, Upload, ArrowLeftRight, Download, Copy, ClipboardCheck,
  HelpCircle, Users2, ListChecks, Zap, Trash2, ChevronDown, ChevronRight, Volume2,
} from "lucide-react";

// Embedded offline engine; isolated names preserve the existing game.
const V2 = (() => {
// Content v2 and offline session engine. No network calls or player state in content.
const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const sentence = v => norm(v).replace(/\s+([,.!?;:])/g, '$1');
const shuffleCopy = (a, rng = Math.random) => { const b = [...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1)); [b[i],b[j]]=[b[j],b[i]];} return b; };
const topic = s => norm(s).replace(/\s+[ivxlcdm]+$/i, '');
const fields = ['words','combos','stories','grammar','puns','challenges'];
// Generic "answer it right twice, get a fresh example next time" pool —
// same idea as the word content pools, reused here for combos/grammar so
// a mastered combo/rule keeps testing the concept with new situations
// instead of either repeating the same fixed example forever or just
// going quiet. `seed` supplies the original authored content for the
// synthetic "seed" entry; AI-generated variants carry their own content.
function pickPoolVariant(pools,key,seed){
  const stored=pools?.[key]?.variant;
  const arr=(stored&&stored.length?stored:[{id:'seed',attempts:0,correctCount:0,lockedUntil:null}]).map(item=>item.id==='seed'?{...item,...seed}:item);
  const now=Date.now();
  const unlocked=arr.filter(it=>!it.lockedUntil||it.lockedUntil<=now);
  const candidates=unlocked.length?unlocked:arr;
  return candidates.reduce((a,b)=>(a.attempts<=b.attempts?a:b));
}
function mergeContent(old = {}, incoming = {}) {
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
  out.words = healOpposites(out.words || []);
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
function compatible(a,b) {
  if (!a || !b) return false;
  if (norm(a.word)===norm(b.word)) return false;
  return !(Array.isArray(a.excludeFromSameOptionsWith)?a.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(b.word)) && !(Array.isArray(b.excludeFromSameOptionsWith)?b.excludeFromSameOptionsWith:[]).some(x=>norm(x)===norm(a.word));
}
function optionWords(targets, words, count=4, rng=Math.random) {
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
  const ranked = shuffleCopy(words,rng).map(w=>({w,rank:Math.max(...chosen.map(t=>(confusable(t,w)?150:confusable(w,t)?120:0)+(t.distractorGroup && t.distractorGroup===w.distractorGroup?100:0)+(t.learningData?.cluster && t.learningData.cluster===w.learningData?.cluster?40:0)+(t.type===w.type?10:0)+(topic(t.category)===topic(w.category)?5:0)))})).sort((a,b)=>b.rank-a.rank);
  for(const {w} of ranked) {
    if(chosen.length>=count) break;
    // Identical definitions are known alternatives; semantic synonyms require author review/exclusions.
    if(chosen.every(t=>compatible(t,w) && norm(t.meaning)!==norm(w.meaning))) chosen.push(w);
  }
  return shuffleCopy(chosen,rng);
}
function validateContent(data, existing={}) {
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
    if('id' in w)err(`${p}.id`,'words use word as key, not id');
    for(const k of ['opposite','chainGroup','distractorGroup','plainForm'])if(w[k]!==undefined)text(w[k],`${p}.${k}`);
    if(w.opposite && norm(w.opposite)!=='none')refs([w.opposite],`${p}.opposite`);
    if(w.excludeFromSameOptionsWith!==undefined)refs(w.excludeFromSameOptionsWith,`${p}.excludeFromSameOptionsWith`,0);
    if(w.hints!==undefined){if(!Array.isArray(w.hints))err(`${p}.hints`,'expected array');else w.hints.forEach((h,j)=>text(h,`${p}.hints[${j}]`));}
    for(const [f,ks] of [['transformExample',['before','after']],['commonMistake',['sentence','correction','why']]])if(w[f]!==undefined){if(!obj(w[f]))err(`${p}.${f}`,'expected object');else ks.forEach(k=>text(w[f][k],`${p}.${f}.${k}`));}
    if(w.transformExample&&!['phrasal','fyi'].includes(w.type))err(`${p}.transformExample`,'only phrasal/fyi');
    if(w.sentenceBuild!==undefined){const b=w.sentenceBuild;if(!obj(b)){err(`${p}.sentenceBuild`,'expected object');return;}text(b.modelAnswer,`${p}.sentenceBuild.modelAnswer`);if(!Array.isArray(b.tokens)||!b.tokens.length||b.tokens.some(t=>typeof t!=='string'||!t.trim()))err(`${p}.sentenceBuild.tokens`,'expected non-empty string tokens');else if(sentence(b.tokens.join(' '))!==sentence(b.modelAnswer))err(`${p}.sentenceBuild.tokens`,'ordered tokens must match modelAnswer; spaces before punctuation are ignored');if(b.constraints!==undefined && typeof b.constraints!=='string' && !(Array.isArray(b.constraints)&&b.constraints.every(x=>typeof x==='string')))err(`${p}.sentenceBuild.constraints`,'expected text or text array');}
  });
  (data.grammar||[]).forEach((g,i)=>{const p=`grammar[${i}]`;for(const k of ['category','rule','prompt','answer','explanation'])text(g[k],`${p}.${k}`);if(!Array.isArray(g.options)||g.options.length<2||g.options.some(o=>typeof o!=='string'||!o.trim()))err(`${p}.options`,'expected at least two strings');else {if(new Set(g.options.map(norm)).size!==g.options.length)err(`${p}.options`,'duplicate options');if(!g.options.some(o=>norm(o)===norm(g.answer)))err(`${p}.answer`,'answer missing from options');}});
  (data.puns||[]).forEach((g,i)=>['category','word','joke','pair'].forEach(k=>text(g[k],`puns[${i}].${k}`)));
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
function makeQuestion(w,mode,words,rng=Math.random,difficulty=1) {
  const q={id:`${w.word}:${mode}`,mode,targets:[w.word],hints:w.hints||[],explanation:w.meaning,type:'mcq',answers:[w.word],difficulty};
  if(mode==='transform')return {...q,type:'typing',prompt:`Use “${w.word}” to rewrite: ${w.transformExample.before}`,answers:[w.transformExample.after],explanation:w.transformExample.after,modelOnly:true};
  if(mode==='order')return {...q,type:'order',prompt:`Build the sentence using “${w.word}”.`,tokens:shuffleCopy(w.sentenceBuild.tokens.map((text,id)=>({text,id})),rng),answers:[w.sentenceBuild.modelAnswer],constraints:w.sentenceBuild.constraints,explanation:w.sentenceBuild.modelAnswer};
  if(mode==='typing')return {...q,type:'typing',prompt:w.meaning};
  if(mode==='gapTyping')return {...q,type:'typing',prompt:w.gap};
  q.prompt=mode==='meaning'?w.word:mode==='reverse'?w.meaning:mode==='gap'?w.gap:w.situation;
  const choices=optionWords([w],words,difficulty>=3?(mode==='meaning'?5:6):4,rng);
  q.options=choices.map(x=>mode==='meaning'?x.meaning:x.word);
  if(mode==='meaning')q.answers=[w.meaning];
  if(q.options.length<2)return null;
  if(mode!=='meaning' && norm(q.prompt).includes(norm(w.word)))return null;
  return q;
}
function activityQuestion(q,words,id,rng=Math.random){
  const targets=(q.mode==='multi'?q.targetWords:[q.targetWord]).map(x=>findWord(words,x)?.word||x);
  const out={...q,id,targets,answers:targets,type:q.mode==='typing'?'typing':q.mode==='multi'?'multi':'mcq',hints:[]};
  if(out.type!=='typing'){out.options=optionWords(targets,words,Math.max(4,targets.length+1),rng).map(w=>w.word);if(out.options.length<=targets.length)throw Error(`${id}: not enough safe distractors`);}
  return out;
}
function practice(content,mastery={},category=null,rng=Math.random,quarantine=null,opts={}){
  const isQuarantined=(word,mode)=>!!quarantine&&quarantine.has(`${String(word).trim().toLowerCase()}|${mode}`);
  const pools=opts.pools||{};
  const questionsPerRound=Math.max(4,opts.questionsPerRound||12);
  const newWordsPerRound=Math.max(0,opts.newWordsPerRound??3);
  const now=Date.now();
  const source=content.words.filter(w=>!category||topic(w.category)===topic(category));
  // Review-first: when the overdue backlog is large, due words from EVERY
  // category come before this level's own words, and new words are held
  // back. dueOnly builds a pure cross-category review round.
  const dueAll=(opts.dueFirst||opts.dueOnly)?content.words.filter(w=>{const s=mastery[w.word];return known(s)&&s.nextReviewAt&&s.nextReviewAt<=now;}).sort((a,b)=>(mastery[a.word].nextReviewAt||0)-(mastery[b.word].nextReviewAt||0)):[];
  const dueSet=new Set(dueAll.map(w=>w.word));
  const fresh=opts.dueOnly?[]:shuffleCopy(source.filter(w=>!known(mastery[w.word])),rng).slice(0,dueAll.length>=questionsPerRound?0:newWordsPerRound);
  // Known words are picked in rotation. Due words and words missed last time
  // come first. A word answered correctly and not yet due goes to the back
  // of the line (least recently reviewed first), so it doesn't return until
  // the rest of the pool has had a turn. The old priority treated every
  // non-Mastered word the same whether or not it was due, so in a small
  // category the same just-answered words were picked every session.
  const old=[...dueAll,...shuffleCopy(source.filter(w=>known(mastery[w.word])&&!dueSet.has(w.word)),rng).sort((a,b)=>priority(a)-priority(b)||lastSeen(a)-lastSeen(b))];
  function priority(w){const s=mastery[w.word]||{};if(s.nextReviewAt&&s.nextReviewAt<=now)return 0;if(s.lastResult&&s.lastResult!=='correct')return 0;return stage(s)==='Mastered'?2:1;}
  function lastSeen(w){return mastery[w.word]?.lastReviewedAt||0;}
  const oldCount=Math.max(questionsPerRound-newWordsPerRound,questionsPerRound-fresh.length);
  const chosen=[...old.slice(0,oldCount),...fresh];const candidates=[];
  for(const w of chosen){const s=mastery[w.word]||{};const st=stage(s);
    // Familiar words already get one production chance (gapTyping) once they
    // have a correct answer, so typing evidence starts before 'Learned'.
    let modes=st==='New'?['meaning','reverse']:st==='Familiar'?['reverse','gap','situation',...((s.correct||0)>=1?['gapTyping']:[])]:['typing','gapTyping','reverse','gap','situation'];
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
    if(known(s)&&w.commonMistake&&!isQuarantined(w.word,'grammarCourt'))candidates.push({id:`${w.word}:court`,mode:'grammarCourt',type:'mcq',prompt:`Choose the correct sentence. Context: ${w.situation}`,targets:[w.word],answers:[w.commonMistake.correction],options:shuffleCopy([w.commonMistake.sentence,w.commonMistake.correction],rng),explanation:w.commonMistake.why});
    for(const mode of modes){if(mode.includes('gap')&&!/_{2,}/.test(w.gap))continue;const q=makeQuestion(w,mode,content.words,rng,difficulty);if(q)candidates.push(q);}
  }
  // Combos and impostor challenges get their OWN spaced-repetition record
  // (progressKey, same trick the grammar loop below already uses) instead
  // of a flat 20%-chance reappearance. Once answered correctly, the real
  // 1/3/7/14/30-day schedule (from sessionEvidence) pushes it further away
  // each time — same as normal vocabulary — rather than gambling on every
  // single session regardless of how many times it's been gotten right.
  for(const c of content.combos||[])if((!category||topic(c.category)===topic(category))&&c.words.every(w=>known(mastery[findWord(content.words,w)?.word]))&&!c.words.some(w=>isQuarantined(w,'multi'))){const comboKey=`combo:${c.id}`;const comboStats=mastery[comboKey];const due=!comboStats||!comboStats.nextReviewAt||comboStats.nextReviewAt<=Date.now();if(due){const item=pickPoolVariant(pools,comboKey,{situation:c.situation,prompt:c.prompt});try{candidates.push(activityQuestion({mode:'multi',targetWords:c.words,prompt:`${item.situation}\n${item.prompt}`,explanation:c.explanation,progressKey:comboKey,poolType:'combo',poolItemId:item.id},content.words,`combo:${c.id}:${item.id}`,rng));}catch{}}}
  for(const c of content.challenges||[])if(['impostor','reverseImpostor'].includes(c.type||c.mode)&&!c.steps&&c.options?.length>=2&&c.answer&&(!category||topic(c.category)===topic(category))){const targets=(c.linkedWords||[]).filter(w=>norm(w)===norm(c.answer));if(targets.length&&targets.every(w=>['Learned','Mastered'].includes(stage(mastery[w])))&&!targets.some(w=>isQuarantined(w,'impostor'))){const challengeKey=`challenge:${c.id}`;const challengeStats=mastery[challengeKey];const due=!challengeStats||!challengeStats.nextReviewAt||challengeStats.nextReviewAt<=Date.now();if(due){const refs=c.options.map(o=>findWord(content.words,o)).filter(Boolean);if(refs.every((a,i)=>refs.slice(i+1).every(b=>compatible(a,b))))candidates.push({id:`challenge:${c.id}`,mode:'impostor',type:'mcq',targets,progressKey:challengeKey,prompt:c.prompt,answers:[c.answer],options:shuffleCopy(c.options,rng),explanation:c.explanation});}}}
  // Grammar: same "fresh example after mastery" idea as combos above —
  // pick whichever variant (seed or AI-generated) is least-attempted and
  // not on cooldown, instead of always the one static authored example.
  for(const g of shuffleCopy(content.grammar||[],rng).filter(g=>!category||topic(g.category)===topic(category)).slice(0,1)){const grammarKey=`grammar:${g.id}`;const item=pickPoolVariant(pools,grammarKey,{prompt:g.prompt,options:g.options,answer:g.answer,explanation:g.explanation});candidates.push({id:`grammar:${g.id}:${item.id}`,mode:'grammarCourt',type:'mcq',prompt:item.prompt,answers:[item.answer],options:shuffleCopy(item.options,rng),targets:[],progressKey:grammarKey,poolType:'grammar',poolItemId:item.id,explanation:item.explanation});}
  const queue=[],counts={}, weights={meaning:3,reverse:3,gap:3,gapTyping:3,situation:2,typing:3,order:2,transform:2,multi:1,grammarCourt:1};
  // Introductions are separate cards. Last introduced word is never the first test.
  const lastIntro=fresh.at(-1)?.word;
  const usedWords=new Set();
  while(queue.length<questionsPerRound&&candidates.length){
    const eligible=candidates.map((q,i)=>({q,i})).filter(({q})=>!(queue.length===0&&q.targets.includes(lastIntro)) && !queue.slice(-2).some(p=>p.targets.some(t=>q.targets.includes(t))) && !(queue.length>=2&&queue.slice(-2).every(p=>p.mode===q.mode)));
    if(!eligible.length)break;
    eligible.sort((a,b)=>{
      const aFresh=a.q.targets.some(t=>!usedWords.has(t))?0:1;
      const bFresh=b.q.targets.some(t=>!usedWords.has(t))?0:1;
      if(aFresh!==bFresh)return aFresh-bFresh;
      return ((counts[a.q.mode]||0)/(weights[a.q.mode]||1))-((counts[b.q.mode]||0)/(weights[b.q.mode]||1));
    });
    const {q,i}=eligible[0];queue.push(q);counts[q.mode]=(counts[q.mode]||0)+1;q.targets.forEach(t=>usedWords.add(t));candidates.splice(i,1);
  }
  return {kind:'practice',id:`session-${Date.now()}-${rng()}`,title:opts.dueOnly?'Due Review':category||'Practice',reviewFirst:!!(opts.dueFirst&&dueAll.length),dueCount:dueAll.length,queue,introductions:fresh,index:0,answers:[],initialLength:queue.length,targetLength:questionsPerRound,reserves:candidates,extraAdded:false};
}
function storySession(story,words,mastery={},rng=Math.random){const introductions=story.targetWords.map(w=>findWord(words,w)).filter(w=>!known(mastery[w.word]));const scoped=story.sourceCategories?.length?words.filter(w=>story.sourceCategories.includes(w.category)):words;const optionSource=scoped.length>=4?scoped:words;const queue=story.questions.map((q,i)=>activityQuestion(q,optionSource,`${story.id}:${i}`,rng));for(const g of story.grammarQuestions||[])queue.push({...g,options:shuffleCopy(g.options,rng)});return {id:`story-${story.id}-${Date.now()}`,sourceStoryId:story.id,kind:'story',title:story.title,text:story.text,queue,introductions,unfairTargets:introductions.map(w=>w.word),index:0,answers:[]};}
function chainSession(group,words,mastery={},rng=Math.random){const queue=shuffleCopy(words.filter(w=>w.chainGroup===group&&w.opposite&&known(mastery[w.word])&&known(mastery[findWord(words,w.opposite)?.word])),rng).map((w,i)=>{const target=findWord(words,w.opposite);if(!target)return null;const options=optionWords([target],words,4,rng).map(x=>x.word);return options.length<2?null:{id:`chain:${i}`,mode:'opposite',type:'mcq',prompt:`What is the opposite of “${w.word}”?`,answers:[target.word],targets:[target.word],options,explanation:`${w.word} ↔ ${target.word}`};}).filter(Boolean);return {id:`chain-${Date.now()}`,kind:'chain',title:group,queue,introductions:[],index:0,answers:[]};}
function grade(q,value,words=[]){const a=Array.isArray(value)?value:[value];const correct=a.length===q.answers.length&&q.answers.every(x=>a.some(v=>sentence(v)===sentence(x)));let spelling=false;if(!correct&&q.type==='typing'&&!q.modelOnly&&!findWord(words,value)){const x=norm(value),y=norm(q.answers[0]);if(x.length>=3){const d=Array.from({length:x.length+1},(_,i)=>[i]);for(let j=0;j<=y.length;j++)d[0][j]=j;for(let i=1;i<=x.length;i++)for(let j=1;j<=y.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(x[i-1]!==y[j-1]));spelling=d[x.length][y.length]<=1;}}return {correct,spelling,unverified:!correct&&q.modelOnly};}
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
    const sessions=[...new Set([...(s.independentSessions||[]),...(ok?[session.id]:[])])];
    const spellingMisses=results.filter(a=>a.spelling).length;
    const lastResult=ok?'correct':spellingMisses?'spelling':results.some(a=>a.assisted)?'assisted':'wrong';
    const modes={...(s.modes||{})};
    const recent=[...(s.recentResults||[])];
    results.forEach(result=>{
      const modeId=result.type==='order'?'order':result.mode;
      const previous=modes[modeId]||{};
      const correct=!!result.correct&&!result.assisted;
      modes[modeId]={...previous,total:(previous.total||0)+1,correct:(previous.correct||0)+(correct?1:0),spellingMisses:(previous.spellingMisses||0)+(result.spelling?1:0),lastResult:correct?'correct':result.spelling?'spelling':result.assisted?'assisted':'wrong',lastDifficulty:result.difficulty||1};
      recent.push({correct,modeId,difficulty:result.difficulty||1,at:now,spelling:!!result.spelling});
    });
    const record={...s,everMastered:s.everMastered===true||stage(s)==='Mastered',evidenceV2:true,correct:(s.correct||0)+(ok?1:0),total:(s.total||0)+1,modes,productionCorrect:(s.productionCorrect||0)+(ok&&recall?1:0),productionAttempts:(s.productionAttempts||0)+(results.some(a=>a.type==='typing')?1:0),assistedAttempts:(s.assistedAttempts||0)+results.filter(a=>a.assisted).length,spellingMisses:(s.spellingMisses||0)+spellingMisses,aiEvaluatedAttempts:(s.aiEvaluatedAttempts||0)+results.filter(a=>a.aiEvaluated).length,independentSessions:sessions,appliedSessions:[...(s.appliedSessions||[]),session.id],lastReviewedAt:now,nextReviewAt:now+[1,3,7,14,30][step]*86400000,reviewStep:step,lastResult,recentResults:recent.slice(-8),regressionStrikes:s.everMastered?(ok?Math.max(0,(s.regressionStrikes||0)-1):(s.regressionStrikes||0)+1):(s.regressionStrikes||0)};
    if(stage(record)==='Mastered')record.everMastered=true;
    next[key]=record;
  }
  return next;
}
function reinforcement(s){if(s.extraAdded||s.kind!=='practice')return s;const wrong=s.queue.filter((q,i)=>s.answers[i]&&!s.answers[i].correct&&!s.answers[i].reported).flatMap(q=>q.targets);const added=[];for(const q of s.reserves||[]){if(added.length>=2)break;if(!q.targets.some(t=>wrong.includes(t)))continue;if([...s.queue,...added].slice(-2).some(p=>p.targets.some(t=>q.targets.includes(t))))continue;added.push(q);}return {...s,queue:[...s.queue,...added],extraAdded:true};}

return { norm, sentence, shuffleCopy, topic, fields, mergeContent, contentOnly, findWord, compatible, optionWords, validateContent, known, stage, activityQuestion, practice, storySession, chainSession, grade, sessionEvidence, reinforcement };
})();

// Pronunciation: two independent sources, tried in order.
//  1. dictionaryapi.dev — free, no key, returns real human-recorded audio.
//     May be blocked by a strict sandbox CSP, so failure is expected and fine.
//  2. The browser's built-in speechSynthesis — works fully offline with no
//     external request at all, so it is the reliable floor.
// YouGlish stays available only as an external link: its widget needs a
// third-party <script>, which this sandbox blocks outright.
const audioCache = new Map();
async function fetchWordAudio(term) {
  const key = String(term || "").trim().toLowerCase();
  if (!key) return null;
  if (audioCache.has(key)) return audioCache.get(key);
  // Only single words have dictionary entries; phrases go straight to TTS.
  if (/\s/.test(key)) { audioCache.set(key, null); return null; }
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`);
  const data = await res.json();
  // dictionaryapi.dev names its files by accent: word-us.mp3, word-uk.mp3,
  // word-au.mp3. Take the US one whenever it exists; only fall back to
  // another accent if there is no American recording at all, and say so in
  // the UI rather than passing it off as American.
  const urls = (Array.isArray(data) ? data : [])
    .flatMap((entry) => entry?.phonetics || [])
    .map((p) => p?.audio)
    .filter((a) => typeof a === "string" && a.trim());
  const us = urls.find((a) => /-us\.(mp3|ogg|wav)/i.test(a));
  const url = us || urls[0] || null;
  const result = url ? { url, isUS: !!us } : null;
  audioCache.set(key, result);
  return result;
}
// Setting utterance.lang alone is only a hint — browsers often keep whatever
// voice is default (frequently en-GB). Pick an explicitly en-US voice when
// the device has one, and report back which accent actually got used.
function pickUSVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((v) => v.lang === "en-US" || v.lang === "en_US")
    || voices.find((v) => /^en[-_]US/i.test(v.lang || ""))
    || null;
}
function speakWithBrowser(term) {
  if (typeof window === "undefined" || !window.speechSynthesis) throw new Error("No speech support in this browser.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(term));
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  const voice = pickUSVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return !!voice;
}
// Shows an image, but never fails silently: if the browser can't load it
// (broken link, or this sandbox blocking the domain — the same class of
// restriction that blocks the YouGlish script), it says so visibly with a
// direct link to check, instead of just vanishing with no trace.
function SmartImage({ src, className }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (failed) return <p className="wh-img-blocked">Image didn't load here (broken link, or blocked by this sandbox). <a href={src} target="_blank" rel="noopener noreferrer">Open it directly to check →</a></p>;
  return <img src={src} alt="" className={className} onError={() => setFailed(true)} />;
}
function PronunciationModal({ term, onClose }) {
  const [status, setStatus] = useState("loading"); // loading | human | ttsOnly
  const [audioUrl, setAudioUrl] = useState(null);
  const [isUS, setIsUS] = useState(false);
  const [ttsIsUS, setTtsIsUS] = useState(false);
  const audioRef = useRef(null);
  const speak = () => { try { setTtsIsUS(speakWithBrowser(term)); } catch (e) { /* no speech support */ } };
  useEffect(() => {
    let cancelled = false;
    // Voice list loads asynchronously in most browsers; without this the
    // first call can run before any en-US voice is known.
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.getVoices();
    fetchWordAudio(term)
      .then((found) => {
        if (cancelled) return;
        if (found?.url) { setAudioUrl(found.url); setIsUS(found.isUS); setStatus("human"); }
        else { setStatus("ttsOnly"); speak(); }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("ttsOnly");
        speak();
      });
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [term]);
  // Autoplay the human recording once it is available. Browsers can refuse
  // autoplay without a user gesture, so the visible Play button stays the
  // guaranteed path.
  useEffect(() => { if (status === "human" && audioRef.current) audioRef.current.play().catch(() => {}); }, [status, audioUrl]);
  const youglishUrl = `https://youglish.com/pronounce/${encodeURIComponent(term)}/english/us`;
  const accentNote = status === "human"
    ? (isUS ? "American recording" : "Non-US accent — no American recording found")
    : status === "ttsOnly"
      ? (ttsIsUS ? "Browser voice · American" : "Browser voice · no US voice on this device")
      : "Searching…";
  return <div className="wh-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="wh-panel wh-say-panel" role="dialog" aria-label={`Pronunciation of ${term}`}>
      <div className="wh-say-head">
        <div>
          <div className="wh-say-label">PRONUNCIATION</div>
          <h2 className="wh-say-term">{term}</h2>
        </div>
        <button className="wh-icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>
      </div>

      <div className={`wh-say-badge ${status === "human" && isUS ? "is-us" : status === "loading" ? "is-loading" : "is-soft"}`}>
        <Volume2 size={12}/> {accentNote}
      </div>

      {status === "loading" && <div className="wh-say-body"><p className="wh-say-muted">Looking for an American recording…</p></div>}

      {status === "human" && <div className="wh-say-body">
        <audio ref={audioRef} src={audioUrl} controls className="wh-say-audio"/>
        <button className="wh-say-secondary" onClick={speak}><Volume2 size={12}/> Computer voice instead</button>
      </div>}

      {status === "ttsOnly" && <div className="wh-say-body">
        <button className="wh-say-play" onClick={speak}><Volume2 size={16}/> Play</button>
        {!ttsIsUS && <p className="wh-say-muted">No American voice is installed on this device, so the accent may differ.</p>}
      </div>}

      <a className="wh-say-link" href={youglishUrl} target="_blank" rel="noopener noreferrer">Hear real Americans say it on YouGlish →</a>
    </div>
  </div>;
}
// Embedded shared answer controls for all new sessions.
const SessionView = (() => {
const { grade, sentence, reinforcement } = V2;

// One answer control for Practice, Stories and Chains. The draft lives in player state.
function AnswerControl({q,draft={},onChange,disabled,onSubmit}){
  const selected=draft.selected||[];
  if(q.type==='order'){
    const ids=draft.tokenIds||[], tokens=q.tokens||[];
    return <><div className="wh-v2-tokens" aria-label="Your sentence">{ids.map(id=>{const t=tokens.find(t=>t.id===id);return <button disabled={disabled} key={id} onClick={()=>onChange({...draft,tokenIds:ids.filter(x=>x!==id)})}>{t?.text}</button>;})}</div><div className="wh-v2-tokens">{tokens.filter(t=>!ids.includes(t.id)).map(t=><button disabled={disabled} key={t.id} onClick={()=>onChange({...draft,tokenIds:[...ids,t.id]})}>{t.text}</button>)}</div>{q.constraints&&<p>{Array.isArray(q.constraints)?q.constraints.join(' · '):q.constraints}</p>}</>;
  }
  if(q.type==='typing'&&q.modelOnly)return <textarea autoFocus className="wh-v2-input wh-v2-long-answer" aria-label="Your answer" disabled={disabled} value={draft.text||''} onChange={e=>onChange({...draft,text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();if(!disabled&&(draft.text||'').trim())onSubmit?.();}}} placeholder="Write your answer… (Ctrl + Enter to submit)"/>;
  if(q.type==='typing')return <input autoFocus className="wh-v2-input" aria-label="Your answer" autoComplete="off" spellCheck={false} disabled={disabled} value={draft.text||''} onChange={e=>onChange({...draft,text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(!disabled&&(draft.text||'').trim())onSubmit?.();}}} placeholder={`Type your answer… (or "${DONT_KNOW_TOKEN}" if you don't know)`}/>;
  return <div className="wh-options">{(q.options||[]).map((opt,index)=><button type="button" className={`wh-option ${selected.includes(opt)?'picked':''}`} aria-pressed={selected.includes(opt)} key={opt} disabled={disabled} onClick={()=>onChange({...draft,selected:q.type==='multi'?(selected.includes(opt)?selected.filter(x=>x!==opt):selected.length<q.answers.length?[...selected,opt]:selected):[opt]})}><span className="wh-shortcut-key" aria-hidden="true">{index+1}</span>{opt}</button>)}</div>;
}
// Click a word inside a story/prompt to get a small floating toolbar with
// "Explain with AI" — avoids needing a drag-select gesture (which doesn't
// work well on mobile and gave no feedback on a plain tap).
function AskableText({ text, onAskWord, onListen, className }) {
  const [toolbar, setToolbar] = useState(null); // { word, left, top }
  const containerRef = useRef(null);
  const tokens = String(text || "").split(/(\s+)/);
  useEffect(() => {
    if (!toolbar) return;
    const close = (e) => { if (!containerRef.current || !containerRef.current.contains(e.target)) setToolbar(null); };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("touchstart", close, true);
    return () => { window.removeEventListener("mousedown", close, true); window.removeEventListener("touchstart", close, true); };
  }, [toolbar]);
  function handleWordClick(e, raw) {
    const word = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
    if (!word) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setToolbar({ word, left: rect.left - containerRect.left + rect.width / 2, top: rect.top - containerRect.top });
  }
  return (
    <span className={`wh-askable ${className || ""}`} ref={containerRef}>
      {tokens.map((tok, i) => (/^\s*$/.test(tok) ? tok : (
        <span key={i} className="wh-askable-word" onClick={(e) => handleWordClick(e, tok)}>{tok}</span>
      )))}
      {toolbar && (
        <span className="wh-ask-toolbar" style={{ left: toolbar.left, top: toolbar.top }}>
          <button onClick={() => { onAskWord?.(toolbar.word); setToolbar(null); }}><Sparkles size={12} /> Explain with AI</button>
          {onListen && <button onClick={() => { onListen(toolbar.word); setToolbar(null); }}><Volume2 size={12} /> Listen</button>}
        </span>
      )}
    </span>
  );
}
const REPORT_REASONS=["Wrong or missing correct answer","My answer should've been accepted","Confusing or unclear wording","Typo or grammar mistake","Distractors too easy/obvious"];
// Typed as an honest "I don't know" instead of a guess — skips the AI
// double-check (no point asking AI to judge a non-answer) and is graded
// wrong immediately, same as leaving it blank would be if that were allowed.
const DONT_KNOW_TOKEN="-";
function SessionView({session:s,onChange,onFinish,onBack,words,onIntroduce,onReport,onReviewReport,onWithdrawReport,onUpdateWord,onResult,onAskWord}){
  const [reviewOpen,setReviewOpen]=useState(false);
  const [aiChecking,setAiChecking]=useState(false);
  const [cardIndex,setCardIndex]=useState(0);
  const [flipped,setFlipped]=useState(false);
  const [regenState,setRegenState]=useState(null);
  const [reportOpen,setReportOpen]=useState(false);
  const [youglishTerm,setYouglishTerm]=useState(null);
  const [reportReason,setReportReason]=useState("");
  // After submit the modal stays open to show the AI's verdict:
  // {report, prior (the answer slot before reporting), index, status:'reviewing'|'done'|'failed', review}
  const [reportReview,setReportReview]=useState(null);
  const continueRef=useRef(null);
  const result=s?.answers?.[s.index];
  useEffect(()=>{if(result){continueRef.current?.scrollIntoView({behavior:'smooth',block:'end'});continueRef.current?.focus();}},[result,s?.index]);
  const save=patch=>s&&onChange({...s,...patch});
  const q=s?.queue?.[s.index];const draft=s?.draft||{};
  // Only shown after a correct answer — by then the word is already known,
  // so an image here is a reward/reinforcement, never a hint toward it.
  const correctImage=result?.correct&&!result.reported?V2.findWord(words,q?.targets?.[0])?.image:null;
  useEffect(()=>{
    function handleKeyboard(event){
      if(!q||event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey)return;
      const tag=event.target?.tagName?.toLowerCase();
      const editing=tag==='input'||tag==='textarea'||event.target?.isContentEditable;
      if(editing)return;
      if(result&&event.key==='Enter'){
        if(event.target===continueRef.current)return;
        event.preventDefault();next();return;
      }
      if(result)return;
      if(/^[1-9]$/.test(event.key)&&q.type!=='typing'&&q.type!=='order'){
        const option=q.options?.[Number(event.key)-1];if(!option)return;
        event.preventDefault();
        const picked=draft.selected||[];
        save({draft:{...draft,selected:q.type==='multi'?(picked.includes(option)?picked.filter(x=>x!==option):picked.length<q.answers.length?[...picked,option]:picked):[option]}});
        return;
      }
      const readyNow=q.type==='typing'?!!draft.text?.trim():q.type==='order'?(draft.tokenIds||[]).length===q.tokens.length:(draft.selected||[]).length===q.answers.length;
      if(event.key==='Enter'&&readyNow){event.preventDefault();submit();}
      if(event.key==='Escape'){event.preventDefault();onBack();}
    }
    window.addEventListener('keydown',handleKeyboard);
    return()=>window.removeEventListener('keydown',handleKeyboard);
  },[q,result,draft,s?.index]);
  if(!s)return null;
  if(!s.introduced && s.introductions?.length){
    const intro=s.introductions;const w=intro[Math.min(cardIndex,intro.length-1)];const isLast=cardIndex>=intro.length-1;
    async function handleRegenerate(){
      setRegenState('loading');
      try{
        const result=await regenerateWordExplanation(w);
        setRegenState(result);
      }catch(e){
        console.error('Word Hunter: regenerate failed',e);
        setRegenState('error');
      }
    }
    function useRegenerated(){
      const patch={meaning:regenState.meaning,situation:regenState.situation};
      const newIntro=intro.map((x,i)=>i===cardIndex?{...x,...patch}:x);
      save({introductions:newIntro});
      onUpdateWord?.(w.word,patch);
      setRegenState(null);
    }
    return <section className="wh-panel">
      <h2>Meet {intro.length} new words</h2>
      <p>Learning cards do not count as correct answers. {s.kind==='story'?'These new words will not receive mastery credit in this story.':''}</p>
      <div className="wh-flashcard-progress">Word {cardIndex+1} of {intro.length} — tap the card to flip</div>
      <div className={`wh-flashcard ${flipped?'flipped':''}`} onClick={()=>setFlipped(f=>!f)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFlipped(f=>!f);}}}>
        {!flipped?<div className="wh-flashcard-front"><SmartImage src={w.image} className="wh-flashcard-img"/><h3>{w.word}</h3><p className="wh-flashcard-hint">Tap to reveal meaning &amp; example</p></div>
        :<div className="wh-flashcard-back"><SmartImage src={w.image} className="wh-flashcard-img"/><h3>{w.word}{w.partsOfSpeech?.length>0&&<span className="wh-pos-tag">{w.partsOfSpeech.join(" / ")}</span>}</h3><p><b>Meaning:</b> {w.meaning}</p><p><b>Situation:</b> {w.situation}</p>{w.example&&<p><b>Example:</b> {w.example}</p>}{w.plainForm&&<p>Plain form: {w.plainForm}</p>}</div>}
      </div>
      {flipped&&<div className="wh-regen-area">
        {!regenState&&<button className="wh-back-btn wh-nav-btn" onClick={handleRegenerate}>Regenerate meaning &amp; example</button>}
        {regenState==='loading'&&<p className="wh-regen-status">Generating a new version…</p>}
        {regenState==='error'&&<p className="wh-regen-status error">Couldn't generate a new version. <button className="wh-back-btn wh-nav-btn" onClick={handleRegenerate}>Try again</button></p>}
        {regenState&&typeof regenState==='object'&&<div className="wh-regen-preview">
          <p className="wh-regen-label">New version:</p>
          <p><b>Meaning:</b> {regenState.meaning}</p>
          <p><b>Situation:</b> {regenState.situation}</p>
          <div className="wh-regen-actions">
            <button className="wh-level-btn" onClick={useRegenerated}>Use this</button>
            <button className="wh-back-btn wh-nav-btn" onClick={()=>setRegenState(null)}>Discard</button>
          </div>
        </div>}
      </div>}
      <div className="wh-flashcard-nav">
        <button className="wh-back-btn wh-nav-btn" disabled={cardIndex===0} onClick={()=>{setCardIndex(i=>Math.max(0,i-1));setFlipped(false);setRegenState(null);}}>← Previous</button>
        {!isLast?<button className="wh-level-btn" onClick={()=>{setCardIndex(i=>i+1);setFlipped(false);setRegenState(null);}}>Next word →</button>
        :<button className="wh-level-btn" onClick={()=>{onIntroduce(intro);save({introduced:true});}}>Continue</button>}
      </div>
      <button className="wh-back-btn wh-nav-btn" onClick={onBack}>Save and leave</button>
    </section>;
  }
  if(s.index>=s.queue.length){
    const extra=s.kind==='practice'&&!s.extraAdded?V2.reinforcement(s):s;
    const correct=s.answers.filter(a=>a.correct).length;
    const total=s.queue.length;
    const pct=total?Math.round(correct/total*100):0;
    const isSolved=s.kind==='story'&&s.sourceStoryId;
    return <section className="wh-panel">
      {isSolved&&<div className="wh-story-solved-banner"><CheckCircle2 size={22}/> <span>Story solved!</span></div>}
      <h2>{s.kind==='story'?s.title||'Story complete':'Session complete'}</h2>
      <p className="wh-session-score">{correct} / {total} correct ({pct}%) · {s.answers.filter(a=>a.assisted).length} assisted</p>
      {isSolved&&<p className="wh-session-score-sub">{pct>=80?'Excellent work — you really know these words!':pct>=60?'Good job — keep practising the ones you missed.':'Keep going — re-read the story and try again soon.'}</p>}
      {s.queue.length===0&&<p>No safe spaced questions are available yet. Your learning cards are saved. Return for practice later.</p>}
      <button className="wh-level-btn" onClick={()=>{onFinish(s);setReviewOpen(true);}}>Save results &amp; review</button>
      {extra.queue.length>s.queue.length&&!reviewOpen&&<button className="wh-level-btn" onClick={()=>onChange(extra)}>Add {extra.queue.length-s.queue.length} reinforcement questions ({extra.queue.length} total)</button>}
      {(reviewOpen||s.completed)&&s.queue.map((q,i)=><article key={q.id} className="wh-v2-learn"><strong>{i+1}. {q.prompt}</strong><p>Your answer: {s.answers[i]?.dontKnow?"Didn't know":Array.isArray(s.answers[i]?.value)?s.answers[i].value.join(' + '):s.answers[i]?.value||'Reported / skipped'}</p><p>{q.modelOnly?'Model answer (other valid sentences may exist)':'Answer'}: {q.answers.join(' + ')}</p><p>{q.explanation}</p></article>)}
      <button className="wh-back-btn wh-nav-btn wh-session-back" onClick={()=>{onFinish(s);onBack();}}>Back</button>
    </section>;
  }
  async function submit(){
    if(aiChecking)return;
    let value=q.type==='typing'?draft.text||'':q.type==='order'?(draft.tokenIds||[]).map(id=>q.tokens.find(t=>t.id===id)?.text).join(' '):draft.selected||[];
    const dontKnow=q.type==='typing'&&String(value).trim()===DONT_KNOW_TOKEN;
    const objectiveCorrect=q.objectiveTerms?.length?q.objectiveTerms.every(term=>sentence(value).includes(sentence(term))):null;
    const base={...(objectiveCorrect===null?grade(q,value,words):{correct:objectiveCorrect,spelling:false,unverified:false}),value,assisted:(draft.hints||0)>0};
    if(dontKnow){
      // Honest "don't know" — never a real answer, so never worth an AI
      // call; grade() may have set unverified for modelOnly questions, so
      // force it back to a plain, final wrong result.
      const answers=[...s.answers];
      const finalResult={...base,correct:false,unverified:false,dontKnow:true};
      answers[s.index]=finalResult;
      onResult?.(q,finalResult,s);
      save({answers});
      return;
    }
    if(base.unverified && q.modelOnly){
      setAiChecking(true);
      try{
        const targetWord=V2.findWord(words,q.targets?.[0]);
        const evaluation=await evaluateFreeForm({freeformKind:q.freeformKind||'sentence',target:{word:q.targets?.[0],meaning:targetWord?.meaning,situation:targetWord?.situation},answer:q.answers[0]},value);
        const targetRequired=q.freeformKind!=='idiomMeaning';
        const genuine=evaluation.correct&&(!targetRequired||evaluation.targetWordUsed)&&evaluation.semanticUse==='correct';
        const aiClose=!genuine&&evaluation.semanticUse==='partly_correct'&&evaluation.naturalness!=='nonsense';
        const answers=[...s.answers];
        const finalResult={...base,correct:genuine,unverified:false,aiEvaluated:true,aiClose,aiFeedback:evaluation.feedback};
        answers[s.index]=finalResult;
        onResult?.(q,finalResult,s);
        save({answers});
      }catch(e){
        // AI check failed (network/parsing) — surface this distinctly from a
        // plain unverified result so it's clear a retry might help, and log
        // the real error for debugging instead of failing silently.
        console.error('Word Hunter: transform AI check failed', e);
        const answers=[...s.answers];
        answers[s.index]={...base,aiFailed:true};
        save({answers});
      }finally{
        setAiChecking(false);
      }
      return;
    }
    // A plain typing question graded "wrong" by exact text match still
    // might be a valid alternative answer (synonym, different phrasing) —
    // a string comparison can't judge that. Double-check with AI before
    // the learner is told they're wrong, same as the modelOnly path above.
    if(q.type==='typing' && !q.modelOnly && !base.correct && !base.spelling && String(value).trim()){
      setAiChecking(true);
      try{
        const targetWord=V2.findWord(words,q.targets?.[0]);
        const evaluation=await evaluateAlternativeGap({prompt:q.prompt,answer:q.answers[0],target:{meaning:targetWord?.meaning||q.explanation}},value);
        const genuine=!!evaluation.correct&&evaluation.semanticUse==='correct';
        const aiClose=!genuine&&evaluation.semanticUse==='partly_correct'&&evaluation.naturalness!=='nonsense';
        const answers=[...s.answers];
        const finalResult={...base,correct:genuine,unverified:false,aiEvaluated:true,aiClose,aiFeedback:evaluation.feedback};
        answers[s.index]=finalResult;
        onResult?.(q,finalResult,s);
        save({answers});
      }catch(e){
        console.error('Word Hunter: alternative-answer AI check failed', e);
        const answers=[...s.answers];
        answers[s.index]={...base,aiFailed:true};
        save({answers});
      }finally{
        setAiChecking(false);
      }
      return;
    }
    const answers=[...s.answers];answers[s.index]=base;onResult?.(q,base,s);save({answers});
  }
  function retry(){const answers=[...s.answers];answers[s.index]=null;save({answers});}
  function next(){save({index:s.index+1,draft:{}});}
  function submitReport(){
    const prior=s.answers[s.index]||null,index=s.index;
    const report=onReport(q,s,reportReason.trim(),prior?.value??null);
    const answers=[...s.answers];answers[index]={...(prior||{}),reported:true,correct:false};save({answers});
    if(!onReviewReport||!report){setReportOpen(false);return;}
    setReportReview({report,prior,index,status:'reviewing'});
    onReviewReport(report).then(review=>setReportReview(current=>current?.report===report?{...current,status:'done',review}:current),()=>setReportReview(current=>current?.report===report?{...current,status:'failed'}:current));
  }
  function closeReport(){setReportOpen(false);setReportReview(null);}
  // The learner agrees with the AI: drop the report and put the question
  // back exactly as it was (unanswered, or their original graded answer).
  function withdrawReport(){
    const {report,prior,index}=reportReview;
    onWithdrawReport?.(report);
    const answers=[...s.answers];answers[index]=prior||undefined;save({answers});
    closeReport();
  }
  const ready=q.type==='typing'?!!draft.text?.trim():q.type==='order'?(draft.tokenIds||[]).length===q.tokens.length:(draft.selected||[]).length===q.answers.length;
  const statusClass=result?(s.kind==='story'||result.reported||result.unverified?'':result.aiClose?'close':result.spelling?'close':result.correct?'correct':'wrong'):'';
  const answerText=result?q.answers.join(' + '):'';
  const sameAsExplanation=result&&q.explanation&&answerText.trim().toLowerCase()===q.explanation.trim().toLowerCase();
  return <section><div className="wh-round-top"><button className="wh-back-btn wh-nav-btn" onClick={onBack}>Save and leave</button><span>{s.title} · {s.index+1}/{s.queue.length}</span></div>{s.kind==='practice'&&s.initialLength<(s.targetLength||12)&&<p className="wh-v2-notice">Short session: {s.initialLength} valid questions (usual goal: {s.targetLength||12}).</p>}{s.reviewFirst&&<p className="wh-v2-notice">Review first: {s.dueCount} overdue words across all levels come before this level's words.</p>}{s.text&&<details className="wh-v2-story" open={s.index===0}><summary>Read the story</summary><p><AskableText text={s.text} onAskWord={onAskWord} onListen={setYouglishTerm} /></p></details>}<div className="wh-card">{result&&statusClass==='correct'&&<div className="wh-stamp correct">SUCCESS</div>}<div className="wh-file-row"><span>{q.mode}</span><div><button className="wh-back-btn" onClick={()=>onAskWord?.(q.targets?.[0]||'')}>Ask AI</button> <button className="wh-back-btn" onClick={()=>setYouglishTerm(q.targets?.[0]||'')}><Volume2 size={12}/> Listen</button> <button className="wh-back-btn" disabled={!!result&&(result.correct||result.reported||s.kind==='story')} onClick={()=>{setReportReason("");setReportReview(null);setReportOpen(true);}}>Report question</button></div></div><p className="wh-sentence"><AskableText text={q.prompt} onAskWord={onAskWord} onListen={setYouglishTerm} /></p>{q.type==='multi'&&<p>Choose {q.answers.length} words.</p>}<AnswerControl key={q.id} q={q} draft={draft} onChange={draft=>save({draft})} disabled={!!result} onSubmit={submit}/>{!result&&q.hints?.length>0&&<><button className="wh-back-btn" disabled={(draft.hints||0)>=q.hints.length} onClick={()=>save({draft:{...draft,hints:(draft.hints||0)+1}})}>Hint ({draft.hints||0}/{q.hints.length})</button>{q.hints.slice(0,draft.hints||0).map((h,i)=><p key={i}>{h}</p>)}</>}{!result?<button className="wh-level-btn wh-submit-btn" disabled={!ready||aiChecking} onClick={submit}>{aiChecking?'Checking with AI…':'Submit'}</button>:<><div role="status" className={`wh-feedback ${statusClass}`}>{s.kind==='story'?'Answer saved. Feedback follows at the end.':result.reported?'Reported; excluded from mastery.':result.aiFailed?'AI check failed. Tap Retry to try again, or Continue without grading this one.':result.dontKnow?"No worries — here's the answer:":result.unverified?'Different from the model. Not graded: a text match cannot check all valid sentences.':result.aiClose?'Almost — close, but not quite right yet.':result.spelling?'Close spelling; this is not a full recall success.':result.correct?'Correct'+(result.assisted?' with help.':'.'):'Try this answer:'}</div>{s.kind!=='story'&&!result.reported&&!result.aiFailed&&<div className="wh-result-details"><SmartImage src={correctImage} className="wh-flashcard-img"/><p>{answerText}</p>{!sameAsExplanation&&<p>{q.explanation}</p>}{result.aiFeedback&&<p className="wh-ai-feedback">{result.aiFeedback}</p>}</div>}{result.aiFailed&&<button className="wh-level-btn wh-result-continue" onClick={retry}>Retry</button>}<button ref={continueRef} className="wh-level-btn wh-result-continue" onClick={next}>Continue</button></>}</div>{reportOpen&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&reportReview?.status!=='reviewing')closeReport();}}><div className="wh-panel wh-confirm-panel" role="alertdialog">{!reportReview?<><p><b>Report this question?</b></p><p>Pick what's wrong (optional), or add your own note below. AI will check it right away.</p><div className="wh-options wh-report-reasons">{REPORT_REASONS.map(reason=><button type="button" key={reason} className={`wh-option ${reportReason===reason?'picked':''}`} onClick={()=>setReportReason(current=>current===reason?"":reason)}>{reason}</button>)}</div><textarea className="wh-freeform" style={{width:"100%",minHeight:60,boxSizing:"border-box",marginTop:8}} value={reportReason} onChange={e=>setReportReason(e.target.value)} placeholder="Add detail (optional)"/><div className="wh-ai-actions"><button onClick={()=>setReportOpen(false)}>Cancel</button><button className="primary" onClick={submitReport}>Submit report</button></div></>:reportReview.status==='reviewing'?<><p><b>Report saved.</b></p><p className="wh-ai-feedback"><Sparkles size={13}/> AI is checking this question…</p></>:reportReview.status==='failed'?<><p><b>Report saved.</b></p><p>AI couldn't check it right now. It's still in the admin's report list, and this question won't count against you.</p><div className="wh-ai-actions"><button className="primary" onClick={closeReport}>Continue</button></div></>:<><p><b>{reportReview.review.verdict==='flawed'?'AI agrees — this question has a problem.':reportReview.review.verdict==='fine'?'AI thinks this question is OK.':"AI isn't sure about this one."}</b></p>{reportReview.review.explanation&&<p className="wh-ai-feedback">{reportReview.review.explanation}</p>}{reportReview.review.learnerAnswerAcceptable===true&&<p>Your answer looks acceptable too.</p>}{reportReview.review.verdict==='flawed'&&<p><small>{reportReview.review.fixed?'A fix is drafted and waiting for admin review.':'Saved for admin review.'} The question won't count against you.</small></p>}{reportReview.review.verdict!=='flawed'&&<p><small>Your report is still saved for the admin, and this question won't count against you. You can withdraw it if you agree with the AI.</small></p>}<div className="wh-ai-actions">{reportReview.review.verdict!=='flawed'&&<button onClick={withdrawReport}>{reportReview.prior?'Withdraw report':'Withdraw & answer it'}</button>}<button className="primary" onClick={closeReport}>{reportReview.review.verdict!=='flawed'?'Keep report':'Continue'}</button></div></>}</div></div>}{youglishTerm&&<PronunciationModal term={youglishTerm} onClose={()=>setYouglishTerm(null)}/>}</section>;
}

return SessionView;
})();


// Claude owns persistence. Never switch the player's data to browser storage.
const storage = {
  get: async (key) => {
    if (!window.storage?.get) throw new Error("Claude artifact storage is unavailable");
    return window.storage.get(key, false);
  },
  set: async (key, value) => {
    if (!window.storage?.set) throw new Error("Claude artifact storage is unavailable");
    return window.storage.set(key, value, false);
  },
  delete: async (key) => {
    if (!window.storage?.delete) throw new Error("Claude artifact storage is unavailable");
    return window.storage.delete(key, false);
  },
};

// The artifact storage backend rejects a write with a 409 whenever it lands
// while another write to the same key is still in flight (e.g. from a
// double-mounted effect, or two tabs on the same published link). That's a
// transient collision, not a real failure — the losing write is perfectly
// valid, it just needs to land a beat later. Retry with jittered backoff a
// couple of times before treating it as a genuine save failure.
async function storageSetWithRetry(key, value, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await storage.set(key, value);
    } catch (e) {
      if (attempt === attempts) throw e;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt + Math.random() * 250));
    }
  }
}

/* ---------------------------------- DATA ---------------------------------- */

const BUILTIN_WORDS = [];

const BUILTIN_PUNS = [];

const BUILTIN_GRAMMAR = [];

// Authored challenge content is intentionally data-driven. The built-in set
// stays empty so existing installations do not suddenly gain hidden sample
// progress keys; curated challenges arrive through content/backup imports.
const BUILTIN_CHALLENGES = [];

/* ------------------------------ DYNAMIC DATA -------------------------------- */
// WORDS/GRAMMAR/PUNS start as just the built-in content, then get merged with
// anything imported from Anki (see the import feature below). LEVELS/BADGES
// are re-derived every time that merge happens — so these live as mutable
// module-level bindings rather than one-time constants.

let WORDS = BUILTIN_WORDS;
let GRAMMAR = BUILTIN_GRAMMAR;
let PUNS = BUILTIN_PUNS;
let CHALLENGES = BUILTIN_CHALLENGES;

// Explicit level ordering: the 5 built-in topics, plus any new topics or
// capacity-overflow continuations ("Media II") created by imports, inserted
// right after their base topic so related levels stay grouped together.
// Starts empty now that built-in seed data is gone — real categories come
// in entirely from imported content (see mergeCustomData, which reassigns
// this once content loads).
let LEVEL_ORDER = [];

/* --------------------------------- LEVELS ---------------------------------- */
// Each level is one topic (matching the original Anki topic tags), mixing
// its vocabulary, grammar rules, and puns together — not separated by type.
// Levels unlock in order — you must clear one (finish its round) before the
// next becomes playable.

function levelItemKey(item) {
  if (item.kind === "word") return item.obj.word;
  if (item.kind === "grammar") return `grammar:${item.obj.id}`;
  if (item.kind === "challenge") return `challenge:${item.obj.id}`;
  return `pun:${item.obj.id}`;
}

const MASTERY_STAGE = { NEW: "New", FAMILIAR: "Familiar", LEARNED: "Learned", MASTERED: "Mastered" };
const MASTERY_STAGE_RANK = { New: 0, Familiar: 1, Learned: 2, Mastered: 3 };
const PRODUCTION_MODES = new Set(["typing", "gapTyping", "phrasalTransform", "finalReport"]);
const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30];
// A word cannot climb past this review step (max 7-day interval) until it has
// been produced correctly at least once (typing / gapTyping). Recognition-only
// evidence must not push a word onto long intervals.
const PRODUCTION_GATE_STEP = 2;
const isWordKey = (key) => !/^(grammar|combo|challenge|pun):/.test(String(key));
const MAX_CONFUSIONS = 80;
// Confusion entries are {count,lastAt}; older data stored a bare number.
// A record whose count was lost (null/NaN) still proves at least one confusion.
const confusionCount = (v) => { const n = typeof v === "number" ? v : Number(v?.count); return Number.isFinite(n) && n > 0 ? n : (v ? 1 : 0); };
const MAX_RELATIONSHIPS = 220;
const RECENT_RESULT_LIMIT = 8;

function getAccuracy(stats) {
  const total = Number(stats?.total || 0);
  return total > 0 ? (Number(stats?.correct || 0) / total) * 100 : 0;
}

function normalizeModeStats(modeStats) {
  return {
    ...modeStats,
    correct: Number(modeStats?.correct || 0),
    total: Number(modeStats?.total || 0),
    spellingMisses: Number(modeStats?.spellingMisses || 0),
    lastResult: modeStats?.lastResult || null,
    lastDifficulty: Math.max(1, Number(modeStats?.lastDifficulty || 1)),
  };
}

function normalizeMasteryRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  const modes = {};
  if (source.modes && typeof source.modes === "object") {
    Object.entries(source.modes).forEach(([modeId, modeStats]) => { modes[modeId] = normalizeModeStats(modeStats); });
  }
  return {
    ...source,
    correct: Number(source.correct || 0),
    total: Number(source.total || 0),
    modes,
    productionCorrect: Number(source.productionCorrect || 0),
    productionAttempts: Number(source.productionAttempts || 0),
    spellingMisses: Number(source.spellingMisses || 0),
    sentenceAttempts: Number(source.sentenceAttempts || 0),
    sentenceSuccesses: Number(source.sentenceSuccesses || 0),
    aiEvaluatedAttempts: Number(source.aiEvaluatedAttempts || 0),
    everMastered: source.everMastered === true,
    regressionStrikes: Math.max(0, Number(source.regressionStrikes || 0)),
    lastResult: source.lastResult || null,
    lastReviewedAt: Number(source.lastReviewedAt || 0) || null,
    nextReviewAt: Number(source.nextReviewAt || 0) || null,
    reviewStep: Math.max(0, Number(source.reviewStep || 0)),
    recentResults: Array.isArray(source.recentResults) ? [...source.recentResults] : [],
  };
}

function getCorrectModeCount(stats) {
  const normalized = normalizeMasteryRecord(stats);
  return Object.values(normalized.modes).filter((mode) => mode.correct > 0).length;
}

function getProductionCorrect(stats) {
  const normalized = normalizeMasteryRecord(stats);
  const fromModes = Object.entries(normalized.modes)
    .filter(([modeId]) => PRODUCTION_MODES.has(modeId))
    .reduce((sum, [, mode]) => sum + Number(mode.correct || 0), 0);
  return Math.max(normalized.productionCorrect, fromModes);
}

function getMasteryStage(stats, item) {
  const normalized = normalizeMasteryRecord(stats);
  if (normalized.correct <= 0) return MASTERY_STAGE.NEW;
  const kind = item?.kind || (item?.key?.startsWith("grammar:") ? "grammar" : item?.key?.startsWith("pun:") ? "pun" : item?.key?.startsWith("challenge:") ? "challenge" : "word");
  const accuracy = getAccuracy(normalized);
  if (kind === "word" && normalized.everMastered && normalized.regressionStrikes < 3) return MASTERY_STAGE.MASTERED;
  if (kind === "word" && normalized.evidenceV2) return V2.stage(normalized);
  if (kind === "word") {
    const variedCorrectModes = getCorrectModeCount(normalized);
    if (normalized.total >= 5 && accuracy >= 80 && variedCorrectModes >= 2 && getProductionCorrect(normalized) >= 1) return MASTERY_STAGE.MASTERED;
    if (normalized.correct >= 2 && variedCorrectModes >= 2) return MASTERY_STAGE.LEARNED;
    return MASTERY_STAGE.FAMILIAR;
  }
  if (normalized.total >= 5 && accuracy >= 80) return MASTERY_STAGE.MASTERED;
  if (normalized.total >= 2 && accuracy >= 70) return MASTERY_STAGE.LEARNED;
  return MASTERY_STAGE.FAMILIAR;
}

function isItemMastered(stats, item) {
  return getMasteryStage(stats, item) === MASTERY_STAGE.MASTERED;
}

function levelMasteredCount(level, mastery) {
  return level.items.filter((it) => isItemMastered(mastery[levelItemKey(it)], it)).length;
}
function levelStageBreakdown(level, mastery) {
  const counts = { New: 0, Familiar: 0, Learned: 0, Mastered: 0 };
  level.items.forEach((it) => { counts[getMasteryStage(mastery[levelItemKey(it)], it)] += 1; });
  return counts;
}

function getStarsForAccuracy(accuracy) {
  if (accuracy >= 95) return 3;
  if (accuracy >= 85) return 2;
  if (accuracy >= 70) return 1;
  return 0;
}

function formatAccuracy(accuracy) {
  const value = Number(accuracy || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatStars(stars = 0) {
  const safe = Math.max(0, Math.min(3, Number(stars || 0)));
  return `${"⭐".repeat(safe)}${"☆".repeat(3 - safe)}`;
}

function updateLevelStat(previous = {}, accuracy, grandfatherStars = 0, now = Date.now()) {
  const oldBest = typeof previous.bestAccuracy === "number" ? previous.bestAccuracy : null;
  const bestAccuracy = oldBest === null ? accuracy : Math.max(oldBest, accuracy);
  return {
    ...previous,
    attempts: Number(previous.attempts || 0) + 1,
    bestAccuracy,
    stars: Math.max(Number(previous.stars || 0), getStarsForAccuracy(accuracy), grandfatherStars),
    lastPlayedAt: now,
    migrated: previous.migrated && oldBest === null && accuracy < 70 ? true : false,
  };
}

function updateSpacedReview(stats, correct, now = Date.now(), opts = {}) {
  const prev = normalizeMasteryRecord(stats);
  const productionCorrect = prev.productionCorrect + (opts.productionNow ? 1 : 0);
  const stepCap = productionCorrect > 0 ? REVIEW_INTERVAL_DAYS.length - 1 : PRODUCTION_GATE_STEP;
  if (!correct) {
    return { reviewStep: Math.max(0, prev.reviewStep - 1), lastReviewedAt: now, nextReviewAt: now };
  }
  if (prev.nextReviewAt && prev.nextReviewAt > now) {
    return { reviewStep: prev.reviewStep, lastReviewedAt: now, nextReviewAt: prev.nextReviewAt };
  }
  const intervalIndex = Math.min(prev.reviewStep, REVIEW_INTERVAL_DAYS.length - 1);
  const nextStep = Math.min(prev.reviewStep + 1, stepCap);
  return {
    reviewStep: nextStep,
    lastReviewedAt: now,
    nextReviewAt: now + REVIEW_INTERVAL_DAYS[intervalIndex] * 24 * 60 * 60 * 1000,
  };
}

function isDueForReview(stats, now = Date.now()) {
  const nextReviewAt = Number(stats?.nextReviewAt || 0);
  return nextReviewAt > 0 && nextReviewAt <= now;
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isPreviousLocalDay(previousKey, todayKey) {
  if (!previousKey || !todayKey) return false;
  const [y, m, d] = previousKey.split("-").map(Number);
  if (!y || !m || !d) return false;
  const next = new Date(y, m - 1, d, 12, 0, 0);
  next.setDate(next.getDate() + 1);
  return localDateKey(next) === todayKey;
}

function nextStudyStreakState(lastStudyDate, studyStreak, bestStudyStreak, today = localDateKey()) {
  if (lastStudyDate === today) return { lastStudyDate, studyStreak, bestStudyStreak };
  const nextStreak = isPreviousLocalDay(lastStudyDate, today) ? Math.max(1, studyStreak + 1) : 1;
  return { lastStudyDate: today, studyStreak: nextStreak, bestStudyStreak: Math.max(bestStudyStreak, nextStreak) };
}

// Puns are parked for now — the pun data and its question builder are kept
// intact (and imports still store them), they're just not dealt into rounds.
// Flip this to true to bring them back into play.
const PUNS_ENABLED = false;

function buildLevel(title) {
  return {
    id: `cat-${title}`,
    title,
    items: [
      ...WORDS.filter((w) => w.category === title).map((w) => ({ kind: "word", obj: w })),
      ...GRAMMAR.filter((g) => g.category === title).map((g) => ({ kind: "grammar", obj: g })),
      ...CHALLENGES.filter((c) => c.category === title).map((c) => ({ kind: "challenge", obj: c })),
      ...(PUNS_ENABLED ? PUNS.filter((p) => p.category === title).map((p) => ({ kind: "pun", obj: p })) : []),
    ],
  };
}

const TOPIC_ICONS = {
  Personality: Users,
  Media: Newspaper,
  Marketing: ShoppingBag,
  Mindset: Target,
  "Pet Peeves": Angry,
};

// Temporarily disabled modes: excluded from mode selection everywhere below
// (getAllowedModes + pickWeakMode's forced picks). Remove an id here to
// re-enable it later — no other code needs to change.
const DISABLED_MODES = new Set(["buildSentence"]);
// Toggled at runtime from the Settings tab (enablePairModes) — kept as a
// mutable module-level set to match the existing LEVEL_ORDER/WORDS pattern
// rather than threading a settings object through every mode-selection call.
let RUNTIME_DISABLED_MODES = new Set();

const WORD_MODES = ["meaning", "gap", "gapTyping", "situation", "story", "typing", "opposite", "whoami", "twopeople", "selecttwo", "impostor", "buildSentence", "phrasalTransform", "idiomDetective"];
const MODE_META = {
  meaning: { label: "Meaning Hunter", icon: Search },
  gap: { label: "Fill the Gap", icon: PenLine },
  gapTyping: { label: "Evidence Typing", icon: Keyboard },
  situation: { label: "Situation", icon: Compass },
  story: { label: "Story Challenge", icon: BookOpen },
  typing: { label: "Typing", icon: Keyboard },
  opposite: { label: "Opposite Battle", icon: ArrowLeftRight },
  whoami: { label: "Who Am I?", icon: HelpCircle },
  twopeople: { label: "Two People", icon: Users2 },
  selecttwo: { label: "Select Two", icon: ListChecks },
  impostor: { label: "Word Impostor", icon: Target },
  buildSentence: { label: "Build the Evidence", icon: PenLine },
  phrasalTransform: { label: "Phrasal Transform", icon: ArrowLeftRight },
  idiomDetective: { label: "Idiom Detective", icon: Search },
};

const CHALLENGE_MODE_META = {
  story: { label: "Story Challenge", icon: BookOpen },
  idiomStory: { label: "Advanced Idiom Story", icon: BookOpen },
  reverseIdiomStory: { label: "Reverse Idiom Story", icon: ArrowLeftRight },
  impostor: { label: "Impostor", icon: Target },
  reverseImpostor: { label: "Reverse Impostor", icon: ListChecks },
  buildSentence: { label: "Build the Sentence", icon: PenLine },
  phrasalTransform: { label: "Phrasal Verb Transform", icon: ArrowLeftRight },
  grammarCourt: { label: "Advanced Grammar Court", icon: Scale },
};

let LEVELS = [];
let BADGES = [];
let LAST_CHALLENGE_ID = null;

function rebuildDerived() {
  LEVELS = LEVEL_ORDER.map(buildLevel);
  BADGES = [
    ...LEVELS.map((level) => ({
      id: level.id,
      type: "category",
      category: level.title,
      label: `${level.title} Files Closed`,
    })),
    { id: "streak-5", type: "streak", threshold: 5, label: "Warming Up" },
    { id: "streak-10", type: "streak", threshold: 10, label: "On a Roll" },
    { id: "streak-20", type: "streak", threshold: 20, label: "Unstoppable" },
    { id: "completionist", type: "completionist", label: "Full Case Archive" },
  ];
}
rebuildDerived();

// Keeps only the first entry for each key — a safety net so a word can never
// be dealt into the same round twice, no matter how it ended up duplicated
// (repeated imports, a review that reintroduced an entry, case differences).
function dedupeBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// The original ~64 words / 15 grammar cards / 6 puns were only ever seed
// examples for building the game. Once real content is imported they're
// just noise mixed into real levels, so gameplay excludes them by default.
// They're never deleted (still exported below) — flip this to true to bring
// them back into every level, or import the export as regular content to
// selectively resurrect specific ones as fully-editable custom entries.
const INCLUDE_BUILTIN_IN_PLAY = false;

// Merges freshly imported content into the live data and rebuilds
// LEVELS/BADGES. Called once on load (with anything saved from a previous
// import) and again right after a new import completes.
function mergeCustomData(customWords, customGrammar, customPuns, customChallenges, levelOrder) {
  const baseWords = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_WORDS : [];
  const baseGrammar = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_GRAMMAR : [];
  const basePuns = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_PUNS : [];
  const baseChallenges = INCLUDE_BUILTIN_IN_PLAY ? BUILTIN_CHALLENGES : [];
  WORDS = dedupeBy([...baseWords, ...customWords], (w) => w.word && w.word.trim().toLowerCase());
  GRAMMAR = dedupeBy([...baseGrammar, ...customGrammar], (g) => g.id);
  PUNS = dedupeBy([...basePuns, ...customPuns], (p) => p.id);
  CHALLENGES = dedupeBy([...baseChallenges, ...(Array.isArray(customChallenges) ? customChallenges : [])], (c) => c && c.id);
  LEVEL_ORDER = levelOrder;
  rebuildDerived();
}



/* --------------------------------- HELPERS --------------------------------- */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Words too common to signal any real similarity between two definitions.
const MEANING_STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","that","this","is","are","was","were","be","been",
  "someone","something","somebody","people","person","you","your","yours","they","them","their","it","its",
  "who","whom","which","when","where","what","how","not","no","but","from","by","at","as","if","than","then",
  "very","more","most","less","least","much","many","other","others","own","same","such","about","into","over",
  "used","use","using","make","makes","making","made","do","does","doing","done","get","gets","getting","got",
  "have","has","had","can","could","will","would","should","may","might","must","one","two","also","often",
  "usually","especially","without","because","while","during","after","before","way","ways","thing","things",
]);

function meaningTokens(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3 && !MEANING_STOPWORDS.has(t))
  );
}

// Rough semantic closeness: how much two definitions overlap in meaningful
// words, normalized so short definitions aren't unfairly penalized.
function meaningSimilarity(a, b) {
  const ta = meaningTokens(a);
  const tb = meaningTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  return shared / Math.min(ta.size, tb.size);
}

// Picks the wrong answers. Two things make a distractor good: it should look
// like the same KIND of thing (an idiom among idioms, not among adjectives),
// and it should be close enough in MEANING that the choice actually tests
// understanding rather than being obvious at a glance. So: filter by type
// and category first, then rank what's left by definition overlap and pick
// from the closest handful — with a little randomness so repeat encounters
// aren't identical.
function sampleDistractors(target, n = 3) {
  return V2.optionWords([target], WORDS, n + 1).filter(w => w.word !== target.word);
}

function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b.charAt(i - 1) === a.charAt(j - 1)
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

const OPPOSITE_TRAP_RATE = 0.12;

function weightedChoice(items) {
  const valid = items.filter((item) => item && item.weight > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of valid) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return valid[valid.length - 1].value;
}

function modeAccuracy(stats, modeId) {
  const mode = normalizeMasteryRecord(stats).modes[modeId];
  return mode?.total ? (mode.correct / mode.total) * 100 : null;
}

function isPhrasal(word) {
  return word?.type === "phrasal" || (/^[a-z]+\s+(up|down|in|out|on|off|over|away|back|through|into|for|with|at|by|around|along|across)$/i.test(String(word?.word || "")));
}

function isIdiom(word) {
  return word?.type === "idiom" || word?.type === "binomial" || word?.type === "fyi";
}

function isStrictIdiom(word) {
  return word?.type === "idiom";
}

function challengeType(challenge) {
  const raw = String(challenge?.type || "").trim();
  const aliases = {
    "idiom-story": "idiomStory",
    advancedIdiomStory: "idiomStory",
    "reverse-idiom-story": "reverseIdiomStory",
    "reverse-impostor": "reverseImpostor",
    "build-sentence": "buildSentence",
    "phrasal-transform": "phrasalTransform",
    "grammar-court": "grammarCourt",
  };
  return aliases[raw] || raw || "story";
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const key = normalizeAnswerText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function challengeLinkedWords(challenge) {
  const valid = new Set(WORDS.map((w) => w.word));
  return uniqueStrings(challenge?.linkedWords).filter((word) => valid.has(word));
}

function authoredChallengesForWord(word, type = null) {
  return CHALLENGES.filter((challenge) => {
    if (!challenge || !challenge.id) return false;
    if (type && challengeType(challenge) !== type) return false;
    return challengeLinkedWords(challenge).includes(word.word);
  });
}

function isStrongStoryFallback(word) {
  const situation = String(word?.situation || "").trim();
  const sentences = situation.split(/(?<=[.!?])\s+/).filter(Boolean);
  const leaksAnswer = normalizeAnswerText(situation).includes(normalizeAnswerText(word?.word));
  return !leaksAnswer && sentences.length >= 2 && sentences.length <= 4 && situation.split(/\s+/).length >= 18;
}

function challengeProgressEligible(challenge, mastery = {}) {
  const linked = challengeLinkedWords(challenge);
  if (!linked.length) return true;
  const stages = linked.map((word) => {
    const obj = WORDS.find((item) => item.word === word);
    return obj ? MASTERY_STAGE_RANK[getMasteryStage(mastery[word], { kind: "word", obj })] : 0;
  });
  const type = challengeType(challenge);
  const production = type === "buildSentence" || type === "phrasalTransform";
  const threshold = production && Number(challenge.difficulty || 1) >= 3
    ? MASTERY_STAGE_RANK[MASTERY_STAGE.LEARNED]
    : MASTERY_STAGE_RANK[MASTERY_STAGE.FAMILIAR];
  return stages.every((stage) => stage >= threshold);
}

function buildChallengeQuestionUnsafe(challenge) {
  const type = challengeType(challenge);
  const linkedWords = challengeLinkedWords(challenge);
  const answerList = uniqueStrings(challenge.answers);
  const acceptedAnswers = uniqueStrings([
    ...(challenge.answer !== undefined ? [challenge.answer] : []),
    ...answerList,
    ...(Array.isArray(challenge.acceptedAnswers) ? challenge.acceptedAnswers : []),
  ]);
  const answer = challenge.answer ?? acceptedAnswers[0] ?? "";
  const target = {
    ...challenge,
    key: `challenge:${challenge.id}`,
    label: String(challenge.label || answer || CHALLENGE_MODE_META[type]?.label || "Challenge"),
    explanation: String(challenge.explanation || ""),
  };
  const common = {
    target,
    challengeId: challenge.id,
    linkedWords,
    modeId: type,
    difficulty: Math.max(1, Number(challenge.difficulty || 1)),
    prompt: String(challenge.prompt || ""),
    answer,
    acceptedAnswers,
    explanation: target.explanation,
  };

  if (Array.isArray(challenge.steps) && challenge.steps.length) {
    const steps = challenge.steps.map((step, index) => ({
      ...step,
      id: step.id || `${challenge.id}-step-${index + 1}`,
      type: step.type === "typing" ? "typing" : "mcq",
      options: uniqueStrings(step.options),
      acceptedAnswers: uniqueStrings([
        ...(step.answer !== undefined ? [step.answer] : []),
        ...(Array.isArray(step.answers) ? step.answers : []),
        ...(Array.isArray(step.acceptedAnswers) ? step.acceptedAnswers : []),
      ]),
    }));
    return { ...common, type: "multiStage", steps, court: type === "grammarCourt" };
  }

  const interaction = challenge.interaction || challenge.variant;
  if (interaction === "order" || interaction === "reorder") {
    const sourceTokens = Array.isArray(challenge.tokens) && challenge.tokens.length
      ? challenge.tokens
      : String(answer).split(/\s+/).filter(Boolean);
    return { ...common, type: "wordOrder", tokens: sourceTokens.map(String) };
  }
  if (interaction === "selfCheck" || interaction === "freeSentence") {
    return {
      ...common,
      type: "selfCheck",
      requiredWords: uniqueStrings(challenge.requiredWords?.length ? challenge.requiredWords : linkedWords),
      exampleAnswer: String(challenge.exampleAnswer || answer || ""),
    };
  }
  if (interaction === "typing" || (!challenge.options && acceptedAnswers.length)) {
    return { ...common, type: "typing" };
  }
  const options = uniqueStrings(challenge.options);
  if (answerList.length > 1) {
    return { ...common, type: "multi", options, correctAnswers: answerList };
  }
  return { ...common, type: "mcq", options, answer };
}

function challengeValidationIssues(challenge, wordSource = WORDS) {
  const issues = [];
  if (!challenge || typeof challenge !== "object") return ["challenge must be an object"];
  if (!String(challenge.id || "").trim()) issues.push("missing stable id");
  if (!String(challenge.prompt || "").trim()) issues.push("missing prompt");
  const type = challengeType(challenge);
  const options = uniqueStrings(challenge.options);
  const answers = uniqueStrings([
    ...(challenge.answer !== undefined ? [challenge.answer] : []),
    ...(Array.isArray(challenge.answers) ? challenge.answers : []),
  ]);
  if (Array.isArray(challenge.options) && options.length !== challenge.options.length) issues.push("duplicate or blank options");
  if (options.length && answers.some((answer) => !options.some((option) => normalizeAnswerText(option) === normalizeAnswerText(answer)))) issues.push("answer is missing from options");
  if (["story", "idiomStory", "reverseIdiomStory", "impostor", "reverseImpostor"].includes(type) && options.length !== 4) issues.push(`${type} requires four unique options`);
  if ((type === "story" || type === "idiomStory") && challenge.answer && normalizeAnswerText(challenge.prompt).includes(normalizeAnswerText(challenge.answer))) issues.push("prompt leaks the answer");
  if ((type === "impostor" || type === "reverseImpostor") && !challenge.relationship) issues.push("impostor relationship is not stored");
  if (type === "impostor" && options.length !== 4) issues.push("impostor requires four options");
  if (type === "reverseImpostor" && options.length !== 4) issues.push("reverse impostor requires four options");
  if (type === "idiomStory") {
    const optionWords = options.map((option) => wordSource.find((word) => normalizeAnswerText(word.word) === normalizeAnswerText(option)));
    if (options.length && optionWords.some((word) => !isStrictIdiom(word))) issues.push("idiom challenge options must all be loaded idioms");
  }
  if (type === "idiomStory" || type === "reverseIdiomStory") {
    const linked = uniqueStrings(challenge.linkedWords).map((label) => wordSource.find((word) => word.word === label));
    if (linked.some((word) => !isStrictIdiom(word))) issues.push("idiom challenge links must use type idiom");
  }
  if (type === "phrasalTransform") {
    const linked = uniqueStrings(challenge.linkedWords).map((label) => wordSource.find((word) => word.word === label));
    if (!linked.length || linked.some((word) => !isPhrasal(word))) issues.push("phrasal transform must link loaded phrasal entries");
  }
  if (Array.isArray(challenge.steps)) {
    challenge.steps.forEach((step, index) => {
      const stepOptions = uniqueStrings(step.options);
      const stepAnswers = uniqueStrings([...(step.answer !== undefined ? [step.answer] : []), ...(Array.isArray(step.answers) ? step.answers : []), ...(Array.isArray(step.acceptedAnswers) ? step.acceptedAnswers : [])]);
      if (!stepAnswers.length) issues.push(`step ${index + 1} has no answer`);
      if (stepOptions.length && stepAnswers.some((answer) => !stepOptions.some((option) => normalizeAnswerText(option) === normalizeAnswerText(answer)))) issues.push(`step ${index + 1} answer is missing from options`);
    });
  }
  return issues;
}

function getAllowedModes(word) {
  const base = ["meaning", "gap", "gapTyping", "situation", "typing", "buildSentence"];
  if (isStrongStoryFallback(word)) base.push("story");
  if (word?.opposite || Math.random() < OPPOSITE_TRAP_RATE) base.push("opposite");
  if (canBuildWhoAmI(word)) base.push("whoami");
  if (canBuildTwoPerson(word)) base.push("twopeople", "selecttwo");
  if (isIdiom(word)) base.push("idiomDetective");
  if (["phrasal", "fyi"].includes(word?.type) && word?.transformExample) base.push("phrasalTransform");
  if (word?.skipTyping) return base.filter((m) => !["typing", "gapTyping", "buildSentence", "phrasalTransform"].includes(m));
  return [...new Set(base)].filter((m) => !DISABLED_MODES.has(m) && !RUNTIME_DISABLED_MODES.has(m));
}

function getAdaptiveDifficulty(word, stats, modeId) {
  const s = normalizeMasteryRecord(stats);
  const stage = getMasteryStage(s, { kind: "word", obj: word });
  const recent = s.recentResults.slice(-4);
  const recentCorrect = recent.filter((r) => r.correct).length;
  const acc = modeAccuracy(s, modeId);
  let difficulty = stage === MASTERY_STAGE.NEW ? 1 : stage === MASTERY_STAGE.FAMILIAR ? 2 : stage === MASTERY_STAGE.LEARNED ? 3 : 4;
  if (recent.length >= 2 && recentCorrect <= 1) difficulty -= 1;
  if (recent.length >= 3 && recentCorrect === recent.length) difficulty += 1;
  if (acc !== null && acc < 50) difficulty -= 1;
  if (acc !== null && acc >= 85 && s.modes[modeId]?.total >= 2) difficulty += 1;
  if ((modeId === "typing" || modeId === "gapTyping") && s.spellingMisses > 0) difficulty = Math.min(difficulty, 3);
  return Math.max(1, Math.min(modeId === "gap" || modeId === "gapTyping" ? 5 : 4, difficulty));
}

function getStrongConfusion(word, confusions = {}) {
  const prefix = `${word.word}|`;
  return Object.entries(confusions)
    .filter(([key, value]) => key.startsWith(prefix) && confusionCount(value) >= 2)
    .map(([key, value]) => ({ partner: key.slice(prefix.length), count: confusionCount(value), lastAt: Number(value?.lastAt || 0) }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)[0] || null;
}

function selectAdaptiveMode(word, masteryStats, context = {}) {
  const stats = normalizeMasteryRecord(masteryStats);
  const stage = getMasteryStage(stats, { kind: "word", obj: word });
  const allowed = new Set(getAllowedModes(word));
  const due = isDueForReview(stats, context.now || Date.now());
  const confusion = context.confusion || null;
  const hasProduction = getProductionCorrect(stats) > 0;
  const weakModes = Object.entries(stats.modes)
    .filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65)
    .map(([modeId]) => modeId);

  const baseByStage = {
    New: { meaning: 8, situation: 7, gap: 6, story: 0, whoami: 2, opposite: 1, impostor: 0, typing: 0, gapTyping: 0, buildSentence: 0 },
    Familiar: { meaning: 4, situation: 5, gap: 5, story: 4, whoami: 3, opposite: 3, impostor: 0, twopeople: 1.5, selecttwo: 1.5, typing: 1.5, gapTyping: 1.5, buildSentence: 0.3 },
    Learned: { meaning: 1.2, situation: 3, gap: 2, story: 4, whoami: 1.5, opposite: 2, impostor: 4, twopeople: 1, selecttwo: 1, typing: 6, gapTyping: 6, buildSentence: 5 },
    Mastered: { meaning: 0.4, situation: 1, gap: 0.8, story: 2, opposite: 2, impostor: 5, typing: 2.5, gapTyping: 2.5, buildSentence: 2.5 },
  };
  const base = { ...(baseByStage[stage] || baseByStage.New) };
  if (isPhrasal(word)) base.phrasalTransform = stage === MASTERY_STAGE.NEW ? 0.3 : stage === MASTERY_STAGE.FAMILIAR ? 2 : 5;
  if (isIdiom(word)) base.idiomDetective = stage === MASTERY_STAGE.NEW ? 3 : 5;

  weakModes.forEach((modeId) => { base[modeId] = (base[modeId] || 0) + 7; });
  if (stats.spellingMisses > 0) {
    base.typing = (base.typing || 0) + Math.min(8, stats.spellingMisses * 2);
    base.gapTyping = (base.gapTyping || 0) + Math.min(6, stats.spellingMisses * 1.5);
  }
  if (!hasProduction && (stage === MASTERY_STAGE.LEARNED || stage === MASTERY_STAGE.FAMILIAR)) {
    base.typing = (base.typing || 0) + 4;
    base.gapTyping = (base.gapTyping || 0) + 3;
    base.buildSentence = (base.buildSentence || 0) + 3;
  }
  if (confusion) {
    base.meaning = (base.meaning || 0) + 4;
    base.impostor = (base.impostor || 0) + 5;
    base.situation = (base.situation || 0) + 3;
  }
  if (due || context.sessionType === "weak") {
    base.typing = (base.typing || 0) + 1.5;
    base.situation = (base.situation || 0) + 1.5;
  }
  if (stage === MASTERY_STAGE.MASTERED && !due && !context.forceMastered) {
    Object.keys(base).forEach((k) => { base[k] *= 0.35; });
  }
  if (context.lastMode && base[context.lastMode] && !weakModes.includes(context.lastMode)) base[context.lastMode] *= 0.25;
  const weighted = Object.entries(base)
    .filter(([modeId]) => allowed.has(modeId) && !(context.quarantine && context.quarantine.has(`${String(word.word||"").trim().toLowerCase()}|${modeId}`)))
    .map(([value, weight]) => ({ value, weight }));
  return weightedChoice(weighted) || (allowed.has("situation") ? "situation" : [...allowed][0] || "meaning");
}

function buildAdaptiveRound(level, mastery = {}, confusions = {}, sessionType = "level") {
  const allUnique = dedupeBy(level.items, levelItemKey);
  let unique = allUnique;
  if (sessionType === "level") {
    const filtered = allUnique.filter((item) => {
      if (item.kind === "challenge") return challengeProgressEligible(item.obj, mastery);
      if (item.kind !== "word") return true;
      const stats = mastery[item.obj.word];
      const mastered = getMasteryStage(stats, item) === MASTERY_STAGE.MASTERED;
      return !mastered || isDueForReview(stats) || Math.random() < 0.18;
    });
    unique = filtered.length ? filtered : shuffle(allUnique).slice(0, Math.min(6, allUnique.length));
  }
  const result = [];
  let lastMode = null;
  const shuffledItems = shuffle(unique);
  if (LAST_CHALLENGE_ID && shuffledItems.length > 1 && shuffledItems[0]?.kind === "challenge" && shuffledItems[0].obj.id === LAST_CHALLENGE_ID) {
    const swapIndex = shuffledItems.findIndex((item, index) => index > 0 && !(item.kind === "challenge" && item.obj.id === LAST_CHALLENGE_ID));
    if (swapIndex > 0) [shuffledItems[0], shuffledItems[swapIndex]] = [shuffledItems[swapIndex], shuffledItems[0]];
  }
  for (const item of shuffledItems) {
    if (item.kind === "challenge") {
      result.push({ kind: "challenge", obj: item.obj });
      continue;
    }
    if (item.kind !== "word") {
      result.push(item.kind === "grammar" ? { kind: "grammar", obj: item.obj } : { kind: "pun", obj: item.obj });
      continue;
    }
    const stats = mastery[item.obj.word];
    const confusion = getStrongConfusion(item.obj, confusions);
    const mode = selectAdaptiveMode(item.obj, stats, { sessionType, confusion, lastMode });
    const difficulty = getAdaptiveDifficulty(item.obj, stats, mode);
    result.push({ kind: "word", wordObj: item.obj, mode, difficulty, confusionPartner: confusion?.partner || null });
    lastMode = mode;
  }
  return result;
}

function buildRound(level, mastery = {}, confusions = {}, sessionType = "level") {
  return buildAdaptiveRound(level, mastery, confusions, sessionType);
}

/* --------------------------------- POOLS ----------------------------------- */
// Each word keeps independent, rotating content pools per question type
// (meaning / gap / situation / typing). Once a variant has been answered
// correctly twice, it locks for a week and a fresh one is generated so the
// same phrasing never gets memorized instead of the word itself.

const POOL_TYPES = ["meaning", "gap", "situation", "typing"];
const LOCK_DAYS = 7;

function seedPoolItem(text) {
  return { id: "seed", text, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
}

function getWordPools(pools, word) {
  const existing = pools[word.word];
  if (existing) {
    const current={...existing};
    for(const type of POOL_TYPES) {
      const text=type==="typing"?word.meaning:word[type];
      current[type]=(existing[type]?.length?existing[type]:[seedPoolItem(text)]).map(item=>item.id==="seed"?{...item,text}:item);
    }
    return current;
  }
  return {
    meaning: [seedPoolItem(word.meaning)],
    gap: [seedPoolItem(word.gap)],
    situation: [seedPoolItem(word.situation)],
    typing: [seedPoolItem(word.meaning)],
  };
}

function pickActiveItem(wordPools, poolType) {
  const arr = wordPools[poolType];
  const now = Date.now();
  const unlocked = arr.filter((it) => !it.lockedUntil || it.lockedUntil <= now);
  const candidates = unlocked.length ? unlocked : arr;
  return candidates.reduce((a, b) => (a.attempts <= b.attempts ? a : b));
}

function poolHasFreshItem(wordPools, poolType) {
  const now = Date.now();
  return wordPools[poolType].some((it) => !it.lockedUntil || it.lockedUntil <= now);
}

function poolNeedsGeneration(wordPools, poolType) {
  return !poolHasFreshItem(wordPools, poolType);
}

// When a word's pool for the chosen style is exhausted (everything answered
// right twice and no replacement generated yet), repeating that exact
// question is the worst option — it's the same text a third time. Swap to
// another style for this word that still has unseen content instead.
function resolvePoolMode(modeId, wordObj, wordPools) {
  if (poolHasFreshItem(wordPools, modeId)) return modeId;
  const alternatives = POOL_TYPES.filter(
    (pt) => pt !== modeId && !(pt === "typing" && wordObj.skipTyping) && poolHasFreshItem(wordPools, pt)
  );
  if (alternatives.length) return alternatives[Math.floor(Math.random() * alternatives.length)];
  return modeId; // genuinely nothing fresh anywhere — fall back to reuse
}

// --- Opposite Battle: four sub-modes, all built from data we already have ---

// Mode A — direct match: word shown, pick its opposite from 4 options.
function buildOppositeDirect(wordObj) {
  const distractors = sampleDistractors(wordObj, 3).filter((d) => d.word !== wordObj.opposite);
  while (distractors.length < 3) {
    const extra = shuffle(WORDS.filter((w) => w.word !== wordObj.word && w.word !== wordObj.opposite && !distractors.includes(w)))[0];
    if (!extra) break;
    distractors.push(extra);
  }
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: `${wordObj.word} ↔ ${wordObj.opposite}` };
  const options = shuffle([wordObj.opposite, ...distractors.slice(0, 3).map((d) => d.word)]);
  return { target, prompt: wordObj.word, options, answer: wordObj.opposite, type: "mcq" };
}

// Mode B — pick the side of the sentence: the word's own situation sentence
// (already written to imply the word, not its opposite) becomes a two-option
// choice between the word and its opposite.
function buildOppositeSentence(wordObj) {
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: `${wordObj.word} ↔ ${wordObj.opposite}` };
  const options = shuffle([wordObj.word, wordObj.opposite]);
  return { target, prompt: wordObj.situation, options, answer: wordObj.word, type: "mcq" };
}

// Mode C — "Opposite or not?": two words, judge whether they're a real pair.
// True half the time (the real opposite); false half the time (a plausible
// but wrong same-category word), so "No" isn't just the safe guess.
function buildOppositePairJudgment(wordObj) {
  const isTruePair = Math.random() < 0.5;
  let partner;
  if (isTruePair) {
    partner = wordObj.opposite;
  } else {
    const sameGroup = WORDS.filter(
      (w) => w.word !== wordObj.word && w.word !== wordObj.opposite && w.category === wordObj.category && w.type === wordObj.type
    );
    const pool = sameGroup.length ? sameGroup : WORDS.filter((w) => w.word !== wordObj.word && w.word !== wordObj.opposite);
    partner = shuffle(pool)[0]?.word;
  }
  if (!partner) return buildOppositeDirect(wordObj);
  const answer = isTruePair ? "Yes, opposites" : "No, not opposites";
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: answer,
    explanation: isTruePair ? `${wordObj.word} ↔ ${partner}` : `${wordObj.word} and ${partner} aren't opposites.`,
  };
  return {
    target,
    prompt: `${wordObj.word}  ⚔️  ${partner}`,
    options: ["Yes, opposites", "No, not opposites"],
    answer,
    type: "mcq",
  };
}

// Mode E — the trap: not every word has a clean opposite, and knowing that
// is part of the skill. Only ever used for words with no `opposite` field.
function buildOppositeTrap(wordObj) {
  const distractors = sampleDistractors(wordObj, 3);
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: "No clear opposite",
    explanation: `${wordObj.word} doesn't have one clear, well-known opposite in this set.`,
  };
  const options = shuffle(["No clear opposite", ...distractors.map((d) => d.word)]);
  return { target, prompt: wordObj.word, options, answer: "No clear opposite", type: "mcq" };
}

function buildOppositeQuestion(wordObj) {
  if (!wordObj.opposite) return buildOppositeTrap(wordObj);
  const r = Math.random();
  if (r < 0.34) return buildOppositeDirect(wordObj);
  if (r < 0.67) return buildOppositeSentence(wordObj);
  return buildOppositePairJudgment(wordObj);
}

// --- Who Am I? — the word narrates its own meaning in first person. ---
// Only meanings phrased as a description ("Unable to make decisions...")
// convert cleanly; verb-style ones ("To deliberately say or do...") read
// oddly in first person, so those words simply don't get this mode.
function firstPersonify(meaning) {
  if (!meaning) return null;
  let m = meaning.trim();
  if (/^(to\s|an?\s|the\s|someone\b|something\b|used to say\b)/i.test(m)) return null;
  m = m.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!m) return null;
  return `I'm ${m.charAt(0).toLowerCase()}${m.slice(1)}.`;
}

function canBuildWhoAmI(w) {
  return w?.type === "vocab" && firstPersonify(w.meaning) !== null;
}

function buildWhoAmIQuestion(wordObj) {
  const riddle = firstPersonify(wordObj.meaning);
  const distractors = sampleDistractors(wordObj, 3);
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  const options = shuffle([wordObj.word, ...distractors.map((d) => d.word)]);
  return { target, prompt: `${riddle} Who am I?`, options, answer: wordObj.word, type: "mcq" };
}

// --- Two People / Select Two — combine two existing situations into one
// harder question, without needing any new authored content. A "companion"
// word from the same category supplies the second situation.
function pickCompanion(wordObj) {
  const sourceSituation = normalizeAnswerText(wordObj.situation);
  const pool = WORDS.filter((w) =>
    w.word !== wordObj.word &&
    w.category === wordObj.category &&
    w.situation &&
    normalizeAnswerText(w.situation) !== sourceSituation &&
    meaningSimilarity(w.meaning, wordObj.meaning) < 0.55
  );
  return pool.length ? shuffle(pool)[0] : null;
}

function canBuildTwoPerson(wordObj) {
  return pickCompanion(wordObj) !== null;
}

function fillToFour(base, exclude) {
  const options = [...base];
  if (options.length >= 4) return options.slice(0, 4);
  const more = shuffle(WORDS.filter((w) => !exclude.has(w.word) && !options.includes(w.word)));
  for (const w of more) {
    if (options.length >= 4) break;
    options.push(w.word);
  }
  return options;
}

function buildTwoPeopleQuestion(wordObj) {
  const companion = pickCompanion(wordObj);
  if (!companion) return null;
  const askFirst = Math.random() < 0.5;
  const distractors = sampleDistractors(wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour([wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
  const prompt = askFirst
    ? `Person A: "${wordObj.situation}"\n\nPerson B: "${companion.situation}"\n\nWhich word describes Person A?`
    : `Person A: "${companion.situation}"\n\nPerson B: "${wordObj.situation}"\n\nWhich word describes Person B?`;
  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  return { target, prompt, options, answer: wordObj.word, type: "mcq" };
}

function buildSelectTwoQuestion(wordObj) {
  const companion = pickCompanion(wordObj);
  if (!companion) return null;
  const distractors = sampleDistractors(wordObj, 3).filter((d) => d.word !== companion.word);
  const options = shuffle(fillToFour([wordObj.word, companion.word, ...distractors.map((d) => d.word)], new Set([wordObj.word, companion.word])));
  const target = {
    ...wordObj,
    key: wordObj.word,
    label: `${wordObj.word} & ${companion.word}`,
    explanation: `"${wordObj.situation}" → ${wordObj.word}. "${companion.situation}" → ${companion.word}.`,
  };
  return {
    target,
    prompt: `Two situations — pick the two words that fit:\n\n1) ${wordObj.situation}\n\n2) ${companion.situation}`,
    options,
    correctAnswers: [wordObj.word, companion.word],
    type: "multi",
  };
}

// --- Speed Round: a standalone timed mode for reviewing words already
// mastered — not for first learning. Picks a random mastered word and a
// fast MCQ style (never typing/multi, which take too long under a clock),
// reusing whatever content is currently active in that word's pools
// read-only, so nothing here touches pool locks, mastery, or triggers
// regeneration the way a normal round answer would.
const SPEED_MODES = ["meaning", "gap", "situation"];

function buildSpeedQuestion(pool) {
  for(const w of shuffle(pool)) {
    const choices=V2.optionWords([w],WORDS,4).map(x=>x.word);
    const prompts=[w.meaning,...(/_{2,}/.test(w.gap)?[w.gap]:[])].filter(text=>text&&text.length<=180&&!V2.norm(text).includes(V2.norm(w.word)));
    if(choices.length>=2&&prompts.length)return {target:{...w,key:w.word,label:w.word},prompt:shuffle(prompts)[0],options:choices,answer:w.word,type:"mcq"};
  }
  return null;
}


function findWordByLabel(label) {
  const key = String(label || "").trim().toLowerCase();
  return WORDS.find((w) => String(w.word || "").trim().toLowerCase() === key) || null;
}

function semanticRelation(a, b) {
  if (!a || !b || a.word === b.word) return null;
  if (a.opposite && String(a.opposite).toLowerCase() === String(b.word).toLowerCase()) return "antonym";
  if (b.opposite && String(b.opposite).toLowerCase() === String(a.word).toLowerCase()) return "antonym";
  const sim = meaningSimilarity(a.meaning, b.meaning);
  if (sim >= 0.45) return "related concept";
  if (a.semanticGroup && b.semanticGroup && a.semanticGroup === b.semanticGroup) return `semantic group: ${a.semanticGroup}`;
  if (a.wordFamily && b.wordFamily && a.wordFamily === b.wordFamily) return `word family: ${a.wordFamily}`;
  return null;
}

function hardDistractors(target, count = 3) { return sampleDistractors(target, count); }

function buildImpostorQuestion(wordObj, difficulty = 2) {
  const authored = authoredChallengesForWord(wordObj, "impostor");
  if (!authored.length) return null;
  return buildChallengeQuestion(shuffle(authored)[0]);
}

function safeLegacyQuestion(q) {
  if (!q) return q;
  const lists = [q.options, ...(q.steps || []).map(step => step.options)].filter(Array.isArray);
  let invalid = false;
  for (const list of lists) {
    if (list.length < 2 || new Set(list.map(V2.norm)).size !== list.length) invalid = true;
    const refs = list.map(label => WORDS.find(w => V2.norm(w.word) === V2.norm(label) || V2.norm(w.meaning) === V2.norm(label))).filter(Boolean);
    if (refs.some((w, i) => refs.slice(i + 1).some(other => !V2.compatible(w, other)))) invalid = true;
  }
  return invalid ? { ...q, type: "unavailable", prompt: "This authored question conflicts with option exclusions or has too few unique options. Report it or continue; no mastery credit is awarded." } : q;
}
function buildQuestion(...args) { return safeLegacyQuestion(buildQuestionUnsafe(...args)); }
function buildChallengeQuestion(...args) { return safeLegacyQuestion(buildChallengeQuestionUnsafe(...args)); }

function buildQuestionUnsafe(modeId, wordObj, pools, options = {}) {
  const difficulty = Math.max(1, Number(options.difficulty || 1));
  const confusionPartner = options.confusionPartner || null;
  if (modeId === "opposite") return { ...buildOppositeQuestion(wordObj), modeId, difficulty };
  if (modeId === "whoami") return { ...buildWhoAmIQuestion(wordObj), modeId, difficulty };
  if (modeId === "twopeople") return { ...(buildTwoPeopleQuestion(wordObj) || buildQuestion("situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "selecttwo") return { ...(buildSelectTwoQuestion(wordObj) || buildQuestion("situation", wordObj, pools, options)), modeId, difficulty };
  if (modeId === "impostor") return buildImpostorQuestion(wordObj, difficulty) || buildQuestion("situation", wordObj, pools, { ...options, difficulty: Math.min(2, difficulty) });

  if (modeId === "story") {
    const authored = authoredChallengesForWord(wordObj, "story");
    if (authored.length) return buildChallengeQuestion(shuffle(authored)[0]);
    if (isStrongStoryFallback(wordObj)) {
      const distractors = hardDistractors(wordObj, 3, confusionPartner);
      const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
      return {
        target,
        modeId: "story",
        difficulty,
        type: "mcq",
        prompt: `${wordObj.situation}\n\nWhich word best describes the complete story?`,
        options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]),
        answer: wordObj.word,
      };
    }
    return buildQuestion("situation", wordObj, pools, options);
  }

  const target = { ...wordObj, key: wordObj.word, label: wordObj.word, explanation: wordObj.meaning };
  if (modeId === "buildSentence" && wordObj.sentenceBuild) {
    const b = wordObj.sentenceBuild;
    return { target, modeId: "sentenceOrder", difficulty, type: "wordOrder", prompt: `Build the sentence using “${wordObj.word}”.`, answer: b.modelAnswer, acceptedAnswers: [b.modelAnswer], tokens: [...b.tokens] };
  }
  if (modeId === "phrasalTransform" && ["phrasal", "fyi"].includes(wordObj.type) && wordObj.transformExample) {
    return { target, modeId, difficulty, type: "typing", prompt: `Use “${wordObj.word}”: ${wordObj.transformExample.before}`, answer: wordObj.transformExample.after, acceptedAnswers: [wordObj.transformExample.after], modelOnly: true, freeformKind: "phrasalTransform" };
  }
  if (modeId === "buildSentence") {
    const rawGap = String(wordObj.gap || "");
    const gapIndex = rawGap.indexOf("______");
    const insertWord = gapIndex > 0
      ? wordObj.word.charAt(0).toLowerCase() + wordObj.word.slice(1)
      : wordObj.word;
    const completedGap = gapIndex !== -1 ? rawGap.replace("______", insertWord) : "";
    if (completedGap) {
      return {
        target,
        modeId,
        difficulty,
        type: "wordOrder",
        prompt: `Reorder the words to build a correct sentence using “${wordObj.word}”.`,
        answer: completedGap,
        acceptedAnswers: [completedGap],
        tokens: completedGap.split(/\s+/).filter(Boolean),
      };
    }
    return {
      target,
      modeId,
      difficulty,
      type: "selfCheck",
      prompt: `Write one sentence using “${wordObj.word}”. This check only verifies that the required word is included.`,
      requiredWords: [wordObj.word],
      exampleAnswer: wordObj.situation || wordObj.gap || "",
      answer: wordObj.word,
    };
  }
  if (modeId === "phrasalTransform") {
    if (!isPhrasal(wordObj)) return buildQuestion("gapTyping", wordObj, pools, options);
    const authored = authoredChallengesForWord(wordObj, "phrasalTransform");
    return authored.length ? buildChallengeQuestion(shuffle(authored)[0]) : buildQuestion("gapTyping", wordObj, pools, options);
  }
  if (modeId === "idiomDetective") {
    if (!isIdiom(wordObj)) return buildQuestion("situation", wordObj, pools, options);
    if (difficulty <= 2) {
      const distractors = hardDistractors(wordObj, 3, confusionPartner);
      return { target, modeId, difficulty, type: "mcq", prompt: wordObj.situation, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word };
    }
    return { target, modeId, difficulty, type: "freeform", prompt: `In this situation, what does “${wordObj.word}” mean?\n${wordObj.situation}`, answer: wordObj.meaning, freeformKind: "idiomMeaning" };
  }

  const wordPools = getWordPools(pools, wordObj);
  let poolMode = modeId === "gapTyping" ? "gap" : modeId;
  if (!POOL_TYPES.includes(poolMode)) poolMode = "situation";
  poolMode = resolvePoolMode(poolMode, wordObj, wordPools);
  const activeItem = pickActiveItem(wordPools, poolMode);
  const common = { target, modeId, difficulty, poolType: poolMode, poolItemId: activeItem.id };
  const distractors = difficulty >= 3 ? hardDistractors(wordObj, 3, confusionPartner) : sampleDistractors(wordObj, 3);

  if (modeId === "meaning" && difficulty >= 2) {
    const hard = difficulty >= 3 ? hardDistractors(wordObj, 3, confusionPartner) : distractors;
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...hard.map((d) => d.word)]), answer: wordObj.word, type: "mcq", direction: "meaningToWord" };
  }
  if (modeId === "meaning") {
    return { ...common, prompt: wordObj.word, options: shuffle([activeItem.text, ...distractors.map((d) => d.meaning)]), answer: activeItem.text, type: "mcq", direction: "wordToMeaning" };
  }
  if (modeId === "gap") {
    if (difficulty >= 3) {
      const first = difficulty === 3 ? `${wordObj.word.charAt(0)}${"_".repeat(Math.max(3, wordObj.word.length - 1))}` : null;
      return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing", hint: first, allowAlternativeGap: difficulty >= 5 };
    }
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word, type: "mcq" };
  }
  if (modeId === "gapTyping") {
    const first = difficulty <= 2 ? `${wordObj.word.charAt(0)}${"_".repeat(Math.max(3, wordObj.word.length - 1))}` : null;
    return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing", hint: first, allowAlternativeGap: difficulty >= 5 };
  }
  if (modeId === "situation") {
    return { ...common, prompt: activeItem.text, options: shuffle([wordObj.word, ...distractors.map((d) => d.word)]), answer: wordObj.word, type: "mcq" };
  }
  return { ...common, prompt: activeItem.text, answer: wordObj.word, type: "typing" };
}
function buildGrammarQuestion(g) {
  const target = { ...g, key: `grammar:${g.id}`, label: g.rule, explanation: g.explanation };
  return { target, modeId: "grammarCourt", prompt: g.prompt, options: shuffle(g.options), answer: g.answer, type: "mcq", court: true };
}

function buildPunQuestion(p) {
  const distractors = shuffle(PUNS.filter((o) => o.id !== p.id)).slice(0, 3).map((o) => o.pair);
  const target = { ...p, key: `pun:${p.id}`, label: p.word, explanation: p.pair };
  const options = shuffle([p.pair, ...distractors]);
  return { target, prompt: `"${p.word}" — ${p.joke}`, options, answer: p.pair, type: "mcq" };
}

function buildEntryQuestion(entry, pools) {
  if (entry.kind === "word") return buildQuestion(entry.mode, entry.wordObj, pools, { difficulty: entry.difficulty, confusionPartner: entry.confusionPartner });
  if (entry.kind === "grammar") return buildGrammarQuestion(entry.obj);
  if (entry.kind === "challenge") return buildChallengeQuestion(entry.obj);
  return buildPunQuestion(entry.obj);
}

// Adaptive builders remain question factories, but all questions are
// normalized into one V2 session/answer contract. There is no second runner.
function legacyQuestionToV2(question, entry, idSuffix = "0") {
  if (!question) return [];
  const mode = question.modeId || (entry.kind === "challenge" ? challengeType(entry.obj) : entry.kind);
  const linkedWords = entry.kind === "word" ? [entry.wordObj.word] : entry.kind === "challenge" ? challengeLinkedWords(entry.obj) : [];
  const progressKeys = entry.kind === "word" ? linkedWords : entry.kind === "grammar" ? [`grammar:${entry.obj.id}`] : entry.kind === "pun" ? [`pun:${entry.obj.id}`] : [`challenge:${entry.obj.id}`, ...linkedWords];
  const base = { id:`v2:${entry.kind}:${entry.obj?.id||entry.wordObj?.word||idSuffix}:${idSuffix}`, mode, targets:linkedWords, progressKeys, prompt:question.prompt, explanation:question.explanation||question.target?.explanation||"", difficulty:question.difficulty||entry.difficulty||1, poolType:question.poolType, poolItemId:question.poolItemId, challengeId:question.challengeId };
  if (question.type === "multiStage") return question.steps.flatMap((step,index)=>legacyQuestionToV2({...question,type:step.type,prompt:step.prompt,options:step.options,answer:step.acceptedAnswers?.[0],acceptedAnswers:step.acceptedAnswers,explanation:step.explanation||question.explanation,steps:undefined},entry,`${idSuffix}-step-${index+1}`));
  if (question.type === "unavailable") return [{...base,type:"mcq",options:["Skip this invalid question"],answers:["Skip this invalid question"],noMastery:true,noTelemetry:true}];
  if (question.type === "wordOrder") return [{...base,type:"order",tokens:V2.shuffleCopy((question.tokens||[]).map((text,index)=>({text,id:`${index}-${text}`}))),answers:question.acceptedAnswers?.length?question.acceptedAnswers:[question.answer]}];
  if (question.type === "selfCheck") return [{...base,type:"typing",answers:[question.exampleAnswer||question.answer||""],objectiveTerms:question.requiredWords||linkedWords,noMastery:true}];
  if (question.type === "multi") return [{...base,type:"multi",options:question.options||[],answers:question.correctAnswers||question.acceptedAnswers||[]}];
  if (question.type === "freeform" || question.type === "typing") return [{...base,type:"typing",answers:question.acceptedAnswers?.length?question.acceptedAnswers:[question.answer],modelOnly:!!question.modelOnly||question.type==="freeform",freeformKind:question.freeformKind}];
  return [{...base,type:"mcq",options:question.options||[],answers:[question.answer]}];
}

let poolsSnapshotForSession = {};
function v2SessionFromEntries(entries, {kind,title,idPrefix=kind}) {
  const queue=entries.flatMap((entry,index)=>legacyQuestionToV2(buildEntryQuestion(entry,poolsSnapshotForSession),entry,String(index)));
  return {id:`${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,kind,title,queue,introductions:[],index:0,answers:[],initialLength:queue.length};
}

function entryFileMeta(entry) {
  if (entry.kind === "word") return MODE_META[entry.mode];
  if (entry.kind === "grammar") return { label: "Grammar Court", icon: Scale };
  if (entry.kind === "challenge") return CHALLENGE_MODE_META[challengeType(entry.obj)] || { label: "Challenge", icon: BookOpen };
  return { label: "Puns", icon: Sparkles };
}

/* ----------------------------- CONTENT GENERATION --------------------------- */
// Asks the model for fresh gap/situation sentences or reworded meaning clues
// for whichever (word, poolType) pairs just ran out of unlocked variants.

function localGeneratedVariantCheck(request, text) {
  const value = String(text || "").trim();
  if (!value || value.length < 8 || value.length > 420) return false;
  const head = normalizeAnswerText(request.word);
  const normalized = normalizeAnswerText(value);
  if (request.poolType === "gap") {
    if (!value.includes("______")) return false;
    if (head && normalized.includes(head)) return false;
  }
  if ((request.poolType === "meaning" || request.poolType === "typing" || request.poolType === "situation") && head && normalized.includes(head)) return false;
  if (request.poolType === "situation" && value.split(/\s+/).length < 6) return false;
  return true;
}

async function validateGeneratedContent(requests, generated) {
  const locallyValid = generated.map((item, index) => ({ item, index, local: localGeneratedVariantCheck(requests[index] || {}, item?.text) })).filter((x) => x.local);
  if (!locallyValid.length) return [];
  try {
    const review = await callClaudeJson(`You are the quality-control layer for generated English-learning questions. Return ONLY JSON with shape {"results":[{"index":0,"valid":true,"confidence":"high|medium|low","reason":"brief"}]}. Reject a variant if context is vague, grammar is broken, the clue reveals the answer, the expected answer is ambiguous, distractors/sibling words could fit equally well, or the situation is culturally strange without reason. Be conservative; valid must be false when confidence is low.`, {
      requests: locallyValid.map(({ index }) => ({ index, ...requests[index], generatedText: generated[index]?.text })),
    }, 900);
    const verdicts = new Map((Array.isArray(review?.results) ? review.results : []).map((v) => [Number(v.index), v]));
    return locallyValid.filter(({ index }) => {
      const v = verdicts.get(index);
      return v?.valid === true && (v.confidence === "high" || v.confidence === "medium");
    }).map(({ item }) => item);
  } catch (e) {
    console.warn("AI question quality control unavailable; using conservative local validation.", e);
    return locallyValid.map(({ item }) => item);
  }
}

async function generateContent(batch, pools) {
  const wordByName = Object.fromEntries(WORDS.map((w) => [w.word, w]));
  const requests = batch.map(({ word, poolType }) => {
    const w = wordByName[word];
    const siblings = WORDS.filter((x) => x.category === w.category && x.word !== w.word)
      .map((x) => `${x.word} = ${x.meaning}`)
      .join(" | ");
    const existing = (pools[word]?.[poolType] || []).map((it) => it.text);
    return { word, poolType, meaning: w.meaning, category: w.category, siblings, existing };
  });

  const instructions = `Use B1-or-easier supporting language; only the target word and taught rule are exempt. You write short exercise content for an English vocabulary game. You will receive a JSON array of requests. For each request, produce ONE new piece of text for the given "poolType":

- poolType "meaning" or "typing": reword the given "meaning" definition in fresh wording. Keep the exact same core meaning — do not invent a different definition. One sentence. Do not use the headword itself.
- poolType "gap": write ONE new natural English sentence that uses the word/phrase naturally in a fresh context, then replace the word with exactly "______". The answer word (or any part of it) must NOT appear anywhere else in the sentence.
- poolType "situation": write a short 1-2 sentence scenario (use a person's name) that clearly and uniquely implies the word's meaning. The related words listed in "siblings" are close synonyms in the same category — the scenario must clearly point to THIS word and not those. Do not use the headword itself anywhere in the scenario.

For every request, avoid closely repeating anything listed in "existing" — write something meaningfully different.

Respond with ONLY a raw JSON array, no markdown fences, no commentary, matching this exact shape and the same order as the input:
[{"word": "...", "poolType": "...", "text": "..."}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${instructions}\n\nRequests:\n${JSON.stringify(requests)}` }],
    }),
  });

  const data = await response.json();
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!Array.isArray(parsed)) throw new Error("Unexpected generation response shape");
  return validateGeneratedContent(requests, parsed);
}


function extractClaudeText(data) {
  return Array.isArray(data?.content)
    ? data.content.filter((block) => block?.type === "text").map((block) => block.text || "").join("")
    : "";
}

// Scans for the first complete top-level JSON object/array in a string,
// tracking string literals (so a brace inside quoted text doesn't throw off
// the count) and brace/bracket depth (so trailing prose containing its own
// "{" or "}" — an example, a note, a second snippet — can't extend the
// match past the real end). Replaces a naive "first { to last }" slice,
// which broke as soon as anything after the JSON contained a brace.
function extractFirstJsonValue(text) {
  const s = String(text || "");
  let start = -1;
  for (let i = 0; i < s.length; i++) { if (s[i] === "{" || s[i] === "[") { start = i; break; } }
  if (start === -1) return null;
  const open = s[start], close = open === "{" ? "}" : "]";
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function parseJsonLoose(text) {
  const clean = String(text || "").replace(/```json|```/gi, "").trim();
  try { return JSON.parse(clean); } catch (_) {}
  const extracted = extractFirstJsonValue(clean);
  if (extracted) { try { return JSON.parse(extracted); } catch (_) {} }
  throw new Error("Invalid AI JSON");
}

async function callClaudeJson(instructions, payload, maxTokens = 800) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: `${instructions}\n\nINPUT JSON:\n${JSON.stringify(payload)}` }],
    }),
  });
  if (!response.ok) throw new Error(`AI request failed (${response.status})`);
  const data = await response.json();
  return parseJsonLoose(extractClaudeText(data));
}

async function askAiForWord(rawTerm, existingWord = null) {
  const term=String(rawTerm||"").trim().replace(/^[^A-Za-z]+|[^A-Za-z' -]+$/g,"").replace(/\s+/g," ").slice(0,80);
  if(!term)throw new Error("Select or type an English word first.");
  const result=await callClaudeJson(`You are the Word Hunter vocabulary coach. Use English only and B1-or-easier supporting language. Explain the requested word or short phrase accurately in its most likely meaning. If an existingEntry is given, its partsOfSpeech (if present) is authoritative — keep those exact values. A word can have more than one (e.g. a noun that is also used as a verb) — list every part of speech that applies to this meaning. Return ONLY JSON with this shape: {"word":"canonical form","type":"vocab|idiom|binomial|phrasal|fyi","partsOfSpeech":["noun"],"category":"short topic","meaning":"simple definition","pronunciation":"easy readable pronunciation","situation":"one natural example sentence","gap":"the same kind of example with the target replaced by exactly ______","nearWords":[{"word":"...","difference":"..."}],"commonMistake":{"sentence":"...","correction":"...","why":"..."},"hints":["...","..."]}. Never include Arabic. The gap must not reveal the answer.`,{term,existingEntry:existingWord||null},1000);
  const partsOfSpeech=Array.isArray(existingWord?.partsOfSpeech)&&existingWord.partsOfSpeech.length?existingWord.partsOfSpeech:(Array.isArray(result.partsOfSpeech)?result.partsOfSpeech.map(String).filter(Boolean):[]);
  const entry={word:String(result.word||term).trim(),type:["vocab","idiom","binomial","phrasal","fyi"].includes(result.type)?result.type:"vocab",partsOfSpeech,category:String(result.category||"AI Discoveries").trim(),meaning:String(result.meaning||"").trim(),situation:String(result.situation||"").trim(),gap:String(result.gap||"").trim(),hints:Array.isArray(result.hints)?result.hints.map(String).filter(Boolean).slice(0,3):[]};
  if(result.commonMistake?.sentence&&result.commonMistake?.correction&&result.commonMistake?.why)entry.commonMistake={sentence:String(result.commonMistake.sentence),correction:String(result.commonMistake.correction),why:String(result.commonMistake.why)};
  if(!entry.meaning||!entry.situation||!entry.gap.includes("______"))throw new Error("AI returned an incomplete vocabulary card. Try again.");
  return {...result,...entry};
}

async function aiFixImportJson(rawText, errorText) {
  const clean = String(rawText || "").trim();
  if (!clean) throw new Error("Nothing to fix — paste or upload JSON first.");
  if (clean.length > 60000) throw new Error("This file is too large for AI auto-fix in one pass — split it into smaller chunks and fix each separately.");
  const result = await callClaudeJson(
    `You are repairing a JSON document for the "Word Hunter" English vocabulary game's Admin import. The document below failed validation. You are given the exact validator error messages and the raw text the person pasted or uploaded (it may not even be valid JSON yet — fix syntax errors too if present).
Rules:
- Fix ONLY what the listed errors require. Do not rewrite, rephrase, reorder, or "improve" any field, sentence, or value that wasn't flagged.
- Every "word" value (in the words array) and every "id" value (in grammar/stories/combos/challenges/puns) is a stable progress key — never change, rename, or regenerate one of these unless an error explicitly says the id/word itself is invalid (e.g. missing or duplicate).
- If a required field is completely missing or empty and an error flags it, write a short, reasonable, English-only placeholder value that keeps the schema valid, and mention that placeholder in "changes" so a human reviews it — never guess elaborate content silently.
- Keep the overall JSON shape (schemaVersion, kind, note, and array names) exactly as given; do not add or remove top-level fields beyond what's needed to fix an error.
- If some errors genuinely cannot be fixed without information only the author has (e.g. an ambiguous duplicate you can't safely merge), leave that item as-is and explain why in "changes" instead of guessing.
Return ONLY JSON with this exact shape: {"fixed": <the complete corrected JSON document, valid JSON>, "changes": ["short plain-English description of each fix made, in the order applied"]}`,
    { validationErrors: String(errorText || "").split("\n").filter(Boolean), rawJson: clean },
    8000
  );
  if (!result || typeof result !== "object" || result.fixed === undefined) throw new Error("AI didn't return a usable fix. Try again or edit manually.");
  if (!Array.isArray(result.changes)) result.changes = [];
  return result;
}

// Given a reported question and the exact authored content object that
// generated it, asks the AI to propose a targeted correction. Scoped to a
// single content item (a word, grammar rule, combo, challenge or pun) —
// never a whole document — so the fix stays small and reviewable.
async function suggestReportFix(report, sourceItem, sourceEntity) {
  const singular = sourceEntity === "words" ? "word" : sourceEntity.slice(0, -1);
  const result = await callClaudeJson(
    `You are the content-quality reviewer for "Word Hunter", an English vocabulary game. A learner reported a specific question as having a problem. You are given the report (why they flagged it, the question type/mode, the exact prompt they saw, the options shown, and the correct answer(s)) plus the exact authored ${singular} entry that generated that question. Propose a corrected version of ONLY the field(s) that need to change to fix the reported problem — leave every other field exactly as given. The "word" or "id" field is a stable progress key and must NEVER change.
Common causes worth checking: the situation/gap/prompt text accidentally contains or reveals the answer word itself; the meaning is ambiguous, wrong, or too close to another word's meaning; a gap sentence has more than one blank or more than one plausible correct word; a grammar rule's options don't clearly have exactly one correct answer; a commonMistake example doesn't match its paired situation.
If the report's reason doesn't map to an obvious fix, make your best conservative improvement to the field(s) most likely responsible and explain your reasoning in "changes" — never leave "fixed" identical to the input with an empty "changes" list.
Return ONLY JSON with this exact shape: {"fixed": <the complete corrected ${singular} object, same keys/shape as the input>, "changes": ["short plain-English description of each change made"]}`,
    { report: { reason: report.reason || null, mode: report.mode, prompt: report.prompt, options: report.options || null, answers: report.answers || null }, entity: sourceEntity, currentContent: sourceItem },
    1500
  );
  if (!result || typeof result !== "object" || !result.fixed) throw new Error("AI didn't return a usable fix. Try again or edit manually in Content Manager.");
  if (!Array.isArray(result.changes)) result.changes = [];
  return result;
}

// Reports carry a questionId like "combo:combo-project-leader-1:seed" or
// "grammar:g-42:variant-2" or "challenge:ch-7" (mode.js builds these in
// V2.practice) or, for a plain word question, just "<word>:<mode>". This
// walks that back to the exact authored entry so a fix can target it.
function locateReportSource(content, report) {
  const qid=String(report.questionId||"");
  for(const [prefix,entityId] of [["combo:","combos"],["grammar:","grammar"],["challenge:","challenges"]]){
    if(qid.startsWith(prefix)){
      const id=qid.slice(prefix.length).split(":")[0];
      const item=(content[entityId]||[]).find(x=>x.id===id);
      return item?{entity:entityId,item}:null;
    }
  }
  const wordName=report.targetWords?.[0]||qid.split(":")[0];
  const item=(content.words||[]).find(w=>V2.norm(w.word)===V2.norm(wordName));
  return item?{entity:"words",item}:null;
}

// Runs the moment a learner submits a report. One call both triages the
// report (is the question actually flawed, and was the learner's answer
// acceptable?) and, when it is flawed, drafts a fix to the authored entry.
// The learner sees the verdict right away; the admin gets the fix
// pre-computed on the report, still applied only by an explicit click.
async function reviewReportedQuestion(report, source) {
  const singular = source ? (source.entity === "words" ? "word" : source.entity.slice(0, -1)) : null;
  const keyField = source?.entity === "words" ? "word" : "id";
  const result = await callClaudeJson(
    `You are the content-quality reviewer for "Word Hunter", an English vocabulary game. A learner just reported a question. You get the report (their reason, the question mode/type, the exact prompt, the options shown, the correct answer(s), and the learner's own answer if they had already answered) plus, when available, the authored ${singular || "content"} entry that generated the question.
Decide honestly:
- "flawed": the question really has a problem (answer leaked in the prompt, wrong or missing correct answer, more than one defensible answer, confusing wording, typo, a valid learner answer wrongly rejected).
- "fine": the question is correct and clear; the learner's complaint does not hold.
- "unsure": you cannot tell with confidence.
If the learner gave an answer, set "learnerAnswerAcceptable" to true only if it is a genuinely correct answer to this exact question; otherwise false. Use null if they gave no answer.
"explanation" is shown to the learner: 1-2 short sentences, English only, B1-or-easier, friendly. For "fine", explain why the expected answer is right (and why theirs isn't, if they answered). For "flawed", say briefly what is wrong.
"adminNote" is one short sentence for the content author.
Only when the verdict is "flawed" AND an authored entry is given, return "fixed": the complete corrected entry with the same keys/shape, changing ONLY the field(s) needed to fix the problem, and list each change in "changes". The "${keyField}" field is a stable progress key and must NEVER change. Otherwise set "fixed" to null and "changes" to [].
Return ONLY JSON with this exact shape: {"verdict":"flawed|fine|unsure","confidence":"high|medium|low","learnerAnswerAcceptable":true,"explanation":"...","adminNote":"...","fixed":null,"changes":[]}`,
    {
      report: { reason: report.reason || null, mode: report.mode, type: report.type || null, prompt: report.prompt, options: report.options || null, answers: report.answers || null, learnerAnswer: report.learnerAnswer ?? null },
      entity: source?.entity || null,
      currentContent: source?.item || null,
    },
    1800
  );
  if (!result || typeof result !== "object") throw new Error("AI didn't return a usable review.");
  const verdict = ["flawed", "fine", "unsure"].includes(result.verdict) ? result.verdict : "unsure";
  let fixed = verdict === "flawed" && source && result.fixed && typeof result.fixed === "object" && !Array.isArray(result.fixed) ? result.fixed : null;
  // The progress key is never allowed to drift, whatever the model returned.
  if (fixed) fixed = { ...fixed, [keyField]: source.item[keyField] };
  return {
    verdict,
    confidence: ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low",
    learnerAnswerAcceptable: typeof result.learnerAnswerAcceptable === "boolean" && report.learnerAnswer != null ? result.learnerAnswerAcceptable : null,
    explanation: String(result.explanation || "").slice(0, 400),
    adminNote: String(result.adminNote || "").slice(0, 300),
    fixed,
    entity: fixed ? source.entity : null,
    changes: fixed && Array.isArray(result.changes) ? result.changes.map(String).slice(0, 10) : [],
    at: Date.now(),
  };
}

// Scans every distinct category name in use and proposes groups that are
// clearly the same topic written differently (punctuation, spacing,
// word order, abbreviation) — never merely related-but-distinct topics.
// Returns only groups the model is confident about; the admin still
// applies each merge explicitly via applyCategoryMerge in AdminControlCenter.
async function suggestCategoryMerges(categories) {
  const result = await callClaudeJson(
    `You are cleaning up the category taxonomy for "Word Hunter", an English vocabulary game's admin panel. You are given every distinct category name currently in use. Find groups of names that are clearly the SAME topic written differently — different punctuation, spacing, capitalization, word order, singular/plural, or an abbreviation (e.g. "Environment-Nature" vs "Environment & Nature"). Do NOT merge categories that are merely related but distinct topics (e.g. "Food" and "Cooking" stay separate; "Personality" and "Emotions" stay separate). Only propose a merge when confident a content author would consider them literally the same category. For each group, pick whichever existing name is best-formatted as the canonical one — never invent a new name not already in the list. Return ONLY JSON with shape {"merges": [{"canonical": "exact existing name", "duplicates": ["exact existing name", "..."]}]}. Omit any category with no duplicates — only include groups of 2+ names.`,
    { categories },
    2000
  );
  if (!result || !Array.isArray(result.merges)) throw new Error("AI didn't return a usable suggestion.");
  const known = new Set(categories);
  return result.merges
    .map(m => ({ canonical: String(m.canonical || "").trim(), duplicates: (Array.isArray(m.duplicates) ? m.duplicates : []).map(String).map(s => s.trim()).filter(d => d && d !== m.canonical && known.has(d)) }))
    .filter(m => m.canonical && known.has(m.canonical) && m.duplicates.length);
}

const FREEFORM_EVALUATION_CONTRACT = `Use B1-or-easier explanations. You are a conservative English-learning evaluator inside Word Hunter. Return ONLY one JSON object. Never reward random word stuffing. Accept beginner/intermediate English when the target meaning is genuinely correct. Minor grammar mistakes may still be acceptable if meaning is clear. If uncertain, set confidence to "low" and correct to false.
Required shape:
{"correct":true,"confidence":"high|medium|low","targetWordUsed":true,"semanticUse":"correct|partly_correct|incorrect|not_applicable","grammar":"acceptable|minor_issues|meaning_breaking","naturalness":"natural|acceptable|awkward|nonsense","spellingIssue":false,"feedback":"one concise sentence","suggestedCorrection":"optional concise correction"}`;

function validateEvaluation(raw, kind) {
  const allowedConfidence = new Set(["high", "medium", "low"]);
  const allowedSemantic = new Set(["correct", "partly_correct", "incorrect", "not_applicable"]);
  const allowedGrammar = new Set(["acceptable", "minor_issues", "meaning_breaking"]);
  const allowedNatural = new Set(["natural", "acceptable", "awkward", "nonsense"]);
  if (!raw || typeof raw !== "object") throw new Error("Invalid evaluation");
  const result = {
    correct: raw.correct === true,
    confidence: allowedConfidence.has(raw.confidence) ? raw.confidence : "low",
    targetWordUsed: raw.targetWordUsed === true,
    semanticUse: allowedSemantic.has(raw.semanticUse) ? raw.semanticUse : "incorrect",
    grammar: allowedGrammar.has(raw.grammar) ? raw.grammar : "meaning_breaking",
    naturalness: allowedNatural.has(raw.naturalness) ? raw.naturalness : "nonsense",
    spellingIssue: raw.spellingIssue === true,
    feedback: String(raw.feedback || "").slice(0, 260),
    suggestedCorrection: String(raw.suggestedCorrection || "").slice(0, 260),
  };
  const requiresTarget = kind === "sentence" || kind === "phrasalTransform";
  if (requiresTarget && !result.targetWordUsed) result.correct = false;
  if (result.semanticUse === "incorrect" || result.grammar === "meaning_breaking" || result.naturalness === "nonsense") result.correct = false;
  if (result.confidence === "low") result.correct = false;
  result.grade = result.correct
    ? (result.grammar === "acceptable" && result.naturalness === "natural" ? "Excellent" : "Good Evidence")
    : (result.semanticUse === "partly_correct" && result.naturalness !== "nonsense" ? "Almost" : "Incorrect Use");
  return result;
}

const REGENERATE_CONTRACT = `You write vocabulary content for an English-learning game aimed at B1-level (intermediate) learners. Rewrite the meaning and example sentence for the given word or phrase. Hard rules: the meaning must be ONE simple sentence using only A2-B1 vocabulary and grammar, and it must NOT contain the target word/phrase itself. The example must be ONE natural sentence, also B1-level or simpler, that clearly shows the word/phrase used with its intended meaning. If partsOfSpeech is given, the new meaning and example must use the word as that exact part of speech — do not drift to a different sense (e.g. a different meaning of the same spelling) or a different grammatical role. Do not reuse the current meaning or example verbatim — produce a genuinely different phrasing. Return ONLY one JSON object with this exact shape: {"meaning":"...","situation":"..."}`;

async function regenerateWordExplanation(word) {
  const raw = await callClaudeJson(REGENERATE_CONTRACT, {
    word: word.word,
    type: word.type,
    partsOfSpeech: word.partsOfSpeech || [],
    category: word.category,
    currentMeaning: word.meaning,
    currentExample: word.situation,
  }, 400);
  if (!raw || typeof raw.meaning !== "string" || typeof raw.situation !== "string" || !raw.meaning.trim() || !raw.situation.trim()) {
    throw new Error("Invalid regeneration response");
  }
  return { meaning: raw.meaning.trim(), situation: raw.situation.trim() };
}

const STORY_GENERATION_CONTRACT = `You create a B1 graded-reader mystery for Word Hunter. The learner must infer hidden vocabulary from events.

NON-NEGOTIABLE RULES:
1. Use every target concept exactly once as a distinct event, action, feeling, decision, or reaction.
2. NEVER write any target word or phrase in the title, story, dialogue, or question prompts. Also avoid its plural, tense, -ed/-ing form, obvious word-family form, and any near-synonym that directly gives away the answer. Be especially careful with idioms and phrasal verbs — depict the EFFECT or RESULT of the concept, never the phrase itself.
3. Show meanings through concrete evidence: who did what, what happened next, and how another person reacted. Do not write dictionary definitions.
4. Mix the selected categories into one coherent plot. Do not create separate mini-paragraphs that feel unrelated.
5. Write 10-20 sentences — use the higher end when there are more targets. Use B1-or-easier supporting English. Give people clear names and keep the event order easy to follow. Each target concept needs its own clear moment in the story; never rush two concepts into the same sentence.
6. Write exactly one question for every target (order doesn't matter, but every target word must be covered once). Each question must point to one specific named event in the story and require reading the story. A reader who sees only the question must not be able to answer it.
7. Do not ask "Which word means...?", "What is the word for...?", or any dictionary-style question.
8. The explanation may reveal the target after answering and must briefly connect it to the exact story evidence.
9. Use plain straight quotes ' " and a plain hyphen -, not curly quotes or em/en dashes, so sentences can be matched exactly across fields.
10. If "grammarRules" is provided (may be empty), naturally work one clear, unambiguous example sentence of each rule into the story text — a real sentence a character says or the narration uses, not a bolted-on example. For each rule, in the same order, return a grammarQuestions entry: {"rule":"...","promptSentence":"the exact sentence from the story with EXACTLY ONE tested span replaced by a single ______ blank","options":["correct form","wrong form", ...2-3 total],"answer":"the correct form","explanation":"..."}. Use exactly one ______ in promptSentence, never two — for paired structures (either/or, neither/nor, not only/but also, comparatives, etc.) keep one half of the pair written out in the sentence and blank only the other half, so a single answer fills the single blank. promptSentence with the blank filled back in by answer must be an exact substring of the story text (same words, same order). Wrong options must be plausible incorrect forms of the same grammar point (wrong tense/preposition/agreement/word order/pairing word), not unrelated words. If grammarRules is empty, return "grammarQuestions":[].

Return ONLY: {"title":"...","text":"...","questions":[{"targetWord":"...","prompt":"...","explanation":"..."}],"grammarQuestions":[...]}`;


// A target word must never appear in the generated story itself — the whole
// point is to depict its meaning through events, not to name it (see the
// contract above). Never trust the model's word on this alone: verify with a
// whole-word, inflection-tolerant match (and a plain substring check for
// multi-word phrases) and reject the story if any target leaked through.
// Common irregular verbs that show up as the first word of idioms/phrasal
// verbs (get/got, bite/bit, ...) — plain suffix rules can't catch these.
const IRREGULAR_VERB_FORMS = {
  get: ["got", "gotten", "getting"], give: ["gave", "given", "giving"], take: ["took", "taken", "taking"],
  go: ["went", "gone", "going"], come: ["came", "coming"], run: ["ran", "running"], break: ["broke", "broken", "breaking"],
  bite: ["bit", "bitten", "biting"], speak: ["spoke", "spoken", "speaking"], see: ["saw", "seen", "seeing"],
  do: ["did", "done", "doing"], say: ["said", "saying"], tell: ["told", "telling"], think: ["thought", "thinking"],
  find: ["found", "finding"], leave: ["left", "leaving"], feel: ["felt", "feeling"], keep: ["kept", "keeping"],
  hold: ["held", "holding"], bring: ["brought", "bringing"], buy: ["bought", "buying"], catch: ["caught", "catching"],
  fight: ["fought", "fighting"], win: ["won", "winning"], lose: ["lost", "losing"], sit: ["sat", "sitting"],
  stand: ["stood", "standing"], fall: ["fell", "fallen", "falling"], throw: ["threw", "thrown", "throwing"],
  know: ["knew", "known", "knowing"], wear: ["wore", "worn", "wearing"], drive: ["drove", "driven", "driving"],
  write: ["wrote", "written", "writing"], meet: ["met", "meeting"], pay: ["paid", "paying"], sell: ["sold", "selling"],
  understand: ["understood", "understanding"], wake: ["woke", "woken", "waking"], begin: ["began", "begun", "beginning"],
  drink: ["drank", "drunk", "drinking"], eat: ["ate", "eaten", "eating"], forget: ["forgot", "forgotten", "forgetting"],
  choose: ["chose", "chosen", "choosing"], blow: ["blew", "blown", "blowing"], draw: ["drew", "drawn", "drawing"],
  fly: ["flew", "flown", "flying"], grow: ["grew", "grown", "growing"], swear: ["swore", "sworn", "swearing"],
  tear: ["tore", "torn", "tearing"], ride: ["rode", "ridden", "riding"], hide: ["hid", "hidden", "hiding"],
  send: ["sent", "sending"], spend: ["spent", "spending"], lend: ["lent", "lending"], build: ["built", "building"],
  deal: ["dealt", "dealing"], mean: ["meant", "meaning"], lead: ["led", "leading"], shoot: ["shot", "shooting"],
  steal: ["stole", "stolen", "stealing"], swim: ["swam", "swum", "swimming"],
};
function storyTextLeaksWord(word, text) {
  const parts = String(word || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const irregular = IRREGULAR_VERB_FORMS[parts[0].toLowerCase()];
  const firstAlternatives = [`${escape(parts[0])}(e?s|e?d|ing)?`, ...(irregular ? irregular.map(escape) : [])];
  const firstPattern = `(?:${firstAlternatives.join("|")})`;
  const rest = parts.slice(1).map(escape).join("\\s+");
  const pattern = rest ? `\\b${firstPattern}\\s+${rest}\\b` : `\\b${firstPattern}\\b`;
  return new RegExp(pattern, "i").test(text);
}

// A grammar question generated alongside the story is only trustworthy if
// its example sentence genuinely came from the story text — otherwise the
// AI could invent a plausible-looking sentence that was never actually
// woven into the plot. Filling the blank back in and checking it's a real
// substring of the story (whitespace/case-insensitive) is the ground truth.
function grammarSentenceIsGrounded(promptSentence, answer, storyText) {
  if (typeof promptSentence !== "string" || !promptSentence.includes("______")) return false;
  if (typeof answer !== "string" || !answer.trim()) return false;
  const filled = promptSentence.replace("______", answer);
  // The model sometimes writes the same sentence with different Unicode
  // punctuation in the two fields (curly vs straight quotes, en/em dash vs
  // hyphen) even though it's the same wording — fold those before comparing
  // so a real match isn't rejected over typography alone.
  const norm = (s) => String(s || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return norm(storyText).includes(norm(filled));
}

async function generateStory(targetWords, selectedCategories=[], grammarRules=[], attempt=1, _leakyWords=new Set()) {
  // On retry, swap out any word that leaked in a previous attempt with a
  // fresh candidate of the same type from the same category pool.
  const activeTargets = targetWords.map(w => {
    if (!_leakyWords.has(V2.norm(w.word))) return w;
    // pick a different word of the same type from the same category
    const alt = WORDS.filter(c => c.category === w.category && c.type === w.type && V2.norm(c.word) !== V2.norm(w.word) && !targetWords.some(t => V2.norm(t.word) === V2.norm(c.word))).sort(() => Math.random() - 0.5)[0];
    return alt || w; // fall back to original if no swap available
  });

  const raw = await callClaudeJson(STORY_GENERATION_CONTRACT, {
    selectedCategories,
    targetWords: activeTargets.map(w => ({ word: w.word, type: w.type, category: w.category, meaning: w.meaning, exampleContext: w.situation })),
    grammarRules: grammarRules.map(g => ({ rule: g.rule, category: g.category })),
    ...(attempt > 1 ? { retryNotice: `Attempt ${attempt}/3. Previous attempt failed. Be extra careful: depict every target purely through events; never write the word itself, an inflected form, or a near-synonym. For idioms and phrasal verbs, describe only the outcome or behaviour — never the phrase.` } : {}),
  }, 2400);

  if (!raw || typeof raw.title !== "string" || typeof raw.text !== "string" || !Array.isArray(raw.questions) || !raw.questions.length)
    throw new Error("Invalid story response — the model returned an unexpected format.");

  // ── vocab leak check — identify WHICH words leaked for smart retry ──
  const leakyWords = new Set();
  for (const w of activeTargets)
    if (storyTextLeaksWord(w.word, `${raw.title} ${raw.text}`)) leakyWords.add(V2.norm(w.word));
  if (leakyWords.size > 0) {
    if (attempt < 3) return generateStory(targetWords, selectedCategories, grammarRules, attempt + 1, leakyWords);
    const names = activeTargets.filter(w => leakyWords.has(V2.norm(w.word))).map(w => w.word).join(", ");
    throw new Error(`Story leaks target word(s) after ${attempt} attempts: ${names}`);
  }

  // ── vocab questions — match by targetWord content, not position ──
  if (raw.questions.length !== activeTargets.length)
    throw new Error(`Expected ${activeTargets.length} questions, received ${raw.questions.length}.`);
  const usedQIdx = new Set();
  const questions = activeTargets.map(target => {
    const qi = raw.questions.findIndex((q, i) => !usedQIdx.has(i) && q && typeof q.targetWord === "string" && V2.norm(q.targetWord) === V2.norm(target.word));
    if (qi === -1) throw new Error(`Missing a story question for: ${target.word}`);
    usedQIdx.add(qi);
    const q = raw.questions[qi];
    if (typeof q.prompt !== "string" || !q.prompt.trim()) throw new Error("Invalid story question — empty prompt.");
    for (const t of activeTargets)
      if (storyTextLeaksWord(t.word, q.prompt)) throw new Error(`Question leaks a target word: ${t.word}`);
    if (/which word means|what is the word for|which term means/i.test(q.prompt))
      throw new Error("A question uses a dictionary-style clue.");
    return { mode: "mcq", targetWord: q.targetWord, prompt: q.prompt.trim(), explanation: String(q.explanation || "").trim() || q.targetWord };
  });

  // ── grammar questions — drop individual failures, never reject the whole story ──
  const rawGQ = Array.isArray(raw.grammarQuestions) ? raw.grammarQuestions : [];
  const grammarQuestions = rawGQ.reduce((acc, g, index) => {
    try {
      if (!g || typeof g.promptSentence !== "string" || typeof g.answer !== "string" || !Array.isArray(g.options) || g.options.length < 2)
        throw new Error("bad shape");
      if ((g.promptSentence.match(/______/g) || []).length !== 1)
        throw new Error("not exactly one blank");
      if (!g.options.some(o => V2.norm(o) === V2.norm(g.answer)))
        throw new Error("answer not in options");
      if (!grammarSentenceIsGrounded(g.promptSentence, g.answer, raw.text))
        throw new Error("not grounded");
      acc.push({ id: `story-grammar:${Date.now()}:${index}`, mode: "grammarCourt", type: "mcq", prompt: g.promptSentence.trim(), answers: [g.answer], targets: [], options: g.options, explanation: String(g.explanation || "").trim() || `Grammar: ${grammarRules[index]?.rule || ""}` });
    } catch (e) {
      // log silently so the UI can see it, but keep the rest of the story
      console.warn(`Word Hunter: dropping grammar question [${index}] (${grammarRules[index]?.rule}): ${e.message}`);
    }
    return acc;
  }, []);

  const categories = [...new Set(selectedCategories.length ? selectedCategories : activeTargets.map(w => w.category))];
  return {
    id: `story-gen-${Date.now()}`,
    category: categories.length === 1 ? categories[0] : "Mixed Story",
    sourceCategories: categories,
    title: raw.title.trim(),
    text: raw.text.trim(),
    targetWords: activeTargets.map(w => w.word),
    questions,
    grammarQuestions,
  };
}

async function evaluateFreeForm(question, answerText) {
  const kind = question.freeformKind || "sentence";
  const payload = {
    kind,
    targetWord: question.target?.word || question.target?.label,
    targetMeaning: question.target?.meaning || question.target?.explanation,
    situation: question.target?.situation || null,
    expectedAnswer: question.answer || null,
    learnerAnswer: answerText,
    rules: kind === "idiomMeaning"
      ? "Judge whether the learner correctly explains the idiom in this situation. The learner does not need to repeat the idiom itself."
      : kind === "phrasalTransform"
      ? "The requested target phrasal verb should be used. A different valid equivalent may be acknowledged in feedback, but targetWordUsed must be false unless the requested target itself is present."
      : "Judge whether the target word is actually used with the intended meaning in a meaningful natural sentence; reject random word stuffing.",
  };
  const raw = await callClaudeJson(FREEFORM_EVALUATION_CONTRACT, payload);
  return validateEvaluation(raw, kind);
}

async function evaluateAlternativeGap(question, answerText) {
  const raw = await callClaudeJson(`${FREEFORM_EVALUATION_CONTRACT}\nFor this task, targetWordUsed may be false. Decide whether the learner's alternative word/phrase makes the exact gap sentence grammatically and semantically natural. If it is a reasonable alternative, correct may be true, but semanticUse must be correct.`, {
    kind: "gapAlternative",
    sentenceWithGap: question.prompt,
    intendedTarget: question.answer,
    intendedMeaning: question.target?.meaning,
    learnerAnswer: answerText,
  });
  return validateEvaluation(raw, "gapAlternative");
}

// Called once a combo's current situation has been answered correctly
// twice (pool item locked) — writes a fresh example testing the SAME two
// target words so the underlying contrast keeps getting practiced with
// varied situations instead of repeating or just disappearing.
async function generateComboVariant(combo) {
  const instructions = `Use B1-or-easier English. You write short "compare two things" exercise scenarios for an English vocabulary game. You are given two target words (a contrasting/opposite pair) and an existing situation+question. Write ONE brand-new situation testing the SAME two words with a DIFFERENT concrete example — same underlying contrast, fresh context, different characters/setting than the existing one. End with a short question asking the learner which word applies to which part. Do not use either target word inside the situation text itself. Respond with ONLY raw JSON, no markdown fences: {"situation":"...","prompt":"..."}`;
  const payload = { targetWords: combo.words, existingSituation: combo.situation, existingPrompt: combo.prompt, ruleExplanation: combo.explanation || "" };
  const raw = await callClaudeJson(instructions, payload, 500);
  const situation = String(raw?.situation || "").trim();
  const prompt = String(raw?.prompt || "").trim();
  if (!situation || !prompt) throw new Error("AI returned an incomplete combo variant.");
  if (combo.words.some((w) => new RegExp(`\\b${w}\\b`, "i").test(situation))) throw new Error("AI variant leaked a target word into the situation.");
  return { situation, prompt };
}

// Same idea for a grammarCourt question — a fresh example of the same
// rule (not the same sentence pair forever) once the current one is mastered.
async function generateGrammarVariant(g) {
  const instructions = `Use B1-or-easier English. You write short grammar-correction multiple-choice questions for an English vocabulary game. You are given an existing question testing one grammar rule (a common-mistake sentence and its correction). Write ONE brand-new example testing the SAME rule with different wording/context — not the same sentence reworded slightly. Respond with ONLY raw JSON, no markdown fences: {"prompt":"...","options":["<wrong sentence>","<correct sentence>"],"answer":"<must exactly match the correct sentence in options>","explanation":"one short sentence on why"}`;
  const payload = { existingPrompt: g.prompt, existingOptions: g.options, existingAnswer: g.answer, existingExplanation: g.explanation || "" };
  const raw = await callClaudeJson(instructions, payload, 500);
  const prompt = String(raw?.prompt || "").trim();
  const options = Array.isArray(raw?.options) ? raw.options.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const answer = String(raw?.answer || "").trim();
  const explanation = String(raw?.explanation || "").trim();
  if (!prompt || options.length < 2 || !answer || !options.includes(answer)) throw new Error("AI returned an incomplete grammar variant.");
  return { prompt, options, answer, explanation };
}

async function evaluateFinalReport(words, reportText) {
  const raw = await callClaudeJson(`Use B1-or-easier explanations. You are a conservative English-learning evaluator for Word Hunter's FINAL CASE. Return ONLY JSON. Evaluate each evidence word separately for genuine semantic use; string presence alone is not enough. Minor grammar errors are allowed when meaning remains clear. Do not automatically pass all words.
Required shape:
{"confidence":"high|medium|low","understandable":true,"quality":"Strong Evidence|Good Evidence|Almost|Needs Work","words":[{"word":"...","used":true,"semanticUse":"correct|partly_correct|incorrect","productionSuccess":true,"feedback":"brief"}],"feedback":"one concise improvement suggestion"}`, {
    evidenceWords: words.map((w) => ({ word: w.word, meaning: w.meaning })),
    report: reportText,
  }, 1200);
  if (!raw || !Array.isArray(raw.words)) throw new Error("Invalid final report evaluation");
  const byWord = new Map(raw.words.map((x) => [String(x.word || "").toLowerCase(), x]));
  const evaluatedWords = words.map((w) => {
    const item = byWord.get(w.word.toLowerCase()) || {};
    const semanticUse = ["correct", "partly_correct", "incorrect"].includes(item.semanticUse) ? item.semanticUse : "incorrect";
    return {
      word: w.word,
      used: item.used === true,
      semanticUse,
      productionSuccess: item.productionSuccess === true && item.used === true && semanticUse === "correct",
      feedback: String(item.feedback || "").slice(0, 180),
    };
  });
  return {
    confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "low",
    understandable: raw.understandable === true,
    quality: ["Strong Evidence", "Good Evidence", "Almost", "Needs Work"].includes(raw.quality) ? raw.quality : "Needs Work",
    words: evaluatedWords,
    feedback: String(raw.feedback || "").slice(0, 260),
  };
}

function normalizeAnswerText(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function containsRequiredTerm(text, term) {
  const clean = (value) => normalizeAnswerText(value).replace(/[^a-z0-9']+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = clean(text);
  const needle = clean(term);
  return !!needle && ` ${haystack} `.includes(` ${needle} `);
}

function spellingDistanceInfo(guess, expected) {
  const a = normalizeAnswerText(guess);
  const b = normalizeAnswerText(expected);
  const distance = levenshtein(a, b);
  const compactLength = Math.max(a.replace(/\s/g, "").length, b.replace(/\s/g, "").length);
  const maxMinor = compactLength <= 4 ? 1 : compactLength <= 8 ? 2 : 3;
  const close = a !== b && distance > 0 && distance <= maxMinor && distance / Math.max(1, compactLength) <= 0.28;
  return { distance, close, exact: a === b };
}

async function evaluateGrammarCorrection(question, correction) {
  const raw = await callClaudeJson(`You are the judge in Word Hunter's GRAMMAR COURT. Return ONLY JSON: {"correct":true,"confidence":"high|medium|low","feedback":"brief","suggestedCorrection":"optional"}. Accept any grammatically correct correction that fixes the relevant rule; do not require an exact string. Be conservative when the learner changes the sentence so much that the target rule is no longer being demonstrated.`, {
    rule: question.target?.label,
    explanation: question.target?.explanation,
    evidence: question.prompt,
    expectedVerdict: question.answer,
    learnerCorrection: correction,
  });
  return {
    correct: raw?.correct === true && (raw?.confidence === "high" || raw?.confidence === "medium"),
    confidence: ["high","medium","low"].includes(raw?.confidence) ? raw.confidence : "low",
    feedback: String(raw?.feedback || "").slice(0, 240),
    suggestedCorrection: String(raw?.suggestedCorrection || "").slice(0, 240),
  };
}

function buildContrastiveFeedback(question, selectedValue) {
  if (!question || !selectedValue || selectedValue === question.answer) return null;
  const selectedWord = findWordByLabel(selectedValue);
  const correctWord = findWordByLabel(question.answer) || question.target;
  if (!selectedWord || !correctWord?.meaning) return null;
  const relation = semanticRelation(correctWord, selectedWord);
  const selectedMeaning = String(selectedWord.meaning || "").replace(/\s+/g, " ").trim();
  const correctMeaning = String(correctWord.meaning || correctWord.explanation || "").replace(/\s+/g, " ").trim();
  return {
    chosen: selectedWord.word,
    correct: correctWord.word,
    chosenMeaning: selectedMeaning,
    correctMeaning,
    keyDifference: relation === "antonym"
      ? `${correctWord.word} and ${selectedWord.word} express opposite ideas.`
      : `${correctWord.word} fits this evidence; ${selectedWord.word} means ${selectedMeaning.charAt(0).toLowerCase()}${selectedMeaning.slice(1)}.`,
  };
}

// Real-time, situation-grounded version of the "Key difference" line above.
// The static version only contrasts dictionary meanings; this asks Claude to
// explain specifically why the CORRECT word fits *this* evidence/situation
// and why the chosen one doesn't, which is what was actually unclear.
async function explainWrongLead(question, chosenWord, correctWord) {
  const raw = await callClaudeJson(
    `You are writing one short "why is this wrong" line inside an English vocabulary game called Word Hunter. The learner picked the wrong multiple-choice word for a piece of evidence (a situation or gap sentence). Explain, in ONE concrete sentence (max ~25 words), why the CORRECT word fits THIS SPECIFIC evidence and why the CHOSEN word doesn't — ground it in the situation, don't just restate two dictionary definitions. Return ONLY JSON: {"keyDifference":"one sentence"}`,
    {
      evidence: question.target?.situation || question.prompt || null,
      chosenWord: chosenWord.word,
      chosenMeaning: chosenWord.meaning || chosenWord.explanation || null,
      correctWord: correctWord.word,
      correctMeaning: correctWord.meaning || correctWord.explanation || null,
    },
    200
  );
  const text = String(raw?.keyDifference || "").trim();
  return text ? text.slice(0, 240) : null;
}

function pruneConfusions(confusions) {
  const entries = Object.entries(confusions || {}).sort((a, b) => {
    const ac = confusionCount(a[1]), bc = confusionCount(b[1]);
    const at = Number(a[1]?.lastAt || 0), bt = Number(b[1]?.lastAt || 0);
    return bc - ac || bt - at;
  });
  return Object.fromEntries(entries.slice(0, MAX_CONFUSIONS));
}

function getWeakWordCandidates(words, mastery, confusions = {}, now = Date.now()) {
  return words.map((word) => {
    const stats = normalizeMasteryRecord(mastery[word.word]);
    const accuracy = getAccuracy(stats);
    const due = isDueForReview(stats, now);
    const lastWrong = stats.lastResult === "wrong";
    const lowAccuracy = stats.total >= 3 && accuracy < 70;
    const weakModes = Object.entries(stats.modes).filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65).map(([id]) => id);
    const spelling = stats.spellingMisses > 0;
    const missingProduction = stats.correct >= 2 && getProductionCorrect(stats) === 0;
    const confusion = getStrongConfusion(word, confusions);
    const failedSentence = stats.sentenceAttempts >= 1 && stats.sentenceSuccesses < stats.sentenceAttempts;
    if (!due && !lastWrong && !lowAccuracy && !weakModes.length && !spelling && !missingProduction && !confusion && !failedSentence) return null;
    let priority = 0;
    if (due) priority += 8;
    if (lastWrong) priority += 7;
    if (lowAccuracy) priority += 6;
    if (weakModes.length) priority += 5;
    if (spelling) priority += 4;
    if (missingProduction) priority += 4;
    if (confusion) priority += Math.min(7, confusion.count * 2);
    if (failedSentence) priority += 5;
    return { word, stats, accuracy, due, lastWrong, lowAccuracy, weakModes, spelling, missingProduction, confusion, failedSentence, priority };
  }).filter(Boolean).sort((a, b) => b.priority - a.priority || a.accuracy - b.accuracy || Number(a.stats.lastReviewedAt || 0) - Number(b.stats.lastReviewedAt || 0));
}

function pickWeakMode(word, stats, confusions = {}, quarantine = null) {
  const s = normalizeMasteryRecord(stats);
  const isQuarantined = (mode) => !!quarantine && quarantine.has(`${String(word.word || "").trim().toLowerCase()}|${mode}`);
  const confusion = getStrongConfusion(word, confusions);
  if (s.spellingMisses > 0 && (!s.modes.typing || modeAccuracy(s, "typing") < 80) && !isQuarantined("typing")) return "typing";
  const weak = Object.entries(s.modes).filter(([, m]) => m.total >= 2 && (m.correct / m.total) < 0.65).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
  if (weak.length && getAllowedModes(word).includes(weak[0][0]) && !isQuarantined(weak[0][0])) return weak[0][0];
  if (confusion && !isQuarantined("meaning") && !isQuarantined("impostor")) return Math.random() < 0.5 ? "meaning" : "impostor";
  if (s.sentenceAttempts > s.sentenceSuccesses && !word.skipTyping && !DISABLED_MODES.has("buildSentence") && !isQuarantined("buildSentence")) return "buildSentence";
  if (getProductionCorrect(s) === 0 && s.correct >= 2 && !word.skipTyping) {
    const preferGapTyping = Math.random() < 0.5 || DISABLED_MODES.has("buildSentence");
    if (preferGapTyping && !isQuarantined("gapTyping")) return "gapTyping";
    if (!preferGapTyping && !isQuarantined("buildSentence")) return "buildSentence";
  }
  return selectAdaptiveMode(word, s, { sessionType: "weak", confusion, quarantine });
}

function deriveLearningInsights(words, mastery, confusions = {}, now = Date.now()) {
  const modeTotals = {};
  words.forEach((word) => {
    const stats = normalizeMasteryRecord(mastery[word.word]);
    Object.entries(stats.modes).forEach(([id, m]) => {
      const agg = modeTotals[id] || { correct: 0, total: 0 };
      agg.correct += m.correct; agg.total += m.total; modeTotals[id] = agg;
    });
  });
  const weakest = Object.entries(modeTotals).filter(([, x]) => x.total >= 3).sort((a, b) => (a[1].correct/a[1].total) - (b[1].correct/b[1].total))[0];
  const confusionEntry = Object.entries(confusions || {}).filter(([, v]) => confusionCount(v) >= 2).sort((a,b)=>confusionCount(b[1])-confusionCount(a[1]))[0];
  const dueCount = words.filter((w) => isDueForReview(mastery[w.word], now)).length;
  const closeToMastery = words.filter((w) => {
    const stats = normalizeMasteryRecord(mastery[w.word]);
    return getMasteryStage(stats, {kind:"word",obj:w}) === MASTERY_STAGE.LEARNED && stats.total >= 4 && getAccuracy(stats) >= 75;
  }).length;
  return {
    weakestMode: weakest ? { id: weakest[0], accuracy: (weakest[1].correct/weakest[1].total)*100 } : null,
    topConfusion: confusionEntry ? { pair: confusionEntry[0].split("|"), count: Number(confusionEntry[1]?.count || confusionEntry[1] || 0) } : null,
    dueCount,
    closeToMastery,
  };
}

function getBadgeProgress(badge, { mastery, bestStreak }) {
  if (badge.type === "category") {
    const level = LEVELS.find((l) => l.title === badge.category);
    const done = levelMasteredCount(level, mastery);
    return { done, total: level.items.length, earned: done >= level.items.length };
  }
  if (badge.type === "streak") {
    return { done: Math.min(bestStreak, badge.threshold), total: badge.threshold, earned: bestStreak >= badge.threshold };
  }
  const earned = LEVELS.every((l) => levelMasteredCount(l, mastery) >= l.items.length);
  return { done: earned ? 1 : 0, total: 1, earned };
}


function levelTitleBase(title) {
  const m = title.match(/^(.*) (I{1,3}|IV|V|VI|VII|VIII)$/);
  return m ? m[1] : title;
}

// Finds groups of existing level base-topics that are loose-duplicates of
// each other (e.g. ["Food Dining", "FoodDining", "Food And Dining"]), for
// the one-time cleanup tool that merges them back into one.
// Inserts any brand-new level titles into the ordering, right after the
// last existing level that shares the same base topic (so "Media II" lands
// next to "Media" instead of at the very end).
function insertLevelTitles(currentOrder, newTitles) {
  const order = [...currentOrder];
  newTitles.forEach((title) => {
    if (order.includes(title)) return;
    const base = levelTitleBase(title);
    let insertAt = order.length;
    for (let i = order.length - 1; i >= 0; i--) {
      if (levelTitleBase(order[i]) === base) {
        insertAt = i + 1;
        break;
      }
    }
    order.splice(insertAt, 0, title);
  });
  return order;
}


const SCHEMA_VERSION = 6;
// General settings — tunable knobs for round length and question mix.
// Kept small and additive so old saves without a `settings` block just
// fall back to these defaults.
const DEFAULT_SETTINGS = { questionsPerRound: 12, newWordsPerRound: 3, weakReviewSize: 8, enablePairModes: true, reviewFirstThreshold: 40 };
function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    questionsPerRound: Math.max(4, Math.min(30, Number(s.questionsPerRound) || DEFAULT_SETTINGS.questionsPerRound)),
    newWordsPerRound: Math.max(0, Math.min(10, Number(s.newWordsPerRound) ?? DEFAULT_SETTINGS.newWordsPerRound)),
    weakReviewSize: Math.max(3, Math.min(20, Number(s.weakReviewSize) || DEFAULT_SETTINGS.weakReviewSize)),
    enablePairModes: s.enablePairModes !== false,
    reviewFirstThreshold: Math.max(0, Math.min(500, Number(s.reviewFirstThreshold) ?? DEFAULT_SETTINGS.reviewFirstThreshold)),
  };
}
const STORAGE_KEY = "progress-v6";
const LEGACY_V5_STORAGE_KEY = "progress-v5";
const LEGACY_V4_STORAGE_KEY = "progress-v4";
const LEGACY_V3_STORAGE_KEY = "progress-v3";
const CUSTOM_CONTENT_KEY = "custom-content-v1";

function normalizeLevelStats(levelStats = {}, levelsCleared = []) {
  const out = {};
  if (levelStats && typeof levelStats === "object") {
    Object.entries(levelStats).forEach(([key, value]) => {
      out[key] = {
        ...value,
        attempts: Number(value?.attempts || 0),
        bestAccuracy: typeof value?.bestAccuracy === "number" ? value.bestAccuracy : null,
        stars: Math.max(0, Math.min(3, Number(value?.stars || 0))),
        lastPlayedAt: Number(value?.lastPlayedAt || 0) || null,
      };
    });
  }
  (levelsCleared || []).forEach((levelId) => {
    out[levelId] = { ...(out[levelId] || {}), stars: Math.max(1, Number(out[levelId]?.stars || 0)), migrated: out[levelId]?.migrated ?? true };
  });
  return out;
}

function migrateProgressData(raw = {}) {
  const levelsCleared = Array.isArray(raw.levelsCleared) ? [...new Set(raw.levelsCleared)] : [];
  const mastery = {};
  if (raw.mastery && typeof raw.mastery === "object") {
    Object.entries(raw.mastery).forEach(([key, record]) => { mastery[key] = normalizeMasteryRecord(record); });
  }
  // Repair confusion records whose count was corrupted to null/NaN by the old counter.
  const confusions = {};
  Object.entries(raw.confusions && typeof raw.confusions === "object" ? raw.confusions : {}).forEach(([pair, value]) => {
    confusions[pair] = { count: confusionCount(value), lastAt: Number(value?.lastAt || 0) };
  });
  // Production gate migration: words that climbed past PRODUCTION_GATE_STEP on
  // recognition evidence alone are pulled back and made due now, so their next
  // appearance is a typing question rather than a 14/30-day silence.
  const nowTs = Date.now();
  Object.entries(mastery).forEach(([key, record]) => {
    if (!isWordKey(key) || record.productionCorrect > 0 || record.reviewStep <= PRODUCTION_GATE_STEP) return;
    mastery[key] = { ...record, reviewStep: PRODUCTION_GATE_STEP, nextReviewAt: nowTs };
  });
  const solvedStories = Array.isArray(raw.solvedStories) ? raw.solvedStories.map(entry=>typeof entry==="string"?{id:entry,correct:0,total:0}:entry).filter(e=>e&&typeof e.id==="string") : [];
  const sessionLogs = Array.isArray(raw.sessionLogs) ? raw.sessionLogs.filter(e=>e&&typeof e.id==="string").slice(0,50) : [];
  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    score: Number(raw.score || 0),
    streak: Number(raw.streak || 0),
    bestStreak: Number(raw.bestStreak || 0),
    attempted: Number(raw.attempted || 0),
    mastery,
    levelsCleared,
    levelStats: normalizeLevelStats(raw.levelStats, levelsCleared),
    studyStreak: Number(raw.studyStreak || 0),
    bestStudyStreak: Number(raw.bestStudyStreak || 0),
    lastStudyDate: raw.lastStudyDate || null,
    pools: raw.pools && typeof raw.pools === "object" ? raw.pools : {},
    bestSpeedScore: Number(raw.bestSpeedScore || 0),
    bestSpeedCombo: Number(raw.bestSpeedCombo || 0),
    confusions,
    solvedStories,
    sessionLogs,
    settings: normalizeSettings(raw.settings),
  };
}

function emptyProgressData() {
  return migrateProgressData({ schemaVersion: SCHEMA_VERSION });
}

function AdminControlCenter({content,mastery,confusions,reports,activeSession,sessionLogs,estimatedStorageBytes,settings,onUpdateSettings,onClearActiveSession,onUpdate,onResolveReport,onReviewReport,onRetireVariant,onDeleteReport,onOpenImport,onExport,onClose}){
  const [tab,setTab]=useState("dashboard");
  const [entity,setEntity]=useState("words");
  const [query,setQuery]=useState("");
  const [editor,setEditor]=useState(null);
  const [draft,setDraft]=useState("");
  const [error,setError]=useState(null);
  const [editorBusy,setEditorBusy]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState(null); // { index, warning } | null
  const [categoryFilter,setCategoryFilter]=useState("");
  const [categoryBrowse,setCategoryBrowse]=useState("");
  const [stubOnly,setStubOnly]=useState(false);
  const [bulkFixBusy,setBulkFixBusy]=useState(false);
  const [bulkFixProgress,setBulkFixProgress]=useState(null); // {done,total} | null
  const [bulkFixReport,setBulkFixReport]=useState(null); // {succeeded:[word...], failed:[{word,message}]} | null
  const [categoryMergeBusy,setCategoryMergeBusy]=useState(false);
  const [categoryMergeError,setCategoryMergeError]=useState(null);
  const [categoryMergeSuggestions,setCategoryMergeSuggestions]=useState(null); // [{canonical,duplicates}] | null
  const [appliedMerges,setAppliedMerges]=useState([]); // canonical names already applied this session
  const [expandedLogId,setExpandedLogId]=useState(null);
  const [expandedReportKey,setExpandedReportKey]=useState(null);
  const [confirmDeleteReport,setConfirmDeleteReport]=useState(null);
  const [reportFixBusy,setReportFixBusy]=useState(false);
  const [reportFixError,setReportFixError]=useState(null);
  const [reportFix,setReportFix]=useState(null); // {key, entity, before, after, changes} | null
  const [reviewAllProgress,setReviewAllProgress]=useState(null); // {done,total,failed} | null
  // Move-to-category: {entity:"words", ids:["Fork"]} for a single item, or
  // {entity:"grammar", ids:[...every id currently in the browsed category]} for a bulk move.
  // Works across every category-bearing entity (words, grammar, combos, challenges, stories, puns).
  const [moveTarget,setMoveTarget]=useState(null);
  const [moveInput,setMoveInput]=useState("");
  function commitMove(){
    const target=moveInput.trim();
    if(!target||!moveTarget)return;
    const {entity:moveEntity,ids}=moveTarget;
    const moveKey=entities[moveEntity].key;
    // A category only shows up as a playable level if it's registered in
    // LEVEL_ORDER — moving words into a brand-new name (not picked from the
    // existing list) would otherwise silently orphan them: real content
    // that never appears in any level. Register it first (LEVEL_ORDER is a
    // plain module variable, updated synchronously, so the words update
    // right after this always sees the new level already in place —
    // doing it in the other order would have the words update overwrite
    // itself with a stale pre-move word list, since React state updates
    // aren't visible to the very next line). Only words drive levels, so
    // this registration only applies when moving words.
    if(moveEntity==="words"&&!(content.levels||[]).some(level=>level.title===target)){
      onUpdate("levels",[...(content.levels||[]),{id:`cat-${target}`,title:target}]);
    }
    const nextList=(content[moveEntity]||[]).map(item=>ids.includes(item[moveKey])?{...item,category:target}:item);
    onUpdate(moveEntity,nextList);
    setMoveTarget(null);setMoveInput("");
  }
  const entities={words:{key:"word",label:"Words"},grammar:{key:"id",label:"Grammar"},stories:{key:"id",label:"Stories"},combos:{key:"id",label:"Combos"},challenges:{key:"id",label:"Challenges"},puns:{key:"id",label:"Puns"},levels:{key:"title",label:"Levels"}};
  async function handleSuggestReportFix(report,key){
    setReportFixError(null);setReportFix(null);
    const source=locateReportSource(content,report);
    if(!source){setReportFixError("Couldn't find the source content for this report — it may already have been edited, moved, or deleted.");return;}
    setReportFixBusy(true);
    try{
      const result=await suggestReportFix(report,source.item,source.entity);
      setReportFix({key,entity:source.entity,before:source.item,after:result.fixed,changes:result.changes});
    }catch(e){
      setReportFixError(e.message||"AI couldn't suggest a fix. Try editing manually in Content Manager.");
    }finally{
      setReportFixBusy(false);
    }
  }
  // Loads the fix the AI drafted when the report was filed into the same
  // review/apply box the on-demand "Suggest fix" uses.
  function openStoredReportFix(report,key){
    const review=report.aiReview;
    const source=locateReportSource(content,report);
    if(!review?.fixed||!source){setReportFixError("The drafted fix no longer matches any content — ask AI for a fresh one.");return;}
    setReportFixError(null);
    setReportFix({key,entity:source.entity,before:source.item,after:review.fixed,changes:review.changes||[]});
  }
  // Triage every open report that hasn't had an AI review yet (e.g. filed
  // while offline or before this feature existed). One at a time, so a
  // long backlog doesn't fire dozens of parallel requests.
  async function reviewAllOpenReports(){
    const pending=reports.filter(r=>!r.resolvedAt&&!r.aiReview);
    if(!pending.length||!onReviewReport)return;
    let failed=0;
    setReviewAllProgress({done:0,total:pending.length,failed:0});
    for(let i=0;i<pending.length;i++){
      try{await onReviewReport(pending[i]);}catch{failed++;}
      setReviewAllProgress({done:i+1,total:pending.length,failed});
    }
  }
  function applyReportFix(report){
    if(!reportFix)return;
    const {entity,after}=reportFix;
    const key=entities[entity].key;
    const list=content[entity]||[];
    const next=list.map(x=>V2.norm(x[key])===V2.norm(after[key])?after:x);
    onUpdate(entity,next);
    onResolveReport(report);
    setReportFix(null);
  }
  const config=entities[entity], list=content[entity]||[];
  const categories=entity==="levels"?[]:[...new Set(list.map(item=>item.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const stubCount=entity==="words"?list.filter(w=>w._autoStub).length:0;
  const filtered=list.map((item,index)=>({item,index})).filter(({item})=>(!query||JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))&&(!categoryFilter||item.category===categoryFilter)&&(!stubOnly||item._autoStub));
  // Cross-type category browser: every entity keeps its own category filter
  // above, but that only ever shows one type (words, OR grammar, OR
  // combos...) at a time. This groups everything tagged with one category
  // across all types in one place, so editing "this category" doesn't mean
  // hopping between tabs to find every related piece.
  const browsableEntities=["words","grammar","combos","challenges","stories","puns"];
  const allCategories=[...new Set(browsableEntities.flatMap(id=>(content[id]||[]).map(item=>item.category)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const categoryGroups=categoryBrowse?browsableEntities.map(id=>({id,label:entities[id].label,items:(content[id]||[]).map((item,index)=>({item,index})).filter(({item})=>item.category===categoryBrowse)})).filter(g=>g.items.length):[];
  async function handleSuggestCategoryMerges(){
    setCategoryMergeError(null);setCategoryMergeBusy(true);
    try{
      const merges=await suggestCategoryMerges(allCategories);
      setCategoryMergeSuggestions(merges);setAppliedMerges([]);
    }catch(e){
      setCategoryMergeError(e.message||"AI couldn't analyze the categories. Try again.");
    }finally{
      setCategoryMergeBusy(false);
    }
  }
  // Same idea as commitMove but sweeps every duplicate name across every
  // category-bearing entity at once, since a fragmented category (e.g.
  // "Environment-Nature" vs "Environment & Nature") can have members
  // scattered across words, grammar, combos, challenges, stories and puns.
  function applyCategoryMerge(merge){
    if(!(content.levels||[]).some(level=>level.title===merge.canonical)){
      onUpdate("levels",[...(content.levels||[]),{id:`cat-${merge.canonical}`,title:merge.canonical}]);
    }
    for(const entityId of browsableEntities){
      const list=content[entityId]||[];
      if(!list.some(item=>merge.duplicates.includes(item.category)))continue;
      const next=list.map(item=>merge.duplicates.includes(item.category)?{...item,category:merge.canonical}:item);
      onUpdate(entityId,next);
    }
    setAppliedMerges(prev=>[...prev,merge.canonical]);
  }
  const stages={New:0,Familiar:0,Learned:0,Mastered:0};
  content.words.forEach(word=>{stages[V2.stage(mastery[word.word])]++;});
  const attempts=Object.values(mastery).reduce((sum,item)=>sum+Number(item?.total||0),0);
  const correct=Object.values(mastery).reduce((sum,item)=>sum+Number(item?.correct||0),0);
  const weak=[...content.words].map(word=>({word,stats:mastery[word.word]||{}})).filter(x=>x.stats.total>0).sort((a,b)=>(a.stats.correct/Math.max(1,a.stats.total))-(b.stats.correct/Math.max(1,b.stats.total))).slice(0,12);
  const topConfusions=Object.entries(confusions||{}).map(([pair,value])=>({pair,count:confusionCount(value)})).sort((a,b)=>b.count-a.count).slice(0,12);
  const missing=content.words.filter(word=>!word.meaning||!word.situation||!word.gap||!word.hints?.length||!word.sentenceBuild).length;
  function startEdit(item,index){setEditor({index,original:item||null});setDraft(JSON.stringify(item||defaultItem(entity),null,2));setError(null);}
  function defaultItem(type){const id=`${type.slice(0,2)}-${Date.now()}`;if(type==="words")return {word:"",type:"vocab",category:"General",meaning:"",situation:"",gap:"______",hints:[]};if(type==="grammar")return {id,category:"Grammar",rule:"",prompt:"",options:["",""],answer:"",explanation:""};if(type==="levels")return {title:"New Level"};return {id,category:"General"};}
  function saveEdit(){
    try{
      const item=JSON.parse(draft), key=config.key, value=V2.norm(item[key]);
      if(!value)throw new Error(`Missing ${key}.`);
      if(/[\u0600-\u06FF]/.test(JSON.stringify(item)))throw new Error("Game content must be English only; Arabic text is not allowed.");
      if(list.some((existing,index)=>index!==editor.index&&V2.norm(existing[key])===value))throw new Error(`Duplicate ${key}.`);
      if(entity!=="levels"){
        const candidate={schemaVersion:2,kind:"content",[entity]:[item]};
        const issues=V2.validateContent(candidate,content);
        if(issues.length)throw new Error(issues[0]);
      }
      const next=[...list];if(editor.index===null)next.push(item);else next[editor.index]=item;
      onUpdate(entity,next);setEditor(null);setError(null);
    }catch(problem){setError(problem.message||"Invalid JSON.");}
  }
  async function fillWordWithAi(){
    try{setEditorBusy(true);setError(null);const current=JSON.parse(draft);if(!current.word)throw new Error("Enter the word first.");const generated=await askAiForWord(current.word,current);const patch={type:generated.type,category:generated.category,meaning:generated.meaning,situation:generated.situation,gap:generated.gap,hints:generated.hints,...(generated.commonMistake?{commonMistake:generated.commonMistake}:{})};setDraft(JSON.stringify({...current,...patch},null,2));}catch(problem){setError(problem.message||"AI generation failed.");}finally{setEditorBusy(false);}
  }
  // Same idea as fillWordWithAi, but for every "_autoStub" word at once —
  // words auto-created from a dangling reference during import (see
  // healMissingWordRefs/healOpposites) that only ever got a placeholder
  // meaning. Runs sequentially (not in parallel) so one bad AI response
  // can't corrupt a batch write, and so progress can be shown honestly.
  async function handleBulkFixStubs(){
    const stubs=(content.words||[]).filter(w=>w._autoStub);
    if(!stubs.length||bulkFixBusy)return;
    setBulkFixBusy(true);setBulkFixReport(null);setBulkFixProgress({done:0,total:stubs.length});
    const succeeded=[],failed=[];
    let nextWords=[...content.words];
    for(const stub of stubs){
      try{
        const generated=await askAiForWord(stub.word,stub);
        const patch={type:generated.type,category:generated.category,meaning:generated.meaning,situation:generated.situation,gap:generated.gap,hints:generated.hints,...(generated.commonMistake?{commonMistake:generated.commonMistake}:{})};
        const updated={...stub,...patch};delete updated._autoStub;
        if(/[\u0600-\u06FF]/.test(JSON.stringify(updated)))throw new Error("Generated content contained non-English text.");
        const issues=V2.validateContent({schemaVersion:2,kind:"content",words:[updated]},content);
        if(issues.length)throw new Error(issues[0]);
        nextWords=nextWords.map(w=>w.word===stub.word?updated:w);
        succeeded.push(stub.word);
      }catch(e){
        failed.push({word:stub.word,message:e.message||"AI generation failed."});
      }
      setBulkFixProgress(p=>({done:(p?.done||0)+1,total:stubs.length}));
    }
    if(succeeded.length)onUpdate("words",nextWords);
    setBulkFixReport({succeeded,failed});
    setBulkFixBusy(false);setBulkFixProgress(null);
  }
  function remove(index){const warning=entity==="levels"?"Delete this level and all content assigned to it? Progress records remain in the backup.":`Delete this ${config.label.slice(0,-1).toLowerCase()}? Its learning history will be preserved but detached.`;setDeleteTarget({index,warning});}
  function confirmRemove(){if(!deleteTarget)return;onUpdate(entity,list.filter((_,i)=>i!==deleteTarget.index));setDeleteTarget(null);}
  return <section className="wh-admin-shell">
    <aside className="wh-admin-side"><div className="wh-admin-brand"><span>WH</span><div><b>CONTROL CENTER</b><small>Content &amp; Learning</small></div></div>{[["dashboard","Dashboard"],["content","Content Manager"],["reports","Question Reports"],["progress","Learning Progress"],["settings","Settings"],["data","Data Center"]].map(([id,label])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}<button onClick={onClose}>← Play Mode</button></aside>
    <main className="wh-admin-main">
      <header className="wh-admin-top"><div><small>WORD HUNTER V7</small><h2>{tab==="dashboard"?"Command Dashboard":tab==="content"?"Content Manager":tab==="reports"?"Question Reports":tab==="progress"?"Learning Progress":tab==="settings"?"Settings":"Data Center"}</h2></div><button className="wh-back-btn" onClick={onClose}>Close Admin</button></header>
      {tab==="dashboard"&&<><div className="wh-admin-kpis">{[[content.words.length,"Words"],[attempts,"Attempts"],[correct?Math.round(correct/Math.max(1,attempts)*100)+"%":"—","Accuracy"],[reports.filter(x=>!x.resolvedAt).length,"Open reports"],[missing,"Needs content"],[content.words.filter(w=>w._aiAdded).length,"AI-added"]].map(([value,label])=><article key={label}><b>{value}</b><span>{label}</span></article>)}</div><div className="wh-admin-grid"><article className="wh-admin-card"><h3>Mastery distribution</h3>{Object.entries(stages).map(([name,value])=><div className="wh-admin-meter" key={name}><span>{name}</span><i style={{width:`${content.words.length?value/content.words.length*100:0}%`}}/><b>{value}</b></div>)}</article><article className="wh-admin-card"><h3>Library health</h3><p>{content.grammar.length} grammar questions</p><p>{content.stories.length} stories · {content.combos.length} combos</p><p>{content.challenges.length} authored challenges · {content.puns.length} puns</p><p>{new Set(content.words.map(w=>V2.topic(w.category))).size} levels/categories</p></article></div></>}
      {tab==="content"&&<><div className="wh-admin-toolbar"><div className="wh-admin-entities">{Object.entries(entities).map(([id,item])=><button key={id} className={entity===id?"active":""} onClick={()=>{setEntity(id);setEditor(null);setCategoryFilter("");setCategoryBrowse("");setStubOnly(false);}}>{item.label} <span>{content[id]?.length||0}</span></button>)}</div>{categories.length>0&&<select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}</select>}<select value={categoryBrowse} onChange={e=>{setCategoryBrowse(e.target.value);setEditor(null);}} title="Show every word, grammar item, combo, challenge and story for one category, across all types"><option value="">Browse a category (all types)…</option>{allCategories.map(cat=><option key={cat} value={cat}>{cat}</option>)}</select><button className="wh-import-btn primary" disabled={categoryMergeBusy} onClick={handleSuggestCategoryMerges}><Sparkles size={13}/> {categoryMergeBusy?"Analyzing…":"Suggest category cleanup"}</button>{entity!=="levels"&&categoryFilter&&filtered.length>0&&<button onClick={()=>{setMoveTarget({entity,ids:filtered.map(({item})=>item[config.key])});setMoveInput("");}}>Move all {filtered.length} in "{categoryFilter}" to…</button>}{entity==="words"&&stubCount>0&&<label className="wh-admin-stub-toggle"><input type="checkbox" checked={stubOnly} onChange={e=>setStubOnly(e.target.checked)}/> Needs content only ({stubCount})</label>}{entity==="words"&&stubCount>0&&<button className="wh-import-btn primary" disabled={bulkFixBusy} onClick={handleBulkFixStubs}><Sparkles size={13}/> {bulkFixBusy?`Fixing ${bulkFixProgress?.done||0}/${bulkFixProgress?.total||stubCount}…`:`Fill ${stubCount} with AI`}</button>}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${config.label.toLowerCase()}…`}/><button className="primary" onClick={()=>startEdit(null,null)}>+ Add</button></div>{bulkFixReport&&<div className="wh-import-hint"><b>AI content fill: {bulkFixReport.succeeded.length} filled, {bulkFixReport.failed.length} failed.</b>{bulkFixReport.failed.length>0&&<ul>{bulkFixReport.failed.map((f,i)=><li key={i}>{f.word}: {f.message}</li>)}</ul>}<div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>setBulkFixReport(null)}>Dismiss</button></div></div>}{categoryMergeError&&<div className="wh-import-error">{categoryMergeError}</div>}{categoryMergeSuggestions&&<div className="wh-import-hint"><b>Suggested category merges:</b>{!categoryMergeSuggestions.length?<p>No confident duplicates found.</p>:categoryMergeSuggestions.map((m,i)=><div className="wh-admin-browse-row" key={i}><span><b>{m.canonical}</b><small>absorbs: {m.duplicates.join(", ")}</small></span><span>{appliedMerges.includes(m.canonical)?<i>Merged</i>:<button className="wh-import-btn primary" onClick={()=>applyCategoryMerge(m)}>Merge</button>}</span></div>)}<div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>{setCategoryMergeSuggestions(null);setAppliedMerges([]);}}>Dismiss</button></div></div>}{editor?<div className="wh-admin-editor"><div className="wh-admin-editor-head"><h3>{editor.index===null?`Add ${config.label}`:`Edit ${editor.original?.[config.key]}`}</h3><button onClick={()=>setEditor(null)}>Cancel</button></div><p>Edit every supported field as structured JSON. IDs and word labels are stable progress keys.</p><textarea value={draft} onChange={e=>setDraft(e.target.value)} spellCheck={false}/>{error&&<div className="wh-import-error">{error}</div>}<div className="wh-ai-actions"><button className="primary" onClick={saveEdit}>Validate &amp; Save</button>{entity==="words"&&<button disabled={editorBusy} onClick={fillWordWithAi}>{editorBusy?"Generating…":"Fill fields with AI"}</button>}<button onClick={()=>{try{setDraft(JSON.stringify(JSON.parse(draft),null,2));setError(null);}catch{setError("Invalid JSON.");}}}>Format JSON</button></div></div>:categoryBrowse?<div className="wh-admin-category-browse"><div className="wh-admin-category-browse-head"><h3>Everything in "{categoryBrowse}"</h3><button onClick={()=>setCategoryBrowse("")}>✕ Clear</button></div>{!categoryGroups.length?<p>Nothing tagged with this category yet.</p>:categoryGroups.map(group=><div className="wh-admin-card" key={group.id}><h4>{group.label} <span>{group.items.length}</span><button onClick={()=>{setMoveTarget({entity:group.id,ids:group.items.map(({item})=>item[entities[group.id].key])});setMoveInput("");}}>Move all {group.items.length} to…</button></h4>{group.items.map(({item,index})=><div className="wh-admin-browse-row" key={item[entities[group.id].key]||index}><span><b>{item[entities[group.id].key]}</b><small>{item.meaning||item.title||item.rule||item.prompt||""}</small></span><span><button onClick={()=>{setEntity(group.id);setCategoryFilter("");startEdit(item,index);}}>Edit</button><button onClick={()=>{setMoveTarget({entity:group.id,ids:[item[entities[group.id].key]]});setMoveInput("");}}>Move</button></span></div>)}</div>)}</div>:<div className="wh-admin-table"><div className="wh-admin-row head"><span>Item</span><span>Category / Type</span><span>Status</span><span>Actions</span></div>{filtered.map(({item,index})=>{const rec=entity==="words"?mastery[item.word]:null;const modesCount=rec?Object.values(rec.modes||{}).filter(m=>m.correct>0).length:0;return <div className="wh-admin-row" key={item[config.key]||index}><span><b>{item[config.key]}</b><small>{item.meaning||item.title||item.rule||item.prompt||""}</small></span><span>{entity==="levels"?`${content.words.filter(word=>V2.topic(word.category)===V2.topic(item.title)).length} words`:item.category||item.type||"—"}</span><span>{item._autoStub?<span className="wh-stub-badge" title="Auto-created from a missing reference during import — needs real content">⚠ Needs content</span>:entity==="words"?<span className="wh-status-stack"><b>{V2.stage(rec)}</b><small>{rec?.correct||0}/{rec?.total||0} · {modesCount} mode{modesCount===1?"":"s"}{item._aiAdded?" · AI-added":""}</small></span>:"Ready"}</span><span><button onClick={()=>startEdit(item,index)}>Edit</button>{entity!=="levels"&&<button onClick={()=>{setMoveTarget({entity,ids:[item[config.key]]});setMoveInput("");}}>Move</button>}<button className="danger" onClick={()=>remove(index)}>Delete</button></span></div>;})}</div>}</>}
      {tab==="reports"&&<div className="wh-admin-card"><h3>Reported questions</h3><p>An open report keeps that exact word + question type out of future sessions automatically. Resolving or retiring it lifts that block. AI checks each report when it's filed and drafts a fix when the question is really flawed.</p>{(()=>{const unreviewed=reports.filter(r=>!r.resolvedAt&&!r.aiReview).length;const busy=reviewAllProgress&&reviewAllProgress.done<reviewAllProgress.total;return (unreviewed>0||reviewAllProgress)&&<div className="wh-import-actions">{unreviewed>0&&<button className="wh-import-btn primary" disabled={busy} onClick={reviewAllOpenReports}><Sparkles size={13}/> {busy?`AI reviewing… ${reviewAllProgress.done}/${reviewAllProgress.total}`:`AI review open reports (${unreviewed})`}</button>}{reviewAllProgress&&!busy&&<small>Reviewed {reviewAllProgress.total-reviewAllProgress.failed}/{reviewAllProgress.total}{reviewAllProgress.failed?` · ${reviewAllProgress.failed} failed — try again`:""}</small>}</div>;})()}{!reports.length?<p>No questions have been reported.</p>:reports.slice().reverse().map((report,index)=>{const key=`${report.sessionId}-${report.questionId}-${index}`;const isOpen=expandedReportKey===key;return <article className="wh-admin-report" key={key}><div><button className="wh-admin-log-row" onClick={()=>{const next=isOpen?null:key;setExpandedReportKey(next);setReportFix(null);setReportFixError(null);}}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<b>{report.prompt||report.questionId}</b></button><small>{report.mode||"question"} · {(report.targetWords||[]).join(", ")||"no target"} · {new Date(report.at).toLocaleString()}</small>{report.reason&&<small><i>Reason: {report.reason}</i></small>}{report.aiReview&&<small className={`wh-report-ai ${report.aiReview.verdict}`}><Sparkles size={11}/> AI: {report.aiReview.verdict==='flawed'?'real problem':report.aiReview.verdict==='fine'?'question looks OK':'unsure'} ({report.aiReview.confidence}){report.aiReview.fixed?' · fix drafted':''}</small>}{isOpen&&<div className="wh-admin-log-detail"><p><b>Question ID:</b> {report.questionId}</p><p><b>Session:</b> {report.sessionId}</p>{report.options?.length>0&&<p><b>Options shown:</b> {report.options.join(" / ")}</p>}{report.answers?.length>0&&<p><b>Correct answer(s):</b> {report.answers.join(", ")}</p>}{report.poolType&&<p><b>Pool:</b> {report.poolType} / {report.poolItemId}</p>}{report.learnerAnswer!=null&&<p><b>Learner answered:</b> {Array.isArray(report.learnerAnswer)?report.learnerAnswer.join(" + "):String(report.learnerAnswer)}{report.aiReview?.learnerAnswerAcceptable!=null&&` (AI: ${report.aiReview.learnerAnswerAcceptable?'acceptable':'not acceptable'})`}</p>}{report.aiReview&&<div className="wh-import-hint"><b><Sparkles size={12}/> AI review: {report.aiReview.verdict}</b>{report.aiReview.adminNote&&<p>{report.aiReview.adminNote}</p>}{report.aiReview.explanation&&<p><small>Told the learner: {report.aiReview.explanation}</small></p>}</div>}<p>{report.resolvedAt?`Resolved ${new Date(report.resolvedAt).toLocaleString()} — no longer blocked.`:"Currently blocked from future sessions for this word + question type."}</p>{!report.resolvedAt&&<><div className="wh-import-actions">{report.aiReview?.fixed&&<button className="wh-import-btn primary" onClick={()=>openStoredReportFix(report,key)}><Sparkles size={13}/> Review drafted fix</button>}<button className={`wh-import-btn ${report.aiReview?.fixed?"secondary":"primary"}`} disabled={reportFixBusy} onClick={()=>handleSuggestReportFix(report,key)}><Sparkles size={13}/> {reportFixBusy?"Asking AI…":report.aiReview?.fixed?"Ask AI for a new fix":"Suggest fix with AI"}</button></div>{reportFixError&&<div className="wh-import-error">{reportFixError}</div>}{reportFix&&reportFix.key===key&&<div className="wh-import-hint"><b>AI suggests these changes to the {entities[reportFix.entity].label.slice(0,-1).toLowerCase()}:</b><ul>{reportFix.changes.map((c,i)=><li key={i}>{c}</li>)}</ul><textarea className="wh-import-textarea" value={JSON.stringify(reportFix.after,null,2)} readOnly rows={6}/><div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>setReportFix(null)}>Discard</button><button className="wh-import-btn primary" onClick={()=>applyReportFix(report)}>Apply fix &amp; resolve</button></div></div>}</>}</div>}</div><span className={report.resolvedAt?"resolved":"open"}>{report.resolvedAt?"Resolved":"Open"}</span><div>{!report.resolvedAt&&report.poolItemId&&<button onClick={()=>onRetireVariant(report)}>Retire variant</button>}{!report.resolvedAt&&<button onClick={()=>onResolveReport(report)}>Resolve</button>}<button onClick={()=>setConfirmDeleteReport(report)}>Delete</button></div></article>;})}</div>}
      {confirmDeleteReport&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmDeleteReport(null);}}><div className="wh-panel wh-confirm-panel" role="alertdialog"><p><b>Delete this report?</b></p><p>This only removes the report record. If it's still open, this also lifts the block on that word + question type — it can be selected again.</p><div className="wh-ai-actions"><button onClick={()=>setConfirmDeleteReport(null)}>Cancel</button><button className="primary" onClick={()=>{onDeleteReport(confirmDeleteReport);setConfirmDeleteReport(null);}}>Yes, delete</button></div></div></div>}
      {moveTarget&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setMoveTarget(null);setMoveInput("");}}}><div className="wh-panel wh-confirm-panel" role="alertdialog"><p><b>Move {moveTarget.ids.length>1?`${moveTarget.ids.length} ${entities[moveTarget.entity].label.toLowerCase()}`:`"${moveTarget.ids[0]}"`} to another category</b></p><p>{moveTarget.ids.length>1?"Every item listed keeps its content — only the category changes.":"Only the category changes; nothing else about this item is touched."}</p><input list="wh-category-options" value={moveInput} onChange={e=>setMoveInput(e.target.value)} placeholder="Pick an existing category or type a new one" style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",font:"12px 'IBM Plex Mono',monospace"}}/><datalist id="wh-category-options">{allCategories.map(cat=><option key={cat} value={cat}/>)}</datalist><div className="wh-ai-actions"><button onClick={()=>{setMoveTarget(null);setMoveInput("");}}>Cancel</button><button className="primary" disabled={!moveInput.trim()} onClick={commitMove}>Move</button></div></div></div>}
      {tab==="settings"&&<div className="wh-admin-card"><h3>Round &amp; question settings</h3><p>Changes apply the next time you start a session.</p>
        <label className="wh-settings-row"><span>Questions per round (Level Practice)</span><input type="number" min="4" max="30" value={settings.questionsPerRound} onChange={e=>onUpdateSettings({...settings,questionsPerRound:Math.max(4,Math.min(30,Number(e.target.value)||12))})}/></label>
        <label className="wh-settings-row"><span>New words introduced per round</span><input type="number" min="0" max="10" value={settings.newWordsPerRound} onChange={e=>onUpdateSettings({...settings,newWordsPerRound:Math.max(0,Math.min(10,Number(e.target.value)||0))})}/></label>
        <label className="wh-settings-row"><span>Words per Weak Review session</span><input type="number" min="3" max="20" value={settings.weakReviewSize} onChange={e=>onUpdateSettings({...settings,weakReviewSize:Math.max(3,Math.min(20,Number(e.target.value)||8))})}/></label>
        <label className="wh-settings-row"><span>Review-first when overdue words reach (0 = off)</span><input type="number" min="0" max="500" value={settings.reviewFirstThreshold} onChange={e=>onUpdateSettings({...settings,reviewFirstThreshold:Number(e.target.value)})}/></label>
        <label className="wh-settings-row wh-settings-toggle"><input type="checkbox" checked={settings.enablePairModes} onChange={e=>onUpdateSettings({...settings,enablePairModes:e.target.checked})}/><span>Enable "pick two" pair questions (twopeople / selecttwo) in Weak Review</span></label>
      </div>}
      {tab==="progress"&&<div className="wh-admin-grid"><article className="wh-admin-card"><h3>Weakest practiced words</h3>{weak.map(({word,stats})=><p key={word.word}><b>{word.word}</b> — {stats.correct||0}/{stats.total||0} · {V2.stage(stats)}</p>)}</article><article className="wh-admin-card"><h3>Top confusions</h3>{!topConfusions.length?<p>No confusion pairs recorded yet.</p>:topConfusions.map(item=><p key={item.pair}><b>{item.pair.replace("|"," ↔ ")}</b> — {item.count}</p>)}</article></div>}
      {tab==="data"&&<div className="wh-admin-grid"><article className="wh-admin-card"><h3>Import &amp; restore</h3><p>Validate content or a full backup before applying it. Existing progress keys remain attached.</p><button className="primary" onClick={onOpenImport}>Open Import Center</button></article><article className="wh-admin-card"><h3>Export</h3><p>Create a content-only handoff or a complete safety backup.</p><p className={`wh-storage-gauge ${estimatedStorageBytes>4*1024*1024?"danger":estimatedStorageBytes>2*1024*1024?"warn":""}`}>Saved progress size: ~{(estimatedStorageBytes/1024/1024).toFixed(2)} MB (storage limit: 5 MB per key)</p><div className="wh-ai-actions"><button onClick={()=>onExport("content")}>Export Content</button><button className="primary" onClick={()=>onExport("backup")}>Full Backup</button></div></article><article className="wh-admin-card"><h3>Active session</h3>{activeSession&&!activeSession.completed?<><p><b>{activeSession.kind==="story"?activeSession.title:activeSession.title||activeSession.kind}</b> · {activeSession.kind} · in progress</p><p>{Math.min(activeSession.index+1,activeSession.queue?.length||0)} / {activeSession.queue?.length||0} questions · {(activeSession.answers||[]).filter(a=>a?.correct).length} correct so far</p><p>Started as: <code>{activeSession.id}</code></p><button className="danger" onClick={onClearActiveSession}>Clear stuck session</button></>:activeSession&&activeSession.completed?<><p><b>{activeSession.title||activeSession.kind}</b> · {activeSession.kind} · last session, finished</p><p>{(activeSession.answers||[]).filter(a=>a?.correct).length} / {activeSession.queue?.length||0} correct — results already saved to progress.</p><button onClick={onClearActiveSession}>Clear from here</button></>:<p>No session started yet — the player is on the level list.</p>}{activeSession?.queue?.length>0&&<div className="wh-admin-session-questions">{activeSession.queue.map((q,i)=>{const a=activeSession.answers?.[i];return <div key={q.id||i} className={`wh-admin-session-q ${a?(a.correct?"ok":"bad"):"pending"}`}><b>{i+1}. {q.prompt}</b><span>Given: {a?(Array.isArray(a.value)?a.value.join(" + "):a.value||(a.reported?"Reported/skipped":"—")):"—"}</span><span>Correct: {(q.answers||[]).join(" + ")}</span></div>;})}</div>}</article><article className="wh-admin-card"><h3>Session log</h3><p>Last {sessionLogs.length} completed session{sessionLogs.length===1?"":"s"} (kept up to 50 — summary only, not every question).</p>{sessionLogs.length?<div className="wh-admin-session-questions">{sessionLogs.map(entry=>{const isOpen=expandedLogId===entry.id;const liveDetail=activeSession&&activeSession.id===entry.id&&activeSession.queue?.length?activeSession:null;return <div key={entry.id}><button className={`wh-admin-session-q wh-admin-log-row ${entry.total?(entry.correct/entry.total>=0.7?"ok":"bad"):"pending"}`} onClick={()=>setExpandedLogId(isOpen?null:entry.id)}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<span className="wh-admin-log-main"><b>{entry.title}</b><span>{entry.kind} · {entry.correct}/{entry.total} correct</span><span>{new Date(entry.at).toLocaleString()}</span></span></button>{isOpen&&(liveDetail?<div className="wh-admin-session-questions wh-admin-log-detail">{liveDetail.queue.map((q,i)=>{const a=liveDetail.answers?.[i];return <div key={q.id||i} className={`wh-admin-session-q ${a?(a.correct?"ok":"bad"):"pending"}`}><b>{i+1}. {q.prompt}</b><span>Given: {a?(Array.isArray(a.value)?a.value.join(" + "):a.value||(a.reported?"Reported/skipped":"—")):"—"}</span><span>Correct: {(q.answers||[]).join(" + ")}</span></div>;})}</div>:<p className="wh-admin-log-detail wh-admin-log-empty">Per-question detail wasn't kept for this session — only the most recently completed session keeps its full question breakdown (see "Active session" above while it's still the latest).</p>)}</div>;})}</div>:<p>No completed sessions logged yet.</p>}</article></div>}
    </main>
    {deleteTarget && (
      <div className="wh-modal-overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)setDeleteTarget(null);}}>
        <div className="wh-panel wh-confirm-panel" role="alertdialog">
          <p>{deleteTarget.warning}</p>
          <div className="wh-regen-actions">
            <button className="wh-level-btn wh-danger-btn" onClick={confirmRemove}>Yes, delete</button>
            <button className="wh-back-btn wh-nav-btn" onClick={()=>setDeleteTarget(null)}>Cancel</button>
          </div>
        </div>
      </div>
    )}
  </section>;
}

/* ---------------------------------- APP ---------------------------------- */

export default function WordHunter() {
  const [loaded, setLoaded] = useState(false);
  const [storageWarning, setStorageWarning] = useState(null);
  const [customCombos, setCustomCombos] = useState([]);
  const [customStories, setCustomStories] = useState([]);
  const [askAiOpen,setAskAiOpen]=useState(false);
  const [askAiTerm,setAskAiTerm]=useState("");
  const [listenTerm,setListenTerm]=useState(null);
  const [askAiResult,setAskAiResult]=useState(null);
  const [askAiBusy,setAskAiBusy]=useState(false);
  const [askAiError,setAskAiError]=useState(null);
  const [selectedStoryCategories,setSelectedStoryCategories]=useState([]);
  const [storyGenError,setStoryGenError]=useState("");
  const [storyGenState, setStoryGenState] = useState(null); // null | 'loading' | 'error' | {title,text,targetWords,questions}
  async function handleGenerateStory() {
    if(!selectedStoryCategories.length){setStoryGenError("Choose at least one category first.");return;}
    setStoryGenState("loading");
    setStoryGenError("");
    try {
      const usedElsewhere=new Set(customStories.flatMap(story=>(story.targetWords||[]).map(w=>V2.norm(w))));
      const weakOrder=new Map(getWeakWordCandidates(WORDS,mastery,confusions).map((item,index)=>[item.word.word,index]));
      // Words already used as a target in an earlier generated story are
      // pushed to the back of each category's pool (not hard-excluded) —
      // so a new story reaches for fresh vocabulary first, and only falls
      // back to a repeat if a category genuinely has nothing left unused.
      const byCategory=selectedStoryCategories.map(category=>{
        const all=V2.shuffleCopy(WORDS.filter(word=>word.category===category),Math.random).sort((a,b)=>(weakOrder.get(a.word)??9999)-(weakOrder.get(b.word)??9999));
        const fresh=all.filter(w=>!usedElsewhere.has(V2.norm(w.word)));
        const reused=all.filter(w=>usedElsewhere.has(V2.norm(w.word)));
        return {category,words:[...fresh,...reused]};
      }).filter(group=>group.words.length);
      const vocabAvailable=byCategory.reduce((sum,group)=>sum+group.words.filter(w=>(w.type||"vocab")==="vocab").length,0);
      if(vocabAvailable<5)throw new Error("The selected categories need at least five vocab words in total.");
      const targets=[];
      // "idiom / binomial / fyi / phrasal" targets are ADDITIONAL to the 5-7
      // vocab targets below, not counted against that budget — pick one of
      // each (when the selected categories actually contain one), randomly
      // among the weakest few so a manual "Regenerate" isn't stuck retrying
      // the same troublesome word forever.
      const REQUIRED_TYPES=["idiom","binomial","fyi","phrasal"];
      const allWords=byCategory.flatMap(group=>group.words);
      for(const type of REQUIRED_TYPES){
        const candidates=allWords.filter(w=>w.type===type&&!targets.some(t=>t.word===w.word)).sort((a,b)=>(usedElsewhere.has(V2.norm(a.word))?1:0)-(usedElsewhere.has(V2.norm(b.word))?1:0)||(weakOrder.get(a.word)??9999)-(weakOrder.get(b.word)??9999)).slice(0,3);
        const pick=candidates.length?candidates[Math.floor(Math.random()*candidates.length)]:null;
        if(pick)targets.push(pick);
      }
      // Now fill the separate 5-7 vocab-only budget via the same
      // weak-word-first, round-robin-across-categories approach.
      const vocabByCategory=byCategory.map(group=>({category:group.category,words:group.words.filter(w=>(w.type||"vocab")==="vocab")}));
      const vocabTargetCount=Math.min(7,Math.max(5,selectedStoryCategories.length+3),vocabAvailable);
      const vocabTargets=[];
      while(vocabTargets.length<vocabTargetCount&&vocabByCategory.some(group=>group.words.length))for(const group of vocabByCategory){if(vocabTargets.length>=vocabTargetCount)break;const word=group.words.shift();if(word&&!vocabTargets.some(item=>item.word===word.word))vocabTargets.push(word);}
      targets.push(...vocabTargets);
      // Pick which grammar RULES to weave in (up to 2, deduped by rule text)
      // from the selected categories — the AI writes the actual example
      // sentence and question, then generateStory verifies it's really in
      // the story before trusting it.
      const grammarRulePool=V2.shuffleCopy((GRAMMAR||[]).filter(g=>selectedStoryCategories.some(cat=>V2.topic(cat)===V2.topic(g.category))),Math.random);
      const seenRules=new Set(),grammarRules=[];
      for(const g of grammarRulePool){const key=V2.norm(g.rule);if(seenRules.has(key))continue;seenRules.add(key);grammarRules.push({rule:g.rule,category:g.category});if(grammarRules.length>=2)break;}
      const story = await generateStory(V2.shuffleCopy(targets,Math.random),selectedStoryCategories,grammarRules);
      setStoryGenState(story);
    } catch (e) {
      console.error("Word Hunter: story generation failed", e);
      setStoryGenError(e.message||"Story generation failed.");
      setStoryGenState("error");
    }
  }
  function toggleStoryCategory(category){setStoryGenState(null);setStoryGenError("");setSelectedStoryCategories(current=>current.includes(category)?current.filter(item=>item!==category):[...current,category]);}

  const [activeSession, setActiveSession] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  useEffect(() => { RUNTIME_DISABLED_MODES = new Set(settings.enablePairModes ? [] : ["twopeople", "selecttwo"]); }, [settings.enablePairModes]);
  const [questionReports,setQuestionReports]=useState([]);
  // Reported (word, mode) pairs are quarantined — excluded from being
  // picked again by the adaptive question generators — until an admin
  // resolves or retires the report. Keyed as `word|mode` (lowercased).
  const reportQuarantine = useMemo(() => {
    const set = new Set();
    for (const r of questionReports) {
      if (r.resolvedAt) continue;
      const words = r.targetWords?.length ? r.targetWords : [null];
      for (const w of words) if (w) set.add(`${String(w).trim().toLowerCase()}|${r.mode}`);
    }
    return set;
  }, [questionReports]);
  const [solvedStories,setSolvedStories]=useState([]);
  const [sessionLogs,setSessionLogs]=useState([]);
  const recordedSessionAnswersRef = useRef(new Set());
  const [section, setSection] = useState("practice");
  const progressExtrasRef = useRef({});
  const contentNoteRef = useRef("");
  function liveContent() { return { words: WORDS, grammar: GRAMMAR, puns: PUNS, challenges: CHALLENGES, combos: customCombos, stories: customStories, note: contentNoteRef.current }; }
  function launchSession(session) { setActiveSession(session); setScreen("session"); }
  function launchStory(story) { try { launchSession(V2.storySession(story, WORDS, masteryRef.current)); } catch(e) { setToast({text:e.message}); } }
  function launchChain(group) { try { const session = V2.chainSession(group, WORDS, masteryRef.current); if(!session.queue.length) {setToast({text:"No eligible opposite questions yet."});return;} launchSession(session); } catch(e) { setToast({text:e.message}); } }
  function introduceWords(words) { const next={...masteryRef.current}; words.forEach(w=>{next[w.word]={...next[w.word], introducedAt:next[w.word]?.introducedAt||Date.now()};}); masteryRef.current=next;setMastery(next);recordStudyDay(); }
  // V2 keeps mastery evidence session-based so repeated questions cannot inflate
  // a word's stage. Global telemetry is still recorded once, at answer time,
  // just like the legacy engine. This also makes partially completed/resumed
  // sessions contribute to score, streaks, attempts and confusion learning.
  function recordSessionResult(q, result, session) {
    if (!q || !result || result.reported || result.unverified || result.aiFailed || q.noTelemetry) return;
    const answerKey = `${session?.id || 'session'}:${session?.index ?? -1}`;
    if (recordedSessionAnswersRef.current.has(answerKey)) return;
    recordedSessionAnswersRef.current.add(answerKey);
    const independentCorrect = !!result.correct && !result.assisted;
    setAttempted((n) => n + 1);
    setStreak((current) => {
      const next = independentCorrect ? current + 1 : 0;
      setBestStreak((best) => Math.max(best, next));
      return next;
    });
    if (independentCorrect) setScore((value) => value + 10);

    if (q.poolType === 'combo' || q.poolType === 'grammar') {
      const key = q.progressKey;
      if (key) {
        const now = Date.now(), snapshot = poolsRef.current;
        const existing = snapshot[key]?.variant?.length ? snapshot[key].variant : [{ id: 'seed', attempts: 0, correctCount: 0, lockedUntil: null }];
        let found = false;
        const items = existing.map((item) => {
          if (item.id !== q.poolItemId) return item;
          found = true;
          const attempts = Number(item.attempts || 0) + 1;
          const correctCount = Number(item.correctCount || 0) + (independentCorrect ? 1 : 0);
          return { ...item, attempts, correctCount, lockedUntil: correctCount >= 2 ? now + LOCK_DAYS * 86400000 : item.lockedUntil };
        });
        if (!found) items.push({ id: q.poolItemId, attempts: 1, correctCount: independentCorrect ? 1 : 0, lockedUntil: null });
        const nextPools = { ...snapshot, [key]: { ...snapshot[key], variant: items } };
        poolsRef.current = nextPools; setPools(nextPools);
        const stillFresh = items.some((it) => !it.lockedUntil || it.lockedUntil <= now);
        if (!stillFresh) triggerVariantGeneration(q.poolType, key);
      }
    } else if (q.poolType && q.poolItemId && q.targets?.length) {
      const wordObj=V2.findWord(WORDS,q.targets[0]);
      if (wordObj) {
        const now=Date.now(), snapshot=poolsRef.current, wordPools=getWordPools(snapshot,wordObj);
        const items=wordPools[q.poolType].map(item=>{
          if(item.id!==q.poolItemId)return item;
          const attempts=Number(item.attempts||0)+1;
          const correctCount=Number(item.correctCount||0)+(independentCorrect?1:0);
          return {...item,attempts,correctCount,lockedUntil:correctCount>=2?now+LOCK_DAYS*86400000:item.lockedUntil};
        });
        const nextWordPools={...wordPools,[q.poolType]:items}, nextPools={...snapshot,[wordObj.word]:nextWordPools};
        poolsRef.current=nextPools;setPools(nextPools);
        if(poolNeedsGeneration(nextWordPools,q.poolType))triggerGeneration([{word:wordObj.word,poolType:q.poolType}],nextPools);
      }
    }

    if (result.correct || !['mcq', 'multi'].includes(q.type)) return;
    const selected = Array.isArray(result.value) ? result.value : [result.value];
    const answerSet = new Set((q.answers || []).map(V2.norm));
    const missingTargets = (q.targets || []).map((label) => V2.findWord(WORDS, label)).filter(Boolean);
    const wrongChoices = selected.map((value) => {
      if (q.mode === 'meaning') return WORDS.find((word) => V2.norm(word.meaning) === V2.norm(value));
      return V2.findWord(WORDS, value);
    }).filter((word) => word && !answerSet.has(V2.norm(q.mode === 'meaning' ? word.meaning : word.word)));
    wrongChoices.forEach((choice, index) => {
      const target = missingTargets[Math.min(index, missingTargets.length - 1)];
      if (target) trackConfusion(target, choice.word);
    });
  }
  function completeSession(session) {
    if(session.completed || (progressExtrasRef.current.completedSessions||[]).includes(session.id)) return;
    progressExtrasRef.current={...progressExtrasRef.current,completedSessions:[...(progressExtrasRef.current.completedSessions||[]),session.id]};
    if(session.queue.length && session.answers.length===session.queue.length){
      const logEntry={id:session.id,kind:session.kind,title:session.title||session.kind,correct:session.answers.filter(a=>a.correct).length,total:session.queue.length,at:Date.now()};
      const nextLogs=[logEntry,...(progressExtrasRef.current.sessionLogs||[])].slice(0,50);
      progressExtrasRef.current={...progressExtrasRef.current,sessionLogs:nextLogs};setSessionLogs(nextLogs);
    }
    const next = V2.sessionEvidence(masteryRef.current, session);
    masteryRef.current = next; setMastery(next); recordStudyDay();
    if(session.kind==="practice" && session.queue.length && session.answers.length===session.queue.length) {
      // A review-first round is mostly other levels' words, so it must not
      // score or clear this level.
      const level=session.reviewFirst?null:LEVELS.find(l=>l.title===session.title);
      if(level){const accuracy=session.answers.filter(a=>a.correct).length/session.queue.length*100;setLevelStats(prev=>({...prev,[level.id]:updateLevelStat(prev[level.id],accuracy)}));if(accuracy>=70)setLevelsCleared(prev=>[...new Set([...prev,level.id])]);}
    }
    if(session.kind==="story" && session.sourceStoryId && session.queue.length && session.answers.length===session.queue.length) {
      const correct=session.answers.filter(a=>a.correct).length,total=session.queue.length;
      const existing=(progressExtrasRef.current.solvedStories||[]).filter(e=>e&&e.id);
      const prior=existing.find(e=>e.id===session.sourceStoryId);
      // Keep the best attempt so far so the story list shows your high score, not whatever the last replay happened to be.
      const record=(!prior||correct>prior.correct)?{id:session.sourceStoryId,correct,total}:prior;
      const nextSolved=[...existing.filter(e=>e.id!==session.sourceStoryId),record];
      progressExtrasRef.current={...progressExtrasRef.current,solvedStories:nextSolved};setSolvedStories(nextSolved);
    }
    setActiveSession({...session,completed:true});
    if(session.kind==="finalRecall") {
      const graded=session.answers.filter(answer=>answer&&!answer.reported&&!answer.aiFailed);
      const correct=graded.filter(answer=>answer.correct&&!answer.assisted).length;
      setFinalRecallSummary({accuracy:graded.length?correct/graded.length*100:0,correct,total:graded.length});
      setScreen("finalReport");
    }
  }
  function reportSessionQuestion(q, session, reason, learnerAnswer) {
    const report={id:`rep-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,questionId:q.id,sessionId:session.id,prompt:q.prompt,targetWords:q.targets||[],mode:q.mode,type:q.type||null,options:q.options||null,answers:q.answers||null,poolType:q.poolType||null,poolItemId:q.poolItemId||null,reason:reason||null,learnerAnswer:learnerAnswer??null,at:Date.now()};
    const merged=[...(progressExtrasRef.current.reports||[]),report];
    // Unbounded growth here was pushing the saved payload toward the
    // storage size limit over months of testing. Keep every unresolved
    // report (still needs action) plus the most recent 150 resolved ones;
    // older resolved history isn't actionable and doesn't need to persist.
    const unresolved=merged.filter(r=>!r.resolvedAt);
    const resolved=merged.filter(r=>r.resolvedAt).slice(-150);
    const reports=[...resolved,...unresolved];
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
    return report;
  }
  // Older saved reports have no id, so object identity stays the fallback.
  function sameReport(a,b){return a===b||(!!a?.id&&a.id===b?.id);}
  // AI triage for one report. Stores the review on the report (so Admin sees
  // the verdict and any drafted fix) and returns it for the learner's view.
  async function reviewQuestionReport(report){
    const review=await reviewReportedQuestion(report,locateReportSource(liveContent(),report));
    const reports=(progressExtrasRef.current.reports||[]).map(item=>sameReport(item,report)?{...item,aiReview:review}:item);
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
    return review;
  }
  function deleteQuestionReport(report){
    const reports=(progressExtrasRef.current.reports||[]).filter(item=>!sameReport(item,report));
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);
  }
  function resolveQuestionReport(report){
    const reports=(progressExtrasRef.current.reports||[]).map(item=>sameReport(item,report)?{...item,resolvedAt:Date.now()}:item);
    progressExtrasRef.current={...progressExtrasRef.current,reports};setQuestionReports(reports);setActiveSession(session=>session?{...session}:session);
  }
  function retireReportedVariant(report){
    const wordObj=V2.findWord(WORDS,report.targetWords?.[0]);
    if(!wordObj||!report.poolType||!report.poolItemId){resolveQuestionReport(report);return;}
    const snapshot=poolsRef.current, wordPools=getWordPools(snapshot,wordObj);
    const items=wordPools[report.poolType].map(item=>item.id===report.poolItemId?{...item,flagged:true,lockedUntil:Date.now()+100*365*86400000}:item);
    const nextWordPools={...wordPools,[report.poolType]:items},nextPools={...snapshot,[wordObj.word]:nextWordPools};
    poolsRef.current=nextPools;setPools(nextPools);triggerGeneration([{word:wordObj.word,poolType:report.poolType}],nextPools);resolveQuestionReport(report);
  }
  function updateWordFields(wordName, patch) {
    const next = customWords.map((w) => (V2.norm(w.word) === V2.norm(wordName) ? { ...w, ...patch } : w));
    mergeCustomData(next, customGrammar, customPuns, customChallenges, LEVEL_ORDER);
    setCustomWords(next);
    setDataVersion((v) => v + 1);
  }
  function updateAdminContent(field,nextList){
    if(field==="levels"){
      const current=LEVEL_ORDER.map(title=>({id:`cat-${title}`,title}));
      const nextById=new Map(nextList.filter(level=>level.id).map(level=>[level.id,level.title]));
      const deleted=new Set(current.filter(level=>!nextById.has(level.id)).map(level=>level.title));
      const renamed=new Map(current.filter(level=>nextById.has(level.id)&&nextById.get(level.id)!==level.title).map(level=>[level.title,nextById.get(level.id)]));
      const adjust=item=>deleted.has(item.category)?null:renamed.has(item.category)?{...item,category:renamed.get(item.category)}:item;
      const nextWords=customWords.map(adjust).filter(Boolean),nextGrammar=customGrammar.map(adjust).filter(Boolean),nextPuns=customPuns.map(adjust).filter(Boolean),nextChallenges=customChallenges.map(adjust).filter(Boolean);
      const nextCombos=customCombos.map(adjust).filter(Boolean),nextStories=customStories.map(adjust).filter(Boolean);
      const nextOrder=nextList.map(level=>String(level.title||"").trim()).filter(Boolean);
      setCustomWords(nextWords);setCustomGrammar(nextGrammar);setCustomPuns(nextPuns);setCustomChallenges(nextChallenges);setCustomCombos(nextCombos);setCustomStories(nextStories);
      mergeCustomData(nextWords,nextGrammar,nextPuns,nextChallenges,nextOrder);setDataVersion(value=>value+1);return;
    }
    const nextWords=field==="words"?nextList:customWords;
    const nextGrammar=field==="grammar"?nextList:customGrammar;
    const nextPuns=field==="puns"?nextList:customPuns;
    const nextChallenges=field==="challenges"?nextList:customChallenges;
    if(field==="words")setCustomWords(nextList);
    if(field==="grammar")setCustomGrammar(nextList);
    if(field==="puns")setCustomPuns(nextList);
    if(field==="challenges")setCustomChallenges(nextList);
    if(field==="combos")setCustomCombos(nextList);
    if(field==="stories")setCustomStories(nextList);
    mergeCustomData(nextWords,nextGrammar,nextPuns,nextChallenges,LEVEL_ORDER);
    setDataVersion(value=>value+1);
  }

  const [dataVersion, setDataVersion] = useState(0); // bumped whenever WORDS/GRAMMAR/PUNS/LEVELS change
  const [confirmAction, setConfirmAction] = useState(null); // null | 'reset' | 'wipe'
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState(null); // null | level object

  function deleteLevelCategory(level) {
    const nextOrder = LEVEL_ORDER.filter((t) => t !== level.title).map((t) => ({ id: `cat-${t}`, title: t }));
    updateAdminContent("levels", nextOrder);
  }
  const [customWords, setCustomWords] = useState([]);
  const [customGrammar, setCustomGrammar] = useState([]);
  const [customPuns, setCustomPuns] = useState([]);
  const [customChallenges, setCustomChallenges] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [contentPanelView, setContentPanelView] = useState("review"); // 'export' | 'review'
  const [exportText, setExportText] = useState("");
  const [exportCopied, setExportCopied] = useState(false);
  const [quickBackupCopied, setQuickBackupCopied] = useState(false);
  const [showFreshCopyPrompt, setShowFreshCopyPrompt] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewPreview, setReviewPreview] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const [aiFixBusy, setAiFixBusy] = useState(false);
  const [aiFixError, setAiFixError] = useState(null);
  const [aiFixChanges, setAiFixChanges] = useState(null);
  const [screen, setScreen] = useState("levels"); // levels | playing | results | reviewResults | finalReport | finalResults | speed | speedResults
  const [sessionType, setSessionType] = useState("level");
  const [levelsCleared, setLevelsCleared] = useState([]);
  const [levelStats, setLevelStats] = useState({});
  const [studyStreak, setStudyStreak] = useState(0);
  const [bestStudyStreak, setBestStudyStreak] = useState(0);
  const [lastStudyDate, setLastStudyDate] = useState(null);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(null);
  const [roundQueue, setRoundQueue] = useState([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundCorrect, setRoundCorrect] = useState(0);
  const [roundTotal, setRoundTotal] = useState(0);
  const [justCleared, setJustCleared] = useState(false);
  const [lastRoundSummary, setLastRoundSummary] = useState(null);
  const [finalCaseWords, setFinalCaseWords] = useState([]);
  const [finalReportText, setFinalReportText] = useState("");
  const [finalRecallSummary, setFinalRecallSummary] = useState(null);
  const [finalCaseResult, setFinalCaseResult] = useState(null);

  async function openAskAi(term="") {
    const clean=String(term||"").trim().replace(/\s+/g," ").slice(0,80);
    setAskAiOpen(true);setAskAiError(null);setAskAiResult(null);
    if(clean){setAskAiTerm(clean);await runAskAi(clean);}
  }

  async function runAskAi(term=askAiTerm) {
    const clean=String(term||"").trim();if(!clean)return;
    setAskAiBusy(true);setAskAiError(null);setAskAiResult(null);
    try{
      const existing=V2.findWord(WORDS,clean);
      const result=await askAiForWord(clean,existing);
      setAskAiResult({...result,alreadyInCollection:!!(existing||V2.findWord(WORDS,result.word))});
    }catch(error){console.error("Ask AI failed",error);setAskAiError(error.message||"AI explanation is unavailable. Try again.");}
    finally{setAskAiBusy(false);}
  }

  function addAiWord() {
    if(!askAiResult||askAiResult.alreadyInCollection)return;
    // Prefer the category the player is currently standing on (the level
    // they're playing, or a practice session's category) over whatever
    // category the AI guessed — keeps newly-added words in context.
    const contextCategory=currentLevel?.title||(activeSession?.kind==='practice'?activeSession.title:null);
    const entry={word:askAiResult.word,type:askAiResult.type,...(askAiResult.partsOfSpeech?.length?{partsOfSpeech:askAiResult.partsOfSpeech}:{}),category:contextCategory||askAiResult.category||"AI Discoveries",meaning:askAiResult.meaning,situation:askAiResult.situation,gap:askAiResult.gap,hints:askAiResult.hints||[],_aiAdded:true,...(askAiResult.commonMistake?{commonMistake:askAiResult.commonMistake}:{})};
    if(/[\u0600-\u06FF]/.test(JSON.stringify(entry))){setAskAiError("The generated card contains non-English text. Regenerate it before adding.");return;}
    const errors=V2.validateContent({schemaVersion:2,kind:"content",words:[entry]},liveContent());
    if(errors.length){setAskAiError(`Cannot add this card: ${errors[0]}`);return;}
    const next=[...customWords,entry];
    mergeCustomData(next,customGrammar,customPuns,customChallenges,LEVEL_ORDER);
    setCustomWords(next);setDataVersion(value=>value+1);
    setAskAiResult(previous=>({...previous,alreadyInCollection:true}));
    setToast({kind:"import",text:`${entry.word} added to your collection`});
  }

  // Speed Round — a standalone timed review mode, separate from the level
  // system entirely.
  const speedDeadlineRef = useRef(0);
  const [speedPool, setSpeedPool] = useState([]);
  const [speedQuestion, setSpeedQuestion] = useState(null);
  const [speedSelected, setSpeedSelected] = useState(null);
  const [speedStatus, setSpeedStatus] = useState(null);
  const [speedTimeLeft, setSpeedTimeLeft] = useState(60);
  const [speedScore, setSpeedScore] = useState(0);
  const [speedAnswered, setSpeedAnswered] = useState(0);
  const [speedCorrect, setSpeedCorrect] = useState(0);
  const [speedCombo, setSpeedCombo] = useState(0);
  const [speedBestCombo, setSpeedBestCombo] = useState(0);
  const [bestSpeedScore, setBestSpeedScore] = useState(0);
  const [bestSpeedCombo, setBestSpeedCombo] = useState(0);

  const [selected, setSelected] = useState(null);
  const [selectedMulti, setSelectedMulti] = useState([]);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(null);
  const [availableTokens, setAvailableTokens] = useState([]);
  const [orderedTokens, setOrderedTokens] = useState([]);
  const [challengeStepIndex, setChallengeStepIndex] = useState(0);
  const [challengeStepResults, setChallengeStepResults] = useState([]);
  const [stepAnswer, setStepAnswer] = useState("");
  const [stepFeedback, setStepFeedback] = useState(null);
  const [feedbackDetail, setFeedbackDetail] = useState(null);
  const [aiEvaluation, setAiEvaluation] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [grammarCorrectionResult, setGrammarCorrectionResult] = useState(null);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [attempted, setAttempted] = useState(0);
  const [mastery, setMastery] = useState({});
  const [pools, setPools] = useState({});
  const [confusions, setConfusions] = useState({});

  const [badgesOpen, setBadgesOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const seenBadgesRef = useRef(null);
  const pendingGenRef = useRef(new Set());
  const poolsRef = useRef(pools);
  const masteryRef = useRef(mastery);
  const confusionsRef = useRef(confusions);
  const roundCorrectRef = useRef(0);
  const roundTotalRef = useRef(0);
  const roundStartStagesRef = useRef({});
  const studyRef = useRef({ studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null });
  const reviewFileInputRef = useRef(null);
  const feedbackRequestIdRef = useRef(0);
  useEffect(() => { poolsRef.current = pools; }, [pools]);
  useEffect(() => { masteryRef.current = mastery; }, [mastery]);
  useEffect(() => { confusionsRef.current = confusions; }, [confusions]);
  useEffect(() => { studyRef.current = { studyStreak, bestStudyStreak, lastStudyDate }; }, [studyStreak, bestStudyStreak, lastStudyDate]);

  const clearedSet = useMemo(() => new Set(levelsCleared), [levelsCleared]);
  const weakCandidates = useMemo(() => getWeakWordCandidates(WORDS, mastery, confusions), [mastery, confusions, dataVersion]);
  const dueWords = useMemo(() => WORDS.filter((w) => isDueForReview(mastery[w.word])), [mastery, dataVersion]);
  const masteredOnlyWords = useMemo(() => WORDS.filter((w) => getMasteryStage(mastery[w.word], { kind: "word", obj: w }) === MASTERY_STAGE.MASTERED), [mastery, dataVersion]);
  const stageSummary = useMemo(() => { const counts = { New: 0, Familiar: 0, Learned: 0, Mastered: 0 }; LEVELS.forEach((level) => level.items.forEach((item) => { counts[getMasteryStage(mastery[levelItemKey(item)], item)] += 1; })); return counts; }, [mastery, dataVersion]);
  const overviewStats = useMemo(() => {
    let total = 0, practiced = 0, correctSum = 0, totalSum = 0;
    LEVELS.forEach((level) => level.items.forEach((item) => {
      total += 1;
      const stats = mastery[levelItemKey(item)];
      const attempts = stats?.total || 0;
      if (attempts > 0) practiced += 1;
      correctSum += stats?.correct || 0;
      totalSum += attempts;
    }));
    return { total, practiced, accuracy: totalSum > 0 ? Math.round((correctSum / totalSum) * 100) : null };
  }, [mastery, dataVersion]);
  const learningInsights = useMemo(() => deriveLearningInsights(WORDS, mastery, confusions), [mastery, confusions, dataVersion]);
  const currentLevel = currentLevelIndex !== null ? LEVELS[currentLevelIndex] : null;
  const currentEntry = roundQueue[roundIndex] || null;
  // Built once per case, not per pools update — otherwise answering (which
  // updates pools) would reshuffle this very question's own options.
  const question = useMemo(
    () => (currentEntry ? buildEntryQuestion(currentEntry, poolsRef.current) : null),
    [currentEntry]
  );

  useEffect(() => {
    setAvailableTokens(
      question?.type === "wordOrder"
        ? shuffle(question.tokens || []).map((text, index) => ({ id: `${index}-${text}`, text }))
        : []
    );
    setOrderedTokens([]);
    setChallengeStepIndex(0);
    setChallengeStepResults([]);
    setStepAnswer("");
    setStepFeedback(null);
  }, [question]);

  function getLevelStars(levelId) {
    return Math.max(Number(levelStats[levelId]?.stars || 0), clearedSet.has(levelId) ? 1 : 0);
  }

  function isLevelUnlocked(index) {
    return true; // TEMP: all levels unlocked for testing — revert to real progression below when ready
    if (index === 0) return true;
    const level = LEVELS[index];
    const previous = LEVELS[index - 1];
    return getLevelStars(previous.id) >= 1 || getLevelStars(level.id) >= 1;
  }

  function recordStudyDay() {
    const prev = studyRef.current;
    const next = nextStudyStreakState(prev.lastStudyDate, prev.studyStreak, prev.bestStudyStreak);
    studyRef.current = next;
    setStudyStreak(next.studyStreak);
    setBestStudyStreak(next.bestStudyStreak);
    setLastStudyDate(next.lastStudyDate);
  }

  function snapshotStages(items) {
    const snapshot = {};
    items.forEach((item) => { const key = levelItemKey(item); snapshot[key] = getMasteryStage(masteryRef.current[key], item); });
    return snapshot;
  }

  // Fires a background content-generation request for the given
  // (word, poolType) pairs and merges the results into the pools once ready.
  // Never blocks the UI — if it fails, the game just keeps reusing what it has.
  async function triggerGeneration(batch, poolsSnapshot) {
    const filtered = batch.filter((b) => !pendingGenRef.current.has(`${b.word}::${b.poolType}`));
    if (!filtered.length) return;
    filtered.forEach((b) => pendingGenRef.current.add(`${b.word}::${b.poolType}`));
    try {
      const results = await generateContent(filtered, poolsSnapshot);
      setPools((prev) => {
        const next = { ...prev };
        for (const item of results) {
          const wordObj = WORDS.find((w) => w.word === item.word);
          if (!wordObj || !item.text) continue;
          const wp = getWordPools(next, wordObj);
          const newItem = {
            id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: item.text,
            attempts: 0,
            correctCount: 0,
            lockedUntil: null,
            flagged: false,
          };
          next[item.word] = { ...wp, [item.poolType]: [...wp[item.poolType], newItem] };
        }
        return next;
      });
    } catch (e) {
      console.error("Content generation failed:", e);
    } finally {
      filtered.forEach((b) => pendingGenRef.current.delete(`${b.word}::${b.poolType}`));
    }
  }

  // Same idea as triggerGeneration above, but for combo/grammar "variant"
  // pools (progressKey-keyed, not word-keyed) — fires once a combo/grammar
  // question's pool has no fresh (unlocked) item left, i.e. it's just been
  // answered correctly twice.
  async function triggerVariantGeneration(poolType, key) {
    const genKey = `variant::${poolType}::${key}`;
    if (pendingGenRef.current.has(genKey)) return;
    pendingGenRef.current.add(genKey);
    try {
      const id = key.slice(key.indexOf(":") + 1);
      const content = liveContent();
      if (poolType === "combo") {
        const combo = (content.combos || []).find((c) => c.id === id);
        if (!combo) return;
        const variant = await generateComboVariant(combo);
        setPools((prev) => {
          const existing = prev[key]?.variant?.length ? prev[key].variant : [];
          const newItem = { id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, situation: variant.situation, prompt: variant.prompt, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
          const next = { ...prev, [key]: { ...prev[key], variant: [...existing, newItem] } };
          poolsRef.current = next;
          return next;
        });
      } else if (poolType === "grammar") {
        const g = (content.grammar || []).find((x) => x.id === id);
        if (!g) return;
        const variant = await generateGrammarVariant(g);
        setPools((prev) => {
          const existing = prev[key]?.variant?.length ? prev[key].variant : [];
          const newItem = { id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, prompt: variant.prompt, options: variant.options, answer: variant.answer, explanation: variant.explanation, attempts: 0, correctCount: 0, lockedUntil: null, flagged: false };
          const next = { ...prev, [key]: { ...prev[key], variant: [...existing, newItem] } };
          poolsRef.current = next;
          return next;
        });
      }
    } catch (e) {
      console.error("Variant generation failed:", e);
    } finally {
      pendingGenRef.current.delete(genKey);
    }
  }

  // Load saved progress AND any previously imported custom content once on
  // mount. Custom content must be merged first so LEVELS/BADGES are already
  // correct by the time we compute badge state from the saved mastery.
  useEffect(() => {
    (async () => {
      let levelOrder = LEVEL_ORDER;
      let hadAnyData = false;
      try {
        const customRes = await storage.get(CUSTOM_CONTENT_KEY, false);
        if (customRes && customRes.value) {
          hadAnyData = true;
          const custom = JSON.parse(customRes.value);
          setCustomCombos(custom.combos || []); setCustomStories(custom.stories || []); contentNoteRef.current=custom.note||"";
          setCustomWords(custom.words || []);
          setCustomGrammar(custom.grammar || []);
          setCustomPuns(custom.puns || []);
          setCustomChallenges(Array.isArray(custom.challenges) ? custom.challenges : []);
          levelOrder = custom.levelOrder || LEVEL_ORDER;
          mergeCustomData(custom.words || [], custom.grammar || [], custom.puns || [], custom.challenges || [], levelOrder);
        }
      } catch (e) {
        // no custom content yet — built-in content only
      }

      try {
        let raw = null;
        let sourceKey = null;
        for (const key of [STORAGE_KEY, LEGACY_V5_STORAGE_KEY, LEGACY_V4_STORAGE_KEY, LEGACY_V3_STORAGE_KEY]) {
          try {
            const res = await storage.get(key, false);
            if (res && res.value) { raw = JSON.parse(res.value); sourceKey = key; hadAnyData = true; break; }
          } catch (_) {}
        }
        const data = raw ? migrateProgressData(raw) : emptyProgressData();
        progressExtrasRef.current = data; setActiveSession(data.activeSession || null);setQuestionReports(Array.isArray(data.reports)?data.reports:[]);setSolvedStories(Array.isArray(data.solvedStories)?data.solvedStories:[]);setSessionLogs(Array.isArray(data.sessionLogs)?data.sessionLogs:[]);
        if (raw && sourceKey !== STORAGE_KEY) {
          try { await storage.set(STORAGE_KEY, JSON.stringify(data), false); } catch (_) {}
        }
        setScore(data.score); setStreak(data.streak); setBestStreak(data.bestStreak); setAttempted(data.attempted);
        setMastery(data.mastery); masteryRef.current = data.mastery;
        setLevelsCleared(data.levelsCleared); setLevelStats(data.levelStats); setPools(data.pools); poolsRef.current = data.pools;
        setStudyStreak(data.studyStreak); setBestStudyStreak(data.bestStudyStreak); setLastStudyDate(data.lastStudyDate);
        studyRef.current = { studyStreak: data.studyStreak, bestStudyStreak: data.bestStudyStreak, lastStudyDate: data.lastStudyDate };
        setBestSpeedScore(data.bestSpeedScore); setBestSpeedCombo(data.bestSpeedCombo);
        setConfusions(data.confusions); confusionsRef.current = data.confusions;
        setSettings(normalizeSettings(data.settings));
        seenBadgesRef.current = new Set(BADGES.filter((b) => getBadgeProgress(b, { mastery: data.mastery, bestStreak: data.bestStreak }).earned).map((b) => b.id));
      } catch (e) {
        console.error("Could not load progress:", e);
        seenBadgesRef.current = new Set();
      } finally {
        setDataVersion((v) => v + 1);
        setLoaded(true);
        if (!hadAnyData) setShowFreshCopyPrompt(true);
      }
    })();
  }, []);

  // Save progress whenever it changes (after initial load).
  // Debounced: `activeSession` changes on nearly every keystroke while
  // playing (draft updates, hint reveals, answers), so firing storage.set()
  // on every render was queuing overlapping writes to the same key — the
  // backend rejects the "losing" one with a 409 Conflict. Waiting for
  // things to go quiet for 600ms collapses a whole typing burst into one
  // write. The in-flight guard skips a save if the previous one hasn't
  // resolved yet; the next state change will schedule another debounced
  // save anyway, so nothing is lost.
  const progressSavingRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(async () => {
      if (progressSavingRef.current) return;
      progressSavingRef.current = true;
      try {
        await storageSetWithRetry(
          STORAGE_KEY,
          JSON.stringify({ ...progressExtrasRef.current, activeSession, schemaVersion: SCHEMA_VERSION, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings })
        );
      } catch (e) {
        console.error("Could not save progress:", e);
        setStorageWarning("Progress could not be saved. Keep a Full backup before closing this preview. Claude persistent storage is available in published artifacts.");
      } finally {
        progressSavingRef.current = false;
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [loaded, activeSession, questionReports, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings]);

  // Save imported custom content whenever it changes (separate from progress
  // so a progress reset never touches imported vocabulary). Same debounce +
  // in-flight guard as the progress save, for the same 409-conflict reason.
  const contentSavingRef = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const handle = setTimeout(async () => {
      if (contentSavingRef.current) return;
      contentSavingRef.current = true;
      try {
        await storageSetWithRetry(
          CUSTOM_CONTENT_KEY,
          JSON.stringify({ schemaVersion: 2, kind: "content", note: contentNoteRef.current, combos: customCombos, stories: customStories, words: customWords, grammar: customGrammar, puns: customPuns, challenges: customChallenges, levelOrder: LEVEL_ORDER })
        );
      } catch (e) {
        console.error("Could not save custom content:", e);
        setStorageWarning("Content could not be saved. Keep a Full backup before closing this preview. Claude persistent storage is available in published artifacts.");
      } finally {
        contentSavingRef.current = false;
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [loaded, customCombos, customStories, customWords, customGrammar, customPuns, customChallenges, dataVersion]);

  // Detect newly earned badges and surface a small celebration toast
  useEffect(() => {
    if (!loaded || !seenBadgesRef.current) return;
    for (const badge of BADGES) {
      const { earned } = getBadgeProgress(badge, { mastery, bestStreak });
      if (earned && !seenBadgesRef.current.has(badge.id)) {
        seenBadgesRef.current.add(badge.id);
        setToast({ kind: "badge", text: badge.label });
      }
    }
  }, [mastery, bestStreak, loaded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(()=>{if(!askAiOpen)return;const close=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setAskAiOpen(false);}};window.addEventListener('keydown',close,true);return()=>window.removeEventListener('keydown',close,true);},[askAiOpen]);

  function dueWordCount() {
    const now = Date.now();
    return WORDS.filter((w) => isDueForReview(masteryRef.current[w.word], now)).length;
  }
  function startLevel(index) {
    const level = LEVELS[index]; if(!level) return;
    setCurrentLevelIndex(index);
    const dueFirst = settings.reviewFirstThreshold > 0 && dueWordCount() >= settings.reviewFirstThreshold;
    const session = V2.practice(liveContent(), masteryRef.current, level.title, Math.random, reportQuarantine, { questionsPerRound: settings.questionsPerRound, newWordsPerRound: settings.newWordsPerRound, pools: poolsRef.current, dueFirst });
    if (session.reviewFirst) setToast({ text: `Review first: ${session.dueCount} words are overdue, so this round starts with them.` });
    launchSession(session);
  }
  function startDueReview() {
    setCurrentLevelIndex(null);
    const session = V2.practice(liveContent(), masteryRef.current, null, Math.random, reportQuarantine, { questionsPerRound: settings.questionsPerRound, newWordsPerRound: 0, pools: poolsRef.current, dueOnly: true });
    if (!session.queue.length) { setToast({ text: "Nothing is due right now." }); return; }
    launchSession(session);
  }

  function startWeakReview() {
    const picked = weakCandidates.slice(0, settings.weakReviewSize);
    if (!picked.length) return;
    let lastWord = null;
    let lastMode = null;
    const queue = picked.map(({ word, stats }) => {
      let mode = pickWeakMode(word, stats, confusionsRef.current, reportQuarantine);
      if (mode === lastMode && !getWeakWordCandidates([word], { [word.word]: stats }, confusionsRef.current)[0]?.weakModes?.includes(mode)) {
        mode = selectAdaptiveMode(word, stats, { sessionType: "weak", confusion: getStrongConfusion(word, confusionsRef.current), lastMode, quarantine: reportQuarantine });
      }
      const entry = { kind: "word", wordObj: word, mode, difficulty: getAdaptiveDifficulty(word, stats, mode), confusionPartner: getStrongConfusion(word, confusionsRef.current)?.partner || null };
      lastWord = word.word; lastMode = mode;
      return entry;
    }).filter((entry, i, arr) => i === 0 || entry.wordObj.word !== arr[i - 1].wordObj.word);
    setCurrentLevelIndex(null);
    roundStartStagesRef.current = snapshotStages(queue.map((entry) => ({ kind: "word", obj: entry.wordObj })));
    poolsSnapshotForSession=poolsRef.current;
    launchSession(v2SessionFromEntries(queue,{kind:"weak",title:"Weak Evidence",idPrefix:"weak"}));
  }

  function startFinalCase(index) {
    const level = LEVELS[index];
    if (!level || getLevelStars(level.id) < 1) return;
    const wordItems = level.items.filter((item) => item.kind === "word");
    if (!wordItems.length) return;
    const priority = { Learned: 0, Familiar: 1, New: 2, Mastered: 3 };
    const selectedItems = shuffle(wordItems).sort((a, b) => {
      const aStage = getMasteryStage(masteryRef.current[levelItemKey(a)], a);
      const bStage = getMasteryStage(masteryRef.current[levelItemKey(b)], b);
      return priority[aStage] - priority[bStage];
    }).slice(0, Math.min(3, wordItems.length));
    const selectedWords = selectedItems.map((item) => item.obj);
    setCurrentLevelIndex(index);
    setFinalCaseWords(selectedWords);
    setFinalReportText("");
    setFinalRecallSummary(null);
    setFinalCaseResult(null);
    roundStartStagesRef.current = snapshotStages(selectedItems);
    poolsSnapshotForSession=poolsRef.current;
    launchSession(v2SessionFromEntries(selectedWords.map((wordObj)=>({kind:"word",wordObj,mode:"gapTyping",difficulty:4})),{kind:"finalRecall",title:`Final Case — ${level.title}`,idPrefix:"final"}));
  }

  function launchAuthoredChallenge(challenge) {
    setCurrentLevelIndex(null);
    poolsSnapshotForSession=poolsRef.current;
    launchSession(v2SessionFromEntries([{kind:"challenge",obj:challenge}],{kind:"challenge",title:challenge.label||challenge.id,idPrefix:`challenge-${challenge.id}`}));
  }

  function retryLevel() { if (currentLevelIndex !== null) startLevel(currentLevelIndex); }
  function backToLevels() { setScreen("levels"); setCurrentLevelIndex(null); setSessionType("level"); }

  function learningDelta(items) {
    let improved = 0;
    let masteredGained = 0;
    items.filter((item) => item.kind === "word").forEach((item) => {
      const key = levelItemKey(item);
      const before = roundStartStagesRef.current[key] || MASTERY_STAGE.NEW;
      const after = getMasteryStage(masteryRef.current[key], item);
      if (MASTERY_STAGE_RANK[after] > MASTERY_STAGE_RANK[before]) improved += 1;
      if (after === MASTERY_STAGE.MASTERED && before !== MASTERY_STAGE.MASTERED) masteredGained += 1;
    });
    const weakCount = getWeakWordCandidates(items.filter((x) => x.kind === "word").map((x) => x.obj), masteryRef.current, confusionsRef.current).length;
    return { improved, masteredGained, weakCount };
  }

  function trackConfusion(targetWord, selectedValue) {
    const selectedWord = findWordByLabel(selectedValue);
    if (!targetWord || !selectedWord || selectedWord.word === targetWord.word) return;
    const key = `${targetWord.word}|${selectedWord.word}`;
    const prevAll = confusionsRef.current || {};
    const prev = prevAll[key];
    const next = pruneConfusions({ ...prevAll, [key]: { count: confusionCount(prev) + 1, lastAt: Date.now() } });
    confusionsRef.current = next;
    setConfusions(next);
  }

  function registerResult(correct, meta = {}) {
    if (!question) return;
    const now = Date.now();
    const key = question.target.key;
    const modeId = question.modeId || question.poolType || (question.type === "typing" ? "typing" : "unknown");
    const isChallenge = String(key).startsWith("challenge:");
    const isWord = !String(key).startsWith("grammar:") && !String(key).startsWith("pun:") && !isChallenge;
    const roundCorrect = meta.roundCorrect !== undefined ? meta.roundCorrect : correct;
    const masteryCorrect = !question.hint && (meta.masteryCorrect !== undefined ? meta.masteryCorrect : correct);

    setAttempted((n) => n + 1);
    roundTotalRef.current += 1; setRoundTotal(roundTotalRef.current);
    if (roundCorrect) { roundCorrectRef.current += 1; setRoundCorrect(roundCorrectRef.current); }
    setStreak((s) => { const next = roundCorrect ? s + 1 : 0; setBestStreak((best) => Math.max(best, next)); return next; });
    setScore((scoreValue) => roundCorrect ? scoreValue + 10 : scoreValue);

    const prevMastery = masteryRef.current;
    let progressionEligible = meta.skipProgression !== true;
    if (progressionEligible && isWord && question.poolType && question.poolItemId) {
      const displayedVariant = getWordPools(poolsRef.current, question.target)[question.poolType]?.find((it) => it.id === question.poolItemId);
      progressionEligible = !(displayedVariant?.lockedUntil && displayedVariant.lockedUntil > now);
    }

    if (progressionEligible) {
      const prev = normalizeMasteryRecord(prevMastery[key]);
      const prevMode = normalizeModeStats(prev.modes[modeId]);
      const productionAttempt = isWord && PRODUCTION_MODES.has(modeId);
      const genuineProduction = productionAttempt && masteryCorrect && meta.productionSuccess !== false;
      const spaced = isWord ? updateSpacedReview(prev, masteryCorrect, now, { productionNow: genuineProduction }) : { lastReviewedAt: now };
      const sentenceAttempt = modeId === "buildSentence" || modeId === "finalReport";
      const regressionStrikes = prev.everMastered
        ? (masteryCorrect ? Math.max(0, prev.regressionStrikes - 1) : prev.regressionStrikes + 1)
        : prev.regressionStrikes;
      let nextRecord = {
        ...prev,
        assistedAttempts: Number(prev.assistedAttempts || 0) + (question.hint ? 1 : 0),
        correct: prev.correct + (masteryCorrect ? 1 : 0),
        total: prev.total + 1,
        modes: { ...prev.modes, [modeId]: { ...prevMode, correct: prevMode.correct + (masteryCorrect ? 1 : 0), total: prevMode.total + 1, spellingMisses: prevMode.spellingMisses + (meta.spellingIssue ? 1 : 0), lastResult: masteryCorrect ? "correct" : meta.spellingIssue ? "spelling" : "wrong", lastDifficulty: Number(question.difficulty || 1) } },
        productionCorrect: prev.productionCorrect + (genuineProduction ? 1 : 0),
        productionAttempts: prev.productionAttempts + (productionAttempt ? 1 : 0),
        spellingMisses: prev.spellingMisses + (meta.spellingIssue ? 1 : 0),
        sentenceAttempts: prev.sentenceAttempts + (sentenceAttempt ? 1 : 0),
        sentenceSuccesses: prev.sentenceSuccesses + (sentenceAttempt && genuineProduction ? 1 : 0),
        aiEvaluatedAttempts: prev.aiEvaluatedAttempts + (meta.aiEvaluated ? 1 : 0),
        lastResult: masteryCorrect ? "correct" : meta.spellingIssue ? "spelling" : "wrong",
        regressionStrikes,
        recentResults: [...prev.recentResults, { correct: masteryCorrect, modeId, difficulty: Number(question.difficulty || 1), at: now, spelling: !!meta.spellingIssue }].slice(-RECENT_RESULT_LIMIT),
        ...spaced,
      };
      if (getMasteryStage(nextRecord, { kind: isWord ? "word" : "grammar", obj: question.target }) === MASTERY_STAGE.MASTERED) nextRecord.everMastered = true;
      let nextMastery = { ...prevMastery, [key]: nextRecord };
      if (isChallenge && Array.isArray(question.linkedWords)) {
        question.linkedWords.filter(label => [question.answer, ...(question.correctAnswers || [])].some(answer => V2.norm(answer) === V2.norm(label))).forEach((linkedWord) => {
          const wordObj = WORDS.find((word) => word.word === linkedWord);
          if (!wordObj) return;
          const linkedPrev = normalizeMasteryRecord(nextMastery[linkedWord]);
          const linkedMode = normalizeModeStats(linkedPrev.modes[modeId]);
          const linkedProductionAttempt = PRODUCTION_MODES.has(modeId);
          const linkedProductionSuccess = linkedProductionAttempt && masteryCorrect && meta.productionSuccess !== false;
          let linkedRecord = {
            ...linkedPrev,
            correct: linkedPrev.correct + (masteryCorrect ? 1 : 0),
            total: linkedPrev.total + 1,
            modes: {
              ...linkedPrev.modes,
              [modeId]: {
                ...linkedMode,
                correct: linkedMode.correct + (masteryCorrect ? 1 : 0),
                total: linkedMode.total + 1,
                lastResult: masteryCorrect ? "correct" : "wrong",
                lastDifficulty: Number(question.difficulty || 1),
              },
            },
            productionCorrect: linkedPrev.productionCorrect + (linkedProductionSuccess ? 1 : 0),
            productionAttempts: linkedPrev.productionAttempts + (linkedProductionAttempt ? 1 : 0),
            sentenceAttempts: linkedPrev.sentenceAttempts + (modeId === "buildSentence" ? 1 : 0),
            sentenceSuccesses: linkedPrev.sentenceSuccesses + (modeId === "buildSentence" && linkedProductionSuccess ? 1 : 0),
            lastResult: masteryCorrect ? "correct" : "wrong",
            recentResults: [...linkedPrev.recentResults, { correct: masteryCorrect, modeId, difficulty: Number(question.difficulty || 1), at: now }].slice(-RECENT_RESULT_LIMIT),
            ...updateSpacedReview(linkedPrev, masteryCorrect, now),
          };
          if (getMasteryStage(linkedRecord, { kind: "word", obj: wordObj }) === MASTERY_STAGE.MASTERED) linkedRecord.everMastered = true;
          nextMastery[linkedWord] = linkedRecord;
        });
      }
      masteryRef.current = nextMastery;
      setMastery(nextMastery);
    }

    if (question.poolType && question.poolItemId && isWord) {
      const wordObj = question.target;
      const poolsSnapshot = poolsRef.current;
      const wordPools = getWordPools(poolsSnapshot, wordObj);
      const arr = wordPools[question.poolType].map((it) => {
        if (it.id !== question.poolItemId) return it;
        const attempts = it.attempts + 1;
        const correctCount = it.correctCount + (masteryCorrect ? 1 : 0);
        const lockedUntil = correctCount >= 2 ? now + LOCK_DAYS * 24 * 60 * 60 * 1000 : it.lockedUntil;
        return { ...it, attempts, correctCount, lockedUntil };
      });
      const nextWordPools = { ...wordPools, [question.poolType]: arr };
      const nextPools = { ...poolsSnapshot, [wordObj.word]: nextWordPools };
      poolsRef.current = nextPools; setPools(nextPools);
      if (poolNeedsGeneration(nextWordPools, question.poolType)) triggerGeneration([{ word: wordObj.word, poolType: question.poolType }], nextPools);
    }
    if (isChallenge) LAST_CHALLENGE_ID = question.challengeId;
  }

  function handleSelect(opt) {
    if (status) return;
    setSelected(opt);
    const correct = normalizeAnswerText(opt) === normalizeAnswerText(question.answer);
    const detail = correct ? null : buildContrastiveFeedback(question, opt);
    setFeedbackDetail(detail);
    const confusionTarget = findWordByLabel(question.answer);
    if (!correct && confusionTarget && findWordByLabel(opt)) trackConfusion(confusionTarget, opt);
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct);

    // Ask Claude for a sharper, situation-grounded explanation in the
    // background and swap it in once ready; the static line above stays
    // visible in the meantime so feedback is never empty.
    if (detail) {
      const requestId = ++feedbackRequestIdRef.current;
      const chosenWord = findWordByLabel(opt);
      const correctWord = findWordByLabel(question.answer) || question.target;
      if (chosenWord && correctWord) {
        setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: true } : prev));
        explainWrongLead(question, chosenWord, correctWord)
          .then((text) => {
            if (feedbackRequestIdRef.current !== requestId) return; // a newer question took over
            setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: false, ...(text ? { keyDifference: text } : {}) } : prev));
          })
          .catch(() => {
            if (feedbackRequestIdRef.current !== requestId) return;
            setFeedbackDetail((prev) => (prev ? { ...prev, aiLoading: false } : prev));
          });
      }
    }
  }

  function toggleMultiOption(opt) { if (!status) setSelectedMulti((prev) => prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]); }
  function submitMulti() {
    if (status || selectedMulti.length === 0) return;
    const want = question.correctAnswers.map(normalizeAnswerText).sort(), got = selectedMulti.map(normalizeAnswerText).sort();
    const correct = want.length === got.length && want.every((w, i) => w === got[i]);
    setStatus(correct ? "correct" : "wrong"); registerResult(correct);
  }

  function acceptedAnswerMatches(value, accepted = []) {
    const normalized = normalizeAnswerText(value).replace(/[.!?]+$/, "").trim();
    return uniqueStrings(accepted).some((answer) => normalizeAnswerText(answer).replace(/[.!?]+$/, "").trim() === normalized);
  }

  function moveTokenToAnswer(token) {
    if (status) return;
    setAvailableTokens((prev) => prev.filter((item) => item.id !== token.id));
    setOrderedTokens((prev) => [...prev, token]);
  }

  function moveTokenBack(token) {
    if (status) return;
    setOrderedTokens((prev) => prev.filter((item) => item.id !== token.id));
    setAvailableTokens((prev) => [...prev, token]);
  }

  function submitWordOrder() {
    if (status || availableTokens.length || !orderedTokens.length) return;
    const built = orderedTokens.map((token) => token.text).join(" ");
    setTyped(built);
    const accepted = question.acceptedAnswers?.length ? question.acceptedAnswers : [question.answer];
    const correct = accepted.some(answer=>V2.sentence(answer)===V2.sentence(built));
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct, { productionSuccess: correct });
  }

  function submitSelfCheck() {
    if (status || !typed.trim()) return;
    const missing = (question.requiredWords || []).filter((word) => !containsRequiredTerm(typed, word));
    if (missing.length) {
      setStepFeedback({ correct: false, explanation: `Still missing: ${missing.join(", ")}. Revise your sentence and check again.` });
      return;
    }
    setStepFeedback({
      correct: true,
      explanation: "Required words found. This is an objective inclusion check only; compare your sentence with the model example for a self-check.",
    });
    setStatus("correct");
    registerResult(true, { productionSuccess: false, skipProgression: true });
  }

  function submitChallengeStep() {
    if (status || stepFeedback || !question?.steps?.[challengeStepIndex]) return;
    const step = question.steps[challengeStepIndex];
    if (!stepAnswer.trim()) return;
    const correct = acceptedAnswerMatches(stepAnswer, step.acceptedAnswers);
    setStepFeedback({ correct, explanation: step.explanation || (correct ? "Correct." : `Accepted answer: ${step.acceptedAnswers[0] || "—"}`) });
  }

  function advanceChallengeStep() {
    if (!stepFeedback || !question?.steps?.length) return;
    const results = [...challengeStepResults, stepFeedback.correct];
    if (challengeStepIndex + 1 < question.steps.length) {
      setChallengeStepResults(results);
      setChallengeStepIndex((index) => index + 1);
      setStepAnswer("");
      setStepFeedback(null);
      return;
    }
    const correct = results.every(Boolean);
    setChallengeStepResults(results);
    setStatus(correct ? "correct" : "wrong");
    registerResult(correct, { productionSuccess: correct });
  }

  async function submitTyped() {
    if (status || aiBusy || !typed.trim()) return;
    const guess = typed.trim();
    const accepted = question.acceptedAnswers?.length ? question.acceptedAnswers : [question.answer];
    if (acceptedAnswerMatches(guess, accepted)) { setStatus("correct"); setAiEvaluation(null); registerResult(true, { productionSuccess: PRODUCTION_MODES.has(question.modeId || "") }); return; }
    if(question.modelOnly) {
      setAiBusy(true); setAiError(null);
      try {
        const evaluation = await evaluateFreeForm(question, guess);
        setAiEvaluation(evaluation);
        const genuine = evaluation.correct && evaluation.targetWordUsed && evaluation.semanticUse === "correct";
        if (genuine) {
          setStatus("correct");
          registerResult(true, { productionSuccess: PRODUCTION_MODES.has(question.modeId || ""), aiEvaluated: true });
        } else if (evaluation.semanticUse === "partly_correct" && evaluation.naturalness !== "nonsense") {
          setStatus("close");
          registerResult(false, { productionSuccess: false, aiEvaluated: true });
        } else {
          setStatus("wrong");
          registerResult(false, { aiEvaluated: true });
        }
      } catch (e) {
        setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer.");
        setStatus("aiError");
      } finally {
        setAiBusy(false);
      }
      return;
    }
    const spell = spellingDistanceInfo(guess, question.answer);
    if (spell.close) { setStatus("close"); setAiEvaluation(null); registerResult(false, { spellingIssue: true, masteryCorrect: false, productionSuccess: false }); return; }
    if (question.allowAlternativeGap) {
      setAiBusy(true); setAiError(null);
      try {
        const evaluation = await evaluateAlternativeGap(question, guess);
        setAiEvaluation(evaluation);
        if (evaluation.correct) {
          setStatus("correctAlternative");
          registerResult(false, { roundCorrect: true, masteryCorrect: false, productionSuccess: false, aiEvaluated: true });
        } else { setStatus("wrong"); registerResult(false, { aiEvaluated: true }); }
      } catch (e) { setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer."); setStatus("aiError"); }
      finally { setAiBusy(false); }
      return;
    }
    setStatus("wrong"); registerResult(false);
  }

  async function submitGrammarCorrection() {
    if (!question?.court || aiBusy || !typed.trim()) return;
    setAiBusy(true); setAiError(null);
    try {
      const result = await evaluateGrammarCorrection(question, typed.trim());
      setGrammarCorrectionResult(result);
    } catch (e) {
      console.error("Grammar correction evaluation failed:", e);
      setGrammarCorrectionResult({ correct: false, confidence: "low", feedback: "The judge is unavailable right now. Your original answer record was not changed.", suggestedCorrection: "" });
    } finally { setAiBusy(false); }
  }

  async function submitFreeForm() {
    if (status || aiBusy || !typed.trim()) return;
    setAiBusy(true); setAiError(null);
    try {
      const evaluation = await evaluateFreeForm(question, typed.trim());
      setAiEvaluation(evaluation);
      const genuine = evaluation.correct && (question.freeformKind === "idiomMeaning" || evaluation.targetWordUsed) && evaluation.semanticUse === "correct";
      if (evaluation.correct) {
        setStatus(genuine ? "correct" : "close");
        registerResult(genuine, { roundCorrect: true, masteryCorrect: genuine, productionSuccess: genuine, aiEvaluated: true });
      } else if (evaluation.semanticUse === "partly_correct" && evaluation.naturalness !== "nonsense") {
        setStatus("close"); registerResult(false, { productionSuccess: false, aiEvaluated: true });
      } else { setStatus("wrong"); registerResult(false, { productionSuccess: false, aiEvaluated: true }); }
    } catch (e) { console.error("AI evaluation failed:", e); setAiError("AI evaluation is unavailable. Retry, or continue without recording this answer."); setStatus("aiError"); }
    finally { setAiBusy(false); }
  }

  function continueAfterAiFailure() { setStatus("skipped"); setAiError(null); }

  function finishCurrentRound() {
    const total = roundTotalRef.current, correct = roundCorrectRef.current;
    const accuracy = total > 0 ? (correct / total) * 100 : 0;
    if (sessionType === "level" && currentLevel) {
      const previousStars = getLevelStars(currentLevel.id), earnedStars = getStarsForAccuracy(accuracy), passed = accuracy >= 70;
      const delta = learningDelta(currentLevel.items);
      setLevelStats((prev) => ({ ...prev, [currentLevel.id]: updateLevelStat(prev[currentLevel.id], accuracy, previousStars) }));
      if (passed) setLevelsCleared((prev) => prev.includes(currentLevel.id) ? prev : [...prev, currentLevel.id]);
      setJustCleared(passed && previousStars === 0);
      setLastRoundSummary({ accuracy, correct, total, earnedStars, passed, previousStars, ...delta });
      recordStudyDay(); setScreen("results"); return;
    }
    if (sessionType === "weak") {
      const reviewItems = roundQueue.map((entry) => ({ kind: "word", obj: entry.wordObj }));
      setLastRoundSummary({ accuracy, correct, total, ...learningDelta(reviewItems) }); recordStudyDay(); setScreen("reviewResults"); return;
    }
    if (sessionType === "challenge") { recordStudyDay();setToast({text:`Challenge complete: ${correct}/${total}`});setScreen("levels");return; }
    if (sessionType === "final") { setFinalRecallSummary({ accuracy, correct, total }); setScreen("finalReport"); }
  }

  function nextQuestion() {
    const isLast = roundIndex + 1 >= roundQueue.length;
    if (isLast) { finishCurrentRound(); return; }
    setRoundIndex((i) => i + 1); setSelected(null); setSelectedMulti([]); setTyped(""); setStatus(null); setAvailableTokens([]); setOrderedTokens([]); setChallengeStepIndex(0); setChallengeStepResults([]); setStepAnswer(""); setStepFeedback(null); feedbackRequestIdRef.current++; setFeedbackDetail(null); setAiEvaluation(null); setAiError(null); setGrammarCorrectionResult(null);
  }

  async function finishFinalCaseReport() {
    if (!finalCaseWords.length || !finalReportText.trim() || aiBusy) return;
    setAiBusy(true); setAiError(null);
    try {
      const evaluation = await evaluateFinalReport(finalCaseWords, finalReportText.trim());
      setFinalCaseResult(evaluation);
      if (evaluation.confidence !== "low") {
        let nextMastery = masteryRef.current;
        const now = Date.now();
        evaluation.words.forEach((result) => {
          if (!result.productionSuccess) return;
          const word = finalCaseWords.find((w) => w.word === result.word); if (!word) return;
          const prev = normalizeMasteryRecord(nextMastery[word.word]);
          const prevMode = normalizeModeStats(prev.modes.finalReport);
          let record = { ...prev, correct: prev.correct + 1, total: prev.total + 1, modes: { ...prev.modes, finalReport: { ...prevMode, correct: prevMode.correct + 1, total: prevMode.total + 1, lastResult: "correct", lastDifficulty: 4 } }, productionCorrect: prev.productionCorrect + 1, productionAttempts: prev.productionAttempts + 1, sentenceAttempts: prev.sentenceAttempts + 1, sentenceSuccesses: prev.sentenceSuccesses + 1, aiEvaluatedAttempts: prev.aiEvaluatedAttempts + 1, lastResult: "correct", recentResults: [...prev.recentResults, { correct: true, modeId: "finalReport", difficulty: 4, at: now }].slice(-RECENT_RESULT_LIMIT), ...updateSpacedReview(prev, true, now, { productionNow: true }) };
          if (getMasteryStage(record, {kind:"word",obj:word}) === MASTERY_STAGE.MASTERED) record.everMastered = true;
          nextMastery = { ...nextMastery, [word.word]: record };
        });
        masteryRef.current = nextMastery; setMastery(nextMastery);
      }
      recordStudyDay(); setScreen("finalResults");
    } catch (e) { console.error("Final Case AI failed:", e); setAiError("AI evaluation is unavailable. Retry the report, or return without changing mastery."); }
    finally { setAiBusy(false); }
  }

  // Reports the current variant as bad: retires it permanently, queues a
  // replacement in the background, and skips to the next case without
  // counting against the player.
  function handleFlag() {
    if (!question || !question.poolType || !question.poolItemId) return;
    const wordObj = question.target;
    const wordPools = getWordPools(pools, wordObj);
    const arr = wordPools[question.poolType].map((it) =>
      it.id === question.poolItemId
        ? { ...it, flagged: true, lockedUntil: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 }
        : it
    );
    const nextWordPools = { ...wordPools, [question.poolType]: arr };
    const nextPools = { ...pools, [wordObj.word]: nextWordPools };
    setPools(nextPools);
    triggerGeneration([{ word: wordObj.word, poolType: question.poolType }], nextPools);
    nextQuestion();
  }

  // --- Speed Round ---------------------------------------------------------

  const MIN_LEARNED_FOR_SPEED = 5;
  const masteredWords = masteredOnlyWords;

  function startSpeedRound() {
    if (masteredOnlyWords.length < MIN_LEARNED_FOR_SPEED) return;
    const preferredPool = masteredOnlyWords;
    if(!buildSpeedQuestion(preferredPool)){setToast({text:"No short questions with safe options are available."});return;}
    speedDeadlineRef.current=Date.now()+60000;
    setSpeedPool(preferredPool); setSpeedScore(0); setSpeedAnswered(0); setSpeedCorrect(0); setSpeedCombo(0); setSpeedBestCombo(0); setSpeedTimeLeft(60); setSpeedSelected(null); setSpeedStatus(null);
    setSpeedQuestion(buildSpeedQuestion(preferredPool, poolsRef.current)); setScreen("speed");
  }

  function handleSpeedAnswer(opt) {
    if (speedStatus || !speedQuestion) return;
    const correct = opt === speedQuestion.answer;
    setSpeedSelected(opt); setSpeedStatus(correct ? "correct" : "wrong"); setSpeedAnswered((n) => n + 1);
    if (correct) {
      setSpeedCorrect((n) => n + 1);
      const nextCombo = speedCombo + 1; setSpeedCombo(nextCombo); setSpeedBestCombo((b) => Math.max(b, nextCombo));
      const bonus = Math.min(nextCombo, 5) * 2; setSpeedScore((s) => s + 10 + bonus); setScore((s) => s + 10);
    } else { setSpeedCombo(0); }
    setTimeout(() => { setSpeedSelected(null); setSpeedStatus(null); setSpeedQuestion(buildSpeedQuestion(speedPool, poolsRef.current)); }, 550);
  }

  function endSpeedRound() {
    setBestSpeedScore((b) => Math.max(b, speedScore)); setBestSpeedCombo((b) => Math.max(b, speedBestCombo)); setScreen("speedResults");
  }

  useEffect(() => {
    if (screen !== "speed") return;
    if (speedTimeLeft <= 0) { endSpeedRound(); return; }
    const t = setTimeout(() => setSpeedTimeLeft(Math.max(0, Math.ceil((speedDeadlineRef.current-Date.now())/1000))), 1000);
    return () => clearTimeout(t);
  }, [screen, speedTimeLeft]);

  async function handleReset() {
    progressExtrasRef.current={};setActiveSession(null);
    try { await storage.delete(STORAGE_KEY, false); } catch (_) {}
    const empty = emptyProgressData();
    setScore(0); setStreak(0); setBestStreak(0); setAttempted(0);
    setMastery({}); masteryRef.current = {};
    setLevelsCleared([]); setLevelStats({});
    setStudyStreak(0); setBestStudyStreak(0); setLastStudyDate(null); studyRef.current = { studyStreak: 0, bestStudyStreak: 0, lastStudyDate: null };
    setPools({}); poolsRef.current = {}; setConfusions({}); confusionsRef.current = {};
    setBestSpeedScore(0); setBestSpeedCombo(0); pendingGenRef.current = new Set(); seenBadgesRef.current = new Set();
    setSolvedStories([]);setSessionLogs([]);
    setScreen("levels"); setCurrentLevelIndex(null); setBadgesOpen(false); setDashboardOpen(false);
    // Custom content is intentionally stored under CUSTOM_CONTENT_KEY and is never deleted here.
  }
  // Full factory reset: progress AND every imported word/grammar/pun/story/
  // combo, plus the level order they built. Distinct from handleReset, which
  // deliberately leaves imported content untouched.
  async function handleWipeEverything() {
    await handleReset();
    mergeCustomData([], [], [], [], []);
    setCustomWords([]); setCustomGrammar([]); setCustomPuns([]); setCustomChallenges([]);
    setCustomCombos([]); setCustomStories([]);
    setDataVersion((v) => v + 1);
    try { await storage.delete(CUSTOM_CONTENT_KEY, false); } catch (_) {}
  }

  // Step 1: parse the pasted export and figure out what's genuinely new
  // (dedup against everything already loaded, built-in or imported).
  // Builds a JSON snapshot of every playable piece of content, meant to be
  // handed to another AI for a review pass, then brought back in with
  // "Apply AI Review" below.
  function handleExport(mode) {
    const content = V2.contentOnly(mode === "builtin" ? {words:BUILTIN_WORDS,grammar:BUILTIN_GRAMMAR,puns:BUILTIN_PUNS,challenges:BUILTIN_CHALLENGES} : liveContent());
    const payload = mode === "backup" ? {
      ...progressExtrasRef.current, ...content, kind:"backup", schemaVersion:SCHEMA_VERSION, contentSchemaVersion:2,
      activeSession, levelOrder:LEVEL_ORDER, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings,
    } : content;
    setExportText(JSON.stringify(payload,null,2)); setExportCopied(false); setContentPanelView("export");
  }

  async function handleCopyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 2500);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  }

  async function handleQuickBackup() {
    // One click, no need to open Data Center at all — for the "I'm about
    // to publish a new version" moment when speed matters most.
    const content = V2.contentOnly(liveContent());
    const payload = {
      ...progressExtrasRef.current, ...content, kind: "backup", schemaVersion: SCHEMA_VERSION, contentSchemaVersion: 2,
      activeSession, levelOrder: LEVEL_ORDER, score, streak, bestStreak, attempted, mastery, levelsCleared, levelStats, studyStreak, bestStudyStreak, lastStudyDate, pools, bestSpeedScore, bestSpeedCombo, confusions, settings,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setQuickBackupCopied(true);
      setToast({ kind: "import", text: "Full backup copied — paste it into the new version's Import Center." });
      setTimeout(() => setQuickBackupCopied(false), 2500);
    } catch (e) {
      console.error("Quick backup copy failed:", e);
      setToast({ text: "Couldn't copy to clipboard — try Admin → Data → Full Backup instead." });
    }
  }

  function handleDownloadExport() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "word-hunter-backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Lets the user upload a .json/.txt file instead of pasting into the
  // Apply/Restore box — reads it as plain text and drops it straight into
  // reviewText, same path as a paste.
  function handleReviewFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setReviewError(null);
    setAiFixError(null); setAiFixChanges(null);
    const reader = new FileReader();
    reader.onload = () => {
      setReviewText(String(reader.result || ""));
    };
    reader.onerror = () => {
      setReviewError("Couldn't read that file — try pasting the JSON directly instead.");
    };
    reader.readAsText(file);
  }

  // Step 1 of applying a review: match incoming entries against what exists
  // (words by exact word text, grammar/puns by id) and split into updates
  // vs genuinely new content.
  function handleParseReview() {
    setReviewError(null);setReviewPreview(null);setAiFixError(null);
    try {
      const data=JSON.parse(reviewText);
      const issues=V2.validateContent(data,liveContent());
      if(issues.length){setReviewError(issues.join("\n"));return;}
      const preview={backupData:data,isBackup:data.kind==="backup"||(!data.kind&&(data.mastery!==undefined||data.pools!==undefined)),restoreProgress:false,builtinSkipped:0,invalidChallenges:[],expectedWords:WORDS.length,gotWords:data.words?.length||0,expectedChallenges:CHALLENGES.length,gotChallenges:data.challenges?.length||0};
      for(const [field,singular,source,key] of [["words","word",WORDS,"word"],["grammar","grammar",GRAMMAR,"id"],["puns","pun",PUNS,"id"],["challenges","challenge",CHALLENGES,"id"]]){
        preview[singular+"Updates"]=[];const plural=field[0].toUpperCase()+field.slice(1);preview["new"+plural]=[];
        for(const incoming of data[field]||[]){const existing=source.find(x=>V2.norm(x[key])===V2.norm(incoming[key]));if(existing)preview[singular+"Updates"].push({existing,incoming});else preview["new"+plural].push(incoming);}
      }
      setReviewPreview(preview);
    }catch(e){setReviewError("JSON: "+e.message);}
  }

  // Lets the person hand a failed import straight to the AI instead of
  // hand-editing JSON. Sends the exact validator errors plus the raw text,
  // gets back a corrected document and a plain-English list of what
  // changed, and drops the fix into the textarea — it does NOT auto-import;
  // the person still reviews and hits Parse/Preview like any other paste.
  async function handleAiFixImport() {
    if (!reviewText.trim() || !reviewError) return;
    setAiFixBusy(true); setAiFixError(null); setAiFixChanges(null);
    try {
      const result = await aiFixImportJson(reviewText, reviewError);
      setReviewText(JSON.stringify(result.fixed, null, 2));
      setAiFixChanges(result.changes.length ? result.changes : ["AI adjusted the JSON to satisfy the validator — review the fields it touched before applying."]);
      setReviewError(null);
    } catch (e) {
      setAiFixError(e.message || "AI couldn't fix this. Try editing manually.");
    } finally {
      setAiFixBusy(false);
    }
  }

  function toggleRestoreProgress() {
    setReviewPreview((prev) => (prev ? { ...prev, restoreProgress: !prev.restoreProgress } : prev));
  }

  // Step 2: apply it. Matched entries keep their word/id (the progress key)
  // and only refresh their content — including any already-seeded pool
  // variants, so an in-progress word shows the improved text too. Anything
  // unmatched goes through the normal capacity-aware level placement.
  function handleConfirmReview() {
    if(!reviewPreview)return;
    const {backupData:data,restoreProgress}=reviewPreview;
    const issues=V2.validateContent(data,restoreProgress?{}:liveContent());if(issues.length){setReviewError(issues.join("\n"));return;}
    // The existing restore checkbox plus the explicit Restore backup button
    // confirm replacement inside the artifact, without a sandbox-blocked native dialog.
    const content=restoreProgress?V2.mergeContent({},data):V2.mergeContent(liveContent(),data);
    const order=restoreProgress&&Array.isArray(data.levelOrder)?data.levelOrder:insertLevelTitles(LEVEL_ORDER,[...new Set([...content.words,...content.grammar,...content.puns,...content.challenges].map(x=>x.category).filter(Boolean))]);
    contentNoteRef.current=data.note||contentNoteRef.current;
    mergeCustomData(content.words,content.grammar,content.puns,content.challenges,order);
    setCustomWords(content.words);setCustomGrammar(content.grammar);setCustomPuns(content.puns);setCustomChallenges(content.challenges);setCustomCombos(content.combos);setCustomStories(content.stories);
    if(restoreProgress){
      const restored=migrateProgressData(data);progressExtrasRef.current=restored;setActiveSession(restored.activeSession||null);
      setScore(restored.score);setStreak(restored.streak);setBestStreak(restored.bestStreak);setAttempted(restored.attempted);
      setMastery(restored.mastery);masteryRef.current=restored.mastery;setLevelsCleared(restored.levelsCleared);setLevelStats(restored.levelStats);
      setStudyStreak(restored.studyStreak);setBestStudyStreak(restored.bestStudyStreak);setLastStudyDate(restored.lastStudyDate);
      studyRef.current={studyStreak:restored.studyStreak,bestStudyStreak:restored.bestStudyStreak,lastStudyDate:restored.lastStudyDate};
      setPools(restored.pools);poolsRef.current=restored.pools;setBestSpeedScore(restored.bestSpeedScore);setBestSpeedCombo(restored.bestSpeedCombo);setConfusions(restored.confusions);confusionsRef.current=restored.confusions;setSolvedStories(restored.solvedStories||[]);setSessionLogs(restored.sessionLogs||[]);setQuestionReports(Array.isArray(restored.reports)?restored.reports:[]);setSettings(normalizeSettings(restored.settings));
    }
    // Content import deliberately retains pools and all progress byte-for-byte.
    // New sessions read current authored text, not stale seed variants.
    setDataVersion(v=>v+1);setReviewPreview(null);setReviewText("");setImportOpen(false);setScreen("levels");
    setToast({text:restoreProgress?"Full backup restored":"Content merged; all player progress retained"});
  }


  const earnedBadgesCount = BADGES.filter((b) => getBadgeProgress(b, { mastery, bestStreak }).earned).length;
  const totalLevelsCleared = levelsCleared.length;
  const nextLevelIndex = currentLevelIndex !== null ? currentLevelIndex + 1 : null;
  const hasNextLevel = nextLevelIndex !== null && nextLevelIndex < LEVELS.length;
  const roundAccuracy = roundTotal > 0 ? Math.round((roundCorrect / roundTotal) * 100) : 0;
  const finalEvidenceUsed = finalCaseWords.filter((word) => { const n = normalizeAnswerText(finalReportText); return n.includes(normalizeAnswerText(word.word)); }).length;
  const fileMeta = currentEntry ? entryFileMeta(currentEntry) : null;
  const FileIcon = fileMeta ? fileMeta.icon : Search;

  return (
    <div className="wh-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Special+Elite&family=IBM+Plex+Mono:wght@500;600&family=Libre+Franklin:wght@400;500;600;700&display=swap');

        .wh-v2-nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
        .wh-v2-nav button, .wh-v2-tokens button { background:var(--ink-soft);color:var(--paper);border:1px solid var(--gold-soft);border-radius:4px;padding:12px;cursor:pointer; }
        .wh-v2-nav button[aria-pressed="true"] {background:var(--gold);color:var(--ink);}
        .wh-v2-learn {border-bottom:1px solid var(--gold-soft);padding:14px 0;overflow-wrap:anywhere;}
        .wh-v2-input {box-sizing:border-box;width:100%;font:inherit;padding:14px;margin:12px 0;}
        .wh-v2-tokens {display:flex;flex-wrap:wrap;gap:8px;min-height:48px;margin:12px 0;}
        .wh-v2-story {background:var(--ink-soft);border:1px solid var(--gold-soft);padding:14px;margin:12px 0;}
        .wh-v2-story p {white-space:pre-wrap;max-height:35vh;overflow:auto;line-height:1.8;}
        .wh-v2-notice {color:var(--gold);}
        .wh-level-card .wh-back-btn, .wh-card .wh-back-btn {color:var(--ink);}
        @media(max-width:480px) {.wh-level-card{flex-wrap:wrap}.wh-level-info{min-width:140px}.wh-v2-nav button{flex:1;min-width:130px}}
        .wh-panel .wh-level-btn {margin:8px 8px 14px 0;}
        .wh-import-error {white-space:pre-wrap;}
        .wh-say-panel { max-width: 380px; padding: 20px; border-color: rgba(201,162,39,0.45); }
        .wh-say-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .wh-say-label { font:10px 'IBM Plex Mono',monospace; letter-spacing:1.6px; color:var(--gold-soft); }
        .wh-say-term { font-family:'Special Elite',monospace; font-size:26px; line-height:1.2; margin:4px 0 0; color:var(--paper); word-break:break-word; }
        .wh-say-badge { display:inline-flex; align-items:center; gap:6px; margin:14px 0 0; padding:5px 10px; border-radius:999px; font:11px 'IBM Plex Mono',monospace; border:1px solid transparent; }
        .wh-say-badge.is-us { color:var(--green); border-color:rgba(79,121,66,0.5); background:rgba(79,121,66,0.12); }
        .wh-say-badge.is-soft { color:var(--gold-soft); border-color:rgba(201,162,39,0.4); background:rgba(201,162,39,0.1); }
        .wh-say-badge.is-loading { color:var(--text-dim); border-color:rgba(107,93,79,0.5); }
        .wh-say-body { margin-top:16px; display:flex; flex-direction:column; gap:12px; }
        .wh-say-audio { width:100%; height:38px; }
        .wh-say-play {
          display:flex; align-items:center; justify-content:center; gap:8px; width:100%;
          font:14px 'IBM Plex Mono',monospace; padding:13px; cursor:pointer;
          color:var(--ink); background:var(--gold); border:none; border-radius:6px;
        }
        .wh-say-play:hover { background:#d8b02c; }
        .wh-say-secondary {
          display:flex; align-items:center; justify-content:center; gap:6px; width:100%;
          font:12px 'IBM Plex Mono',monospace; padding:9px; cursor:pointer;
          color:var(--gold-soft); background:none; border:1px solid rgba(201,162,39,0.4); border-radius:6px;
        }
        .wh-say-secondary:hover { background:rgba(201,162,39,0.12); }
        .wh-say-muted { font:11px 'IBM Plex Mono',monospace; color:var(--text-dim); margin:0; line-height:1.5; }
        .wh-say-link { display:block; margin-top:18px; padding-top:14px; border-top:1px solid rgba(201,162,39,0.2); font:11px 'IBM Plex Mono',monospace; color:var(--gold-soft); text-decoration:none; }
        .wh-say-link:hover { text-decoration:underline; }
        .wh-root {
          --ink: #1c1a17;
          --ink-soft: #2a2620;
          --paper: #ede4d3;
          --paper-dim: #ded2ba;
          --gold: #c9a227;
          --gold-soft: #a6841f;
          --green: #4f7942;
          --red: #b33a3a;
          --text-dim: #6b5d4f;
          font-family: 'Libre Franklin', sans-serif;
          background: var(--ink);
          color: var(--paper);
          min-height: 100vh;
          padding: 28px 16px 40px;
          box-sizing: border-box;
          background-image:
            radial-gradient(circle at 15% 10%, rgba(201,162,39,0.06), transparent 40%),
            radial-gradient(circle at 85% 90%, rgba(201,162,39,0.05), transparent 45%);
        }
        .wh-container { max-width: 640px; margin: 0 auto; }
        .wh-container-admin { max-width: 1280px; }

        .wh-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 22px; flex-wrap: wrap; gap: 10px; }
        .wh-title { font-family: 'Special Elite', monospace; font-size: 28px; letter-spacing: 0.5px; color: var(--paper); margin: 0; }
        .wh-title span { color: var(--gold); }
        .wh-sub { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px; }

        .wh-stats { display: flex; gap: 10px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--paper-dim); align-items: center; flex-wrap: wrap; }
        .wh-stat-streak { display: flex; align-items: center; gap: 4px; color: var(--gold); }
        .wh-reset {
          display: flex; align-items: center; gap: 4px;
          background: none; border: none; color: var(--text-dim); cursor: pointer;
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 2px 4px;
        }
        .wh-reset:hover { color: var(--paper-dim); }
        .wh-reset:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
        .wh-reset.danger { color: var(--red); }
        .wh-reset.danger:hover { color: var(--red); opacity: 0.8; }
        .wh-confirm-panel { border-color: rgba(197,74,58,0.45); }
        .wh-confirm-panel p { margin: 0 0 12px; }

        .wh-icon-btn {
          display: flex; align-items: center; gap: 4px;
          background: none; border: 1px solid rgba(201,162,39,0.4); color: var(--gold);
          cursor: pointer; border-radius: 12px;
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 3px 9px;
        }
        .wh-icon-btn:hover { background: rgba(201,162,39,0.12); }
        .wh-icon-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

        .wh-panel {
          background: var(--ink-soft);
          border: 1px solid rgba(201,162,39,0.3);
          border-radius: 4px;
          padding: 14px 16px 6px;
          margin-bottom: 18px;
        }
        .wh-panel-header {
          display: flex; justify-content: space-between; align-items: center;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--gold); margin-bottom: 12px;
        }
        .wh-panel-header button {
          background: none; border: none; color: var(--text-dim); cursor: pointer; display: flex;
        }
        .wh-panel-header button:hover { color: var(--paper); }

        .wh-badges-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 8px; padding-bottom: 12px;
        }
        .wh-badge {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; border-radius: 3px;
          background: rgba(237,228,211,0.04);
          border: 1px solid rgba(237,228,211,0.1);
          color: var(--text-dim);
        }
        .wh-badge.earned { color: var(--paper); border-color: rgba(201,162,39,0.45); background: rgba(201,162,39,0.08); }
        .wh-badge.earned svg { color: var(--gold); }
        .wh-badge-text { min-width: 0; }
        .wh-badge-label { font-family: 'Libre Franklin', sans-serif; font-size: 12px; line-height: 1.3; }
        .wh-badge-progress { font-family: 'IBM Plex Mono', monospace; font-size: 10px; opacity: 0.75; margin-top: 2px; }

        .wh-dash-group { margin-bottom: 14px; }
        .wh-dash-summary {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
          gap: 8px; margin-bottom: 10px;
        }
        .wh-dash-stat {
          text-align: center; padding: 10px 6px; border-radius: 4px;
          background: rgba(237,228,211,0.04); border: 1px solid rgba(237,228,211,0.1);
        }
        .wh-dash-stat.mastered { border-color: rgba(201,162,39,0.45); background: rgba(201,162,39,0.08); }
        .wh-dash-stat-num { font-family: 'IBM Plex Mono', monospace; font-size: 20px; font-weight: 600; color: var(--paper); line-height: 1; }
        .wh-dash-stat.mastered .wh-dash-stat-num { color: var(--gold); }
        .wh-dash-stat-label { font-family: 'Libre Franklin', sans-serif; font-size: 10px; color: var(--paper-dim); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
        .wh-dash-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(237,228,211,0.08); margin-bottom: 6px; }
        .wh-dash-bar-seg { height: 100%; }
        .wh-dash-bar-seg.mastered { background: var(--gold); }
        .wh-dash-bar-seg.learned { background: var(--gold-soft); }
        .wh-dash-bar-seg.familiar { background: rgba(237,228,211,0.35); }
        .wh-dash-accuracy { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper-dim); margin-bottom: 10px; }
        .wh-dash-group-title {
          font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 1px;
          text-transform: uppercase; color: var(--gold-soft); margin-bottom: 6px;
        }
        .wh-dash-table { width: 100%; border-collapse: collapse; font-family: 'Libre Franklin', sans-serif; font-size: 12px; }
        .wh-dash-table td { padding: 4px 6px; border-bottom: 1px solid rgba(237,228,211,0.08); color: var(--paper-dim); }
        .wh-dash-table td.wh-dash-name { color: var(--paper); }
        .wh-dash-table td.wh-dash-num { text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 11px; white-space: nowrap; }
        .wh-dash-scroll { max-height: 320px; overflow-y: auto; padding-right: 4px; }

        .wh-content-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
        .wh-content-tabs button {
          font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: 0.3px;
          padding: 6px 10px; border-radius: 12px; cursor: pointer;
          background: transparent; border: 1px solid rgba(237,228,211,0.2); color: var(--paper-dim);
        }
        .wh-content-tabs button.active { background: var(--gold); border-color: var(--gold); color: var(--ink); font-weight: 600; }
        .wh-import-hint { font-family: 'Libre Franklin', sans-serif; font-size: 12.5px; color: var(--paper-dim); margin: 0 0 10px; line-height: 1.5; }
        .wh-import-textarea {
          width: 100%; box-sizing: border-box; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
          background: rgba(237,228,211,0.06); color: var(--paper); border: 1px solid rgba(237,228,211,0.18);
          border-radius: 3px; padding: 10px; resize: vertical; line-height: 1.5;
        }
        .wh-import-textarea:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
        .wh-import-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; padding-bottom: 4px; }
        .wh-import-actions-tight { margin-top: 0; margin-bottom: 10px; justify-content: flex-start; }
        .wh-restore-toggle {
          display: flex; align-items: flex-start; gap: 8px; margin-top: 12px;
          font-family: 'Libre Franklin', sans-serif; font-size: 12px; color: var(--paper-dim); line-height: 1.5; cursor: pointer;
        }
        .wh-restore-toggle input { margin-top: 3px; flex-shrink: 0; }
        .wh-import-btn {
          display: flex; align-items: center; gap: 6px;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.3px;
          padding: 9px 16px; border-radius: 3px; cursor: pointer; border: 1.5px solid var(--gold);
        }
        .wh-import-btn.primary { background: var(--gold); color: var(--ink); font-weight: 600; }
        .wh-import-btn.primary:disabled { opacity: 0.4; cursor: default; }
        .wh-import-btn.secondary { background: transparent; color: var(--paper-dim); border-color: rgba(237,228,211,0.25); }
        .wh-import-error {
          font-family: 'Libre Franklin', sans-serif; font-size: 12.5px; color: var(--red);
          background: rgba(179,58,58,0.12); border: 1px solid rgba(179,58,58,0.3);
          border-radius: 3px; padding: 8px 10px; margin-top: 10px; line-height: 1.5;
        }
        .wh-import-summary { font-family: 'Libre Franklin', sans-serif; font-size: 14px; color: var(--paper); padding-bottom: 6px; }
        .wh-import-breakdown {
          display: flex; flex-direction: column; gap: 4px; margin-top: 8px;
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper-dim);
        }

        .wh-toast {
          position: fixed; top: 18px; left: 50%; transform: translateX(-50%);
          background: var(--gold); color: var(--ink);
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600;
          padding: 10px 18px; border-radius: 20px; z-index: 50;
          display: flex; align-items: center; gap: 8px;
          box-shadow: 0 8px 20px rgba(0,0,0,0.4);
        }
        .wh-toast b { font-family: 'Special Elite', monospace; font-weight: normal; }
        @media (prefers-reduced-motion: no-preference) {
          .wh-toast { animation: wh-toast-in 0.3s ease; }
        }
        @keyframes wh-toast-in {
          0% { opacity: 0; transform: translate(-50%, -12px); }
          100% { opacity: 1; transform: translate(-50%, 0); }
        }

        /* Level select */
        .wh-dupe-banner {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          background: rgba(201,162,39,0.1); border: 1px solid rgba(201,162,39,0.35);
          border-radius: 4px; padding: 10px 14px; margin-bottom: 12px;
          font-family: 'Libre Franklin', sans-serif; font-size: 12.5px; color: var(--paper-dim); line-height: 1.5;
        }
        .wh-dupe-banner button {
          flex-shrink: 0; font-family: 'IBM Plex Mono', monospace; font-size: 11px;
          padding: 7px 12px; border-radius: 3px; border: 1px solid var(--gold); background: var(--gold);
          color: var(--ink); font-weight: 600; cursor: pointer;
        }
        .wh-speed-card {
          display: flex; align-items: center; gap: 14px;
          background: linear-gradient(135deg, rgba(201,162,39,0.16), rgba(201,162,39,0.05));
          border: 1px solid rgba(201,162,39,0.4); border-radius: 4px;
          padding: 14px 16px; margin-bottom: 14px;
        }
        .wh-speed-card.locked { opacity: 0.55; }
        .wh-speed-card-icon { color: var(--gold); flex-shrink: 0; }
        .wh-speed-card-info { flex: 1; min-width: 0; }
        .wh-speed-card-title { font-family: 'Special Elite', monospace; font-size: 16px; color: var(--paper); }
        .wh-speed-card-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper-dim); margin-top: 2px; }
        .wh-speed-card-btn {
          display: flex; align-items: center; gap: 6px; flex-shrink: 0;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px;
          padding: 9px 16px; border-radius: 3px; border: none; cursor: pointer;
          background: var(--gold); color: var(--ink); font-weight: 600;
        }
        .wh-speed-card-btn:disabled { background: rgba(237,228,211,0.15); color: var(--text-dim); cursor: not-allowed; }

        .wh-speed-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .wh-speed-timer {
          display: flex; align-items: center; gap: 5px;
          font-family: 'Special Elite', monospace; font-size: 20px; color: var(--gold);
        }
        .wh-speed-timer.urgent { color: var(--red); animation: wh-pulse 0.6s ease infinite; }
        @keyframes wh-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        .wh-speed-stats { display: flex; gap: 14px; font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--paper-dim); }
        .wh-speed-combo { color: var(--gold); }

        .wh-levels-list { display: grid; gap: 10px; }
        .wh-level-card {
          display: flex; align-items: center; gap: 14px;
          background: var(--paper); color: var(--ink);
          border-radius: 4px; padding: 16px 18px;
          box-shadow: 0 6px 16px rgba(0,0,0,0.25);
          position: relative; overflow: hidden;
        }
        .wh-level-card::before {
          content: '';
          position: absolute; left: 0; top: 0; bottom: 0; width: 5px;
          background: var(--gold); opacity: 0.7;
        }
        .wh-level-card.locked { background: rgba(237,228,211,0.55); color: var(--text-dim); }
        .wh-level-card.locked::before { background: rgba(28,26,23,0.15); }
        .wh-level-num {
          font-family: 'Special Elite', monospace; font-size: 22px; color: var(--gold-soft);
          width: 34px; text-align: center; flex-shrink: 0;
        }
        .wh-level-icon { flex-shrink: 0; color: var(--gold-soft); }
        .wh-level-card.locked .wh-level-icon { color: var(--text-dim); }
        .wh-level-info { flex: 1; min-width: 0; }
        .wh-level-title { font-family: 'Libre Franklin', sans-serif; font-weight: 600; font-size: 16px; display: flex; align-items: center; gap: 6px; }
        .wh-level-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); margin-top: 2px; }
        .wh-level-stage-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; background: rgba(237,228,211,0.1); margin-top: 6px; }
        .wh-level-stage-seg { height: 100%; }
        .wh-level-stage-seg.mastered { background: var(--gold); }
        .wh-level-stage-seg.learned { background: var(--gold-soft); }
        .wh-level-stage-seg.familiar { background: rgba(237,228,211,0.35); }
        .wh-level-stage-detail { margin-top: 4px; opacity: 0.85; }
        .wh-level-btn {
          flex-shrink: 0; display: flex; align-items: center; gap: 6px;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px;
          padding: 9px 14px; border-radius: 3px; border: none; cursor: pointer;
          background: var(--ink); color: var(--paper);
        }
        .wh-level-btn:disabled { background: rgba(28,26,23,0.15); color: var(--text-dim); cursor: not-allowed; }
        .wh-level-btn:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }
        .wh-level-delete-btn {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 50%; border: none; cursor: pointer;
          background: transparent; color: var(--text-dim);
        }
        .wh-level-delete-btn:hover { background: rgba(178,58,52,0.12); color: var(--red, #b23a34); }
        .wh-danger-btn { background: var(--red, #b23a34) !important; }
        .wh-modal-overlay {
          position: fixed; inset: 0; z-index: 200;
          background: rgba(10,9,7,0.72);
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .wh-modal-overlay .wh-panel { margin-bottom: 0; max-width: 420px; width: 100%; max-height: 82vh; overflow: auto; color: var(--paper); }
        .wh-modal-overlay .wh-panel p { color: var(--paper); }
        .wh-askable { position: relative; display: inline; }
        .wh-askable-word { cursor: pointer; border-radius: 2px; }
        .wh-askable-word:hover { background: rgba(201,162,39,0.22); }
        .wh-ask-toolbar {
          position: absolute; transform: translate(-50%, -100%); margin-top: -6px;
          z-index: 60; white-space: nowrap;
          display: flex; gap: 4px;
        }
        .wh-ask-toolbar button {
          display: flex; align-items: center; gap: 5px;
          font-family: 'IBM Plex Mono', monospace; font-size: 11px;
          background: var(--ink); color: var(--gold-soft);
          border: 1px solid rgba(201,162,39,0.5); border-radius: 4px;
          padding: 6px 9px; cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,0.35);
        }
        .wh-ask-toolbar button:hover { background: rgba(201,162,39,0.18); }
        .wh-story-solved-flag { display:inline-flex; align-items:center; gap:4px; margin-left:8px; font:11px 'IBM Plex Mono',monospace; color: var(--green,#4f7942); }
        .wh-fresh-copy-banner { background:rgba(201,162,39,0.15); border:1px solid rgba(201,162,39,0.5); border-radius:6px; padding:12px 14px; margin-bottom:14px; }
        .wh-fresh-copy-banner p { margin:0 0 10px; font-size:13px; }
        .wh-story-solved-banner { display:flex; align-items:center; gap:8px; background:rgba(79,121,66,0.15); border:1px solid rgba(79,121,66,0.4); border-radius:6px; padding:10px 14px; margin-bottom:12px; color:var(--green,#4f7942); font:600 14px 'IBM Plex Mono',monospace; }
        .wh-session-score { font-size:15px; font-weight:600; margin:4px 0; }
        .wh-session-score-sub { font-size:13px; color:var(--text-dim); margin:2px 0 12px; }

        /* Playing screen */
        .wh-round-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .wh-back-btn {
          display: flex; align-items: center; gap: 6px;
          background: none; border: none; color: var(--paper-dim); cursor: pointer;
          font-family: 'IBM Plex Mono', monospace; font-size: 12px;
        }
        .wh-back-btn:hover { color: var(--paper); }
        .wh-back-btn:disabled { opacity: 0.4; cursor: default; }
        .wh-flashcard-progress { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper-dim); margin: 14px 0 10px; }
        .wh-flashcard {
          background: var(--paper); color: var(--ink); border-radius: 4px;
          padding: 36px 24px; text-align: center; cursor: pointer; min-height: 130px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 12px 30px rgba(0,0,0,0.35), 0 2px 0 rgba(0,0,0,0.2);
        }
        .wh-flashcard-front h3 { font-family: 'Special Elite', monospace; font-size: 28px; margin: 0 0 12px; }
        .wh-flashcard-hint { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--ink); opacity: 0.55; margin: 0; }
        .wh-flashcard-back { width: 100%; }
        .wh-flashcard-back h3 { font-family: 'Special Elite', monospace; font-size: 20px; margin: 0 0 12px; }
        .wh-pos-tag { font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:normal; color:var(--text-dim); margin-left:8px; text-transform:lowercase; }
        .wh-flashcard-back p { margin: 0 0 8px; text-align: left; }
        .wh-flashcard-back p:last-child { margin-bottom: 0; }
        .wh-flashcard-img { display:block; width:100%; max-height:160px; object-fit:cover; border-radius:6px; margin-bottom:12px; }
        .wh-img-blocked { font:11px 'IBM Plex Mono',monospace; color:var(--text-dim); background:rgba(107,93,79,0.08); border:1px dashed rgba(107,93,79,0.4); border-radius:6px; padding:8px 10px; margin:0 0 12px; }
        .wh-img-blocked a { color:var(--gold-soft); }
        .wh-flashcard-nav { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 16px 0; }
        .wh-regen-area { margin-top: 12px; }
        .wh-regen-status { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--paper-dim); }
        .wh-regen-status.error { color: var(--red); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .wh-regen-preview {
          background: rgba(201,162,39,0.08); border: 1px solid rgba(201,162,39,0.35);
          border-radius: 4px; padding: 14px 16px; margin-top: 4px;
        }
        .wh-regen-label { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--gold-soft); text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 8px; }
        .wh-regen-preview p { margin: 0 0 8px; font-size: 13.5px; }
        .wh-regen-preview p:last-of-type { margin-bottom: 0; }
        .wh-regen-actions { display: flex; gap: 10px; margin-top: 12px; }
        .wh-regen-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--paper-dim); margin: 8px 0 0; }
        .wh-nav-btn {
          border: 1.5px solid rgba(237,228,211,0.3) !important;
          background: rgba(237,228,211,0.06);
          padding: 7px 13px; border-radius: 3px;
        }
        .wh-nav-btn:hover { background: rgba(237,228,211,0.13); border-color: rgba(237,228,211,0.55) !important; }
        .wh-session-back { margin-top: 18px; }
        .wh-submit-btn { margin-top: 16px; }
        .wh-storage-warning { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .wh-warning-close { background: none; border: none; color: inherit; cursor: pointer; flex-shrink: 0; opacity: 0.7; padding: 2px; }
        .wh-warning-close:hover { opacity: 1; }
        .wh-round-progress { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--text-dim); }

        .wh-card {
          position: relative;
          background: var(--paper);
          color: var(--ink);
          border-radius: 4px;
          padding: 28px 26px 26px;
          box-shadow: 0 12px 30px rgba(0,0,0,0.35), 0 2px 0 rgba(0,0,0,0.2);
          overflow: hidden;
        }
        .wh-card::before {
          content: '';
          position: absolute; left: 0; top: 0; bottom: 0; width: 6px;
          background: repeating-linear-gradient(180deg, var(--gold) 0 10px, transparent 10px 16px);
          opacity: 0.7;
        }
        .wh-file-row { display: flex; align-items: center; justify-content: space-between; margin: 0 10px 4px; flex-wrap: wrap; gap: 6px; }
        .wh-file-row-right { display: flex; align-items: center; gap: 8px; }
        .wh-flag-btn {
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid rgba(28,26,23,0.2); color: var(--text-dim);
          border-radius: 3px; padding: 3px 6px; cursor: pointer;
        }
        .wh-flag-btn:hover { color: var(--red); border-color: var(--red); }
        .wh-flag-btn:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }
        .wh-file-label {
          font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 1.5px;
          color: var(--gold-soft); text-transform: uppercase;
          display: flex; align-items: center; gap: 6px;
        }
        .wh-category-badge {
          font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 1px;
          color: var(--text-dim); border: 1px solid rgba(28,26,23,0.25);
          padding: 2px 8px; border-radius: 10px; text-transform: uppercase;
        }
        .wh-prompt-label { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--text-dim); margin: 0 10px 14px; }

        .wh-word {
          font-family: 'Special Elite', monospace;
          font-size: 34px;
          margin: 4px 10px 18px;
          line-height: 1.15;
        }
        .wh-sentence {
          font-family: 'Libre Franklin', sans-serif;
          font-size: 19px; line-height: 1.5;
          margin: 4px 10px 20px;
          font-style: italic;
          white-space: pre-line;
        }

        .wh-options { display: grid; gap: 10px; margin: 0 10px; }
        .wh-report-reasons { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
        .wh-report-reasons .wh-option { padding: 6px 10px; font-size: 12px; border-radius: 999px; }
        .wh-option-multi { display: flex; align-items: center; gap: 10px; }
        .wh-option-check {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; flex-shrink: 0; border-radius: 3px;
          border: 1.5px solid rgba(28,26,23,0.3); font-size: 12px; color: var(--green);
        }
        .wh-option-multi.picked { border-color: var(--gold-soft); background: rgba(201,162,39,0.12); }
        .wh-option-multi.picked .wh-option-check { border-color: var(--gold-soft); }
        .wh-option {
          text-align: left;
          font-family: 'Libre Franklin', sans-serif;
          font-size: 15px;
          padding: 13px 16px;
          border-radius: 3px;
          border: 1.5px solid rgba(28,26,23,0.18);
          background: rgba(255,255,255,0.35);
          color: var(--ink);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .wh-option:hover:not(:disabled) { border-color: var(--gold-soft); background: rgba(255,255,255,0.6); }
        .wh-option.picked { border-color: var(--gold-soft); background: rgba(201,162,39,0.14); }
        .wh-option:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }
        .wh-option:disabled { cursor: default; }
        .wh-option.correct { border-color: var(--green); background: rgba(79,121,66,0.18); font-weight: 600; }
        .wh-option.wrong { border-color: var(--red); background: rgba(179,58,58,0.16); }
        .wh-option.reveal { border-color: var(--green); background: rgba(79,121,66,0.18); font-weight: 600; }

        .wh-type-form { display: flex; gap: 10px; margin: 0 10px; }
        .wh-type-input {
          flex: 1; font-family: 'Libre Franklin', sans-serif; font-size: 16px;
          padding: 12px 14px; border-radius: 3px; border: 1.5px solid rgba(28,26,23,0.25);
          background: rgba(255,255,255,0.5); color: var(--ink);
        }
        .wh-type-input:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }
        .wh-type-submit {
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.5px;
          padding: 0 18px; border-radius: 3px; border: none; background: var(--ink); color: var(--paper);
          cursor: pointer;
        }
        .wh-type-submit:disabled { opacity: 0.4; cursor: default; }

        .wh-feedback { margin: 18px 10px 0; font-size: 14px; line-height: 1.5; }
        .wh-result-details { margin: 12px 10px 0; }
        .wh-result-details p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.5; color: var(--ink); }
        .wh-result-details p:last-child { margin-bottom: 0; }
        .wh-ai-feedback { font-style: italic; opacity: 0.85; }
        .wh-result-continue { margin: 18px 10px 0; }
        .wh-feedback.correct { color: var(--green); }
        .wh-feedback.wrong, .wh-feedback.close { color: var(--red); }
        .wh-feedback b { font-family: 'Special Elite', monospace; }
        .wh-feedback-card { margin-top: 10px; padding: 12px; border: 1px solid rgba(201,162,39,.28); background: rgba(0,0,0,.16); border-radius: 4px; color: var(--paper-dim); }
        .wh-feedback-card .lead { font-family: 'IBM Plex Mono', monospace; color: var(--gold); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 7px; }
        .wh-feedback-pair { display: grid; gap: 4px; font-size: 13px; }
        .wh-feedback-pair b { color: var(--paper); }
        .wh-freeform { width: 100%; min-height: 110px; box-sizing: border-box; resize: vertical; background: #171512; border: 1px solid #4d4437; color: var(--paper); border-radius: 4px; padding: 12px; font: 14px/1.55 'Libre Franklin', sans-serif; }
        .wh-token-area { display: grid; gap: 10px; margin: 0 10px; }
        .wh-token-label { font: 10px 'IBM Plex Mono', monospace; letter-spacing: .7px; text-transform: uppercase; color: var(--text-dim); }
        .wh-token-bank, .wh-token-answer { display: flex; flex-wrap: wrap; gap: 8px; min-height: 48px; padding: 10px; border-radius: 4px; border: 1px dashed rgba(28,26,23,.3); background: rgba(255,255,255,.25); }
        .wh-token-answer { border-style: solid; background: rgba(201,162,39,.08); }
        .wh-token { border: 1px solid rgba(28,26,23,.3); background: rgba(255,255,255,.7); color: var(--ink); border-radius: 3px; padding: 8px 10px; cursor: pointer; font: 14px 'Libre Franklin', sans-serif; }
        .wh-token:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }
        .wh-stage-head { display: flex; justify-content: space-between; gap: 10px; margin: 0 10px 12px; font: 11px 'IBM Plex Mono', monospace; color: var(--text-dim); }
        .wh-step-feedback { margin: 10px; padding: 10px 12px; border-radius: 4px; font: 13px/1.45 'Libre Franklin', sans-serif; background: rgba(79,121,66,.12); color: var(--green); }
        .wh-step-feedback.wrong { background: rgba(179,58,58,.11); color: var(--red); }
        .wh-model-answer { margin-top: 8px; padding: 9px 10px; border-left: 3px solid var(--gold-soft); background: rgba(201,162,39,.08); color: var(--ink); font-style: italic; }
        .wh-hint { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--gold); margin: 8px 0; letter-spacing: 1px; }
        .wh-insight-card { border: 1px solid rgba(201,162,39,.28); background: rgba(201,162,39,.055); padding: 13px 14px; margin-bottom: 12px; display: flex; gap: 12px; align-items: flex-start; border-radius: 4px; }
        .wh-insight-title { font-family: 'Special Elite', monospace; color: var(--gold); margin-bottom: 5px; }
        .wh-insight-lines { display: grid; gap: 3px; font-size: 12px; color: var(--paper-dim); }
        .wh-adaptive-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
        .wh-adaptive-actions button { border: 1px solid #5c4f3d; background: #27221b; color: var(--paper); padding: 9px 12px; border-radius: 3px; cursor: pointer; font: 600 11px 'IBM Plex Mono', monospace; }
        .wh-adaptive-actions button.primary { border-color: var(--gold-soft); color: var(--gold); }
        .wh-evidence-list { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
        .wh-evidence-chip { border:1px solid #504637; padding:5px 8px; border-radius:999px; font:11px 'IBM Plex Mono', monospace; color:var(--paper-dim); }
        .wh-evidence-chip.used { border-color:var(--green); color:#8db37f; }
        .wh-case-report textarea { width:100%; min-height:120px; box-sizing:border-box; background:#171512; border:1px solid #4d4437; color:var(--paper); padding:12px; border-radius:4px; }


        .wh-stamp {
          position: absolute; top: 22px; right: 26px;
          font-family: 'Special Elite', monospace; font-size: 20px; letter-spacing: 1px;
          padding: 6px 14px; border: 3px solid; border-radius: 4px; text-transform: uppercase;
          transform: rotate(-8deg); opacity: 0.92; pointer-events: none;
        }
        .wh-stamp.correct { color: var(--green); border-color: var(--green); }
        .wh-stamp.wrong { color: var(--red); border-color: var(--red); }
        .wh-stamp.close { color: var(--gold-soft); border-color: var(--gold-soft); }

        @media (prefers-reduced-motion: no-preference) {
          .wh-stamp { animation: wh-stamp-in 0.28s cubic-bezier(.2,.9,.3,1.2); }
        }
        @keyframes wh-stamp-in {
          0% { opacity: 0; transform: rotate(-8deg) scale(1.6); }
          100% { opacity: 0.92; transform: rotate(-8deg) scale(1); }
        }

        .wh-next { margin: 20px 10px 0; display: flex; justify-content: flex-end; }
        .wh-next button {
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.5px;
          padding: 10px 18px; border-radius: 3px; border: 1.5px solid var(--ink);
          background: var(--ink); color: var(--paper); cursor: pointer;
        }
        .wh-next button:focus-visible { outline: 2px solid var(--gold-soft); outline-offset: 2px; }

        .wh-round-progress-track { height: 4px; background: rgba(237,228,211,0.15); border-radius: 2px; margin: 14px 0 0; overflow: hidden; }
        .wh-round-progress-fill { height: 100%; background: var(--gold); transition: width 0.25s ease; }

        /* Results screen */
        .wh-results-card {
          background: var(--paper); color: var(--ink); border-radius: 4px;
          padding: 32px 26px; text-align: center;
          box-shadow: 0 12px 30px rgba(0,0,0,0.35);
        }
        .wh-results-stamp {
          display: inline-block; font-family: 'Special Elite', monospace; font-size: 26px;
          border: 3px solid var(--green); color: var(--green); padding: 8px 20px;
          border-radius: 4px; transform: rotate(-4deg); margin-bottom: 18px; text-transform: uppercase;
        }
        .wh-results-score { font-family: 'IBM Plex Mono', monospace; font-size: 15px; margin: 6px 0; }
        .wh-results-score b { font-family: 'Special Elite', monospace; font-size: 20px; color: var(--gold-soft); }
        .wh-results-unlock {
          margin-top: 16px; padding: 12px; border-radius: 3px;
          background: rgba(79,121,66,0.12); color: var(--green);
          font-family: 'IBM Plex Mono', monospace; font-size: 12px;
        }
        .wh-results-actions { display: flex; gap: 10px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }
        .wh-results-actions button {
          font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.5px;
          padding: 10px 18px; border-radius: 3px; border: 1.5px solid var(--ink); cursor: pointer;
        }
        .wh-results-actions .primary { background: var(--ink); color: var(--paper); }
        .wh-results-actions .secondary { background: transparent; color: var(--ink); }
        .wh-shortcut-key { display:inline-grid;place-items:center;min-width:23px;height:23px;margin-right:10px;border:1px solid currentColor;border-radius:4px;font:700 11px 'IBM Plex Mono',monospace;opacity:.72; }
        .wh-v2-long-answer { min-height:110px;resize:vertical; }
        .wh-ask-bar { display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.07);border:1px solid rgba(237,228,211,.2);padding:4px;border-radius:6px; }
        .wh-ask-bar input { width:180px;background:transparent;border:0;outline:0;color:var(--paper);font:12px 'IBM Plex Mono',monospace;padding:6px; }
        .wh-ai-drawer { position:fixed;inset:0;z-index:90;background:rgba(8,12,12,.72);display:flex;justify-content:flex-end; }
        .wh-ai-drawer-card { width:min(480px,94vw);height:100%;overflow:auto;background:#f3ecdc;color:#1d2928;padding:24px;box-shadow:-18px 0 45px rgba(0,0,0,.4); }
        .wh-ai-drawer-head { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px; }
        .wh-ai-drawer-card input { width:100%;box-sizing:border-box;padding:12px;border:1px solid #9b8f79;border-radius:5px;background:#fffaf0;color:#1d2928; }
        .wh-ai-card { margin-top:18px;padding:18px;border:1px solid #b7a88c;background:#fffaf0;border-radius:6px; }
        .wh-ai-card h2 { margin:0 0 4px;font-family:'Special Elite',monospace; }
        .wh-ai-meta { color:#71583c;font:12px 'IBM Plex Mono',monospace; }
        .wh-ai-actions { display:flex;flex-wrap:wrap;gap:8px;margin-top:16px; }
        .wh-admin-shell { min-height:680px;display:grid;grid-template-columns:220px 1fr;background:#eef1ef;color:#152322;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.35); }
        .wh-admin-side { background:#132c2a;color:#e9e1d0;padding:22px 14px;display:flex;flex-direction:column;gap:7px; }
        .wh-admin-brand { display:flex;gap:10px;align-items:center;padding:4px 8px 22px; }
        .wh-admin-brand>span { display:grid;place-items:center;width:38px;height:38px;border:1px solid #c8a96b;border-radius:6px;color:#c8a96b;font-family:'Special Elite',monospace; }
        .wh-admin-brand small,.wh-admin-top small,.wh-admin-row small { display:block;opacity:.65;font:10px 'IBM Plex Mono',monospace;margin-top:3px; }
        .wh-admin-side button { text-align:left;border:0;background:transparent;color:inherit;padding:11px;border-radius:5px;cursor:pointer;font:12px 'IBM Plex Mono',monospace; }
        .wh-admin-side button.active,.wh-admin-side button:hover { background:rgba(255,255,255,.1);color:#e6c57d; }
        .wh-admin-side button:last-child { margin-top:auto; }
        .wh-admin-main { min-width:0;padding:25px;overflow:auto; }
        .wh-admin-top { display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;border-bottom:1px solid #ccd4d0;padding-bottom:16px; }
        .wh-admin-top h2 { margin:4px 0 0;font-family:'Special Elite',monospace;font-size:24px; }
        .wh-admin-kpis { display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;margin-bottom:16px; }
        .wh-admin-kpis article,.wh-admin-card,.wh-admin-editor,.wh-admin-table { background:white;border:1px solid #d7ddda;border-radius:7px;padding:16px; }
        .wh-admin-kpis b { display:block;font:25px 'Special Elite',monospace;color:#1d5751; }.wh-admin-kpis span { font:10px 'IBM Plex Mono',monospace;color:#66726f; }
        .wh-admin-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px; }.wh-admin-card h3 { margin-top:0; }
        .wh-admin-meter { display:grid;grid-template-columns:80px 1fr 35px;align-items:center;gap:9px;margin:12px 0;font:11px 'IBM Plex Mono',monospace; }.wh-admin-meter i { height:7px;background:#2f746c;border-radius:5px;min-width:2px; }
        .wh-admin-toolbar { display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px; }.wh-admin-toolbar>input { margin-left:auto;min-width:210px;padding:10px;border:1px solid #bdc7c3;border-radius:5px; }.wh-admin-toolbar>select { padding:10px;border:1px solid #bdc7c3;border-radius:5px;background:white;color:#152322;font:12px 'IBM Plex Mono',monospace; }.wh-admin-toolbar button,.wh-admin-card button,.wh-admin-editor button,.wh-admin-row button,.wh-admin-report button { border:1px solid #8fa19b;background:white;padding:8px 10px;border-radius:4px;cursor:pointer; }.wh-admin-toolbar button.primary,.wh-admin-card button.primary,.wh-admin-editor button.primary { background:#174a45;color:white;border-color:#174a45; }
        .wh-admin-stub-toggle { display:flex; align-items:center; gap:6px; font:12px 'IBM Plex Mono',monospace; color:#7a4a1a; white-space:nowrap; }
        .wh-stub-badge { color:#9a5a12; font:11px 'IBM Plex Mono',monospace; }
        .wh-status-stack { display:flex; flex-direction:column; gap:2px; }
        .wh-status-stack small { color:#5f6d68; font-size:10px; }
        .wh-admin-session-questions { display:flex; flex-direction:column; gap:6px; margin-top:12px; max-height:340px; overflow:auto; }
        .wh-admin-session-q { display:flex; flex-direction:column; gap:2px; padding:8px 10px; border-radius:5px; border-left:3px solid #bdc7c3; background:#f4f6f5; font-size:12px; }
        .wh-admin-session-q.ok { border-left-color:#4f7942; }
        .wh-admin-session-q.bad { border-left-color:#9a3434; }
        .wh-admin-session-q.pending { border-left-color:#c9a227; opacity:.7; }
        .wh-admin-session-q span { color:#5f6d68; }
        .wh-admin-log-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left; cursor:pointer; background:#f4f6f5; }
        .wh-admin-log-row:hover { background:#e9edec; }
        .wh-admin-log-main { display:flex; flex-direction:column; gap:2px; }
        .wh-admin-log-detail { margin:6px 0 4px 20px; }
        .wh-admin-log-empty { font-size:12px; color:#5f6d68; font-style:italic; padding:8px 10px; }
        .wh-storage-gauge { font:12px 'IBM Plex Mono',monospace; color:#4f7942; }
        .wh-storage-gauge.warn { color:#9a7a12; }
        .wh-storage-gauge.danger { color:#9a3434; font-weight:600; }
        .wh-admin-entities { display:flex;gap:5px;flex-wrap:wrap; }.wh-admin-entities button.active { background:#174a45;color:white; }.wh-admin-entities span { opacity:.65;margin-left:3px; }
        .wh-admin-table { padding:0;overflow:hidden; }.wh-admin-row { display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,.7fr) minmax(90px,120px);gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e9e7;font-size:12px; }.wh-admin-row.head { background:#e3e9e6;font:10px 'IBM Plex Mono',monospace;text-transform:uppercase; }.wh-admin-row>span:last-child { display:flex;gap:5px; }.wh-admin-row button.danger { color:#9a3434;border-color:#d9aaaa; }
        .wh-admin-category-browse-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:14px; }.wh-admin-category-browse-head h3 { margin:0; }
        .wh-admin-category-browse .wh-admin-card { margin-bottom:14px; }.wh-admin-category-browse .wh-admin-card h4 { margin:0 0 8px;display:flex;align-items:center;gap:8px; }.wh-admin-category-browse .wh-admin-card h4 span { font:10px 'IBM Plex Mono',monospace;color:#72807c;background:#eef1ef;border-radius:999px;padding:2px 8px; }
        .wh-admin-browse-row { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #e5e9e7;font-size:12px; }.wh-admin-browse-row:last-child { border-bottom:none; }.wh-admin-browse-row small { display:block;color:#72807c;margin-top:2px; }
        .wh-admin-editor-head { display:flex;align-items:center;justify-content:space-between; }.wh-admin-editor textarea { width:100%;min-height:400px;box-sizing:border-box;background:#102221;color:#dce9e5;border:0;border-radius:5px;padding:15px;font:12px/1.6 'IBM Plex Mono',monospace; }
        .wh-report-ai { font-weight:600; }.wh-report-ai.flawed { color:#a45626 !important; }.wh-report-ai.fine { color:#2f7a55 !important; }.wh-admin-report { display:grid;grid-template-columns:1fr 80px minmax(90px,190px);gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #e4e8e6; }.wh-admin-report small { display:block;color:#72807c;margin-top:4px; }.wh-admin-report .open { color:#a45626; }.wh-admin-report .resolved { color:#377d56; }.wh-admin-report>div:last-child { display:flex;gap:5px;flex-wrap:wrap; }
        .wh-settings-row { display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid #e4e8e6;max-width:480px; }.wh-settings-row input[type="number"] { width:70px;padding:6px 8px;border:1px solid #bdc7c3;border-radius:5px;font:12px 'IBM Plex Mono',monospace; }.wh-settings-toggle { justify-content:flex-start; }.wh-settings-toggle input[type="checkbox"] { width:16px;height:16px; }
        .wh-story-builder { margin:14px 0 18px;padding:15px;border:1px solid rgba(237,228,211,.2);background:rgba(0,0,0,.12);border-radius:6px; }.wh-story-builder h3 { margin:0 0 5px;font-size:15px; }.wh-category-multiselect { display:flex;flex-wrap:wrap;gap:7px;margin:12px 0;max-height:180px;overflow:auto; }.wh-category-choice { display:flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid rgba(237,228,211,.25);border-radius:5px;cursor:pointer;font:11px 'IBM Plex Mono',monospace; }.wh-category-choice.selected { background:rgba(205,167,91,.18);border-color:var(--gold);color:var(--gold-soft); }.wh-category-choice input { accent-color:#cda75b; }

        @media (max-width: 480px) {
          .wh-word { font-size: 26px; }
          .wh-sentence { font-size: 16px; }
          .wh-stamp { font-size: 15px; padding: 4px 10px; top: 16px; right: 16px; }
          .wh-level-card { padding: 12px 14px; gap: 10px; }
          .wh-level-title { font-size: 14px; }
          .wh-admin-shell { grid-template-columns:1fr; }.wh-admin-side { flex-direction:row;overflow:auto; }.wh-admin-brand { display:none; }.wh-admin-side button:last-child { margin:0; }.wh-admin-kpis { grid-template-columns:repeat(2,1fr); }.wh-admin-grid { grid-template-columns:1fr; }.wh-admin-row { grid-template-columns:1fr; }.wh-admin-row.head { display:none; }
        }
        @media (max-width: 760px) {
          .wh-admin-shell { grid-template-columns:1fr;min-height:auto; }
          .wh-admin-side { flex-direction:row;overflow-x:auto;padding:12px; }
          .wh-admin-brand { display:none; }
          .wh-admin-side button:last-child { margin:0; }
          .wh-admin-main { padding:16px; }
          .wh-admin-kpis { grid-template-columns:repeat(2,1fr); }
          .wh-admin-grid { grid-template-columns:1fr; }
          .wh-admin-row { grid-template-columns:1fr; gap:4px; }
          .wh-admin-row.head { display:none; }
          .wh-admin-toolbar>input { min-width:0;width:100%;margin-left:0; }
          .wh-admin-toolbar>select { width:100%; }
        }
      `}</style>

      <div className={`wh-container${screen === "admin" ? " wh-container-admin" : ""}`}>
        {toast && (
          <div className="wh-toast" role="status">
            {!toast.kind && <b>{toast.text}</b>}
            {toast.kind === "badge" && <><Trophy size={15} /> New badge: <b>{toast.text}</b></>}
            {toast.kind === "import" && <><Upload size={15} /> <b>{toast.text}</b></>}
            {toast.kind === "merge" && <><CheckCircle2 size={15} /> <b>{toast.text}</b></>}
          </div>
        )}

        {storageWarning && <div className="wh-panel wh-storage-warning" role="status"><span>{storageWarning}</span><button className="wh-warning-close" aria-label="Dismiss" onClick={()=>setStorageWarning(null)}><X size={14} /></button></div>}
        <div className="wh-header">
          <div>
            <h1 className="wh-title">
              WORD <span>HUNTER</span>
            </h1>
            <div className="wh-sub">{totalLevelsCleared}/{LEVELS.length} levels cleared · V7.1 unified engine</div>
          </div>
          <div className="wh-stats">
            <span>Score {score}</span>
            <span className="wh-stat-streak" title="Answer streak">
              <Flame size={14} /> {streak}
            </span>
            <span title="Study streak">Study {studyStreak}d</span>
            <button className="wh-icon-btn" onClick={() => { setBadgesOpen((v) => !v); setDashboardOpen(false); }} title="View badges">
              <Trophy size={13} /> {earnedBadgesCount}/{BADGES.length}
            </button>
            <button className="wh-icon-btn" onClick={() => { setDashboardOpen((v) => !v); setBadgesOpen(false); setImportOpen(false); }} title="View stats dashboard">
              <BarChart3 size={13} /> Stats
            </button>
            <button className="wh-icon-btn" onClick={()=>{setScreen("admin");setBadgesOpen(false);setDashboardOpen(false);setImportOpen(false);}} title="Open Content and Learning Control Center"><ListChecks size={13}/> Admin</button>
            <button className="wh-icon-btn" onClick={handleQuickBackup} title="Copy a full backup to your clipboard in one click">
              {quickBackupCopied ? <><ClipboardCheck size={13} /> Copied</> : <><Copy size={13} /> Quick Backup</>}
            </button>
            <div className="wh-ask-bar">
              <input value={askAiTerm} onChange={event=>setAskAiTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();openAskAi(askAiTerm);}}} placeholder="Ask about a word…" aria-label="Ask AI about a word" />
              <button className="wh-icon-btn" onClick={()=>openAskAi(askAiTerm)} title="Ask AI"><HelpCircle size={13}/> Ask AI</button>
              <button className="wh-icon-btn" onClick={()=>{const term=askAiTerm.trim();if(term)setListenTerm(term);}} title="Hear it pronounced"><Volume2 size={13}/> Listen</button>
            </div>
            <button className="wh-reset" onClick={() => setConfirmAction("reset")} title="Clear saved progress">
              <RotateCcw size={12} /> Reset
            </button>
            <button className="wh-reset danger" onClick={() => setConfirmAction("wipe")} title="Delete everything, including imported content">
              <RotateCcw size={12} /> Clear everything
            </button>
          </div>
        </div>
        {listenTerm&&<PronunciationModal term={listenTerm} onClose={()=>setListenTerm(null)}/>}
        {askAiOpen&&<div className="wh-ai-drawer" role="dialog" aria-modal="true" aria-label="Ask AI about a word" onMouseDown={event=>{if(event.target===event.currentTarget)setAskAiOpen(false);}}>
          <aside className="wh-ai-drawer-card">
            <div className="wh-ai-drawer-head"><div><div className="wh-ai-meta">WORD HUNTER FIELD GUIDE</div><h2>Ask AI</h2></div><button className="wh-icon-btn" onClick={()=>setAskAiOpen(false)} aria-label="Close"><X size={18}/></button></div>
            <div className="wh-type-form"><input autoFocus value={askAiTerm} onChange={event=>setAskAiTerm(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();runAskAi();}}} placeholder="Type a word or short phrase…"/><button className="wh-level-btn" disabled={askAiBusy||!askAiTerm.trim()} onClick={()=>runAskAi()}>{askAiBusy?'Investigating…':'Explain'}</button></div>
            <p className="wh-ai-meta">Tip: select a word inside any question or story to open this panel automatically.</p>
            {askAiError&&<div className="wh-import-error">{askAiError}</div>}
            {askAiResult&&<article className="wh-ai-card">
              <h2>{askAiResult.word}</h2><div className="wh-ai-meta">{askAiResult.partsOfSpeech?.length>0&&<b>{askAiResult.partsOfSpeech.join(" / ")}</b>}{askAiResult.partsOfSpeech?.length>0&&' · '}{askAiResult.type} · {askAiResult.category} · {askAiResult.pronunciation}</div>
              <p><b>Meaning:</b> {askAiResult.meaning}</p><p><b>Example:</b> {askAiResult.situation}</p>
              {!!askAiResult.nearWords?.length&&<><b>Close words:</b>{askAiResult.nearWords.map(item=><p key={item.word}><b>{item.word}:</b> {item.difference}</p>)}</>}
              {askAiResult.commonMistake&&<p><b>Common mistake:</b> {askAiResult.commonMistake.sentence}<br/><b>Better:</b> {askAiResult.commonMistake.correction}<br/>{askAiResult.commonMistake.why}</p>}
              <div className="wh-ai-actions"><button className="wh-back-btn" onClick={()=>setListenTerm(askAiResult.word)}><Volume2 size={13}/> Listen</button>{askAiResult.alreadyInCollection?<span className="wh-results-unlock">Already in your collection</span>:<button className="wh-level-btn" onClick={()=>addAiWord()}>Add to Collection</button>}</div>
            </article>}
          </aside>
        </div>}
        {screen==="admin"&&<AdminControlCenter content={{...liveContent(),levels:LEVEL_ORDER.map(title=>({id:`cat-${title}`,title}))}} mastery={mastery} confusions={confusions} reports={questionReports} activeSession={activeSession} sessionLogs={sessionLogs} estimatedStorageBytes={JSON.stringify({...progressExtrasRef.current,activeSession,score,streak,bestStreak,attempted,mastery,levelsCleared,levelStats,studyStreak,bestStudyStreak,lastStudyDate,pools,bestSpeedScore,bestSpeedCombo,confusions}).length} settings={settings} onUpdateSettings={setSettings} onClearActiveSession={()=>setActiveSession(null)} onUpdate={updateAdminContent} onResolveReport={resolveQuestionReport} onReviewReport={reviewQuestionReport} onRetireVariant={retireReportedVariant} onDeleteReport={deleteQuestionReport} onClose={()=>setScreen("levels")} onOpenImport={()=>{setScreen("levels");setContentPanelView("review");setImportOpen(true);}} onExport={mode=>{handleExport(mode);setScreen("levels");setContentPanelView("export");setImportOpen(true);}}/>}
        {confirmAction && (
          <div className="wh-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmAction(null); }}>
          <div className="wh-panel wh-confirm-panel" role="alertdialog">
            <p>
              {confirmAction === "reset"
                ? "Reset all progress? This clears your score, streaks, mastery, and level stats. Your imported words and content stay untouched."
                : "Clear everything? This deletes your progress AND all imported words, grammar, puns, and stories. This cannot be undone — make sure you have a Full Backup first."}
            </p>
            <div className="wh-regen-actions">
              <button
                className="wh-level-btn"
                onClick={async () => { if (confirmAction === "reset") await handleReset(); else await handleWipeEverything(); setConfirmAction(null); }}
              >
                {confirmAction === "reset" ? "Yes, reset progress" : "Yes, delete everything"}
              </button>
              <button className="wh-back-btn wh-nav-btn" onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
          </div>
        )}
        {deleteCategoryTarget && (
          <div className="wh-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteCategoryTarget(null); }}>
          <div className="wh-panel wh-confirm-panel" role="alertdialog">
            <p>
              Delete the category "{deleteCategoryTarget.title}"? This removes its words, grammar, puns, combos, stories, and challenges from your content. This cannot be undone — make sure you have a Full Backup first.
            </p>
            <div className="wh-regen-actions">
              <button
                className="wh-level-btn wh-danger-btn"
                onClick={() => { deleteLevelCategory(deleteCategoryTarget); setDeleteCategoryTarget(null); }}
              >
                Yes, delete category
              </button>
              <button className="wh-back-btn wh-nav-btn" onClick={() => setDeleteCategoryTarget(null)}>Cancel</button>
            </div>
          </div>
          </div>
        )}

        {badgesOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Case Archive — Badges</span>
              <button onClick={() => setBadgesOpen(false)} aria-label="Close badges panel">
                <X size={15} />
              </button>
            </div>
            <div className="wh-badges-grid">
              {BADGES.map((b) => {
                const { done, total, earned } = getBadgeProgress(b, { mastery, bestStreak });
                return (
                  <div key={b.id} className={`wh-badge ${earned ? "earned" : ""}`}>
                    {earned ? <Award size={16} /> : <Lock size={14} />}
                    <div className="wh-badge-text">
                      <div className="wh-badge-label">{b.label}</div>
                      <div className="wh-badge-progress">{done}/{total}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {dashboardOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Study Dashboard</span>
              <button onClick={() => setDashboardOpen(false)} aria-label="Close dashboard">
                <X size={15} />
              </button>
            </div>
            <div className="wh-dash-summary">
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.total}</div>
                <div className="wh-dash-stat-label">Total words</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.practiced}</div>
                <div className="wh-dash-stat-label">Practiced</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{overviewStats.total - overviewStats.practiced}</div>
                <div className="wh-dash-stat-label">Not tried yet</div>
              </div>
              <div className="wh-dash-stat mastered">
                <div className="wh-dash-stat-num">{stageSummary.Mastered}</div>
                <div className="wh-dash-stat-label">Mastered</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{stageSummary.Learned}</div>
                <div className="wh-dash-stat-label">Learned</div>
              </div>
              <div className="wh-dash-stat">
                <div className="wh-dash-stat-num">{stageSummary.Familiar}</div>
                <div className="wh-dash-stat-label">Familiar</div>
              </div>
            </div>
            <div className="wh-dash-bar" aria-hidden="true">
              {overviewStats.total > 0 && (
                <>
                  <span className="wh-dash-bar-seg mastered" style={{ width: `${(stageSummary.Mastered / overviewStats.total) * 100}%` }} />
                  <span className="wh-dash-bar-seg learned" style={{ width: `${(stageSummary.Learned / overviewStats.total) * 100}%` }} />
                  <span className="wh-dash-bar-seg familiar" style={{ width: `${(stageSummary.Familiar / overviewStats.total) * 100}%` }} />
                </>
              )}
            </div>
            {overviewStats.accuracy !== null && (
              <div className="wh-dash-accuracy">Overall accuracy: {overviewStats.accuracy}%</div>
            )}
            <div className="wh-dash-scroll">
              {LEVELS.map((level) => (
                <div className="wh-dash-group" key={level.id}>
                  <div className="wh-dash-group-title">{level.title}</div>
                  <table className="wh-dash-table">
                    <tbody>
                      {level.items.map((item) => {
                        const key = levelItemKey(item);
                        const name =
                          item.kind === "word"
                            ? item.obj.word
                            : item.kind === "grammar"
                            ? `${item.obj.rule} #${item.obj.id.slice(1)}`
                            : item.obj.word;
                        const stats = mastery[key];
                        const attempts = stats?.total || 0;
                        const correct = stats?.correct || 0;
                        const acc = attempts > 0 ? Math.round((correct / attempts) * 100) : null;
                        return (
                          <tr key={key}>
                            <td className="wh-dash-name">{name}</td>
                            <td className="wh-dash-num">{attempts === 0 ? "not tried" : `${correct}/${attempts} correct`}</td>
                            <td className="wh-dash-num">{acc === null ? "—" : `${acc}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {importOpen && (
          <div className="wh-panel">
            <div className="wh-panel-header">
              <span>Data Center</span>
              <button
                onClick={() => { setImportOpen(false); setReviewPreview(null); setReviewError(null); setAiFixError(null); setAiFixChanges(null); }}
                aria-label="Close content panel"
              >
                <X size={15} />
              </button>
            </div>

            <div className="wh-content-tabs">
              <button className={contentPanelView === "export" ? "active" : ""} onClick={() => setContentPanelView("export")}>Export</button>
              <button className={contentPanelView === "review" ? "active" : ""} onClick={() => setContentPanelView("review")}>Apply / Restore</button>
            </div>

            {contentPanelView === "export" && (
              <>
                <p className="wh-import-hint">
                  <b>Content only</b> — for handing to another AI to review wording/clarity. Keep every "word"
                  and "id" field unchanged so your progress stays attached, then paste its answer into "Apply / Restore". Challenge IDs are stable progress keys too.<br />
                  <b>Full backup</b> — everything, including your score, streak, and mastery. Use this to move
                  to a new browser/tab, or as a safety copy.
                </p>
                <div className="wh-import-actions wh-import-actions-tight">
                  <button className="wh-import-btn secondary" onClick={() => handleExport("content")}>Content only</button>
                  <button className="wh-import-btn secondary" onClick={() => handleExport("backup")}>Full backup</button>
                </div>
                {exportText && (
                  <>
                    <textarea className="wh-import-textarea" value={exportText} readOnly rows={8} onFocus={(e) => e.target.select()} />
                    <div className="wh-import-actions">
                      <button className="wh-import-btn secondary" onClick={handleDownloadExport}>
                        <Download size={13} /> Download .json
                      </button>
                      <button className="wh-import-btn primary" onClick={handleCopyExport}>
                        {exportCopied ? <><ClipboardCheck size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {contentPanelView === "review" && !reviewPreview && (
              <>
                <p className="wh-import-hint">
                  Paste the reviewed JSON back here, or upload a .json/.txt file. Matched words/rules/puns/challenges get
                  their content refreshed without touching your progress; anything new gets added as usual.
                </p>
                <textarea
                  className="wh-import-textarea"
                  value={reviewText}
                  onChange={(e) => { setReviewText(e.target.value); setAiFixError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (reviewText.trim()) handleParseReview(); } }}
                  placeholder="Paste the reviewed JSON here…"
                  rows={8}
                />
                {reviewError && <div className="wh-import-error">{reviewError}<div className="wh-import-actions"><button className="wh-import-btn primary" disabled={aiFixBusy} onClick={handleAiFixImport}>{aiFixBusy ? "Asking AI…" : <><Sparkles size={13} /> Fix with AI</>}</button></div></div>}
                {aiFixError && <div className="wh-import-error">{aiFixError}</div>}
                {aiFixChanges && <div className="wh-import-hint"><b>AI adjusted the JSON below to fix the errors — review it, then Parse again:</b><ul>{aiFixChanges.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                <div className="wh-import-actions">
                  <input
                    ref={reviewFileInputRef}
                    id="wh-review-file-input"
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
                    onChange={handleReviewFileChange}
                  />
                  <label htmlFor="wh-review-file-input" className="wh-import-btn secondary">
                    <Upload size={13} /> Upload file
                  </label>
                  <button className="wh-import-btn primary" onClick={handleParseReview} disabled={!reviewText.trim()}>
                    Parse
                  </button>
                </div>
              </>
            )}

            {contentPanelView === "review" && reviewPreview && (
              <>
                <div className="wh-import-summary">
                  <div>
                    <b>{reviewPreview.wordUpdates.length + reviewPreview.grammarUpdates.length + reviewPreview.punUpdates.length + reviewPreview.challengeUpdates.length}</b> updated,{" "}
                    <b>{reviewPreview.newWords.length + reviewPreview.newGrammar.length + reviewPreview.newPuns.length + reviewPreview.newChallenges.length}</b> new · {reviewPreview.backupData.combos?.length||0} combos · {reviewPreview.backupData.stories?.length||0} stories
                    {reviewPreview.builtinSkipped > 0 && <> — {reviewPreview.builtinSkipped} matched built-in content and can't be edited this way</>}
                  </div>
                  <div className="wh-import-breakdown">
                    {reviewPreview.wordUpdates.length > 0 && <span>{reviewPreview.wordUpdates.length} word(s) updated</span>}
                    {reviewPreview.grammarUpdates.length > 0 && <span>{reviewPreview.grammarUpdates.length} grammar updated</span>}
                    {reviewPreview.punUpdates.length > 0 && <span>{reviewPreview.punUpdates.length} pun(s) updated</span>}
                    {reviewPreview.challengeUpdates.length > 0 && <span>{reviewPreview.challengeUpdates.length} challenge(s) updated by stable ID</span>}
                    {reviewPreview.newWords.length > 0 && <span>{reviewPreview.newWords.length} new word(s)</span>}
                    {reviewPreview.newGrammar.length > 0 && <span>{reviewPreview.newGrammar.length} new grammar</span>}
                    {reviewPreview.newPuns.length > 0 && <span>{reviewPreview.newPuns.length} new pun(s)</span>}
                    {reviewPreview.newChallenges.length > 0 && <span>{reviewPreview.newChallenges.length} new challenge(s)</span>}
                    {reviewPreview.invalidChallenges.length > 0 && <span>{reviewPreview.invalidChallenges.length} invalid challenge(s) skipped</span>}
                    <span>received {reviewPreview.gotWords} of {reviewPreview.expectedWords} current words</span>
                    <span>received {reviewPreview.gotChallenges} challenge(s); currently loaded {reviewPreview.expectedChallenges}</span>
                  </div>
                  <p>Partial content files are merged. Missing arrays do not delete current items. Structural checks do not verify B1 language or semantic accuracy.</p>
                </div>
                {reviewPreview.isBackup && (
                  <label className="wh-restore-toggle">
                    <input type="checkbox" checked={reviewPreview.restoreProgress} onChange={toggleRestoreProgress} />
                    Also restore progress (score, streak, mastery, cleared levels) — this overrides what's currently loaded
                  </label>
                )}
                <div className="wh-import-actions">
                  <button className="wh-import-btn secondary" onClick={() => setReviewPreview(null)}>Back</button>
                  <button className="wh-import-btn primary" onClick={handleConfirmReview}>
                    {reviewPreview.restoreProgress ? "Restore backup" : "Apply review"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {screen === "levels" && <>
          {showFreshCopyPrompt && <div className="wh-fresh-copy-banner">
            <p><b>Fresh copy detected.</b> No saved progress or content found here — if you have a backup from a previous version, restore it now before you start playing.</p>
            <div className="wh-regen-actions">
              <button className="wh-level-btn" onClick={()=>{setImportOpen(true);setContentPanelView("review");setShowFreshCopyPrompt(false);}}>Open Import Center</button>
              <button className="wh-back-btn wh-nav-btn" onClick={()=>setShowFreshCopyPrompt(false)}>Dismiss</button>
            </div>
          </div>}
          <nav className="wh-v2-nav" aria-label="Game sections">{[["practice","Practice"],["stories","Stories"],["challenges","Challenges"]].map(([id,label])=><button key={id} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}</nav>
          {activeSession&&!activeSession.completed&&<button className="wh-level-btn" onClick={()=>setScreen("session")}>Resume {activeSession.title} ({Math.min(activeSession.index+1,activeSession.queue.length)}/{activeSession.queue.length})</button>}
          {section==="practice"&&<p>Up to 12 questions · at most 3 new words · offline practice</p>}
          {section==="stories"&&<div className="wh-panel"><h2>Stories</h2>
            <div className="wh-story-builder"><h3>Generate a mixed-category story</h3><p className="wh-regen-meta">Choose one or more categories. Weak words are selected first and distributed across your choices.</p><div className="wh-category-multiselect">{LEVEL_ORDER.filter(category=>WORDS.some(word=>word.category===category)).map(category=><label key={category} className={`wh-category-choice ${selectedStoryCategories.includes(category)?"selected":""}`}><input type="checkbox" checked={selectedStoryCategories.includes(category)} onChange={()=>toggleStoryCategory(category)}/><span>{category}</span><small>{WORDS.filter(word=>word.category===category).length}</small></label>)}</div>{storyGenState!=="loading"&&<button className="wh-level-btn" disabled={!selectedStoryCategories.length} onClick={handleGenerateStory}>✨ Generate from {selectedStoryCategories.length||0} categor{selectedStoryCategories.length===1?"y":"ies"}</button>}{storyGenError&&storyGenState!=="loading"&&<p className="wh-regen-status error">{storyGenError}</p>}</div>
            {storyGenState==="loading"&&<p className="wh-regen-status">Writing and checking a new story…</p>}
            {storyGenState&&typeof storyGenState==="object"&&<div className="wh-regen-preview">
              <p className="wh-regen-label">New story — preview</p>
              <p><strong>{storyGenState.title}</strong></p>
              <p>{storyGenState.text}</p>
              <p className="wh-regen-meta">Categories: {(storyGenState.sourceCategories||[]).join(" + ")} · Hidden targets: {storyGenState.targetWords.join(", ")} · {storyGenState.questions.length} questions{storyGenState.grammarQuestions?.length?` + ${storyGenState.grammarQuestions.length} grammar`:""}</p>
              <div className="wh-regen-actions">
                <button className="wh-level-btn" onClick={()=>{setCustomStories(prev=>[...prev,storyGenState]);setStoryGenState(null);}}>Add to My Stories</button>
                <button className="wh-back-btn wh-nav-btn" onClick={handleGenerateStory}>Regenerate</button>
                <button className="wh-back-btn wh-nav-btn" onClick={()=>setStoryGenState(null)}>Discard</button>
              </div>
            </div>}
            {!customStories.length&&<p>No authored stories loaded. Import a Content v2 file to add them.</p>}{[...customStories].sort((a,b)=>a.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length-b.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length).map(story=>{const fresh=story.targetWords.filter(w=>!V2.known(mastery[V2.findWord(WORDS,w)?.word])).length;const record=solvedStories.find(e=>e.id===story.id);return <article className="wh-v2-learn" key={story.id}><strong>{story.title}{record&&<span className="wh-story-solved-flag"><CheckCircle2 size={13}/> Solved · {record.correct}/{record.total}</span>}</strong><p>{story.questions.length}{story.grammarQuestions?.length?` + ${story.grammarQuestions.length} grammar`:""} questions · {fresh?`${fresh} new words: preview first`:"Ready for review"}</p><button className="wh-level-btn" onClick={()=>launchStory(story)}>{record?"Play again":"Open story"}</button></article>;})}</div>}
          {section==="challenges"&&<div className="wh-panel"><h2>Opposite Chain</h2>{[...new Set(WORDS.filter(w=>w.chainGroup&&w.opposite).map(w=>w.chainGroup))].map(group=><button key={group} className="wh-level-btn" onClick={()=>launchChain(group)}>{group}</button>)}<h2>Authored Challenges</h2>{!CHALLENGES.length&&<p>No authored challenges loaded.</p>}{CHALLENGES.map(c=><button key={c.id} className="wh-level-btn" onClick={()=>launchAuthoredChallenge(c)}>{c.label||c.id}</button>)}</div>}
        </>}
        {screen === "session" && <SessionView session={activeSession} onChange={setActiveSession} onFinish={completeSession} onBack={()=>setScreen("levels")} words={WORDS} onIntroduce={introduceWords} onReport={reportSessionQuestion} onReviewReport={reviewQuestionReport} onWithdrawReport={deleteQuestionReport} onUpdateWord={updateWordFields} onResult={recordSessionResult} onAskWord={openAskAi}/>}

        {screen === "levels" && (
          <>
            <div className="wh-insight-card">
              <Search size={18} />
              <div>
                <div className="wh-insight-title">Investigation Notes</div>
                <div className="wh-insight-lines">
                  {learningInsights.weakestMode && <span>{MODE_META[learningInsights.weakestMode.id]?.label || learningInsights.weakestMode.id} is currently your weakest mode ({formatAccuracy(learningInsights.weakestMode.accuracy)}%).</span>}
                  {learningInsights.topConfusion && <span>You often confuse {learningInsights.topConfusion.pair[0]} and {learningInsights.topConfusion.pair[1]}.</span>}
                  <span>{learningInsights.dueCount} word{learningInsights.dueCount === 1 ? " is" : "s are"} due for review · {learningInsights.closeToMastery} Learned close to Mastery.</span>
                  <span>Archive: {stageSummary.New} New · {stageSummary.Familiar} Familiar · {stageSummary.Learned} Learned · {stageSummary.Mastered} Mastered</span>
                </div>
              </div>
            </div>
            <div className="wh-adaptive-actions">
              {learningInsights.dueCount > 0 && <button className="primary" onClick={startDueReview}>Due today ({learningInsights.dueCount})</button>}
              {weakCandidates.length > 0 && <button className={learningInsights.dueCount > 0 ? "secondary" : "primary"} onClick={startWeakReview}>Hunt Weak Evidence ({weakCandidates.length})</button>}
            </div>
          </>
        )}

        {screen === "levels" && section === "challenges" && (
          <div className={`wh-speed-card ${masteredWords.length < MIN_LEARNED_FOR_SPEED ? "locked" : ""}`}>
            <div className="wh-speed-card-icon"><Zap size={22} /></div>
            <div className="wh-speed-card-info">
              <div className="wh-speed-card-title">Speed Round</div>
              <div className="wh-speed-card-meta">
                {masteredWords.length < MIN_LEARNED_FOR_SPEED
                  ? `Master ${MIN_LEARNED_FOR_SPEED - masteredWords.length} more word${MIN_LEARNED_FOR_SPEED - masteredWords.length === 1 ? "" : "s"} to unlock`
                  : `${masteredWords.length} mastered words in the pool · best ${bestSpeedScore} pts, x${bestSpeedCombo} combo`}
              </div>
            </div>
            <button
              className="wh-speed-card-btn"
              disabled={masteredWords.length < MIN_LEARNED_FOR_SPEED}
              onClick={startSpeedRound}
            >
              <Play size={13} /> Play
            </button>
          </div>
        )}

        {screen === "levels" && section === "practice" && (
          <div className="wh-levels-list">
            {LEVELS.map((level, i) => {
              const unlocked = isLevelUnlocked(i);
              const cleared = clearedSet.has(level.id);
              const stageCounts = levelStageBreakdown(level, mastery);
              const LevelIcon = TOPIC_ICONS[level.title] || BookOpen;
              return (
                <div key={level.id} className={`wh-level-card ${unlocked ? "" : "locked"}`}>
                  <button
                    className="wh-level-delete-btn"
                    title="Delete category"
                    onClick={(e) => { e.stopPropagation(); setDeleteCategoryTarget(level); }}
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className="wh-level-num">{String(i + 1).padStart(2, "0")}</div>
                  <div className="wh-level-icon"><LevelIcon size={20} /></div>
                  <div className="wh-level-info">
                    <div className="wh-level-title">
                      {level.title}
                      {cleared && <CheckCircle2 size={14} color="var(--green, #4f7942)" />}
                    </div>
                    <div className="wh-level-meta">
                      {level.items.length} words · {formatStars(getLevelStars(level.id))}
                    </div>
                    <div className="wh-level-stage-bar" aria-hidden="true">
                      {level.items.length > 0 && (
                        <>
                          <span className="wh-level-stage-seg mastered" style={{ width: `${(stageCounts.Mastered / level.items.length) * 100}%` }} />
                          <span className="wh-level-stage-seg learned" style={{ width: `${(stageCounts.Learned / level.items.length) * 100}%` }} />
                          <span className="wh-level-stage-seg familiar" style={{ width: `${(stageCounts.Familiar / level.items.length) * 100}%` }} />
                        </>
                      )}
                    </div>
                    <div className="wh-level-meta wh-level-stage-detail">
                      {stageCounts.Mastered} mastered · {stageCounts.Learned} learned · {stageCounts.Familiar} familiar · {stageCounts.New} new
                    </div>
                  </div>
                  <button
                    className="wh-level-btn"
                    disabled={!unlocked}
                    onClick={() => startLevel(i)}
                  >
                    {unlocked ? <Play size={13} /> : <Lock size={13} />}
                    {cleared ? "Practice again" : unlocked ? "Practice" : "Locked"}
                  </button>
                  <button className="wh-back-btn" disabled={getLevelStars(level.id)<1} title="Available after earning one star in Practice" onClick={()=>startFinalCase(i)}>Final Case</button>
                </div>
              );
            })}
          </div>
        )}

        {screen === "playing" && question && (
          <>
            <div className="wh-round-top">
              <button className="wh-back-btn wh-nav-btn" onClick={backToLevels}>
                <ArrowLeft size={14} /> Levels
              </button>
              <div className="wh-round-progress">
                Case {roundIndex + 1}/{roundQueue.length} — {sessionType === "weak" ? "Weak Evidence" : sessionType === "final" ? "Final Case" : currentLevel?.title || "Investigation"}
              </div>
            </div>

            <div className="wh-card">
              {status && (
                <div className={`wh-stamp ${status}`}>
                  {status === "correct" ? "EVIDENCE SECURED" : status === "correctAlternative" ? "VALID ALTERNATIVE" : status === "close" ? "ALMOST" : status === "aiError" ? "CHECK PAUSED" : status === "skipped" ? "SKIPPED" : "WRONG LEAD"}
                </div>
              )}

              <div className="wh-file-row">
                <div className="wh-file-label"><FileIcon size={13} /> {fileMeta.label}</div>
                <div className="wh-file-row-right">
                  <div className="wh-category-badge">{question.target.category}</div>
                  {question.poolType && (
                    <button className="wh-flag-btn" onClick={handleFlag} title="Report this question — swap it for a new one">
                      <Flag size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="wh-sentence">{question.prompt}</div>
              {question.hint && !status && <div className="wh-hint">Hint: {question.hint}</div>}

              {question.type === "unavailable" && <button className="wh-level-btn" onClick={()=>{setStatus("skipped");}}>Skip invalid question</button>}
              {question.type === "mcq" && (
                <div className="wh-options">
                  {question.options.map((opt) => {
                    let cls = "wh-option";
                    if (status && opt === question.answer) cls += " reveal";
                    if (status && opt === selected && opt !== question.answer) cls += " wrong";
                    return (
                      <button key={opt} className={cls} disabled={!!status} onClick={() => handleSelect(opt)}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {question.type === "typing" && (
                <div className="wh-type-form">
                  <input
                    className="wh-type-input"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitTyped();
                      }
                    }}
                    placeholder="Type the word…"
                    disabled={!!status || aiBusy}
                    autoFocus
                  />
                  <button
                    className="wh-type-submit"
                    type="button"
                    onClick={submitTyped}
                    disabled={!!status || aiBusy || !typed.trim()}
                  >
                    {aiBusy ? "Checking…" : "Submit"}
                  </button>
                </div>
              )}

              {question.type === "freeform" && (
                <div className="wh-type-form" style={{ display: "grid" }}>
                  <textarea
                    className="wh-freeform"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (typed.trim() && !status && !aiBusy) submitFreeForm(); } }}
                    placeholder={question.freeformKind === "sentence" ? `Write a natural sentence using ${question.target.word}…` : "Write your answer…"}
                    disabled={!!status || aiBusy}
                    autoFocus
                  />
                  <button className="wh-type-submit" type="button" onClick={submitFreeForm} disabled={!!status || aiBusy || !typed.trim()}>
                    {aiBusy ? "Examining evidence…" : "Submit Evidence"}
                  </button>
                </div>
              )}

              {question.type === "selfCheck" && (
                <div className="wh-type-form" style={{ display: "grid" }}>
                  <textarea
                    className="wh-freeform"
                    value={typed}
                    onChange={(e) => { setTyped(e.target.value); setStepFeedback(null); }}
                    placeholder={`Use: ${(question.requiredWords || []).join(" + ")}`}
                    disabled={!!status}
                    autoFocus
                  />
                  <button className="wh-type-submit" type="button" onClick={submitSelfCheck} disabled={!!status || !typed.trim()}>
                    Check Requirements
                  </button>
                  {stepFeedback && (
                    <div className={`wh-step-feedback ${stepFeedback.correct ? "" : "wrong"}`}>
                      {stepFeedback.explanation}
                      {stepFeedback.correct && question.exampleAnswer && <div className="wh-model-answer">Model example: {question.exampleAnswer}</div>}
                    </div>
                  )}
                </div>
              )}

              {question.type === "wordOrder" && (
                <div className="wh-token-area">
                  <div className="wh-token-label">Your sentence</div>
                  <div className="wh-token-answer" aria-label="Ordered sentence">
                    {orderedTokens.map((token) => (
                      <button key={token.id} type="button" className="wh-token" onClick={() => moveTokenBack(token)} disabled={!!status} aria-label={`Remove ${token.text} from sentence`}>
                        {token.text}
                      </button>
                    ))}
                  </div>
                  <div className="wh-token-label">Word bank</div>
                  <div className="wh-token-bank" aria-label="Available words">
                    {availableTokens.map((token) => (
                      <button key={token.id} type="button" className="wh-token" onClick={() => moveTokenToAnswer(token)} disabled={!!status} aria-label={`Add ${token.text} to sentence`}>
                        {token.text}
                      </button>
                    ))}
                  </div>
                  {!status && <button className="wh-type-submit" type="button" onClick={submitWordOrder} disabled={availableTokens.length > 0 || orderedTokens.length === 0}>Submit Sentence</button>}
                </div>
              )}

              {question.type === "multiStage" && question.steps[challengeStepIndex] && (
                <div>
                  <div className="wh-stage-head">
                    <span>{fileMeta.label}</span>
                    <span>Stage {challengeStepIndex + 1}/{question.steps.length}</span>
                  </div>
                  <div className="wh-sentence" style={{ fontSize: 16 }}>{question.steps[challengeStepIndex].prompt}</div>
                  {question.steps[challengeStepIndex].type === "mcq" ? (
                    <div className="wh-options">
                      {question.steps[challengeStepIndex].options.map((opt) => {
                        let cls = "wh-option";
                        if (!stepFeedback && normalizeAnswerText(stepAnswer) === normalizeAnswerText(opt)) cls += " picked";
                        if (status && acceptedAnswerMatches(opt, question.steps[challengeStepIndex].acceptedAnswers)) cls += " reveal";
                        if (status && normalizeAnswerText(stepAnswer) === normalizeAnswerText(opt) && !acceptedAnswerMatches(opt, question.steps[challengeStepIndex].acceptedAnswers)) cls += " wrong";
                        return <button key={opt} type="button" className={cls} disabled={!!stepFeedback || !!status} onClick={() => setStepAnswer(opt)}>{opt}</button>;
                      })}
                    </div>
                  ) : (
                    <div className="wh-type-form">
                      <input className="wh-type-input" value={stepAnswer} onChange={(e) => setStepAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitChallengeStep(); } }} placeholder="Type the correction…" disabled={!!stepFeedback || !!status} autoFocus />
                    </div>
                  )}
                  {stepFeedback && <div className="wh-step-feedback">Answer saved. Review after all steps.</div>}
                  {status && question.steps.map((step,i)=><p key={step.id}>{i+1}. {step.acceptedAnswers.join(" / ")} — {step.explanation}</p>)}
                  {!status && (
                    <div className="wh-next">
                      {!stepFeedback
                        ? <button type="button" onClick={submitChallengeStep} disabled={!stepAnswer.trim()}>Submit Stage</button>
                        : <button type="button" onClick={advanceChallengeStep}>{challengeStepIndex + 1 < question.steps.length ? "Next stage →" : "Final verdict →"}</button>}
                    </div>
                  )}
                </div>
              )}

              {question.type === "multi" && (
                <>
                  <div className="wh-options">
                    {question.options.map((opt) => {
                      let cls = "wh-option wh-option-multi";
                      const isPicked = selectedMulti.includes(opt);
                      const isCorrectAnswer = question.correctAnswers.includes(opt);
                      if (!status && isPicked) cls += " picked";
                      if (status && isCorrectAnswer) cls += " reveal";
                      if (status && isPicked && !isCorrectAnswer) cls += " wrong";
                      return (
                        <button key={opt} className={cls} disabled={!!status} onClick={() => toggleMultiOption(opt)}>
                          <span className="wh-option-check">{isPicked ? "✓" : ""}</span>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {!status && (
                    <div className="wh-next">
                      <button onClick={submitMulti} disabled={selectedMulti.length === 0}>
                        Submit ({selectedMulti.length} picked)
                      </button>
                    </div>
                  )}
                </>
              )}

              {status && status !== "aiError" && (
                <div className={`wh-feedback ${status}`}>
                  {status === "correct" && <>EVIDENCE SECURED. {aiEvaluation?.grade && <><b>{aiEvaluation.grade}</b> — </>}<b>{question.target.label}</b> — {aiEvaluation?.feedback || question.target.explanation}</>}
                  {status === "correctAlternative" && <>Accepted as a valid English answer for this gap. It does not count as recall of <b>{question.target.label}</b>. {aiEvaluation?.feedback}</>}
                  {status === "wrong" && question.type === "multi" && <>Correct evidence: <b>{question.correctAnswers.join(" & ")}</b> — {question.target.explanation}</>}
                  {status === "wrong" && question.type === "multiStage" && <>The case was not fully cleared. {question.target.explanation}</>}
                  {status === "wrong" && question.type !== "multi" && question.type !== "multiStage" && <>Correct evidence: <b>{question.answer}</b> — {aiEvaluation?.feedback || question.target.explanation}</>}
                  {status === "close" && <>{aiEvaluation ? <>ALMOST. {aiEvaluation.feedback}{aiEvaluation.suggestedCorrection ? <> Suggested: <b>{aiEvaluation.suggestedCorrection}</b></> : null}</> : <>You found the right word. Spelling: <b>{typed}</b> ❌ <b>{question.answer}</b> ✅</>}</>}
                  {feedbackDetail && (
                    <div className="wh-feedback-card">
                      <div className="lead">Wrong Lead</div>
                      <div className="wh-feedback-pair">
                        <span>You chose: <b>{feedbackDetail.chosen}</b> — {feedbackDetail.chosenMeaning}</span>
                        <span>Correct evidence: <b>{feedbackDetail.correct}</b> — {feedbackDetail.correctMeaning}</span>
                        <span><b>Key difference:</b> {feedbackDetail.keyDifference}{feedbackDetail.aiLoading && <i style={{ opacity: 0.6 }}> (sharpening…)</i>}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {status === "wrong" && question.court && question.type !== "multiStage" && (
                <div className="wh-feedback-card">
                  <div className="lead">Grammar Court — Guilty</div>
                  <div>Correct or rewrite the evidence. Alternative correct corrections are accepted.</div>
                  <textarea className="wh-freeform" style={{ marginTop: 8, minHeight: 78 }} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (typed.trim() && !aiBusy) submitGrammarCorrection(); } }} placeholder="Write a corrected version…" disabled={aiBusy} />
                  <div className="wh-adaptive-actions" style={{ marginTop: 8, marginBottom: 0 }}>
                    <button className="primary" onClick={submitGrammarCorrection} disabled={aiBusy || !typed.trim()}>{aiBusy ? "Judging…" : "Submit Correction"}</button>
                  </div>
                  {grammarCorrectionResult && <div style={{ marginTop: 8 }}><b>{grammarCorrectionResult.correct ? "Not Guilty ✅" : "Needs another correction"}</b> — {grammarCorrectionResult.feedback}{grammarCorrectionResult.suggestedCorrection ? <> Suggested: <b>{grammarCorrectionResult.suggestedCorrection}</b></> : null}</div>}
                </div>
              )}

              {status === "aiError" && (
                <div className="wh-feedback-card">
                  <div className="lead">Evaluation unavailable</div>
                  <div>{aiError}</div>
                  <div className="wh-adaptive-actions" style={{ marginTop: 10, marginBottom: 0 }}>
                    <button className="primary" onClick={question.type === "freeform" ? submitFreeForm : submitTyped}>Retry AI Check</button>
                    <button onClick={continueAfterAiFailure}>Continue — don’t record mastery</button>
                  </div>
                </div>
              )}

              {status && status !== "aiError" && (
                <div className="wh-next">
                  <button onClick={nextQuestion}>
                    {roundIndex + 1 >= roundQueue.length ? "Finish case →" : "Next case →"}
                  </button>
                </div>
              )}

              <div className="wh-round-progress-track">
                <div
                  className="wh-round-progress-fill"
                  style={{ width: `${((roundIndex + (status ? 1 : 0)) / roundQueue.length) * 100}%` }}
                />
              </div>
            </div>
          </>
        )}

        {screen === "results" && currentLevel && lastRoundSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">CASE CLOSED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>{currentLevel.title}</div>
            <div className="wh-results-score"><b>{formatAccuracy(lastRoundSummary.accuracy)}%</b> accuracy — {lastRoundSummary.correct}/{lastRoundSummary.total} correct · {formatStars(lastRoundSummary.earnedStars)}</div>
            <div className="wh-results-learning"><span>{lastRoundSummary.improved} improved</span><span>{lastRoundSummary.masteredGained} mastered</span><span>{lastRoundSummary.weakCount} weak evidence</span></div>
            {learningInsights.topConfusion && <div className="wh-results-note">Investigation note: watch the difference between {learningInsights.topConfusion.pair[0]} and {learningInsights.topConfusion.pair[1]}.</div>}
            <div className="wh-results-actions">
              {weakCandidates.length > 0 && <button className="primary" onClick={startWeakReview}>Hunt Weak Evidence</button>}
              <button className="secondary" onClick={retryLevel}>Retry case</button>
              {lastRoundSummary.passed && currentLevel.items.some((item) => item.kind === "word") && <button className="secondary" onClick={() => startFinalCase(currentLevelIndex)}>Final Case</button>}
              {lastRoundSummary.passed && hasNextLevel && <button className="primary" onClick={() => startLevel(nextLevelIndex)}>Next Case →</button>}
              <button className="secondary" onClick={backToLevels}>Back to levels</button>
            </div>
          </div>
        )}

        {screen === "reviewResults" && lastRoundSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">EVIDENCE REVIEWED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>Weak Evidence</div>
            <div className="wh-results-score"><b>{formatAccuracy(lastRoundSummary.accuracy)}%</b> accuracy — {lastRoundSummary.correct}/{lastRoundSummary.total} correct</div>
            <div className="wh-results-learning"><span>{lastRoundSummary.improved} improved</span><span>{lastRoundSummary.masteredGained} mastered</span><span>{lastRoundSummary.weakCount} still need review</span></div>
            <div className="wh-results-note">Review timing and weak-mode signals were updated from today’s evidence.</div>
            <div className="wh-results-actions">{weakCandidates.length > 0 && <button className="primary" onClick={startWeakReview}>Review More</button>}<button className="secondary" onClick={backToLevels}>Back to levels</button></div>
          </div>
        )}

        {screen === "finalReport" && currentLevel && finalRecallSummary && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">RECALL SECURED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>FINAL CASE — {currentLevel.title}</div>
            <div className="wh-results-score">Recall: <b>{finalRecallSummary.correct}/{finalRecallSummary.total}</b> correct</div>
            <div className="wh-case-report">
              <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 18 }}>CASE REPORT</div>
              <div className="wh-results-note">Write 1–3 understandable sentences using the evidence words naturally. AI checks meaning, not just string presence.</div>
              <div className="wh-evidence-list">{finalCaseWords.map((word) => { const used = normalizeAnswerText(finalReportText).includes(normalizeAnswerText(word.word)); return <span key={word.word} className={`wh-evidence-chip ${used ? "used" : ""}`}>{used ? "✓ " : ""}{word.word}</span>; })}</div>
              <textarea value={finalReportText} onChange={(e) => setFinalReportText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (finalReportText.trim() && !aiBusy) finishFinalCaseReport(); } }} placeholder="Write your case report here…" disabled={aiBusy} />
              <div className="wh-results-note">Evidence text detected: {finalEvidenceUsed}/{finalCaseWords.length}. Semantic credit is decided only after evaluation.</div>
              {aiError && <div className="wh-feedback-card">{aiError}</div>}
            </div>
            <div className="wh-results-actions"><button className="primary" onClick={finishFinalCaseReport} disabled={!finalReportText.trim() || aiBusy}>{aiBusy ? "Examining report…" : "Submit Case Report"}</button><button className="secondary" onClick={backToLevels}>Leave Case</button></div>
          </div>
        )}

        {screen === "finalResults" && currentLevel && finalCaseResult && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">FINAL CASE SOLVED</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>{currentLevel.title}</div>
            <div className="wh-results-score">Report quality: <b>{finalCaseResult.quality}</b></div>
            <div className="wh-evidence-list">{finalCaseResult.words.map((item) => <span key={item.word} className={`wh-evidence-chip ${item.productionSuccess ? "used" : ""}`}>{item.word} {item.productionSuccess ? "✅" : item.used ? "⚠️" : "❌"}</span>)}</div>
            <div className="wh-results-note">{finalCaseResult.feedback || "Production evidence was recorded only for words used with the correct meaning. Normal mastery requirements still apply."}</div>
            <div className="wh-results-actions"><button className="secondary" onClick={backToLevels}>Back to levels</button></div>
          </div>
        )}

        {screen === "speed" && speedQuestion && (
          <div className="wh-speed-play">
            <div className="wh-speed-top">
              <div className={`wh-speed-timer ${speedTimeLeft <= 10 ? "urgent" : ""}`}>
                <Zap size={15} /> {speedTimeLeft}s
              </div>
              <div className="wh-speed-stats">
                <span>{speedScore} pts</span>
                <span className="wh-speed-combo">🔥 x{speedCombo}</span>
              </div>
            </div>

            <div className="wh-card">
              {speedStatus && (
                <div className={`wh-stamp ${speedStatus}`}>{speedStatus === "correct" ? "Correct" : "Wrong"}</div>
              )}
              <div className="wh-category-badge" style={{ marginBottom: 10 }}>{speedQuestion.target.category}</div>
              <div className="wh-sentence">{speedQuestion.prompt}</div>
              <div className="wh-options">
                {speedQuestion.options.map((opt) => {
                  let cls = "wh-option";
                  if (speedStatus && opt === speedQuestion.answer) cls += " reveal";
                  if (speedStatus && opt === speedSelected && opt !== speedQuestion.answer) cls += " wrong";
                  return (
                    <button key={opt} className={cls} disabled={!!speedStatus} onClick={() => handleSpeedAnswer(opt)}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {screen === "speedResults" && (
          <div className="wh-results-card">
            <div className="wh-results-stamp">Time's Up</div>
            <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 20 }}>Speed Round</div>
            <div className="wh-results-score">
              <b>{speedScore}</b> points — {speedCorrect}/{speedAnswered} correct · best combo x{speedBestCombo}
            </div>
            {speedScore >= bestSpeedScore && speedScore > 0 && (
              <div className="wh-results-unlock">🏆 New best score!</div>
            )}
            <div className="wh-results-actions">
              <button className="primary" onClick={startSpeedRound}>Play again</button>
              <button className="secondary" onClick={backToLevels}>Back to levels</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
