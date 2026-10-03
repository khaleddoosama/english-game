import { describe, expect, it } from 'vitest';
import { heartsAt, spendHeart, earnHeart, HEART_INTERVAL, scheduleReview, dueWords } from '../src/features/learner/learning';
import { interactiveTraining } from '../src/features/learner/training';
import { V2 } from '../src/engine/v2';
import { createFakeSupabase } from './fakeSupabase';
import { createSupabaseRepo } from '../src/lib/repo';

describe('hearts and review scheduling',()=>{
 it('refills only elapsed half-hours, preserves the next refill time, and caps at five',()=>{
  const start={count:1,at:100}; expect(heartsAt(start,100+HEART_INTERVAL-1).count).toBe(1);
  expect(heartsAt(start,100+HEART_INTERVAL*2+123)).toEqual({count:3,at:100+HEART_INTERVAL*2});
  expect(heartsAt(start,100+HEART_INTERVAL*20).count).toBe(5);
 });
 it('spending a full heart starts its refill clock and cannot make a negative balance',()=>{
  expect(spendHeart({count:5,at:0},100)).toEqual({count:4,at:100});
  expect(spendHeart({count:0,at:100},100).count).toBe(0);
  expect(earnHeart({count:5,at:100},100).count).toBe(5);
 });
 it('self-ratings postpone due words without changing mastery',()=>{
  const mastery={one:{total:1}}, words=[{word:'one'},{word:'new'}];
  expect(dueWords(words,mastery,{},100)).toEqual([words[0]]);
  const schedule=scheduleReview({},'one','good',100);
  expect(dueWords(words,mastery,schedule,101)).toEqual([]);
  expect(dueWords(words,mastery,schedule,100+86400000)).toEqual([words[0]]);
  expect(mastery.one).toEqual({total:1});
 });
 it('ignores invalid ratings instead of writing an invalid due date',()=>{const s={};expect(scheduleReview(s,'one','unknown')).toBe(s);});
 it('persists learner preferences, hearts and self-ratings through the Supabase repository',async()=>{
  const client=createFakeSupabase({userId:'u'}), repo=createSupabaseRepo({userId:'u',client});await repo.loadProgress();
  const learner={displayName:'Learner',goal:'Travel',reviews:scheduleReview({},'one','hard',100),hearts:{count:2,at:100}};
  await repo.saveProgress({learner,mastery:{}});const again=createSupabaseRepo({userId:'u',client});expect((await again.loadProgress()).learner).toEqual(learner);repo.dispose();again.dispose();
 });
});
describe('interactive training',()=>{
 const unit={title:'Unit',words:[{word:'passport',meaning:'A travel document.',situation:'I showed my passport.'},{word:'ticket',meaning:'Proof of booking.',situation:'She bought a ticket.'},{word:'paper',meaning:'A travel document.'}]};
 it('does not expose the listening answer in its prompt',()=>{const s=interactiveTraining(unit,'listen');expect(s.queue[0].prompt).not.toContain(s.queue[0].answers[0]);expect(s.queue.every(q=>q.audio)).toBe(true);});
 it('excludes duplicate meanings from matching and grades pairs regardless of tap order',()=>{const q=interactiveTraining(unit,'match',{},12,()=>.5).queue[0];expect(q.pairs).toHaveLength(2);expect(V2.grade(q,[...q.answers].reverse()).correct).toBe(true);expect(V2.grade(q,[q.answers[0],q.answers[0]]).correct).toBe(false);});
 it('preserves repeated tokens in sentence-building',()=>{const q=interactiveTraining({title:'U',words:[{word:'had',situation:'I had had enough.'}]},'build').queue[0];expect(q.tokens.filter(t=>t==='had')).toHaveLength(2);expect(q.answers[0]).toBe('I had had enough.');});
 it('keeps spoken repetition out of independent production credit',()=>{const s=interactiveTraining(unit,'speak');s.index=s.queue.length;s.answers=s.queue.map(()=>({correct:true,assisted:true}));const m=V2.sessionEvidence({},s);expect(m.passport.productionCorrect).toBe(0);expect(m.passport.correct).toBe(0);});
 it('rejects empty activities instead of creating a zero-question pass',()=>{expect(()=>interactiveTraining({words:[],title:'U'},'match')).toThrow();});
});

describe('story checks across imported categories',()=>{
 const words=[{word:'target',meaning:'Target meaning',category:'B'},...['one','two','three','four'].map(word=>({word,meaning:word+' meaning',category:'A'}))];
 it('keeps target words in a story pool when source categories have changed',()=>{
  const s=V2.storySession({id:'story',title:'Story',text:'Text',targetWords:['target'],sourceCategories:['A'],questions:[{mode:'mcq',targetWord:'target',prompt:'Choose the target'}]},words);
  expect(s.queue[0].answers).toEqual(['target']);expect(s.queue[0].options).toContain('target');
 });
 it('reports missing targets instead of crashing on undefined word references',()=>{
  expect(()=>V2.storySession({targetWords:['missing'],questions:[]},words)).toThrow('missing from the course library');
 });
});
