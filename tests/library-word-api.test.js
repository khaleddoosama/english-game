import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
import { entry } from './vocabularyFixture.js';
vi.mock('../api/_lib/env.js',()=>({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public',serverAuth:()=>({apikey:'secret',authorization:'Bearer secret'}),json:(status,body)=>new Response(JSON.stringify(body),{status})}));
vi.mock('../api/_lib/gate.js',()=>({gate:vi.fn(async()=>({callId:'audit1'})),finishCall:vi.fn(async()=>{})}));
vi.mock('../api/_lib/gemini.js',()=>({generateJsonText:vi.fn()}));
import { POST } from '../api/library-word.js';
import { gate,finishCall } from '../api/_lib/gate.js';
import { generateJsonText } from '../api/_lib/gemini.js';
const response = (data,status=200)=>new Response(JSON.stringify(data),{status});
const req = (term,token='player-token')=>new Request('https://game.test/api/library-word',{method:'POST',headers:token?{authorization:`Bearer ${token}`,'content-type':'application/json'}:{},body:JSON.stringify({term,userId:'forged-user'})});
describe('library word endpoint',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn());generateJsonText.mockResolvedValue({text:JSON.stringify({valid:true,confidence:'high',entry}),model:'test',usage:{inputTokens:10}});});
  afterEach(()=>vi.unstubAllGlobals());
  it('attaches an existing word immediately without calling AI or consuming quota',async()=>{
    fetch.mockResolvedValueOnce(response({id:'verified-user'})).mockResolvedValueOnce(response([{key:'Meticulous',data:entry}])).mockResolvedValueOnce(response(null));
    const r=await POST(req('meticulous'));expect(r.status).toBe(200);expect((await r.json()).created).toBe(false);
    expect(gate).not.toHaveBeenCalled();expect(generateJsonText).not.toHaveBeenCalled();
    const options=fetch.mock.calls[2][1];expect(JSON.parse(options.body)).toEqual({user_id:'verified-user',word_key:'Meticulous'});expect(options.headers.authorization).toBe('Bearer player-token');
  });
  it('generates only after a database miss and stores as the verified account',async()=>{
    fetch.mockResolvedValueOnce(response({id:'verified-user'})).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response(entry));
    const r=await POST(req('meticulous'));expect(r.status).toBe(200);expect(generateJsonText).toHaveBeenCalledTimes(1);
    const write=fetch.mock.calls[2];expect(write[0]).toContain('rpc/store_generated_word');expect(write[1].headers.apikey).toBe('secret');expect(JSON.parse(write[1].body).p_user).toBe('verified-user');
    expect(finishCall).toHaveBeenCalledWith('audit1',expect.objectContaining({ok:true}));
  });
  it('refuses forged/expired tokens, invalid terms and unauthenticated generation',async()=>{
    expect((await POST(req('meticulous',''))).status).toBe(401);
    expect((await POST(req('%'))).status).toBe(400);
    fetch.mockResolvedValueOnce(response({},401));expect((await POST(req('meticulous'))).status).toBe(401);
    expect(generateJsonText).not.toHaveBeenCalled();
  });
  it('does not save malformed or low-confidence AI content',async()=>{
    fetch.mockResolvedValueOnce(response({id:'verified-user'})).mockResolvedValueOnce(response([]));
    generateJsonText.mockResolvedValueOnce({text:JSON.stringify({valid:false,confidence:'low'}),model:'test'});
    expect((await POST(req('meticulous'))).status).toBe(422);expect(fetch).toHaveBeenCalledTimes(2);
    expect(finishCall).toHaveBeenCalledWith('audit1',expect.objectContaining({ok:false}));
  });
  it('honours the existing player AI gate and does not call the model when denied',async()=>{
    fetch.mockResolvedValueOnce(response({id:'verified-user'})).mockResolvedValueOnce(response([]));
    gate.mockResolvedValueOnce({denied:response({error:'quota'},429)});
    expect((await POST(req('meticulous'))).status).toBe(429);expect(generateJsonText).not.toHaveBeenCalled();
  });
  it('does not generate when catalogue lookup fails',async()=>{
    fetch.mockResolvedValueOnce(response({id:'verified-user'})).mockResolvedValueOnce(response({},500));
    expect((await POST(req('meticulous'))).status).toBe(502);expect(generateJsonText).not.toHaveBeenCalled();
  });
});
