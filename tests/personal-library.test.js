import { describe,expect,it } from 'vitest';
import { normalizeTerm,validateVocabulary } from '../api/_lib/vocabulary.js';
import { personalPracticeContent,preparePersonalContent,sessionFitsLibrary,selectedStories } from '../src/features/library/scope.js';
import { V2 } from '../src/engine/v2.js';
import * as engine from '../src/engine/data.js';
import { parseRoute,pathFor } from '../src/lib/router.js';
import { entry } from './vocabularyFixture.js';
describe('personal learning scope',()=>{
  it('builds practice categories from the chosen words instead of an empty catalogue order',()=>{
    const content=preparePersonalContent({words:[entry],grammar:[],levelOrder:[]});
    expect(content.levelOrder).toEqual(['Personality']);
    expect(content.words).toEqual([entry]);
    engine.mergeCustomData(content.words,content.grammar,[],content.levelOrder);
    expect(engine.LEVELS.map(level=>level.title)).toEqual(['Personality']);
    expect(engine.WORDS.map(w=>w.word)).toEqual(['meticulous']);
    engine.mergeCustomData([],[],[],[]);
  });
  it('never keeps global categories that have no selected words or related grammar',()=>{
    expect(preparePersonalContent({words:[],grammar:[],levelOrder:['Food','Health']}).levelOrder).toEqual([]);
    expect(preparePersonalContent({words:[entry],grammar:[],levelOrder:['Food','Personality']}).levelOrder).toEqual(['Personality']);
  });
  it('can practise a single selected word and excludes unselected combo targets',()=>{
    const content=personalPracticeContent({words:[entry],grammar:[],challenges:[]},{combos:[{id:'outside',words:['meticulous','careless']}],stories:[]});
    expect(content.combos).toEqual([]);
    const session=V2.practice(content,{},null,()=>0.5);
    expect(session.queue.length).toBeGreaterThan(0);
    expect(session.introductions.map(w=>w.word)).toEqual(['meticulous']);
    expect(session.queue.flatMap(q=>q.targets).every(w=>w==='meticulous')).toBe(true);
  });
  it('never resumes an old session with unselected targets',()=>{
    expect(sessionFitsLibrary({queue:[{targets:['meticulous','careless']}]},[{word:'meticulous'}])).toBe(false);
    expect(sessionFitsLibrary({words:[{word:'meticulous'}],queue:[{targets:['meticulous']}]},[{word:'meticulous'}])).toBe(true);
    expect(sessionFitsLibrary({queue:[{targets:['meticulous']}]},[])).toBe(false);
  });
  it('only includes stories when every target is selected',()=>{
    const stories=[{id:'a',targetWords:['meticulous']},{id:'b',targetWords:['meticulous','careless']}];
    expect(selectedStories(stories,[{word:'meticulous'}])).toEqual([stories[0]]);
    expect(selectedStories(stories,[])).toEqual([]);
  });
  it('supports shareable library and friends routes',()=>{
    for(const screen of ['library','friends'])expect(parseRoute(pathFor(screen))).toEqual({screen});
  });
});
describe('generated vocabulary validation',()=>{
  const valid = changes => ({valid:true,confidence:'high',entry:{...entry,...changes}});
  it('keeps all learning fields and safe compatibility aliases',()=>{
    const word=validateVocabulary(valid(),'meticulous');
    expect(word.situation).toBe(entry.situations[0]);expect(word.gap).toBe(entry.gaps[0]);
    expect(word.commonMistake).toEqual(entry.commonMistakes[0]);expect(word.units).toEqual(entry.units);
    expect(word).not.toHaveProperty('puns');expect(word).not.toHaveProperty('source');expect(word).not.toHaveProperty('opposite');
  });
  it('accepts an empty family or antonyms instead of inventing relations',()=>{
    expect(validateVocabulary(valid({wordFamily:[],antonyms:[]}),'meticulous').antonyms).toEqual([]);
  });
  it('normalizes typography and rejects inputs that could alter a catalogue query',()=>{
    expect(normalizeTerm('  put   off  ')).toBe('put off');expect(normalizeTerm('don’t')).toBe("don't");
    for(const input of ['*','apple,kind.eq.grammar','hello%','<script>','كلمة','a'.repeat(81)])expect(()=>normalizeTerm(input)).toThrow();
  });
  it('rejects missing linguistic fields, low confidence and leaked answers',()=>{
    for(const change of [{partsOfSpeech:[]},{level:'unknown'},{register:'rare'},{meaning:'Meticulous means careful.'},{gaps:['She is meticulous and ______.','He is ______.']},{situations:['She checked a report.','She is meticulous.']},{commonMistakes:[]},{units:[]},{collocations:[]}])expect(()=>validateVocabulary(valid(change),'meticulous')).toThrow();
    expect(()=>validateVocabulary({...valid(),confidence:'low'},'meticulous')).toThrow();
    expect(()=>validateVocabulary(valid({word:'careless'}),'meticulous')).toThrow();
  });
});
