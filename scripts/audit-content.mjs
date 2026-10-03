import fs from 'node:fs';
import {createServer} from 'vite';
const input=process.argv[2], output=process.argv[3];
if(!input||!output)throw Error('Usage: node scripts/audit-content.mjs snapshot.json report.json');
const snapshot=JSON.parse(fs.readFileSync(input,'utf8'));
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {V2}=await server.ssrLoadModule('/src/engine/v2.js');
 const J=await server.ssrLoadModule('/src/features/journey/journey.js');
 const {interactiveTraining}=await server.ssrLoadModule('/src/features/learner/training.js');
 const content={schemaVersion:3,kind:'content',words:[],grammar:[],stories:[],challenges:[],combos:[],puns:[]};
 for(const row of snapshot.items)if(content[row.kind])content[row.kind].push(row.data);
 const findings=[];const add=(severity,code,item,detail)=>findings.push({severity,code,item,detail});
 const norm=V2.norm, has=(text,term)=>norm(text||'').includes(norm(term||''));
 for(const w of content.words){
  if(!Array.isArray(w.partsOfSpeech)||!w.partsOfSpeech.length)add('medium','missing_pos',w.word,'partsOfSpeech must be a non-empty array');
  if(!w.level)add('high','missing_level',w.word,'Placed in Unassigned; this level participates in Journey gates');
  if(!w.units?.length)add('high','missing_units',w.word,'Placed in an Unassigned unit');
  if((String(w.gap||'').match(/_{2,}/g)||[]).length!==1)add('medium','gap_format',w.word,'Expected exactly one blank');
  if(has(w.meaning,w.word))add('medium','meaning_answer_leak',w.word,w.meaning);
  if(has(String(w.gap||'').replace(/_{2,}/g,''),w.word))add('medium','gap_answer_leak',w.word,w.gap);
  if(!has(w.situation,w.word))add('review','example_lemma_not_found',w.word,w.situation||'');
  if(/[\u0600-\u06ff]/.test(JSON.stringify(w)))add('review','arabic_in_word_record',w.word,'Inspect whether Arabic is learner-visible or internal metadata');
  if(/(?:ðŸ|â€|â†|ï¸)/.test(JSON.stringify(w)))add('medium','encoding_damage',w.word,'Possible mojibake');
 }
 for(const g of content.grammar){if(!g.level)add('high','missing_level',g.id,'Grammar has no course level');if(!g.units?.length)add('high','missing_units',g.id,'Grammar has no unit');if(!V2.grammarQuestions(g).length)add('high','no_grammar_questions',g.id,'No usable grammar question');}
 const schemaErrors=V2.validateContent({...content,schemaVersion:2});
 const levels=J.buildJourney(content), rounds=[];
 for(const l of levels){for(const u of l.units){const entry={level:l.id,unit:u.id,words:u.words.length,rules:u.grammar.length,modes:{}};
  for(const kind of ['training','unit']){const attempts=[];for(let seed=1;seed<=10;seed++){let n=seed;const rng=()=>((n=(n*1664525+1013904223)>>>0)/4294967296);try{const s=J.journeySession(content,l,u,kind,{},12,rng);attempts.push(s.queue.length);for(const q of s.queue){if(q.options && !q.answers.every(a=>q.options.includes(a)))add('high','answer_missing_option',q.id,'Generated answer is absent from options');if(q.options && new Set(q.options.map(norm)).size!==q.options.length)add('high','duplicate_options',q.id,'Generated duplicate options');}}catch(e){add('high','round_blocked',l.id+' / '+u.id+' / '+kind,e.message);break;}}entry.modes[kind]={runs:attempts.length,minQuestions:Math.min(...attempts),maxQuestions:Math.max(...attempts)};}
  for(const mode of ['listen','speak','build','match'])try{entry.modes[mode]={questions:interactiveTraining(u,mode).queue.length};}catch(e){entry.modes[mode]={unavailable:e.message};}
  let mastery={},trainingRuns=0;try{while(!J.coverage(u,mastery).ready&&trainingRuns<30){const s=J.journeySession(content,l,u,'training',mastery,12,()=>.5);s.answers=s.queue.map(()=>({correct:true,value:'audit'}));s.index=s.queue.length;mastery=V2.sessionEvidence(mastery,s);trainingRuns++;}entry.trainingCoverage={...J.coverage(u,mastery),runs:trainingRuns};if(!entry.trainingCoverage.ready)add('high','coverage_blocked',l.id+' / '+u.id,'Training rotation never covers all content');}catch(e){add('high','coverage_blocked',l.id+' / '+u.id,e.message);}
  rounds.push(entry);
 }try{const s=J.journeySession(content,l,null,'final',{},12,()=>.5);l.finalQuestions=s.queue.length;}catch(e){add('high','final_blocked',l.id,e.message);}}
 const storyChecks=content.stories.map(s=>{try{return {id:s.id,title:s.title,questions:V2.storySession(s,content.words).queue.length};}catch(e){add('high','story_blocked',s.id,e.message);return {id:s.id,error:e.message};}});
 const duplicateDefinitions=Object.entries(Object.groupBy(content.words,w=>norm(w.meaning||''))).filter(([k,v])=>k&&v.length>1).map(([meaning,words])=>({meaning,words:words.map(w=>w.word),allExcluded:words.every(w=>words.every(o=>w===o||!V2.compatible(w,o)))}));
 const report={checkedAt:new Date().toISOString(),source:'Supabase read-only snapshot',version:snapshot.meta.version,missingStableIds:content.words.filter(w=>!w.id).length,counts:Object.fromEntries(['words','grammar','stories','challenges','combos'].map(k=>[k,content[k].length])),schemaErrors,levels:levels.map(l=>({level:l.id,units:l.units.map(u=>u.id),uniqueWords:new Set(l.units.flatMap(u=>u.words.map(w=>w.word))).size,rules:new Set(l.units.flatMap(u=>u.grammar.map(g=>g.id))).size,finalQuestions:l.finalQuestions})),rounds,storyChecks,duplicateDefinitions,findings};
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({counts:report.counts,levels:report.levels,schemaErrors:report.schemaErrors,findings:findings.reduce((r,f)=>(r[f.code]=(r[f.code]||0)+1,r),{}),blocked:findings.filter(f=>f.code.endsWith('blocked'))},null,2));
}finally{await server.close();}
