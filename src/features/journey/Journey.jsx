import { useState } from 'react';
import { ArrowLeft, BookOpen, Check, Flag, Lock, Play, Trophy, Zap } from 'lucide-react';
import { coverage, finalReady, levelUnlocked, unitKey, unitUnlocked } from './journey';

export default function Journey({ levels, progress, mastery, selectedLevel, selectedUnit, onSelect, onStart, onNavigate }) {
  const [tab, setTab] = useState('words');
  const level = levels.find(l => l.id === selectedLevel) || levels.find((l,i) => levelUnlocked(levels,i,progress) && !progress.levels?.[l.id]?.passed) || levels[0];
  const index = levels.indexOf(level);
  const unlocked = level && levelUnlocked(levels,index,progress);
  const unit = level?.units.find(u => u.id === selectedUnit);
  const ready = unit ? coverage(unit,mastery) : null;
  const completed = level?.units.filter(u => progress.units?.[unitKey(level.id,u.id)]?.passed).length || 0;
  if (!levels.length) return <section className="lq-empty"><BookOpen size={48}/><h2>Your journey starts with your content</h2><p>No course content is loaded yet. Import your words and grammar to build the path.</p><button className="lq-primary" onClick={()=>onNavigate('data')}>Open your data</button></section>;
  return <section className="lq-journey">
    <div className="lq-course-picker"><label htmlFor="course-level">COURSE LEVEL</label><select id="course-level" value={level.id} onChange={e=>onSelect(e.target.value,null)}>{levels.map((l,i)=><option key={l.id} value={l.id}>{l.title}{levelUnlocked(levels,i,progress)?'':' · Locked'}</option>)}</select><button className="lq-secondary" onClick={()=>onNavigate('stories')}>Stories</button></div>
    {unit ? <>
      <button className="lq-back" onClick={()=>onSelect(level.id,null)}><ArrowLeft size={18}/> Back to journey</button>
      <div className="lq-banner"><span>{level.title} · UNIT {level.units.indexOf(unit)+1}</span><h2>{unit.title}</h2><p>{unit.words.length} words · {unit.grammar.length} grammar rules</p></div>
      <div className="lq-unit-progress"><strong>{ready.done} / {ready.total} items practised</strong><progress max={ready.total || 1} value={ready.done}/><p>Practise every item, then score 70% or more in the unit test.</p></div>
      <div className="lq-tabs" role="group" aria-label="Unit content">{['words','grammar'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t === 'words' ? 'Words' : 'Grammar'}</button>)}</div>
      <div className="lq-content-list">{unit[tab].map(item=><article key={item.word || item.id}><div><strong>{item.word || item.rule}</strong><span>{item.partsOfSpeech?.join(' / ')}</span></div><p>{item.meaning || item.explanation}</p>{item.situation && <blockquote>{item.situation}</blockquote>}<small>{mastery[item.word || `grammar:${item.id}`]?.total ? 'Practised' : 'New'}</small></article>)}</div>
      <div className="lq-unit-actions"><button className="lq-primary" disabled={!unlocked || !unitUnlocked(level,level.units.indexOf(unit),progress)} onClick={()=>onStart(level,unit,'training')}><Play size={18}/> Start training</button><button className="lq-secondary" disabled={!unlocked || !ready.ready || !unitUnlocked(level,level.units.indexOf(unit),progress)} onClick={()=>onStart(level,unit,'unit')}><Flag size={18}/> Take unit test · 70%</button></div>
    </> : <>
      <div className="lq-banner"><span>YOUR LEARNING PATH</span><h2>{level.title}</h2><p>{completed} of {level.units.length} units complete</p><BookOpen size={35}/></div>
      {!unlocked && <p className="lq-notice"><Lock size={18}/> Pass the previous level’s final challenge to unlock this level.</p>}
      <ol className="lq-path">{level.units.map((u,i)=>{const passed=!!progress.units?.[unitKey(level.id,u.id)]?.passed;const open=unlocked && unitUnlocked(level,i,progress);return <li key={u.id} className={`${passed?'complete':open?'current':'locked'}`}><button className="lq-node" disabled={!open} aria-label={`${u.title}: ${passed?'complete':open?'open':'locked'}`} onClick={()=>onSelect(level.id,u.id)}>{passed?<Check/>:open?<BookOpen/>:<Lock/>}</button><div><small>UNIT {i+1} · {passed?'COMPLETE':open?'READY':'LOCKED'}</small><strong>{u.title}</strong><span>{u.words.length} words · {u.grammar.length} rules</span>{open && <button className="lq-path-link" onClick={()=>onSelect(level.id,u.id)}>{passed?'Review unit':'Open unit'} →</button>}</div></li>;})}<li className={`lq-final ${unlocked && finalReady(level,progress)?'current':'locked'}`}><button className="lq-node" disabled={!unlocked || !finalReady(level,progress)} aria-label="Start level final challenge" onClick={()=>onStart(level,null,'final')}><Trophy/></button><div><small>FINAL CHALLENGE</small><strong>Put it all together</strong><span>Every unit · harder questions · 70% to pass</span>{progress.levels?.[level.id]?.passed && <small>LEVEL COMPLETE ✓</small>}</div></li></ol>
      <div className="lq-extras"><button onClick={()=>onNavigate('review')}><BookOpen/> Review your words</button><button onClick={()=>onNavigate('live')}><Zap/> Challenge friends</button></div>
    </>}
  </section>;
}
