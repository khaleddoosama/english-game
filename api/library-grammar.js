import { json } from './_lib/env.js';
import { gate, finishCall } from './_lib/gate.js';
import { generateJsonText } from './_lib/gemini.js';
import { grammarRequest, grammarPrompt, validateGrammar } from './_lib/grammar.js';
export async function POST(request) {
  let input;
  try { const body=await request.json(); if(JSON.stringify(body).length>20000) throw new Error('Grammar input is too large.'); input=grammarRequest(body); } catch(e) { return json(400,{error:e.message}); }
  const {denied,callId}=await gate(request,{task:'Write my grammar practice',preview:input.topic,chars:JSON.stringify(input).length});
  if(denied) return denied;
  const started=Date.now(); let generation;
  try {
    generation=await generateJsonText(grammarPrompt(input), { signal: request.signal });
    const rule=validateGrammar(JSON.parse(generation.text),input);
    await finishCall(callId,{ok:true,model:generation.model,ms:Date.now()-started,status:200,outputChars:generation.text.length,usage:generation.usage});
    return json(200,{rule});
  } catch(e) {
    const status=e.status || 422;
    await finishCall(callId,{ok:false,model:generation?.model,ms:Date.now()-started,status,error:e.message,usage:generation?.usage});
    return json(status,{error:e.message || 'Could not prepare grammar practice.'});
  }
}
