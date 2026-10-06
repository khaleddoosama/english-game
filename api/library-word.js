import { json, serverAuth, SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/env.js';
import { gate, finishCall } from './_lib/gate.js';
import { generateJsonText } from './_lib/gemini.js';
import { normalizeTerm, validateVocabulary, vocabularyPrompt } from './_lib/vocabulary.js';

export async function POST(request) {
  let term;
  try { term = normalizeTerm((await request.json())?.term); } catch (e) { return json(400,{error:e.message}); }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json(500,{error:'Server is missing Supabase settings.'});
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/.test(authorization)) return json(401,{error:'Sign in to add words.'});
  const headers = {apikey:SUPABASE_ANON_KEY,authorization,'content-type':'application/json'};
  let user, matches;
  try {
    const identity = await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers,signal:AbortSignal.timeout(5000)});
    if (!identity.ok) return json(401,{error:'Your session expired. Sign in again.'});
    user = await identity.json();
    if (!user.id) return json(401,{error:'Sign in to add words.'});
    const query = new URLSearchParams({select:'key,data',kind:'eq.words',deleted:'eq.false',key:`ilike.${term}`,limit:'1'});
    const found = await fetch(`${SUPABASE_URL}/rest/v1/content_items?${query}`,{headers,signal:AbortSignal.timeout(5000)});
    if (!found.ok) throw new Error('Could not search the word library.');
    matches = await found.json();
    if (matches.length) {
      const added = await fetch(`${SUPABASE_URL}/rest/v1/personal_words?on_conflict=user_id,word_key`,{
        method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({user_id:user.id,word_key:matches[0].key}),signal:AbortSignal.timeout(5000),
      });
      if (!added.ok) throw new Error('Could not add the existing word to your library.');
      return json(200,{word:matches[0].data,created:false});
    }
  } catch (e) { return json(502,{error:e.message || 'Library is unavailable. Try again.'}); }
  const auth = serverAuth();
  if (!auth) return json(503,{error:'Word generation needs the server database key. Existing words can still be added.'});
  const {denied,callId} = await gate(request,{task:'Add a word to my library',preview:term,chars:term.length});
  if (denied) return denied;
  const started = Date.now();
  let generation;
  try {
    generation = await generateJsonText(vocabularyPrompt(term));
    const entry = validateVocabulary(JSON.parse(generation.text),term);
    const saved = await fetch(`${SUPABASE_URL}/rest/v1/rpc/store_generated_word`,{
      method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({p_user:user.id,p_word:entry}),signal:AbortSignal.timeout(5000),
    });
    if (!saved.ok) throw new Error('Could not save this word. Try again.');
    const word = await saved.json();
    await finishCall(callId,{ok:true,model:generation.model,ms:Date.now()-started,status:200,outputChars:generation.text.length,usage:generation.usage});
    return json(200,{word,created:true});
  } catch (e) {
    const status = e.status || 422;
    await finishCall(callId,{ok:false,model:generation?.model,ms:Date.now()-started,status,error:e.message,usage:generation?.usage});
    return json(status,{error:e.message || 'The AI did not return valid word content. Try again.'});
  }
}
