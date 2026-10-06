import { supabase, isLocalMode } from '../../lib/supabase';
import { accessToken } from '../../lib/auth';
import { preparePersonalContent } from './scope';
import { idb } from '../../lib/idb';
import { normalizeTerm } from '../../../api/_lib/vocabulary.js';
const check = ({data,error}) => { if(error) throw new Error(error.message); return data; };
export async function loadPersonalContent(userId) {
  if(isLocalMode) return null;
  const key = `personal-content:${userId}`;
  try {
    const content = preparePersonalContent(check(await supabase.rpc('my_library_content')));
    await idb.set(key,content);
    return content;
  } catch(e) {
    if(typeof navigator !== 'undefined' && navigator.onLine === false) {
      const cached = await idb.get(key);
      if(cached) return preparePersonalContent(cached);
    }
    throw e;
  }
}
export async function searchCatalogue(term) {
  if(isLocalMode) return [];
  const clean = normalizeTerm(term);
  return check(await supabase.from('content_items').select('key,data').eq('kind','words').eq('deleted',false).ilike('key',`%${clean}%`).order('key').limit(40));
}
export async function chooseWords(userId,keys) {
  if(isLocalMode) throw new Error('Sign in online to build a personal library.');
  check(await supabase.from('personal_words').upsert(keys.map(word_key=>({user_id:userId,word_key})),{onConflict:'user_id,word_key',ignoreDuplicates:true}));
}
export async function removeWord(userId,key) { check(await supabase.from('personal_words').delete().eq('user_id',userId).eq('word_key',key)); }
export async function addOrGenerateWord(term) {
  const token = await accessToken();
  const res = await fetch('/api/library-word',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({term:normalizeTerm(term)})});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Could not add this word.');
  return data;
}
