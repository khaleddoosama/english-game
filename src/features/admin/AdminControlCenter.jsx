import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { V2 } from "../../engine/v2";
import { IMAGE_LINKS, WordPicture, checkImageLink } from "../media/media";
import { confusionCount } from "../../engine/data";
import { askAiForWord, locateReportSource, suggestCategoryMerges, suggestReportFix } from "../../engine/ai";
import { ContentHealthPanel } from "./ContentHealthPanel";
import { GrammarPanel } from "./GrammarPanel";
import { importImageLink, uploadWordImage } from "../../lib/images";
import { pageWindow } from "./DataTable";
// Mini pager for the classic lists (the new admin tables use DataTable).
const CLASSIC_PAGE=40;
function MiniPager({page,total,onPage}){
  const pages=Math.max(1,Math.ceil(total/CLASSIC_PAGE));
  if(pages<=1)return null;
  return <nav className="adm-pager-nav classic" aria-label="Pages"><span>{(page-1)*CLASSIC_PAGE+1}–{Math.min(total,page*CLASSIC_PAGE)} of {total}</span>{pageWindow(page,pages).map((p,i)=>p==="…"?<span key={`e${i}`} className="adm-pager-gap">…</span>:<button key={p} className={p===page?"on":""} aria-current={p===page?"page":undefined} onClick={()=>onPage(p)}>{p}</button>)}</nav>;
}
// embedded: rendered inside the new AdminPanel (no own sidebar/header; the
// panel picks the tab). focus: open a word's editor or a report directly.
export function AdminControlCenter({content,mastery,confusions,reports,activeSession,sessionLogs,estimatedStorageBytes,settings,onUpdateSettings,onClearActiveSession,onUpdate,onResolveReport,onReviewReport,onRetireVariant,onDeleteReport,onOpenImport,onExport,onResetProgress,onWipeEverything,onMergeCategories,onRemoveEmptyLevels,onClose,embedded=false,tab:forcedTab=null,focus=null}){
  const [tabState,setTab]=useState("dashboard");
  const tab=forcedTab||tabState;
  const [contentPage,setContentPage]=useState(1);
  const [reportPage,setReportPage]=useState(1);
  const [entity,setEntity]=useState("words");
  const [pictureNote,setPictureNote]=useState(null);
  const [pictureLink,setPictureLink]=useState("");
  const [pictureLinkBusy,setPictureLinkBusy]=useState(false);
  const [query,setQuery]=useState("");
  const [editor,setEditor]=useState(null);
  const [draft,setDraft]=useState("");
  const [error,setError]=useState(null);
  const [editorBusy,setEditorBusy]=useState(false);
  const [deleteTarget,setDeleteTarget]=useState(null); // { index, warning } | null
  const [categoryFilter,setCategoryFilter]=useState("");
  const [categoryBrowse,setCategoryBrowse]=useState("");
  const [stubOnly,setStubOnly]=useState(false);
  const [bulkFixBusy,setBulkFixBusy]=useState(false);
  const [bulkFixProgress,setBulkFixProgress]=useState(null); // {done,total} | null
  const [bulkFixReport,setBulkFixReport]=useState(null); // {succeeded:[word...], failed:[{word,message}]} | null
  const [categoryMergeBusy,setCategoryMergeBusy]=useState(false);
  const [categoryMergeError,setCategoryMergeError]=useState(null);
  const [categoryMergeSuggestions,setCategoryMergeSuggestions]=useState(null); // [{canonical,duplicates}] | null
  const [appliedMerges,setAppliedMerges]=useState([]); // canonical names already applied this session
  const [expandedLogId,setExpandedLogId]=useState(null);
  const [expandedReportKey,setExpandedReportKey]=useState(null);
  const [confirmDeleteReport,setConfirmDeleteReport]=useState(null);
  const [reportFixBusy,setReportFixBusy]=useState(false);
  const [reportFixError,setReportFixError]=useState(null);
  const [reportFix,setReportFix]=useState(null); // {key, entity, before, after, changes} | null
  const [reviewAllProgress,setReviewAllProgress]=useState(null); // {done,total,failed} | null
  // Move-to-category: {entity:"words", ids:["Fork"]} for a single item, or
  // {entity:"grammar", ids:[...every id currently in the browsed category]} for a bulk move.
  // Works across every category-bearing entity (words, grammar, combos, challenges, stories, puns).
  const [moveTarget,setMoveTarget]=useState(null);
  const [moveInput,setMoveInput]=useState("");
  function commitMove(){
    const target=moveInput.trim();
    if(!target||!moveTarget)return;
    const {entity:moveEntity,ids}=moveTarget;
    const moveKey=entities[moveEntity].key;
    // A category only shows up as a playable level if it's registered in
    // LEVEL_ORDER — moving words into a brand-new name (not picked from the
    // existing list) would otherwise silently orphan them: real content
    // that never appears in any level. Register it first (LEVEL_ORDER is a
    // plain module variable, updated synchronously, so the words update
    // right after this always sees the new level already in place —
    // doing it in the other order would have the words update overwrite
    // itself with a stale pre-move word list, since React state updates
    // aren't visible to the very next line). Only words drive levels, so
    // this registration only applies when moving words.
    if(moveEntity==="words"&&!(content.levels||[]).some(level=>level.title===target)){
      onUpdate("levels",[...(content.levels||[]),{id:`cat-${target}`,title:target}]);
    }
    const nextList=(content[moveEntity]||[]).map(item=>ids.includes(item[moveKey])?{...item,category:target}:item);
    onUpdate(moveEntity,nextList);
    setMoveTarget(null);setMoveInput("");
  }
  const entities={words:{key:"word",label:"Words"},grammar:{key:"id",label:"Grammar"},stories:{key:"id",label:"Stories"},combos:{key:"id",label:"Combos"},challenges:{key:"id",label:"Challenges"},levels:{key:"title",label:"Levels"}};
  async function handleSuggestReportFix(report,key){
    setReportFixError(null);setReportFix(null);
    const source=locateReportSource(content,report);
    if(!source){setReportFixError("Couldn't find the source content for this report — it may already have been edited, moved, or deleted.");return;}
    setReportFixBusy(true);
    try{
      const result=await suggestReportFix(report,source.item,source.entity);
      setReportFix({key,entity:source.entity,before:source.item,after:result.fixed,changes:result.changes});
    }catch(e){
      setReportFixError(e.message||"AI couldn't suggest a fix. Try editing manually in Content Manager.");
    }finally{
      setReportFixBusy(false);
    }
  }
  // Loads the fix the AI drafted when the report was filed into the same
  // review/apply box the on-demand "Suggest fix" uses.
  function openStoredReportFix(report,key){
    const review=report.aiReview;
    const source=locateReportSource(content,report);
    if(!review?.fixed||!source){setReportFixError("The drafted fix no longer matches any content — ask AI for a fresh one.");return;}
    setReportFixError(null);
    setReportFix({key,entity:source.entity,before:source.item,after:review.fixed,changes:review.changes||[]});
  }
  // Triage every open report that hasn't had an AI review yet (e.g. filed
  // while offline or before this feature existed). One at a time, so a
  // long backlog doesn't fire dozens of parallel requests.
  async function reviewAllOpenReports(){
    const pending=reports.filter(r=>!r.resolvedAt&&!r.aiReview);
    if(!pending.length||!onReviewReport)return;
    let failed=0;
    setReviewAllProgress({done:0,total:pending.length,failed:0});
    for(let i=0;i<pending.length;i++){
      try{await onReviewReport(pending[i]);}catch{failed++;}
      setReviewAllProgress({done:i+1,total:pending.length,failed});
    }
  }
  function applyReportFix(report){
    if(!reportFix)return;
    const {entity,after}=reportFix;
    const key=entities[entity].key;
    const list=content[entity]||[];
    const next=list.map(x=>V2.norm(x[key])===V2.norm(after[key])?after:x);
    onUpdate(entity,next);
    onResolveReport(report);
    setReportFix(null);
  }
  const config=entities[entity], list=content[entity]||[];
  const categories=entity==="levels"?[]:[...new Set(list.map(item=>item.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const stubCount=entity==="words"?list.filter(w=>w._autoStub).length:0;
  const filtered=list.map((item,index)=>({item,index})).filter(({item})=>(!query||JSON.stringify(item).toLowerCase().includes(query.toLowerCase()))&&(!categoryFilter||item.category===categoryFilter)&&(!stubOnly||item._autoStub));
  useEffect(()=>{setContentPage(1);},[entity,query,categoryFilter,stubOnly]);
  // Open a specific word/item editor or report when the new panel asks for it.
  useEffect(()=>{
    if(!focus)return;
    if(focus.entity&&focus.create){
      setEntity(focus.entity);setCategoryFilter("");setCategoryBrowse("");setStubOnly(false);
      setPictureNote(null);setEditor({index:null,original:null});setDraft(JSON.stringify(defaultItem(focus.entity),null,2));setError(null);
    }
    else if(focus.entity&&focus.key!=null){
      const items=content[focus.entity]||[];const k=entities[focus.entity]?.key;
      const index=items.findIndex(it=>V2.norm(it[k])===V2.norm(focus.key));
      setEntity(focus.entity);setCategoryFilter("");setCategoryBrowse("");setStubOnly(false);
      if(index>=0){setPictureNote(null);setEditor({index,original:items[index]});setDraft(JSON.stringify(items[index],null,2));setError(null);}
    }
    if(focus.reportId){
      const ordered=reports.slice().reverse();
      const index=ordered.findIndex(r=>r.id===focus.reportId);
      if(index>=0){const r=ordered[index];setReportPage(Math.floor(index/CLASSIC_PAGE)+1);setExpandedReportKey(`${r.sessionId}-${r.questionId}-${index}`);}
    }
  },[focus]);
  // Cross-type category browser: every entity keeps its own category filter
  // above, but that only ever shows one type (words, OR grammar, OR
  // combos...) at a time. This groups everything tagged with one category
  // across all types in one place, so editing "this category" doesn't mean
  // hopping between tabs to find every related piece.
  const browsableEntities=["words","grammar","combos","challenges","stories"];
  const allCategories=[...new Set(browsableEntities.flatMap(id=>(content[id]||[]).map(item=>item.category)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const categoryGroups=categoryBrowse?browsableEntities.map(id=>({id,label:entities[id].label,items:(content[id]||[]).map((item,index)=>({item,index})).filter(({item})=>item.category===categoryBrowse)})).filter(g=>g.items.length):[];
  async function handleSuggestCategoryMerges(){
    setCategoryMergeError(null);setCategoryMergeBusy(true);
    try{
      const merges=await suggestCategoryMerges(allCategories);
      setCategoryMergeSuggestions(merges);setAppliedMerges([]);
    }catch(e){
      setCategoryMergeError(e.message||"AI couldn't analyze the categories. Try again.");
    }finally{
      setCategoryMergeBusy(false);
    }
  }
  // Same idea as commitMove but sweeps every duplicate name across every
  // category-bearing entity at once, since a fragmented category (e.g.
  // "Environment-Nature" vs "Environment & Nature") can have members
  // scattered across words, grammar, combos, challenges, stories and puns.
  function applyCategoryMerge(merge){
    onMergeCategories(merge.canonical,merge.duplicates);
    setAppliedMerges(prev=>[...prev,merge.canonical]);
  }
  const stages={New:0,Familiar:0,Learned:0,Mastered:0};
  content.words.forEach(word=>{stages[V2.stage(mastery[word.word])]++;});
  const attempts=Object.values(mastery).reduce((sum,item)=>sum+Number(item?.total||0),0);
  const correct=Object.values(mastery).reduce((sum,item)=>sum+Number(item?.correct||0),0);
  const weak=[...content.words].map(word=>({word,stats:mastery[word.word]||{}})).filter(x=>x.stats.total>0).sort((a,b)=>(a.stats.correct/Math.max(1,a.stats.total))-(b.stats.correct/Math.max(1,b.stats.total))).slice(0,12);
  const topConfusions=Object.entries(confusions||{}).map(([pair,value])=>({pair,count:confusionCount(value)})).sort((a,b)=>b.count-a.count).slice(0,12);
  const missing=content.words.filter(word=>!word.meaning||!word.situation||!word.gap||!word.hints?.length).length;
  function startEdit(item,index){setPictureNote(null);setEditor({index,original:item||null});setDraft(JSON.stringify(item||defaultItem(entity),null,2));setError(null);}
  function defaultItem(type){const id=`${type.slice(0,2)}-${Date.now()}`;if(type==="words")return {word:"",type:"vocab",category:"General",meaning:"",situation:"",gap:"______",hints:[]};if(type==="grammar")return {id,category:"Grammar",rule:"",prompt:"",options:["",""],answer:"",explanation:""};if(type==="levels")return {title:"New Level"};return {id,category:"General"};}
  function saveEdit(){
    try{
      const item=JSON.parse(draft), key=config.key, value=V2.norm(item[key]);
      if(!value)throw new Error(`Missing ${key}.`);
      if(/[\u0600-\u06FF]/.test(JSON.stringify(item)))throw new Error("Game content must be English only; Arabic text is not allowed.");
      if(list.some((existing,index)=>index!==editor.index&&V2.norm(existing[key])===value))throw new Error(`Duplicate ${key}.`);
      if(entity!=="levels"){
        const candidate={schemaVersion:2,kind:"content",[entity]:[item]};
        const issues=V2.validateContent(candidate,content);
        if(issues.length)throw new Error(issues[0]);
      }
      const next=[...list];if(editor.index===null)next.push(item);else next[editor.index]=item;
      onUpdate(entity,next);setEditor(null);setError(null);
    }catch(problem){setError(problem.message||"Invalid JSON.");}
  }
  async function fillWordWithAi(){
    try{setEditorBusy(true);setError(null);const current=JSON.parse(draft);if(!current.word)throw new Error("Enter the word first.");const generated=await askAiForWord(current.word,current);const patch={type:generated.type,category:generated.category,meaning:generated.meaning,situation:generated.situation,gap:generated.gap,hints:generated.hints,...(generated.commonMistake?{commonMistake:generated.commonMistake}:{})};setDraft(JSON.stringify({...current,...patch},null,2));}catch(problem){setError(problem.message||"AI generation failed.");}finally{setEditorBusy(false);}
  }
  // Same idea as fillWordWithAi, but for every "_autoStub" word at once —
  // words auto-created from a dangling reference during import (see
  // healMissingWordRefs/healOpposites) that only ever got a placeholder
  // meaning. Runs sequentially (not in parallel) so one bad AI response
  // can't corrupt a batch write, and so progress can be shown honestly.
  async function handleBulkFixStubs(){
    const stubs=(content.words||[]).filter(w=>w._autoStub);
    if(!stubs.length||bulkFixBusy)return;
    setBulkFixBusy(true);setBulkFixReport(null);setBulkFixProgress({done:0,total:stubs.length});
    const succeeded=[],failed=[];
    let nextWords=[...content.words];
    for(const stub of stubs){
      try{
        const generated=await askAiForWord(stub.word,stub);
        const patch={type:generated.type,category:generated.category,meaning:generated.meaning,situation:generated.situation,gap:generated.gap,hints:generated.hints,...(generated.commonMistake?{commonMistake:generated.commonMistake}:{})};
        const updated={...stub,...patch};delete updated._autoStub;
        if(/[\u0600-\u06FF]/.test(JSON.stringify(updated)))throw new Error("Generated content contained non-English text.");
        const issues=V2.validateContent({schemaVersion:2,kind:"content",words:[updated]},content);
        if(issues.length)throw new Error(issues[0]);
        nextWords=nextWords.map(w=>w.word===stub.word?updated:w);
        succeeded.push(stub.word);
      }catch(e){
        failed.push({word:stub.word,message:e.message||"AI generation failed."});
      }
      setBulkFixProgress(p=>({done:(p?.done||0)+1,total:stubs.length}));
    }
    if(succeeded.length)onUpdate("words",nextWords);
    setBulkFixReport({succeeded,failed});
    setBulkFixBusy(false);setBulkFixProgress(null);
  }
  function remove(index){const warning=entity==="levels"?"Delete this level and all content assigned to it? Progress records remain in the backup.":`Delete this ${config.label.slice(0,-1).toLowerCase()}? Its learning history will be preserved but detached.`;setDeleteTarget({index,warning});}
  function confirmRemove(){if(!deleteTarget)return;onUpdate(entity,list.filter((_,i)=>i!==deleteTarget.index));setDeleteTarget(null);}
  return <section className={`wh-admin-shell${embedded?" embedded":""}`}>
    {!embedded&&<aside className="wh-admin-side"><div className="wh-admin-brand"><span>WH</span><div><b>CONTROL CENTER</b><small>Content &amp; Learning</small></div></div>{[["dashboard","Dashboard"],["content","Content Manager"],["grammar","Grammar"],["reports","Question Reports"],["health","Content Health"],["progress","Learning Progress"],["settings","Settings"],["data","Data Center"]].map(([id,label])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}<button onClick={onClose}>← Play Mode</button></aside>}
    <main className="wh-admin-main">
      {!embedded&&<header className="wh-admin-top"><div><small>WORD HUNTER V7</small><h2>{tab==="dashboard"?"Command Dashboard":tab==="content"?"Content Manager":tab==="grammar"?"Grammar Rules":tab==="reports"?"Question Reports":tab==="health"?"Content Health":tab==="progress"?"Learning Progress":tab==="settings"?"Settings":"Data Center"}</h2></div><button className="wh-back-btn" onClick={onClose}>Close Admin</button></header>}
      {tab==="dashboard"&&<><div className="wh-admin-kpis">{[[content.words.length,"Words"],[attempts,"Attempts"],[correct?Math.round(correct/Math.max(1,attempts)*100)+"%":"—","Accuracy"],[reports.filter(x=>!x.resolvedAt).length,"Open reports"],[missing,"Needs content"],[content.words.filter(w=>w._aiAdded).length,"AI-added"]].map(([value,label])=><article key={label}><b>{value}</b><span>{label}</span></article>)}</div><div className="wh-admin-grid"><article className="wh-admin-card"><h3>Mastery distribution</h3>{Object.entries(stages).map(([name,value])=><div className="wh-admin-meter" key={name}><span>{name}</span><i style={{width:`${content.words.length?value/content.words.length*100:0}%`}}/><b>{value}</b></div>)}</article><article className="wh-admin-card"><h3>Library health</h3><p>{content.grammar.length} grammar rules · {content.grammar.reduce((n,g)=>n+V2.grammarQuestions(g).length,0)} questions</p><p>{content.stories.length} stories · {content.combos.length} combos</p><p>{content.challenges.length} authored challenges</p><p>{new Set(content.words.map(w=>V2.topic(w.category))).size} levels/categories</p></article></div></>}
      {tab==="content"&&<><div className="wh-admin-toolbar"><div className="wh-admin-entities">{Object.entries(entities).map(([id,item])=><button key={id} className={entity===id?"active":""} onClick={()=>{setEntity(id);setEditor(null);setCategoryFilter("");setCategoryBrowse("");setStubOnly(false);}}>{item.label} <span>{content[id]?.length||0}</span></button>)}</div>{categories.length>0&&<select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{categories.map(cat=><option key={cat} value={cat}>{cat}</option>)}</select>}<select value={categoryBrowse} onChange={e=>{setCategoryBrowse(e.target.value);setEditor(null);}} title="Show every word, grammar item, combo, challenge and story for one category, across all types"><option value="">Browse a category (all types)…</option>{allCategories.map(cat=><option key={cat} value={cat}>{cat}</option>)}</select><button className="wh-import-btn primary" disabled={categoryMergeBusy} onClick={handleSuggestCategoryMerges}><Sparkles size={13}/> {categoryMergeBusy?"Analyzing…":"Suggest category cleanup"}</button>{entity!=="levels"&&categoryFilter&&filtered.length>0&&<button onClick={()=>{setMoveTarget({entity,ids:filtered.map(({item})=>item[config.key])});setMoveInput("");}}>Move all {filtered.length} in "{categoryFilter}" to…</button>}{entity==="words"&&stubCount>0&&<label className="wh-admin-stub-toggle"><input type="checkbox" checked={stubOnly} onChange={e=>setStubOnly(e.target.checked)}/> Needs content only ({stubCount})</label>}{entity==="words"&&stubCount>0&&<button className="wh-import-btn primary" disabled={bulkFixBusy} onClick={handleBulkFixStubs}><Sparkles size={13}/> {bulkFixBusy?`Fixing ${bulkFixProgress?.done||0}/${bulkFixProgress?.total||stubCount}…`:`Fill ${stubCount} with AI`}</button>}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`Search ${config.label.toLowerCase()}…`}/><button className="primary" onClick={()=>startEdit(null,null)}>+ Add</button></div>{bulkFixReport&&<div className="wh-import-hint"><b>AI content fill: {bulkFixReport.succeeded.length} filled, {bulkFixReport.failed.length} failed.</b>{bulkFixReport.failed.length>0&&<ul>{bulkFixReport.failed.map((f,i)=><li key={i}>{f.word}: {f.message}</li>)}</ul>}<div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>setBulkFixReport(null)}>Dismiss</button></div></div>}{categoryMergeError&&<div className="wh-import-error">{categoryMergeError}</div>}{categoryMergeSuggestions&&<div className="wh-import-hint"><b>Suggested category merges:</b>{!categoryMergeSuggestions.length?<p>No confident duplicates found.</p>:categoryMergeSuggestions.map((m,i)=><div className="wh-admin-browse-row" key={i}><span><b>{m.canonical}</b><small>absorbs: {m.duplicates.join(", ")}</small></span><span>{appliedMerges.includes(m.canonical)?<i>Merged</i>:<button className="wh-import-btn primary" onClick={()=>applyCategoryMerge(m)}>Merge</button>}</span></div>)}<div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>{setCategoryMergeSuggestions(null);setAppliedMerges([]);}}>Dismiss</button></div></div>}{editor?<div className="wh-admin-editor"><div className="wh-admin-editor-head"><h3>{editor.index===null?`Add ${config.label}`:`Edit ${editor.original?.[config.key]}`}</h3><button onClick={()=>setEditor(null)}>Cancel</button></div><p>Edit every supported field as structured JSON. IDs and word labels are stable progress keys.</p>{entity==="words"&&(()=>{let current=null;try{current=JSON.parse(draft);}catch{}const hasPicture=current&&(current.image||current.illustration);return hasPicture?<div className="wh-admin-picture"><WordPicture word={current} className="wh-admin-picture-img"/><div>{pictureNote&&<small>{pictureNote}</small>}{current.image&&<button onClick={()=>{const {image,...rest}=current;setDraft(JSON.stringify(rest,null,2));setPictureNote(current.illustration?"Picture removed — the drawing will show instead.":"Picture removed.");}}>Remove picture</button>}</div></div>:null;})()}<textarea value={draft} onChange={e=>setDraft(e.target.value)} spellCheck={false}/>{error&&<div className="wh-import-error">{error}</div>}<div className="wh-ai-actions"><button className="primary" onClick={saveEdit}>Validate &amp; Save</button>{entity==="words"&&<button disabled={editorBusy} onClick={fillWordWithAi}>{editorBusy?"Generating…":"Fill fields with AI"}</button>}{entity==="words"&&<label className="wh-admin-file-btn">Add picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;try{const current=JSON.parse(draft);setPictureNote("Uploading…");const image=await uploadWordImage(file);setDraft(JSON.stringify({...current,image},null,2));setError(null);setPictureNote("Picture uploaded (resized to WebP). Press Validate & Save to keep it.");}catch(problem){setError(problem instanceof SyntaxError?"Fix the JSON first, then add the picture.":problem.message);}}}/></label>}<button onClick={()=>{try{setDraft(JSON.stringify(JSON.parse(draft),null,2));setError(null);}catch{setError("Invalid JSON.");}}}>Format JSON</button></div>{entity==="words"&&<div className="wh-admin-link"><input value={pictureLink} onChange={e=>setPictureLink(e.target.value)} placeholder="…or paste a picture link (https://…)"/><button disabled={pictureLinkBusy||!pictureLink.trim()} onClick={async()=>{const url=pictureLink.trim();let current;try{current=JSON.parse(draft);}catch{setError("Fix the JSON first, then add the link.");return;}if(!/^https?:\/\/\S+$/i.test(url)){setError("The link must start with http:// or https://");return;}setPictureLinkBusy(true);setError(null);try{const copy=await importImageLink(url);setPictureLinkBusy(false);setDraft(JSON.stringify({...current,image:copy},null,2));setPictureLink("");setPictureNote("Picture copied into your storage, so the link can't break. Press Validate & Save to keep it.");return;}catch(copyProblem){console.warn("Copy failed, checking the link itself:",copyProblem.message);}IMAGE_LINKS.delete(url);const ok=await checkImageLink(url);setPictureLinkBusy(false);if(!ok){setPictureNote(null);setError("This link didn't load here (broken, not a direct image link, or the site blocks it). Try the image's own address — right-click the picture → Copy image address.");return;}setDraft(JSON.stringify({...current,image:url},null,2));setPictureLink("");setPictureNote("Couldn't copy it, but the link itself works. Press Validate & Save to keep it.");}}>{pictureLinkBusy?"Checking…":"Use link"}</button></div>}</div>:categoryBrowse?<div className="wh-admin-category-browse"><div className="wh-admin-category-browse-head"><h3>Everything in "{categoryBrowse}"</h3><button onClick={()=>setCategoryBrowse("")}>✕ Clear</button></div>{!categoryGroups.length?<p>Nothing tagged with this category yet.</p>:categoryGroups.map(group=><div className="wh-admin-card" key={group.id}><h4>{group.label} <span>{group.items.length}</span><button onClick={()=>{setMoveTarget({entity:group.id,ids:group.items.map(({item})=>item[entities[group.id].key])});setMoveInput("");}}>Move all {group.items.length} to…</button></h4>{group.items.map(({item,index})=><div className="wh-admin-browse-row" key={item[entities[group.id].key]||index}><span><b>{item[entities[group.id].key]}</b><small>{item.meaning||item.title||item.rule||item.prompt||""}</small></span><span><button onClick={()=>{setEntity(group.id);setCategoryFilter("");startEdit(item,index);}}>Edit</button><button onClick={()=>{setMoveTarget({entity:group.id,ids:[item[entities[group.id].key]]});setMoveInput("");}}>Move</button></span></div>)}</div>)}</div>:<div className="wh-admin-table"><MiniPager page={contentPage} total={filtered.length} onPage={setContentPage}/><div className="wh-admin-row head"><span>Item</span><span>Category / Type</span><span>Status</span><span>Actions</span></div>{filtered.slice((contentPage-1)*CLASSIC_PAGE,contentPage*CLASSIC_PAGE).map(({item,index})=>{const rec=entity==="words"?mastery[item.word]:null;const modesCount=rec?Object.values(rec.modes||{}).filter(m=>m.correct>0).length:0;return <div className="wh-admin-row" key={item[config.key]||index}><span><b>{item[config.key]}</b><small>{item.meaning||item.title||item.rule||item.prompt||""}</small></span><span>{entity==="levels"?`${content.words.filter(word=>V2.topic(word.category)===V2.topic(item.title)).length} words`:item.category||item.type||"—"}</span><span>{item._autoStub?<span className="wh-stub-badge" title="Auto-created from a missing reference during import — needs real content">⚠ Needs content</span>:entity==="words"?<span className="wh-status-stack"><b>{V2.stage(rec)}</b><small>{rec?.correct||0}/{rec?.total||0} · {modesCount} mode{modesCount===1?"":"s"}{item._aiAdded?" · AI-added":""}</small></span>:"Ready"}</span><span><button onClick={()=>startEdit(item,index)}>Edit</button>{entity!=="levels"&&<button onClick={()=>{setMoveTarget({entity,ids:[item[config.key]]});setMoveInput("");}}>Move</button>}<button className="danger" onClick={()=>remove(index)}>Delete</button></span></div>;})}</div>}</>}
      {tab==="grammar"&&<GrammarPanel content={content} mastery={mastery} onUpdate={onUpdate}/>}
      {tab==="health"&&<ContentHealthPanel content={content} onUpdate={onUpdate} onMergeCategories={onMergeCategories} onRemoveEmptyLevels={onRemoveEmptyLevels}/>}
      {tab==="reports"&&<div className="wh-admin-card"><div className="wh-admin-editor-head"><h3>Reported questions</h3><button disabled={!reports.length} onClick={()=>{
        // Download every report (open and resolved) with its AI review, as JSON.
        const blob=new Blob([JSON.stringify({kind:"word-hunter-reports",exportedAt:new Date().toISOString(),count:reports.length,reports},null,2)],{type:"application/json"});
        const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`word-hunter-reports-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
      }}>Export reports ({reports.length})</button></div><p>An open report keeps that exact word + question type out of future sessions automatically. Resolving or retiring it lifts that block. AI checks each report when it's filed and drafts a fix when the question is really flawed.</p>{(()=>{const unreviewed=reports.filter(r=>!r.resolvedAt&&!r.aiReview).length;const busy=reviewAllProgress&&reviewAllProgress.done<reviewAllProgress.total;return (unreviewed>0||reviewAllProgress)&&<div className="wh-import-actions">{unreviewed>0&&<button className="wh-import-btn primary" disabled={busy} onClick={reviewAllOpenReports}><Sparkles size={13}/> {busy?`AI reviewing… ${reviewAllProgress.done}/${reviewAllProgress.total}`:`AI review open reports (${unreviewed})`}</button>}{reviewAllProgress&&!busy&&<small>Reviewed {reviewAllProgress.total-reviewAllProgress.failed}/{reviewAllProgress.total}{reviewAllProgress.failed?` · ${reviewAllProgress.failed} failed — try again`:""}</small>}</div>;})()}<MiniPager page={reportPage} total={reports.length} onPage={setReportPage}/>{!reports.length?<p>No questions have been reported.</p>:reports.slice().reverse().slice((reportPage-1)*CLASSIC_PAGE,reportPage*CLASSIC_PAGE).map((report,pageIndex)=>{const index=(reportPage-1)*CLASSIC_PAGE+pageIndex;const key=`${report.sessionId}-${report.questionId}-${index}`;const isOpen=expandedReportKey===key;return <article className="wh-admin-report" key={key}><div><button className="wh-admin-log-row" onClick={()=>{const next=isOpen?null:key;setExpandedReportKey(next);setReportFix(null);setReportFixError(null);}}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<b>{report.prompt||report.questionId}</b></button><small>{report.mode||"question"} · {(report.targetWords||[]).join(", ")||"no target"} · {new Date(report.at).toLocaleString()}{report._from?` · from ${report._from}`:""}</small>{report.reason&&<small><i>Reason: {report.reason}</i></small>}{report.details&&<small><i>Learner wrote: {report.details}</i></small>}{report.learnerAnswer!=null&&report.learnerAnswer!==''&&<small><i>Their answer: {Array.isArray(report.learnerAnswer)?report.learnerAnswer.join(' + '):String(report.learnerAnswer)}</i></small>}{report.aiReview&&<small className={`wh-report-ai ${report.aiReview.verdict}`}><Sparkles size={11}/> AI: {report.aiReview.verdict==='flawed'?'real problem':report.aiReview.verdict==='repeated'?'repetition complaint':report.aiReview.verdict==='fine'?'question looks OK':'unsure'} ({report.aiReview.confidence}){report.aiReview.fixed?' · fix drafted':''}</small>}{isOpen&&<div className="wh-admin-log-detail"><p><b>Question ID:</b> {report.questionId}</p><p><b>Session:</b> {report.sessionId}</p>{report.options?.length>0&&<p><b>Options shown:</b> {report.options.join(" / ")}</p>}{report.answers?.length>0&&<p><b>Correct answer(s):</b> {report.answers.join(", ")}</p>}{report.poolType&&<p><b>Pool:</b> {report.poolType} / {report.poolItemId}</p>}{report.learnerAnswer!=null&&<p><b>Learner answered:</b> {Array.isArray(report.learnerAnswer)?report.learnerAnswer.join(" + "):String(report.learnerAnswer)}{report.aiReview?.learnerAnswerAcceptable!=null&&` (AI: ${report.aiReview.learnerAnswerAcceptable?'acceptable':'not acceptable'})`}</p>}{report.aiReview&&<div className="wh-import-hint"><b><Sparkles size={12}/> AI review: {report.aiReview.verdict}</b>{report.aiReview.adminNote&&<p>{report.aiReview.adminNote}</p>}{report.aiReview.explanation&&<p><small>Told the learner: {report.aiReview.explanation}</small></p>}</div>}<p>{report.resolvedAt?`Resolved ${new Date(report.resolvedAt).toLocaleString()} — no longer blocked.`:"Currently blocked from future sessions for this word + question type."}</p>{!report.resolvedAt&&<><div className="wh-import-actions">{report.aiReview?.fixed&&<button className="wh-import-btn primary" onClick={()=>openStoredReportFix(report,key)}><Sparkles size={13}/> Review drafted fix</button>}<button className={`wh-import-btn ${report.aiReview?.fixed?"secondary":"primary"}`} disabled={reportFixBusy} onClick={()=>handleSuggestReportFix(report,key)}><Sparkles size={13}/> {reportFixBusy?"Asking AI…":report.aiReview?.fixed?"Ask AI for a new fix":"Suggest fix with AI"}</button></div>{reportFixError&&<div className="wh-import-error">{reportFixError}</div>}{reportFix&&reportFix.key===key&&<div className="wh-import-hint"><b>AI suggests these changes to the {entities[reportFix.entity].label.slice(0,-1).toLowerCase()}:</b><ul>{reportFix.changes.map((c,i)=><li key={i}>{c}</li>)}</ul><textarea className="wh-import-textarea" value={JSON.stringify(reportFix.after,null,2)} readOnly rows={6}/><div className="wh-import-actions"><button className="wh-import-btn secondary" onClick={()=>setReportFix(null)}>Discard</button><button className="wh-import-btn primary" onClick={()=>applyReportFix(report)}>Apply fix &amp; resolve</button></div></div>}</>}</div>}</div><span className={report.resolvedAt?"resolved":"open"}>{report.resolvedAt?"Resolved":"Open"}</span><div>{!report.resolvedAt&&report.poolItemId&&<button onClick={()=>onRetireVariant(report)}>Retire variant</button>}{!report.resolvedAt&&<button onClick={()=>onResolveReport(report)}>Resolve</button>}<button onClick={()=>setConfirmDeleteReport(report)}>Delete</button></div></article>;})}</div>}
      {confirmDeleteReport&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmDeleteReport(null);}}><div className="wh-panel wh-confirm-panel" role="alertdialog"><p><b>Delete this report?</b></p><p>This only removes the report record. If it's still open, this also lifts the block on that word + question type — it can be selected again.</p><div className="wh-ai-actions"><button onClick={()=>setConfirmDeleteReport(null)}>Cancel</button><button className="primary" onClick={()=>{onDeleteReport(confirmDeleteReport);setConfirmDeleteReport(null);}}>Yes, delete</button></div></div></div>}
      {moveTarget&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget){setMoveTarget(null);setMoveInput("");}}}><div className="wh-panel wh-confirm-panel" role="alertdialog"><p><b>Move {moveTarget.ids.length>1?`${moveTarget.ids.length} ${entities[moveTarget.entity].label.toLowerCase()}`:`"${moveTarget.ids[0]}"`} to another category</b></p><p>{moveTarget.ids.length>1?"Every item listed keeps its content — only the category changes.":"Only the category changes; nothing else about this item is touched."}</p><input list="wh-category-options" value={moveInput} onChange={e=>setMoveInput(e.target.value)} placeholder="Pick an existing category or type a new one" style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",font:"12px 'IBM Plex Mono',monospace"}}/><datalist id="wh-category-options">{allCategories.map(cat=><option key={cat} value={cat}/>)}</datalist><div className="wh-ai-actions"><button onClick={()=>{setMoveTarget(null);setMoveInput("");}}>Cancel</button><button className="primary" disabled={!moveInput.trim()} onClick={commitMove}>Move</button></div></div></div>}
      {tab==="settings"&&<div className="wh-admin-card"><h3>Round &amp; question settings</h3><p>Changes apply the next time you start a session.</p>
        <label className="wh-settings-row"><span>Questions per round (Level Practice)</span><input type="number" min="4" max="30" value={settings.questionsPerRound} onChange={e=>onUpdateSettings({...settings,questionsPerRound:Math.max(4,Math.min(30,Number(e.target.value)||12))})}/></label>
        <label className="wh-settings-row"><span>New words introduced per round</span><input type="number" min="0" max="10" value={settings.newWordsPerRound} onChange={e=>onUpdateSettings({...settings,newWordsPerRound:Math.max(0,Math.min(10,Number(e.target.value)||0))})}/></label>
        <label className="wh-settings-row wh-settings-toggle"><input type="checkbox" checked={settings.enablePairModes} onChange={e=>onUpdateSettings({...settings,enablePairModes:e.target.checked})}/><span>Enable "pick two" pair questions (twopeople / selecttwo) in Practice and Weak Review</span></label>
        <label className="wh-settings-row"><span>Daily goal (questions per day)</span><input type="number" min="5" max="100" value={settings.dailyGoal} onChange={e=>onUpdateSettings({...settings,dailyGoal:Math.max(5,Math.min(100,Number(e.target.value)||20))})}/></label>
        <label className="wh-settings-row wh-settings-toggle"><input type="checkbox" checked={settings.sound} onChange={e=>onUpdateSettings({...settings,sound:e.target.checked})}/><span>Sound effects for correct and wrong answers</span></label>
      </div>}
      {tab==="progress"&&<div className="wh-admin-grid"><article className="wh-admin-card"><h3>Weakest practiced words</h3>{weak.map(({word,stats})=><p key={word.word}><b>{word.word}</b> — {stats.correct||0}/{stats.total||0} · {V2.stage(stats)}</p>)}</article><article className="wh-admin-card"><h3>Top confusions</h3>{!topConfusions.length?<p>No confusion pairs recorded yet.</p>:topConfusions.map(item=><p key={item.pair}><b>{item.pair.replace("|"," ↔ ")}</b> — {item.count}</p>)}</article></div>}
      {tab==="data"&&<div className="wh-admin-grid"><article className="wh-admin-card"><h3>Import &amp; restore</h3><p>Validate content or a full backup before applying it. Existing progress keys remain attached.</p><button className="primary" onClick={onOpenImport}>Open Import Center</button></article><article className="wh-admin-card"><h3>Export</h3><p>Create a content-only handoff or a complete safety backup.</p><p className={`wh-storage-gauge ${estimatedStorageBytes>4*1024*1024?"danger":estimatedStorageBytes>2*1024*1024?"warn":""}`}>Saved progress size: ~{(estimatedStorageBytes/1024/1024).toFixed(2)} MB (storage limit: 5 MB per key)</p><div className="wh-ai-actions"><button onClick={()=>onExport("content")}>Export Content</button><button className="primary" onClick={()=>onExport("backup")}>Full Backup</button></div></article><article className="wh-admin-card"><h3>Danger zone</h3><p>Take a Full Backup first. Reset clears progress but keeps your content; Clear everything deletes both.</p><div className="wh-ai-actions"><button onClick={onResetProgress}>Reset progress</button><button className="danger" onClick={onWipeEverything}>Clear everything</button></div></article><article className="wh-admin-card"><h3>Active session</h3>{activeSession&&!activeSession.completed?<><p><b>{activeSession.kind==="story"?activeSession.title:activeSession.title||activeSession.kind}</b> · {activeSession.kind} · in progress</p><p>{Math.min(activeSession.index+1,activeSession.queue?.length||0)} / {activeSession.queue?.length||0} questions · {(activeSession.answers||[]).filter(a=>a?.correct).length} correct so far</p><p>Started as: <code>{activeSession.id}</code></p><button className="danger" onClick={onClearActiveSession}>Clear stuck session</button></>:activeSession&&activeSession.completed?<><p><b>{activeSession.title||activeSession.kind}</b> · {activeSession.kind} · last session, finished</p><p>{(activeSession.answers||[]).filter(a=>a?.correct).length} / {activeSession.queue?.length||0} correct — results already saved to progress.</p><button onClick={onClearActiveSession}>Clear from here</button></>:<p>No session started yet — the player is on the level list.</p>}{activeSession?.queue?.length>0&&<div className="wh-admin-session-questions">{activeSession.queue.map((q,i)=>{const a=activeSession.answers?.[i];return <div key={q.id||i} className={`wh-admin-session-q ${a?(a.correct?"ok":"bad"):"pending"}`}><b>{i+1}. {q.prompt}</b><span>Given: {a?(Array.isArray(a.value)?a.value.join(" + "):a.value||(a.reported?"Reported/skipped":"—")):"—"}</span><span>Correct: {(q.answers||[]).join(" + ")}</span></div>;})}</div>}</article><article className="wh-admin-card"><h3>Session log</h3><p>Last {sessionLogs.length} completed session{sessionLogs.length===1?"":"s"} (kept up to 50 — summary only, not every question).</p>{sessionLogs.length?<div className="wh-admin-session-questions">{sessionLogs.map(entry=>{const isOpen=expandedLogId===entry.id;const liveDetail=activeSession&&activeSession.id===entry.id&&activeSession.queue?.length?activeSession:null;return <div key={entry.id}><button className={`wh-admin-session-q wh-admin-log-row ${entry.total?(entry.correct/entry.total>=0.7?"ok":"bad"):"pending"}`} onClick={()=>setExpandedLogId(isOpen?null:entry.id)}>{isOpen?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<span className="wh-admin-log-main"><b>{entry.title}</b><span>{entry.kind} · {entry.correct}/{entry.total} correct</span><span>{new Date(entry.at).toLocaleString()}</span></span></button>{isOpen&&(liveDetail?<div className="wh-admin-session-questions wh-admin-log-detail">{liveDetail.queue.map((q,i)=>{const a=liveDetail.answers?.[i];return <div key={q.id||i} className={`wh-admin-session-q ${a?(a.correct?"ok":"bad"):"pending"}`}><b>{i+1}. {q.prompt}</b><span>Given: {a?(Array.isArray(a.value)?a.value.join(" + "):a.value||(a.reported?"Reported/skipped":"—")):"—"}</span><span>Correct: {(q.answers||[]).join(" + ")}</span></div>;})}</div>:<p className="wh-admin-log-detail wh-admin-log-empty">Per-question detail wasn't kept for this session — only the most recently completed session keeps its full question breakdown (see "Active session" above while it's still the latest).</p>)}</div>;})}</div>:<p>No completed sessions logged yet.</p>}</article></div>}
    </main>
    {deleteTarget && (
      <div className="wh-modal-overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)setDeleteTarget(null);}}>
        <div className="wh-panel wh-confirm-panel" role="alertdialog">
          <p>{deleteTarget.warning}</p>
          <div className="wh-regen-actions">
            <button className="wh-level-btn wh-danger-btn" onClick={confirmRemove}>Yes, delete</button>
            <button className="wh-back-btn wh-nav-btn" onClick={()=>setDeleteTarget(null)}>Cancel</button>
          </div>
        </div>
      </div>
    )}
  </section>;
}
