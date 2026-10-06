import { beforeEach,describe,it,expect,vi } from 'vitest';
vi.mock('../api/_lib/gate.js',()=>({gate:vi.fn(async()=>({callId:'grammar1'})),finishCall:vi.fn(async()=>{})}));
vi.mock('../api/_lib/gemini.js',()=>({generateJsonText:vi.fn()}));
import { POST } from '../api/library-grammar.js';
import { gate,finishCall } from '../api/_lib/gate.js';
import { generateJsonText } from '../api/_lib/gemini.js';
const req=body=>new Request('https://game.test/api/library-grammar',{method:'POST',headers:{authorization:'Bearer player'},body:JSON.stringify(body)});
const data={valid:true,confidence:'high',entry:{rule:'Used to',category:'Grammar',explanation:'Past habits.',examples:['I used to run.','I used to swim.'],commonMistakes:[{sentence:'I use to run.',correction:'I used to run.',why:'Use used to.'}],questions:Array.from({length:3},()=>({type:'fix',sentence:'I use to run.',answer:'I used to run.',explanation:'Use used to.'}))}};
describe('personal grammar endpoint',()=>{
  beforeEach(()=>{vi.clearAllMocks();generateJsonText.mockResolvedValue({text:JSON.stringify(data),model:'test'});});
  it('returns a checked draft under the player gate without publishing',async()=>{
    const r=await POST(req({topic:'Used to',types:['fix'],count:3}));expect(r.status).toBe(200);
    expect((await r.json()).rule.rule).toBe('Used to');expect(gate).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({task:'Write my grammar practice'}));
    expect(finishCall).toHaveBeenCalledWith('grammar1',expect.objectContaining({ok:true}));
  });
  it('honours quota and authentication denials before calling AI',async()=>{
    gate.mockResolvedValueOnce({denied:new Response('{}',{status:429})});
    expect((await POST(req({topic:'Used to'}))).status).toBe(429);expect(generateJsonText).not.toHaveBeenCalled();
  });
  it('rejects bad requests and logs invalid generated output',async()=>{
    expect((await POST(req({topic:''}))).status).toBe(400);expect(gate).not.toHaveBeenCalled();
    generateJsonText.mockResolvedValueOnce({text:'{"valid":false}',model:'test'});
    expect((await POST(req({topic:'Used to'}))).status).toBe(422);expect(finishCall).toHaveBeenCalledWith('grammar1',expect.objectContaining({ok:false}));
  });
});
