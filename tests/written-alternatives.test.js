import {describe,it,expect} from 'vitest';
import {V2} from '../src/engine/v2';
import {examScore} from '../src/features/journey/journey';
const word={word:'Sick',type:'vocab',category:'Health',meaning:'Not well because of an illness.',situation:'I feel sick today.',gap:'I feel ______ today.',gaps:['I feel ______ today.','He is ______ with the flu.'],synonyms:['Ill'],acceptedWrittenAnswers:[{mode:'typing',prompt:'Not well because of an illness.',answers:['ill','unwell']},{mode:'gapTyping',prompt:'I feel ______ today.',answers:['ill','unwell']}]};
const question=()=>V2.makeQuestion(word,'gapTyping',[word],()=>0);
describe('prompt-specific written alternatives',()=>{
 it('accepts an authored alternative, preserves one canonical answer, and scores the exam',()=>{const q=question();expect(q.answers).toEqual(['Sick']);const result=V2.grade(q,'  ILL  ');expect(result).toMatchObject({correct:true,spelling:false,alternativeAccepted:true});const score=examScore({queue:[q],index:1,answers:[result]});expect(score.passed).toBe(true);});
 it('keeps canonical recall and spelling checks unchanged',()=>{expect(V2.grade(question(),'sick')).toMatchObject({correct:true,spelling:false});expect(V2.grade(question(),'sick').alternativeAccepted).toBeUndefined();expect(V2.grade(question(),'sik')).toMatchObject({correct:false,spelling:true});expect(V2.grade(question(),'dizzy').correct).toBe(false);expect(V2.grade(question(),['ill','unwell']).correct).toBe(false);});
 it('does not infer answers from synonym fields',()=>{const q=V2.makeQuestion({...word,acceptedWrittenAnswers:[]},'typing',[word]);expect(V2.grade(q,'ill').correct).toBe(false);});
 it('does not copy alternatives into another authored gap or a generated pool variant',()=>{
 const other=V2.makeQuestion({...word,gap:word.gaps[1]},'gapTyping',[word]);expect(other.acceptedAnswers).toEqual([]);expect(V2.grade(other,'ill').correct).toBe(false);
 const pools={Sick:{gap:[{id:'seed',attempts:10},{id:'seed-2',attempts:10},{id:'generated',text:'This film makes me feel ______.',attempts:0}]}};
 const q=V2.makeQuestion(word,'gapTyping',[word],()=>0,1,pools);expect(q.prompt).toBe('This film makes me feel ______.');expect(q.acceptedAnswers).toEqual([]);expect(V2.grade(q,'ill').correct).toBe(false);
 });
 it('does not accept alternatives in audio, spelling, grammar, sentence-building or multiple choice',()=>{for(const mode of ['listen','order','grammarFix','reverse'])expect(V2.grade({...question(),mode},'ill').correct).toBe(false);expect(V2.grade({...question(),type:'mcq'},'ill').correct).toBe(false);expect(V2.grade({...question(),modelOnly:true},'ill').correct).toBe(false);});
 it('does not advance or regress target mastery when a correct alternative was typed',()=>{const q=question();const mastery={Sick:{total:3,correct:3,productionCorrect:0,reviewStep:2}};const result=V2.grade(q,'ill');expect(V2.sessionEvidence(mastery,{id:'alternative',kind:'practice',queue:[q],answers:[result]})).toEqual(mastery);const canonical=V2.grade(q,'sick');expect(V2.sessionEvidence(mastery,{id:'canonical',kind:'practice',queue:[q],answers:[canonical]}).Sick.productionCorrect).toBe(1);});
 it('validates prompt binding and rejects stale, malformed, duplicated or canonical alternatives',()=>{
 const payload=w=>({schemaVersion:2,kind:'content',words:[w]});expect(V2.validateContent(payload(word))).toEqual([]);
 for(const entry of [{mode:'listen',prompt:word.gap,answers:['ill']},{mode:'gapTyping',prompt:'Old question',answers:['ill']},{mode:'typing',prompt:word.meaning,answers:[]},{mode:'typing',prompt:word.meaning,answers:['Ill','ill']},{mode:'typing',prompt:word.meaning,answers:['Sick']},null])expect(V2.validateContent(payload({...word,acceptedWrittenAnswers:[entry]})).length).toBeGreaterThan(0);
 });
 it('preserves authored alternatives through content import/export',()=>{const content={schemaVersion:2,kind:'content',words:[word],grammar:[],stories:[],combos:[],challenges:[]};const exported=V2.contentOnly(content);expect(exported.words[0].acceptedWrittenAnswers).toEqual(word.acceptedWrittenAnswers);const roundTrip=V2.prepareImport(JSON.parse(JSON.stringify(exported)));expect(roundTrip.errors).toEqual([]);expect(roundTrip.data.words[0].acceptedWrittenAnswers).toEqual(word.acceptedWrittenAnswers);});
});
