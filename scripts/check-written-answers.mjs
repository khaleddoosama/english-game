import fs from 'node:fs';
import {createServer} from 'vite';
const [input,output]=process.argv.slice(2);
if(!input)throw Error('Usage: node scripts/check-written-answers.mjs snapshot.json [report.json]');
const snapshot=JSON.parse(fs.readFileSync(input,'utf8'));
const words=snapshot.items.filter(r=>r.kind==='words').map(r=>r.data);
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {V2}=await server.ssrLoadModule('/src/engine/v2.js');
 const findings=[];let prompts=0,alternatives=0,checks=0;
 for(const w of words)for(const entry of w.acceptedWrittenAnswers||[]){
  prompts++;
  const target=entry.mode==='gapTyping'?{...w,gap:entry.prompt}:w;
  const q=V2.makeQuestion(target,entry.mode,words,()=>0);
  if(q.prompt!==entry.prompt)findings.push({word:w.word,detail:'Prompt changed'});
  if(q.answers.length!==1||q.answers[0]!==w.word)findings.push({word:w.word,detail:'Canonical answer changed'});
  for(const answer of entry.answers){
   alternatives++;
   for(const value of [answer,'  '+answer.toUpperCase()+'  ']){
    checks++;const result=V2.grade(q,value,words);
    if(!result.correct||result.spelling||!result.alternativeAccepted)findings.push({word:w.word,answer:value,detail:'Alternative rejected'});
   }
   checks++;
   const initial={[w.word]:{total:3,correct:2,productionCorrect:0,reviewStep:2}};
   const next=V2.sessionEvidence(initial,{id:'alternative-check',kind:'practice',queue:[q],answers:[V2.grade(q,answer,words)]});
   if(JSON.stringify(initial)!==JSON.stringify(next))findings.push({word:w.word,detail:'Alternative changed target mastery'});
  }
  checks++;
  if(!V2.grade(q,w.word,words).correct)findings.push({word:w.word,detail:'Canonical rejected'});
 }
 const report={version:snapshot.meta.version,wordsWithAlternatives:words.filter(w=>w.acceptedWrittenAnswers?.length).length,prompts,alternatives,checks,findings,passed:!findings.length};
 if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(findings.length)process.exitCode=1;
}finally{await server.close();}
