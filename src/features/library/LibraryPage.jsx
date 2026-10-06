import { useEffect, useRef, useState } from 'react';
import { addOrGenerateWord, chooseWords, removeWord, searchCatalogue } from './libraryApi';
import { loadFriends, shareWords } from '../social/friendsApi';
import '../../styles/library.css';
import PersonalWorkspace from './PersonalWorkspace';

export default function LibraryPage({ userId, words, grammar = [], onChanged, local = false }) {
  const [term,setTerm] = useState(''), [results,setResults] = useState([]);
  const [busy,setBusy] = useState(false), [searching,setSearching] = useState(false);
  const [error,setError] = useState(''), [message,setMessage] = useState('');
  const [selected,setSelected] = useState([]), [friends,setFriends] = useState([]), [recipient,setRecipient] = useState('');
  const [filter,setFilter] = useState(''), [editor,setEditor] = useState(null), [categoryFilter,setCategoryFilter] = useState(''), [unitFilter,setUnitFilter] = useState('');
  const sequence = useRef(0);
  const own = new Set(words.map(w=>w.word));
  useEffect(()=>{
    let active = true;
    loadFriends(userId).then(d=>{if(active)setFriends(d.friends);}).catch(()=>{});
    return ()=>{active=false;};
  },[userId]);
  useEffect(()=>{
    const seq = ++sequence.current;
    if(!term.trim() || local) {setResults([]);setSearching(false);return;}
    setSearching(true);
    const timer = setTimeout(()=>searchCatalogue(term).then(rows=>{if(sequence.current===seq)setResults(rows);}).catch(e=>{if(sequence.current===seq){setResults([]);setError(e.message);}}).finally(()=>{if(sequence.current===seq)setSearching(false);}),300);
    return ()=>{clearTimeout(timer);sequence.current++;};
  },[term,local]);
  async function act(fn) {
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try { await fn(); } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function add(key) {await chooseWords(userId,[key]);await onChanged();setMessage(`${key} is ready to practise.`);}
  async function generate(e) {
    e.preventDefault();
    await act(async()=>{
      const result = await addOrGenerateWord(term);
      await onChanged();setTerm('');setResults([]);
      setMessage(result.created ? `${result.word.word} was checked and added. Open its details below.` : `${result.word.word} was already available and is ready to practise.`);
    });
  }
  const visible = words.filter(w=>(!categoryFilter||w.category===categoryFilter)&&(!unitFilter||(w.units||[]).includes(unitFilter))).filter(w=>`${w.word} ${w.meaning} ${w.category}`.toLowerCase().includes(filter.toLowerCase()));
  const shareKeys = selected.filter(k=>own.has(k));
  return <section className="pl-page">
    <header><p className="lv-kicker">Your learning, your words</p><h2>My words</h2><p>Choose what you want to practise. Your progress stays saved when you remove a word.</p></header>
    {local ? <p>Sign in on the online version to choose words, generate content and share with friends.</p> : <form className="pl-form" onSubmit={generate}>
      <label htmlFor="word-search">Find a word or phrase</label>
      <div className="pl-row"><input id="word-search" value={term} onChange={e=>{setTerm(e.target.value);setError('');}} placeholder="e.g. meticulous or put off" maxLength={80} autoComplete="off" /><button className="wh-level-btn" disabled={busy || !term.trim()}>{busy?'Adding…':'Add to my words'}</button></div>
      <small>Existing words are available immediately. Missing words are written and checked by AI. Edit and organise your personal version below.</small>
    </form>}
    {error && <p className="pl-error" role="alert">{error}</p>}
    {(busy || message) && <p role="status">{busy?'Checking the library and preparing your word…':message}</p>}
    {term.trim() && <section aria-label="Search results"><h3>Library matches</h3>{searching?<p role="status">Searching…</p>:results.length?results.map(r=><article className="pl-result" key={r.key}><div><b>{r.data.word}</b><p>{r.data.meaning}</p><small>{r.data.level} · {r.data.category}</small></div><button className="wh-level-btn" disabled={busy||own.has(r.key)} onClick={()=>act(()=>add(r.key))}>{own.has(r.key)?'Added':'Add'}</button></article>):<p>No matches yet. Add this word to let AI prepare its learning content.</p>}</section>}
    {!local && <PersonalWorkspace words={words} grammar={grammar} selected={shareKeys} busy={busy} act={act} onChanged={onChanged} editor={editor} setEditor={setEditor}/>}
    <div className="pl-row"><select aria-label="Filter by category" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">All categories</option>{[...new Set(words.map(w=>w.category).filter(Boolean))].map(c=><option key={c}>{c}</option>)}</select><select aria-label="Filter by unit" value={unitFilter} onChange={e=>setUnitFilter(e.target.value)}><option value="">All units</option>{[...new Set(words.flatMap(w=>w.units||[]))].map(u=><option key={u}>{u}</option>)}</select></div>
    <div className="pl-row"><h3>My library · {words.length}</h3><input aria-label="Filter my words" placeholder="Filter my words" value={filter} onChange={e=>setFilter(e.target.value)} /></div>
    {!words.length && <div className="pl-empty"><h3>Start with the words you are learning</h3><p>Search above and add your first word. Your practice sessions will use your selection.</p></div>}
    {visible.length > 0 && <label className="pl-check"><input type="checkbox" checked={visible.every(w=>shareKeys.includes(w.word))} onChange={e=>setSelected(e.target.checked?[...new Set([...shareKeys,...visible.map(w=>w.word)])]:shareKeys.filter(k=>!visible.some(w=>w.word===k)))} />Select visible words to organise or share</label>}
    {shareKeys.length>0 && <div className="pl-share-bar"><b>{shareKeys.length} selected</b><select aria-label="Friend to share words with" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a friend</option>{friends.map(f=><option key={f.id} value={f.userId}>{f.username}</option>)}</select><button className="wh-level-btn" disabled={busy||!recipient||shareKeys.length>100} onClick={()=>act(async()=>{await shareWords(userId,recipient,shareKeys);setSelected([]);setMessage('Your friend can now add these words from Friends.');})}>Share words</button>{!friends.length && <p>Add a friend from the Friends page first.</p>}{shareKeys.length>100 && <p>Share up to 100 words at a time.</p>}</div>}
    <div className="pl-word-list">{visible.map(w=><article className="pl-word" key={w.word}>
      <div className="pl-row"><label className="pl-check"><input type="checkbox" checked={shareKeys.includes(w.word)} onChange={e=>setSelected(e.target.checked?[...shareKeys,w.word]:shareKeys.filter(k=>k!==w.word))}/><b>{w.word}</b></label><button className="wh-back-btn" disabled={busy||local} onClick={()=>setEditor({kind:"words",item:w,isNew:false})}>Edit</button><button className="wh-back-btn" disabled={busy||local} aria-label={`Remove ${w.word} from my words`} onClick={()=>act(async()=>{await removeWord(userId,w.word);await onChanged();setSelected(s=>s.filter(k=>k!==w.word));})}>Remove</button></div>
      <p>{w.meaning}</p><small>{(w.partsOfSpeech||[]).join(', ')} · {w.level} · {w.register}</small>
      <details><summary>Learning details</summary><p><b>Units:</b> {(w.units||[]).join(', ')}</p>{(w.situations||[w.situation]).filter(Boolean).map((s,i)=><p key={i}>{s}</p>)}<p><b>Word partners:</b> {(w.collocations||[]).join(' · ')||'No word partners recorded.'}</p><p><b>Word family:</b> {(w.wordFamily||[]).map(f=>typeof f==='string'?f:`${f.word} (${f.pos||f.partOfSpeech||''})`).join(' · ')||'No word family recorded.'}</p><p><b>Synonyms:</b> {(w.synonyms||[]).join(', ')||'No clear synonyms recorded.'}</p><p><b>Antonyms:</b> {(w.antonyms||[]).join(', ')||'No clear antonyms recorded.'}</p>{(w.commonMistakes||[w.commonMistake]).filter(Boolean).map((m,i)=><p key={i}>{m.sentence} → {m.correction}<br/>{m.why}</p>)}</details>
    </article>)}</div>
  </section>;
}
