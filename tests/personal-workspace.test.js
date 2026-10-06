import { describe,it,expect,vi } from 'vitest';
import { parseBulkWords,groupContent,runBulkWords } from '../src/features/library/workspace.js';
import { grammarRequest,validateGrammar } from '../api/_lib/grammar.js';
import { sessionFitsLibrary,preparePersonalContent } from '../src/features/library/scope.js';
import { V2 } from '../src/engine/v2.js';
import { entry } from './vocabularyFixture.js';
const rule={id:'my-rule',rule:'Used to',category:'Past habits',explanation:'Use used to for past habits.',examples:['I used to swim.','She used to run.'],commonMistakes:[{sentence:'I use to swim.',correction:'I used to swim.',why:'Use used to for past habits.'}],questions:[{type:'fix',sentence:'I use to swim.',answer:'I used to swim.',explanation:'Use used to for a past habit.'}]};
describe('personal authoring workspace',()=>{
  it('parses 20 words, preserves phrases and removes casing/spacing duplicates',()=>{
    const input=Array.from({length:20},(_,i)=>`word${String.fromCharCode(97+i)}`).join(',');
    expect(parseBulkWords(input)).toHaveLength(20);
    expect(parseBulkWords('apple, APPLE\nput   off،don’t').map(r=>r.term)).toEqual(['apple','put off',"don't"]);
    expect(parseBulkWords('apple, <script>')[1].status).toBe('failed');
    expect(()=>parseBulkWords(' , ')).toThrow();
    expect(()=>parseBulkWords(Array.from({length:101},(_,i)=>`word${i}`).join(','))).toThrow('100');
  });
  it('retains partial successes and retries only failed saves without another AI call',async()=>{
    const add=vi.fn(async term=>{if(term==='bad')throw new Error('quota');return {word:{...entry,word:term}};});
    const save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue();
    const options={add,save,category:'My course',units:'Unit 4',onUpdate:vi.fn()};
    const first=await runBulkWords(parseBulkWords('apple, bad, pear'),options);
    expect(first.map(r=>r.status)).toEqual(['failed','failed','done']);
    const second=await runBulkWords(first,options);
    expect(second.map(r=>r.status)).toEqual(['done','failed','done']);
    expect(add.mock.calls.map(c=>c[0])).toEqual(['apple','bad','pear','bad']);
    expect(save).toHaveBeenCalledTimes(3);
  });
  it('uses the own edited word and groups without mutating its original learning fields',async()=>{
    const own={...entry,meaning:'My edited meaning',categoryId:'global',units:['Existing']};
    const grouped=groupContent(own,'My unit category','Unit 4, Unit 4, Exam');
    expect(grouped.units).toEqual(['Existing','Unit 4','Exam']);expect(grouped.categoryId).toBeUndefined();
    expect(grouped.meaning).toBe(own.meaning);expect(own.units).toEqual(['Existing']);
    const add=vi.fn(),save=vi.fn();
    await runBulkWords(parseBulkWords('METICULOUS'),{existing:[own],add,save,category:'Revision',onUpdate:()=>{}});
    expect(add).not.toHaveBeenCalled();expect(save.mock.calls[0][0].meaning).toBe('My edited meaning');
  });
  it('supports grammar-only practice and rejects removed grammar on resume',()=>{
    const content=preparePersonalContent({words:[],grammar:[rule],challenges:[]});
    expect(content.levelOrder).toEqual(['Past habits']);
    const session=V2.practice(content,{},null,()=>0.5);
    expect(session.queue).toHaveLength(1);expect(session.queue[0].progressKey).toBe('grammar:my-rule');
    expect(sessionFitsLibrary(session,[],[rule])).toBe(true);expect(sessionFitsLibrary(session,[],[])).toBe(false);
  });
  it('validates both content JSON versions for personal export/import',()=>{
    const exported=V2.contentOnly({words:[{...entry,situation:entry.situations[0],gap:entry.gaps[0]}],grammar:[rule]});
    const prepared=V2.prepareImport(exported,{});
    expect(prepared.errors).toEqual([]);expect(V2.validateContent(prepared.data)).toEqual([]);
    expect(prepared.data.grammar[0].questions).toEqual(rule.questions);
  });
});
describe('grammar generation contract',()=>{
  const input=grammarRequest({topic:'Used to',types:['fix'],count:3});
  const valid={valid:true,confidence:'high',entry:{...rule,questions:Array.from({length:3},()=>({...rule.questions[0]}))}};
  it('requires a bounded topic, allowed types and a bounded question count',()=>{
    expect(()=>grammarRequest({topic:'a'.repeat(161)})).toThrow();
    expect(()=>grammarRequest({topic:'Past tense',types:['code']})).toThrow();
    expect(()=>grammarRequest({topic:'Past tense',count:100})).toThrow();
  });
  it('rejects uncertain, incomplete and contradictory grammar output',()=>{
    expect(validateGrammar(valid,input).questions).toHaveLength(3);
    expect(()=>validateGrammar({...valid,confidence:'low'},input)).toThrow();
    expect(()=>validateGrammar({...valid,entry:{...valid.entry,questions:[{type:'fix',sentence:'Same.',answer:'Same.',explanation:'x'}]}},input)).toThrow();
    expect(()=>validateGrammar({...valid,entry:{...valid.entry,examples:[]}},input)).toThrow();
  });
});
