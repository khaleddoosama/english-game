import { runAiOperation, updateAiOperation } from '../../lib/aiOperations.js';
import { useCancelAiOnLeave } from '../../lib/aiLifecycle.js';
import { lazy, Suspense, useState } from 'react';
import { V2 } from '../../engine/v2';
import { addOrGenerateWord, prepareBulkWords, generatePersonalGrammar, removeGrammar, removeWord, savePersonalItem, savePersonalItems, searchGrammar } from './libraryApi';
import { groupContent, parseBulkWords, runBulkWords } from './workspace';
import { blankGrammarRule, checkAiQuestion } from '../admin/editors/grammarRules';
import '../../styles/admin.css';
const WordEditor=lazy(()=>import('../admin/editors/WordEditor').then(m=>({default:m.WordEditor})));
const GrammarEditor=lazy(()=>import('../admin/editors/GrammarEditor').then(m=>({default:m.GrammarEditor})));
const freshId=()=>`my-grammar-${crypto.randomUUID()}`;

export default function PersonalWorkspace({words,grammar,selected,busy,act,onChanged,editor,setEditor}) {
  useCancelAiOnLeave(["Add a word batch", "Write my grammar practice"]);
  const [bulk,setBulk]=useState(''),[rows,setRows]=useState([]),[category,setCategory]=useState(''),[units,setUnits]=useState('');
  const [topic,setTopic]=useState(''),[matches,setMatches]=useState([]),[json,setJson]=useState(''),[note,setNote]=useState('');
  const categories=[...new Set([...words,...grammar].map(x=>x.category).filter(Boolean))];
  const content={words,grammar,levels:categories.map(title=>({title}))};
  const refresh=async()=>{await onChanged();};
  async function batch(retry=false) {
    setNote('');
    const input=retry?rows:parseBulkWords(bulk);setRows(input);
    const result = await runAiOperation("Add a word batch", async signal => {
      updateAiOperation(signal, { done: input.filter(r => r.status === 'done').length, total: input.length, phase: "Preparing your words" });
      const available = await prepareBulkWords(input.filter(r=>r.status!=='done').flatMap(r=>{try{return parseBulkWords(r.term).filter(x=>!x.error).map(x=>x.term);}catch{return [];}}));
      signal.throwIfAborted();
      return runBulkWords(input, { add:addOrGenerateWord, save:w=>savePersonalItem('words',w), category, units, existing:[...available,...words], onUpdate:setRows, signal, onProgress:(done,total)=>updateAiOperation(signal,{done,total}) });
    }, { timeoutMs: 240000 });
    await refresh();setNote(`${result.filter(r=>r.status==='done').length} ready; ${result.filter(r=>r.status!=='done').length} can be retried.`);
  }

  async function save(kind,item) { await savePersonalItem(kind,item);await refresh();setEditor(null); }
  async function remove(kind,item) { await (kind==='words'?removeWord(null,item.word):removeGrammar(item.id));await refresh();setEditor(null); }
  async function questionAi(rule,types,count) { const result=await generatePersonalGrammar({rule,types,count});return result.questions.map(q=>checkAiQuestion(q,types)); }
  function exportJson() {
    const data=V2.contentOnly({words,grammar,combos:[],stories:[],challenges:[]});
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='my-word-hunter-content.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importJson() {
    const parsed=JSON.parse(json), prepared=V2.prepareImport(parsed,content);
    if(prepared.errors.length) throw new Error(prepared.errors.slice(0,5).join(' · '));
    const data=prepared.data;
    if((data.combos||[]).length || (data.stories||[]).length || (data.challenges||[]).length) throw new Error('Personal import supports words and grammar. Import those sections only.');
    const problems=V2.validateContent(data,prepared.existing);
    if(problems.length) throw new Error(problems.slice(0,5).join(' · '));
    if(/[؀-ۿ]/.test(JSON.stringify(data))) throw new Error('Game content must be in English.');
    const items=['words','grammar'].flatMap(kind=>(data[kind]||[]).map(d=>({kind,key:kind==='words'?d.word:d.id,data:d})));
    await savePersonalItems(items);await refresh();setJson('');setNote(`Imported ${items.length} personal items.`);
  }
  return <div className="pl-workspace">
    <section className="pl-form"><h3>Add and organise content</h3><div className="pl-row"><button className="wh-level-btn" disabled={busy} onClick={()=>setEditor({kind:'words',item:null,isNew:true})}>Write a word</button><button className="wh-level-btn" disabled={busy} onClick={()=>setEditor({kind:'grammar',item:blankGrammarRule(freshId(),category||'Grammar'),isNew:true})}>Write a grammar rule</button><button className="wh-back-btn" onClick={exportJson}>Export my content</button></div>
      <div className="pl-row"><label>Category<input value={category} onChange={e=>setCategory(e.target.value)} list="my-categories" placeholder="e.g. Gateway B1" maxLength={120}/></label><label>Units (comma-separated)<input value={units} onChange={e=>setUnits(e.target.value)} placeholder="e.g. Unit 4, Exam revision" maxLength={500}/></label></div><datalist id="my-categories">{categories.map(c=><option key={c} value={c}/>)}</datalist>
      <p>Type a new category or unit name to create it. A word or rule can belong to several units. Grouping changes only your library.</p>
      <button className="wh-level-btn" disabled={busy||!selected.length||(!category.trim()&&!units.trim())} onClick={()=>act(async()=>{await savePersonalItems(words.filter(w=>selected.includes(w.word)).map(w=>({kind:'words',key:w.word,data:groupContent(w,category,units)})));await refresh();setNote('Selected words organised.');})}>Apply groups to {selected.length} selected words</button>
      <label htmlFor="bulk-words">Bulk words · commas or one per line</label><textarea id="bulk-words" value={bulk} onChange={e=>setBulk(e.target.value)} placeholder="apple, put off, meticulous" rows={4} disabled={busy}/><div className="pl-row"><button className="wh-level-btn" disabled={busy||!bulk.trim()} onClick={()=>act(()=>batch())}>Add batch</button>{rows.some(r=>r.status==='failed'||r.status==='pending')&&<button className="wh-back-btn" disabled={busy} onClick={()=>act(()=>batch(true))}>Retry unfinished words</button>}</div><small>Up to 100 words. Existing entries are reused. AI requests run one at a time and use your account allowance. Category and units above apply to this batch.</small>
      {!!rows.length&&<ul className="pl-bulk-results" aria-live="polite">{rows.map(r=><li key={r.term}><b>{r.term}</b> · {r.status==='done'?'Ready':r.status==='working'?'Preparing…':r.status==='pending'?'Waiting':r.error}</li>)}</ul>}
    </section>
    <section className="pl-form"><h3>My grammar · {grammar.length}</h3><label htmlFor="grammar-topic">Find or prepare a grammar topic</label><div className="pl-row"><input id="grammar-topic" value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. present perfect" maxLength={160}/><button className="wh-back-btn" disabled={busy||!topic.trim()} onClick={()=>act(async()=>setMatches(await searchGrammar(topic)))}>Search library</button><button className="wh-level-btn" disabled={busy||!topic.trim()} onClick={()=>act(async()=>{const rule=await generatePersonalGrammar({topic});setEditor({kind:'grammar',item:groupContent({...rule,id:freshId()},category,units),isNew:true});})}>Prepare with AI</button></div><small>Review AI explanations and questions in the editor before saving.</small>
      {matches.map(r=><article className="pl-result" key={r.key}><div><b>{r.data.rule}</b><p>{r.data.explanation}</p></div><button className="wh-level-btn" disabled={busy||grammar.some(g=>g.id===r.key)} onClick={()=>act(()=>save('grammar',groupContent(r.data,category,units)))}>Add rule</button></article>)}
      {grammar.map(g=><article className="pl-result" key={g.id}><div><b>{g.rule}</b><p>{g.category} · {(g.units||[]).join(', ')}</p><small>{V2.grammarQuestions(g).length} questions</small></div><button className="wh-back-btn" disabled={busy} onClick={()=>setEditor({kind:'grammar',item:g,isNew:false})}>Edit rule</button></article>)}
    </section>
    <details className="pl-form"><summary>Import words and grammar as JSON</summary><p>Use the same content JSON format as the existing editor. Matching keys replace your personal version; the shared library stays unchanged.</p><textarea aria-label="Personal content JSON" rows={8} value={json} onChange={e=>setJson(e.target.value)} placeholder='{"schemaVersion":3,"kind":"content","words":[],"grammar":[]}'/><input aria-label="Load content JSON file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)act(async()=>{if(file.size>2000000)throw new Error('Choose a JSON file smaller than 2 MB.');setJson(await file.text());});}}/><button className="wh-level-btn" disabled={busy||!json.trim()} onClick={()=>act(importJson)}>Validate and import</button></details>
    {note&&<p role="status">{note}</p>}
    {editor&&<Suspense fallback={<p role="status">Opening editor…</p>}>{editor.kind==='words'?<WordEditor personal word={editor.item} content={content} onSave={w=>save('words',w)} onDelete={w=>remove('words',w)} onClose={()=>setEditor(null)} generateWord={async term=>(await addOrGenerateWord(term)).word}/>:<GrammarEditor personal rule={editor.item} isNew={editor.isNew} content={content} onSave={g=>save('grammar',g)} onDelete={g=>remove('grammar',g)} onDuplicate={g=>setEditor({kind:'grammar',item:{...g,id:freshId(),rule:`${g.rule} (copy)`},isNew:true})} onClose={()=>setEditor(null)} generateQuestions={questionAi} key={editor.item?.id}/>}</Suspense>}
  </div>;
}
