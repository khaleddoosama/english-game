import { supabase, isLocalMode } from '../../lib/supabase';
import { postAiRequest } from '../../lib/ai';
import { managedAiFunction } from '../../lib/aiOperations.js';
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
export async function removeWord(userId,key) { check(await supabase.rpc('remove_personal_item',{p_kind:'words',p_key:key})); }
export async function savePersonalItems(items) {
  check(await supabase.rpc('save_personal_items',{p_items:items}));
}
export async function savePersonalItem(kind,data) {
  await savePersonalItems([{kind,key:kind==='words'?data.word:data.id,data}]);
}
export async function removeGrammar(key) { check(await supabase.rpc('remove_personal_item',{p_kind:'grammar',p_key:key})); }
export async function searchGrammar(term) {
  if(isLocalMode || !term.trim()) return [];
  const clean=term.trim().replace(/[%_*(),.]/g,'').slice(0,80);
  if(!clean) return [];
  return check(await supabase.from('content_items').select('key,data').eq('kind','grammar').eq('deleted',false).ilike('data->>rule',`%${clean}%`).order('key').limit(40));
}
export async function acceptWordShare(id) { check(await supabase.rpc('accept_word_share',{p_id:id})); }
async function addOrGenerateWordImpl(term, options = {}) {
  const data = await postAiRequest('/api/library-word', { term: normalizeTerm(term) }, { ...options, timeoutMs: 65000 });
  if (!data?.word || typeof data.word.word !== 'string') throw new Error('AI did not return a usable word. Please try again.');
  return data;
}
export const addOrGenerateWord = managedAiFunction('Add a word to my library', addOrGenerateWordImpl, 1, { timeoutMs: 70000 });
async function generatePersonalGrammarImpl(body, options = {}) {
  const data = await postAiRequest('/api/library-grammar', body, { ...options, timeoutMs: 55000 });
  if (!data?.rule || !Array.isArray(data.rule.questions) || !data.rule.questions.length) throw new Error('AI did not return usable grammar practice. Please try again.');
  return data.rule;
}
export const generatePersonalGrammar = managedAiFunction('Write my grammar practice', generatePersonalGrammarImpl, 1, { timeoutMs: 60000 });

export async function prepareBulkWords(terms) {
  return check(await supabase.rpc('choose_bulk_words',{p_terms:terms}));
}
