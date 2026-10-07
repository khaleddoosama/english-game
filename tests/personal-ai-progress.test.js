import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/auth', () => ({accessToken:vi.fn(async()=> 'token')}));
vi.mock('../src/lib/supabase', () => ({supabase:{}, isLocalMode:false}));
import { addOrGenerateWord, generatePersonalGrammar } from '../src/features/library/libraryApi.js';
import { runBulkWords } from '../src/features/library/workspace.js';
import { cancelAiOperation, cancelAiTasks, dismissAiOperation, getAiOperations } from '../src/lib/aiOperations.js';
afterEach(()=>{cancelAiTasks(null,{includeBackground:true});for(const job of getAiOperations())dismissAiOperation(job.id);vi.unstubAllGlobals();});
describe('personal library AI',()=>{
  it.each([
    ['word',()=>addOrGenerateWord('patient')],
    ['grammar',()=>generatePersonalGrammar({topic:'present simple'})],
  ])('cancels a hung %s endpoint',async(_name,start)=>{
    let signal;
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{signal=init.signal;return new Promise(()=>{});}));
    const pending=start(), checked=expect(pending).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    cancelAiOperation(getAiOperations().at(-1).id);await checked;
    expect(signal.aborted).toBe(true);
  });
  it('preserves successful words and stops the rest of a cancelled batch',async()=>{
    const controller=new AbortController(), updates=[];
    const add=vi.fn(async(term,{signal})=>{
      if(term==='apple')return {word:{word:term}};
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));
    });
    const items=['apple','pear','plum'].map(term=>({term,status:'pending'}));
    const pending=runBulkWords(items,{add,save:vi.fn(),signal:controller.signal,onUpdate:rows=>updates.push(rows)});
    await vi.waitFor(()=>expect(add).toHaveBeenCalledTimes(2));controller.abort();
    const rows=await pending;
    expect(rows.map(row=>row.status)).toEqual(['done','pending','pending']);
    expect(add.mock.calls.map(call=>call[0])).toEqual(['apple','pear']);
    const retry=vi.fn(async term=>({word:{word:term}}));
    const result=await runBulkWords(rows,{add:retry,save:vi.fn(),onUpdate:()=>{}});
    expect(retry.mock.calls.map(call=>call[0])).toEqual(['pear','plum']);
    expect(result.every(row=>row.status==='done')).toBe(true);
  });
  it('surfaces an invalid generated response as a failure',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
    await expect(addOrGenerateWord('patient')).rejects.toThrow(/usable word/);
    expect(getAiOperations().at(-1).status).toBe('failed');
  });
});
