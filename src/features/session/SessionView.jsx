import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Trophy, Flame, Sparkles, Volume2, VolumeX, Zap } from "lucide-react";
import { examScore } from "../journey/journey";
import { V2 } from "../../engine/v2";
import { PronunciationModal, WordPicture } from "../media/media";
import { MODE_META } from "../../engine/data";
import { SPEED_SECONDS, speedStats } from "../../engine/questions";
import { evaluateAlternativeGap, evaluateFreeForm, regenerateWordExplanation } from "../../engine/ai";
import { preloadImage } from "../../lib/images";
// Embedded shared answer controls for all new sessions.
export const SessionView = (() => {
const { grade, sentence, reinforcement } = V2;

// One answer control for Practice, Stories and Chains. The draft lives in player state.
function AnswerControl({q,draft={},onChange,disabled,onSubmit}){
  const selected=draft.selected||[];
  if(q.type==='typing'&&q.modelOnly)return <textarea autoFocus className="wh-v2-input wh-v2-long-answer" aria-label="Your answer" disabled={disabled} value={draft.text??(q.freeformKind==='grammarFix'?q.sentence:'')} onChange={e=>onChange({...draft,text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();if(!disabled&&(draft.text||'').trim())onSubmit?.();}}} placeholder={q.freeformKind==='grammarFix'?"Edit the sentence to fix it… (Ctrl + Enter to submit)":"Write your answer… (Ctrl + Enter to submit)"}/>;
  if(q.type==='typing')return <input autoFocus className="wh-v2-input" aria-label="Your answer" autoComplete="off" spellCheck={false} disabled={disabled} value={draft.text||''} onChange={e=>onChange({...draft,text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(!disabled&&(draft.text||'').trim())onSubmit?.();}}} placeholder={`Type your answer… (or "${DONT_KNOW_TOKEN}" if you don't know)`}/>;
  return <div className="wh-options">{(q.options||[]).map((opt,index)=><button type="button" className={`wh-option ${selected.includes(opt)?'picked':''}`} aria-pressed={selected.includes(opt)} key={opt} disabled={disabled} onClick={()=>onChange({...draft,selected:q.type==='multi'?(selected.includes(opt)?selected.filter(x=>x!==opt):selected.length<q.answers.length?[...selected,opt]:selected):[opt]})}><span className="wh-shortcut-key" aria-hidden="true">{index+1}</span>{showOption(opt,q)}</button>)}</div>;
}
// Word options start with a capital letter on screen (idioms are stored in
// lowercase and would stand out). Display only: values and grading stay.
function showOption(opt,q){const t=String(opt);return q.mode!=='meaning'&&q.mode!=='collocation'&&!String(q.mode).startsWith('grammar')&&t.trim().split(/\s+/).length<=4&&/^[a-z]/.test(t)?t.charAt(0).toUpperCase()+t.slice(1):t;}
// Click a word inside a story/prompt to get a small floating toolbar with
// "Explain with AI" — avoids needing a drag-select gesture (which doesn't
// work well on mobile and gave no feedback on a plain tap).
function AskableText({ text, onAskWord, onListen, className }) {
  const [toolbar, setToolbar] = useState(null); // { word, left, top }
  const containerRef = useRef(null);
  const tokens = String(text || "").split(/(\s+)/);
  useEffect(() => {
    if (!toolbar) return;
    const close = (e) => { if (!containerRef.current || !containerRef.current.contains(e.target)) setToolbar(null); };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("touchstart", close, true);
    return () => { window.removeEventListener("mousedown", close, true); window.removeEventListener("touchstart", close, true); };
  }, [toolbar]);
  function handleWordClick(e, raw) {
    const word = raw.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
    if (!word) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setToolbar({ word, left: rect.left - containerRect.left + rect.width / 2, top: rect.top - containerRect.top });
  }
  return (
    <span className={`wh-askable ${className || ""}`} ref={containerRef}>
      {tokens.map((tok, i) => (/^\s*$/.test(tok) ? tok : (
        <span key={i} className="wh-askable-word" onClick={(e) => handleWordClick(e, tok)}>{tok}</span>
      )))}
      {toolbar && (
        <span className="wh-ask-toolbar" style={{ left: toolbar.left, top: toolbar.top }}>
          <button onClick={() => { onAskWord?.(toolbar.word); setToolbar(null); }}><Sparkles size={12} /> Explain with AI</button>
          {onListen && <button onClick={() => { onListen(toolbar.word); setToolbar(null); }}><Volume2 size={12} /> Listen</button>}
        </span>
      )}
    </span>
  );
}
const REPORT_REASONS=["Wrong or missing correct answer","My answer should've been accepted","Confusing or unclear wording","Typo or grammar mistake","Distractors too easy/obvious"];
// Typed as an honest "I don't know" instead of a guess — skips the AI
// double-check (no point asking AI to judge a non-answer) and is graded
// wrong immediately, same as leaving it blank would be if that were allowed.
const DONT_KNOW_TOKEN="-";
// Short synthesized cues, no audio files. Correct: a quick rising pair
// that climbs a little with the combo; wrong: one low soft note.
let audioCtx=null;
function playCue(kind,combo=0){
  try{
    audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    const ctx=audioCtx,t=ctx.currentTime;
    const notes=kind==='correct'?[523.25*Math.pow(2,Math.min(combo,8)/12),659.25*Math.pow(2,Math.min(combo,8)/12)]:[196];
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type=kind==='correct'?'triangle':'sine';osc.frequency.value=freq;
      const start=t+i*0.09,len=kind==='correct'?0.14:0.28;
      gain.gain.setValueAtTime(0.0001,start);gain.gain.exponentialRampToValueAtTime(0.18,start+0.02);gain.gain.exponentialRampToValueAtTime(0.0001,start+len);
      osc.connect(gain).connect(ctx.destination);osc.start(start);osc.stop(start+len+0.02);
    });
  }catch{}
}
// Friendly names for the V2-only modes MODE_META doesn't cover.
const MODE_LABELS_V2={reverse:"Name the Word",picture:"Picture Hunter",antonym:"Opposite Clue",collocation:"Word Partners",family:"Word Family",grammarCourt:"Grammar Court",grammarChoose:"Grammar",grammarJudge:"Right or Wrong?",grammarFix:"Fix the Sentence",multi:"Combo",transform:"Transform"};
// Correct answers in a row ending at index i (reported/skipped ones don't break it).
function comboAt(answers,i){let n=0;for(let j=i;j>=0;j--){const a=answers[j];if(!a||a.reported)continue;if(!a.correct)break;n++;}return n;}
function SessionView({session:s,onChange,onFinish,onBack,words,onIntroduce,onReport,onReviewReport,onWithdrawReport,onUpdateWord,onResult,onAskWord,sound=true,onToggleSound,prefs={}}){
  const [reviewOpen,setReviewOpen]=useState(false);
  const [aiChecking,setAiChecking]=useState(false);
  const [cardIndex,setCardIndex]=useState(0);
  const [flipped,setFlipped]=useState(false);
  const [regenState,setRegenState]=useState(null);
  const [reportOpen,setReportOpen]=useState(false);
  const [youglishTerm,setYouglishTerm]=useState(null);
  // The picked reason and the learner's own words are kept apart, so
  // picking a reason never wipes what they typed (and the AI gets both).
  const [reportReason,setReportReason]=useState("");
  const [reportDetails,setReportDetails]=useState("");
  // After submit the modal stays open to show the AI's verdict:
  // {report, prior (the answer slot before reporting), index, status:'reviewing'|'done'|'failed', review}
  const [reportReview,setReportReview]=useState(null);
  const continueRef=useRef(null);
  const result=s?.answers?.[s.index];
  const speed=s?.kind==='speed';
  useEffect(()=>{if(result&&!speed){continueRef.current?.scrollIntoView({behavior:'smooth',block:'end'});continueRef.current?.focus();}},[result,s?.index]);
  // A new question brings the top of the question box into view (not the
  // top of the page), so the prompt is right there to read.
  const cardRef=useRef(null);
  useEffect(()=>{if(s?.index)cardRef.current?.scrollIntoView({behavior:'smooth',block:'start'});},[s?.index]);
  const save=patch=>s&&onChange({...s,...patch});
  const q=s?.queue?.[s.index];const draft=s?.draft||{};
  // Fetch the next question's picture (and this word's reward picture) while
  // the learner is still answering, so it appears instantly.
  useEffect(()=>{const next=s?.queue?.[(s?.index||0)+1];if(next?.photo)preloadImage(next.photo);const w=q?V2.findWord(words,q.targets?.[0]):null;if(w?.image)preloadImage(w.image);},[s?.index]);
  // Only shown after a correct answer — by then the word is already known,
  // so an image here is a reward/reinforcement, never a hint toward it.
  const correctWord=result?.correct&&!result.reported&&q?.mode!=='picture'?V2.findWord(words,q?.targets?.[0]):null;
  const graded=!!result&&s?.kind!=='story'&&!result.reported&&!result.aiFailed&&!result.unverified;
  const combo=graded&&result.correct?comboAt(s.answers,s.index):0;
  // Play a cue only when a result appears on this question, not when a
  // saved session is resumed onto an already-answered question.
  // Speed Round: a clock, one tap (or 1–4) answers, and the next question
  // follows on its own. Time up, or out of questions, ends the round.
  const [clock,setClock]=useState(Date.now());
  const speedEndedRef=useRef(false);
  useEffect(()=>{if(!speed)return;const t=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(t);},[speed]);
  const timeLeft=speed?Math.max(0,Math.ceil(((s.deadline||0)-clock)/1000)):null;
  const endSpeed=()=>{if(speedEndedRef.current)return;speedEndedRef.current=true;onFinish(s);};
  useEffect(()=>{if(speed&&(timeLeft<=0||s.index>=s.queue.length))endSpeed();},[speed,timeLeft,s?.index]);
  useEffect(()=>{if(speed&&q&&!result&&(s.draft?.selected||[]).length===q.answers.length)submit();},[speed,s?.draft?.selected]);
  useEffect(()=>{if(!speed||!result)return;const t=setTimeout(next,result.correct?450:1000);return()=>clearTimeout(t);},[speed,result,s?.index]);
  // Settings: after an answer given just now (not one restored with a saved
  // round), say the word aloud and, when it was right, move on by itself.
  const freshRef=useRef(null);
  useEffect(()=>{
    const key=`${s?.id}:${s?.index}`;
    if(!result){freshRef.current=key;return;}
    if(freshRef.current!==key||speed)return;
    freshRef.current=null;
    const word=q?.targets?.[0];
    if(prefs.speakWord&&word&&typeof window!=='undefined'&&window.speechSynthesis){try{const u=new SpeechSynthesisUtterance(word);u.lang='en-US';window.speechSynthesis.cancel();window.speechSynthesis.speak(u);}catch{}}
    if(prefs.autoAdvanceMs>0&&result.correct&&graded){const t=setTimeout(next,prefs.autoAdvanceMs);return()=>clearTimeout(t);}
  },[result,s?.index]);
  const cueRef=useRef({key:null,hadResult:true});
  useEffect(()=>{
    const key=`${s?.id}:${s?.index}`;
    if(cueRef.current.key!==key){cueRef.current={key,hadResult:!!result};return;}
    if(result&&!cueRef.current.hadResult&&graded&&sound)playCue(result.correct?'correct':'wrong',combo);
    cueRef.current.hadResult=!!result;
  },[result,s?.id,s?.index]);
  useEffect(()=>{
    function handleKeyboard(event){
      if(!q||event.defaultPrevented||event.metaKey||event.ctrlKey||event.altKey)return;
      const tag=event.target?.tagName?.toLowerCase();
      const editing=tag==='input'||tag==='textarea'||event.target?.isContentEditable;
      if(editing)return;
      if(result&&event.key==='Enter'){
        if(event.target===continueRef.current)return;
        event.preventDefault();next();return;
      }
      if(result)return;
      if(/^[1-9]$/.test(event.key)&&q.type!=='typing'){
        const option=q.options?.[Number(event.key)-1];if(!option)return;
        event.preventDefault();
        const picked=draft.selected||[];
        save({draft:{...draft,selected:q.type==='multi'?(picked.includes(option)?picked.filter(x=>x!==option):picked.length<q.answers.length?[...picked,option]:picked):[option]}});
        return;
      }
      const readyNow=q.type==='typing'?!!draft.text?.trim():(draft.selected||[]).length===q.answers.length;
      if(event.key==='Enter'&&readyNow){event.preventDefault();submit();}
      if(event.key==='Escape'){event.preventDefault();speed?endSpeed():onBack();}
    }
    window.addEventListener('keydown',handleKeyboard);
    return()=>window.removeEventListener('keydown',handleKeyboard);
  },[q,result,draft,s?.index]);
  if(!s)return null;
  if(!s.introduced && s.introductions?.length){
    const intro=s.introductions;const w=intro[Math.min(cardIndex,intro.length-1)];const isLast=cardIndex>=intro.length-1;
    async function handleRegenerate(){
      setRegenState('loading');
      try{
        const result=await regenerateWordExplanation(w);
        setRegenState(result);
      }catch(e){
        console.error('Word Hunter: regenerate failed',e);
        setRegenState('error');
      }
    }
    function useRegenerated(){
      const patch={meaning:regenState.meaning,situation:regenState.situation};
      const newIntro=intro.map((x,i)=>i===cardIndex?{...x,...patch}:x);
      save({introductions:newIntro});
      onUpdateWord?.(w.word,patch);
      setRegenState(null);
    }
    return <section className="wh-panel">
      <h2>Meet {intro.length} new words</h2>
      <p>Learning cards do not count as correct answers. {s.kind==='story'?'These new words will not receive mastery credit in this story.':''}</p>
      <div className="wh-flashcard-progress">Word {cardIndex+1} of {intro.length} — tap the card to flip</div>
      <div className={`wh-flashcard ${flipped?'flipped':''}`} onClick={()=>setFlipped(f=>!f)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setFlipped(f=>!f);}}}>
        {!flipped?<div className="wh-flashcard-front"><WordPicture word={w}/><h3>{w.word}</h3><p className="wh-flashcard-hint">Tap to reveal meaning &amp; example</p></div>
        :<div className="wh-flashcard-back"><WordPicture word={w}/><h3>{w.word}{w.partsOfSpeech?.length>0&&<span className="wh-pos-tag">{w.partsOfSpeech.join(" / ")}</span>}</h3><p><b>Meaning:</b> {w.meaning}</p><p><b>Situation:</b> {w.situation}</p>{w.plainForm&&<p>Plain form: {w.plainForm}</p>}</div>}
      </div>
      {flipped&&<div className="wh-regen-area">
        {!regenState&&onUpdateWord&&<button className="wh-back-btn wh-nav-btn" onClick={handleRegenerate}>Regenerate meaning &amp; example</button>}
        {regenState==='loading'&&<p className="wh-regen-status">Generating a new version…</p>}
        {regenState==='error'&&<p className="wh-regen-status error">Couldn't generate a new version. <button className="wh-back-btn wh-nav-btn" onClick={handleRegenerate}>Try again</button></p>}
        {regenState&&typeof regenState==='object'&&<div className="wh-regen-preview">
          <p className="wh-regen-label">New version:</p>
          <p><b>Meaning:</b> {regenState.meaning}</p>
          <p><b>Situation:</b> {regenState.situation}</p>
          <div className="wh-regen-actions">
            <button className="wh-level-btn" onClick={useRegenerated}>Use this</button>
            <button className="wh-back-btn wh-nav-btn" onClick={()=>setRegenState(null)}>Discard</button>
          </div>
        </div>}
      </div>}
      <div className="wh-flashcard-nav">
        <button className="wh-back-btn wh-nav-btn" disabled={cardIndex===0} onClick={()=>{setCardIndex(i=>Math.max(0,i-1));setFlipped(false);setRegenState(null);}}>← Previous</button>
        {!isLast?<button className="wh-level-btn" onClick={()=>{setCardIndex(i=>i+1);setFlipped(false);setRegenState(null);}}>Next word →</button>
        :<button className="wh-level-btn" onClick={()=>{onIntroduce(intro);save({introduced:true});}}>Continue</button>}
      </div>
      <button className="wh-back-btn wh-nav-btn" onClick={onBack}>Save and leave</button>
    </section>;
  }
  if(s.index>=s.queue.length){
    const extra=s.kind==='practice'&&!s.extraAdded?V2.reinforcement(s):s;
    const correct=s.answers.filter(a=>a.correct).length;
    const total=s.queue.length;
    const pct=total?Math.round(correct/total*100):0;
    const isSolved=s.kind==='story'&&s.sourceStoryId;
    const bestCombo=s.queue.reduce((best,_,i)=>Math.max(best,comboAt(s.answers,i)),0);
    const missed=[...new Set(s.queue.flatMap((q,i)=>{const a=s.answers[i];return a&&!a.correct&&!a.reported?q.targets||[]:[];}))];
    return <section className="wh-panel">
      {isSolved&&<div className="wh-story-solved-banner"><CheckCircle2 size={22}/> <span>Story solved!</span></div>}
      {s.journey && s.journey.kind!=='training' && <div className="lq-exam-result"><Trophy size={42}/><h2>{examScore(s).passed?'Challenge passed!':'Keep practising'}</h2><p>{Math.floor(examScore(s).accuracy)}% · 70% to pass</p><p>{examScore(s).passed ? (s.journey.kind==='final'?'Save your results to unlock the next level.':'Save your results to complete this unit.') : 'Review the missed answers, then try again.'}</p></div>}
      <h2>{s.kind==='story'?s.title||'Story complete':'Session complete'}</h2>
      <p className="wh-session-score">{correct} / {total} correct ({pct}%) · {s.answers.filter(a=>a?.assisted).length} assisted</p>
      {s.kind!=='story'&&total>0&&<div className="wh-session-summary"><div><b>{pct}%</b><span>accuracy</span></div><div><b><Flame size={16}/> {bestCombo}</b><span>best streak</span></div><div><b>{missed.length}</b><span>to review</span></div></div>}
      {s.kind!=='story'&&total>0&&<p className="wh-session-score-sub">{pct===100?'Perfect round — nothing slipped past you.':pct>=80?'Sharp work. Only a few got away.':pct>=60?'Solid progress — the missed ones will come back first next time.':'Tough round. The missed words come back first next time, so they will stick.'}</p>}
      {missed.length>0&&<div className="wh-missed-words"><span>Missed:</span>{missed.map(word=><button key={word} className="wh-evidence-chip" onClick={()=>onAskWord?.(word)} title="Ask AI about this word">{word}</button>)}</div>}
      {isSolved&&<p className="wh-session-score-sub">{pct>=80?'Excellent work — you really know these words!':pct>=60?'Good job — keep practising the ones you missed.':'Keep going — re-read the story and try again soon.'}</p>}
      {s.queue.length===0&&<p>No safe questions are available yet. Your learning cards are saved. Return for practice later.</p>}
      <button className="wh-level-btn" onClick={()=>{onFinish(s);setReviewOpen(true);}}>Save results &amp; review</button>
      {extra.queue.length>s.queue.length&&!reviewOpen&&<button className="wh-level-btn" onClick={()=>onChange(extra)}>Add {extra.queue.length-s.queue.length} reinforcement questions ({extra.queue.length} total)</button>}
      {(reviewOpen||s.completed)&&s.queue.map((q,i)=><article key={q.id} className="wh-v2-learn"><strong>{i+1}. {q.prompt}</strong><p>Your answer: {s.answers[i]?.dontKnow?"Didn't know":Array.isArray(s.answers[i]?.value)?s.answers[i].value.join(' + '):s.answers[i]?.value||'Reported / skipped'}</p><p>{q.modelOnly?'Model answer (other valid sentences may exist)':'Answer'}: {q.answers.join(' + ')}</p><p>{q.explanation}</p></article>)}
      <button className="wh-back-btn wh-nav-btn wh-session-back" onClick={()=>{onFinish(s);onBack();}}>Back</button>
    </section>;
  }
  async function submit(){
    if(aiChecking)return;
    let value=q.type==='typing'?draft.text||'':draft.selected||[];
    const dontKnow=q.type==='typing'&&String(value).trim()===DONT_KNOW_TOKEN;
    const objectiveCorrect=q.objectiveTerms?.length?q.objectiveTerms.every(term=>sentence(value).includes(sentence(term))):null;
    const base={...(objectiveCorrect===null?grade(q,value,words):{correct:objectiveCorrect,spelling:false,unverified:false}),value,assisted:(draft.hints||0)>0};
    if(dontKnow){
      // Honest "don't know" — never a real answer, so never worth an AI
      // call; grade() may have set unverified for modelOnly questions, so
      // force it back to a plain, final wrong result.
      const answers=[...s.answers];
      const finalResult={...base,correct:false,unverified:false,dontKnow:true};
      answers[s.index]=finalResult;
      onResult?.(q,finalResult,s);
      save({answers});
      return;
    }
    if(base.unverified && q.modelOnly){
      setAiChecking(true);
      try{
        const targetWord=V2.findWord(words,q.targets?.[0]);
        const target=q.freeformKind==='grammarFix'?{label:q.rule,situation:q.sentence}:{word:q.targets?.[0],meaning:targetWord?.meaning,situation:targetWord?.situation};
        const evaluation=await evaluateFreeForm({freeformKind:q.freeformKind||'sentence',target,answer:q.answers[0]},value);
        const targetRequired=!['idiomMeaning','grammarFix'].includes(q.freeformKind);
        const genuine=evaluation.correct&&(!targetRequired||evaluation.targetWordUsed)&&evaluation.semanticUse==='correct';
        const aiClose=!genuine&&evaluation.semanticUse==='partly_correct'&&evaluation.naturalness!=='nonsense';
        const answers=[...s.answers];
        const finalResult={...base,correct:genuine,unverified:false,aiEvaluated:true,aiClose,aiFeedback:evaluation.feedback};
        answers[s.index]=finalResult;
        onResult?.(q,finalResult,s);
        save({answers});
      }catch(e){
        // AI check failed (network/parsing) — surface this distinctly from a
        // plain unverified result so it's clear a retry might help, and log
        // the real error for debugging instead of failing silently.
        console.error('Word Hunter: transform AI check failed', e);
        const answers=[...s.answers];
        answers[s.index]={...base,aiFailed:true};
        save({answers});
      }finally{
        setAiChecking(false);
      }
      return;
    }
    // A plain typing question graded "wrong" by exact text match still
    // might be a valid alternative answer (synonym, different phrasing) —
    // a string comparison can't judge that. Double-check with AI before
    // the learner is told they're wrong, same as the modelOnly path above.
    if(!(s.journey && s.journey.kind!=='training') && q.type==='typing' && !q.modelOnly && !base.correct && !base.spelling && String(value).trim()){
      setAiChecking(true);
      try{
        const targetWord=V2.findWord(words,q.targets?.[0]);
        const evaluation=await evaluateAlternativeGap({prompt:q.prompt,answer:q.answers[0],target:{meaning:targetWord?.meaning||q.explanation}},value);
        const genuine=!!evaluation.correct&&evaluation.semanticUse==='correct';
        const aiClose=!genuine&&evaluation.semanticUse==='partly_correct'&&evaluation.naturalness!=='nonsense';
        const answers=[...s.answers];
        const finalResult={...base,correct:genuine,unverified:false,aiEvaluated:true,aiClose,aiFeedback:evaluation.feedback};
        answers[s.index]=finalResult;
        onResult?.(q,finalResult,s);
        save({answers});
      }catch(e){
        console.error('Word Hunter: alternative-answer AI check failed', e);
        const answers=[...s.answers];
        answers[s.index]={...base,aiFailed:true};
        save({answers});
      }finally{
        setAiChecking(false);
      }
      return;
    }
    const answers=[...s.answers];answers[s.index]=base;onResult?.(q,base,s);save({answers});
  }
  function retry(){const answers=[...s.answers];answers[s.index]=null;save({answers});}
  function next(){save({index:s.index+1,draft:{}});}
  function submitReport(){
    const prior=s.answers[s.index]||null,index=s.index;
    const draftValue=q.type==='typing'?(draft.text||'').trim()||null:(draft.selected?.length?draft.selected:null);
    const report=onReport(q,s,reportReason,prior?.value??draftValue,reportDetails.trim(),prior);
    const answers=[...s.answers];answers[index]={...(prior||{}),reported:true,correct:false};save({answers});
    if(!onReviewReport||!report){setReportOpen(false);return;}
    setReportReview({report,prior,index,status:'reviewing'});
    onReviewReport(report).then(review=>setReportReview(current=>current?.report===report?{...current,status:'done',review}:current),()=>setReportReview(current=>current?.report===report?{...current,status:'failed'}:current));
  }
  function closeReport(){setReportOpen(false);setReportReview(null);}
  // The learner agrees with the AI: drop the report and put the question
  // back exactly as it was (unanswered, or their original graded answer).
  function withdrawReport(){
    const {report,prior,index}=reportReview;
    onWithdrawReport?.(report);
    const answers=[...s.answers];answers[index]=prior||undefined;save({answers});
    closeReport();
  }
  const ready=q.type==='typing'?!!draft.text?.trim():(draft.selected||[]).length===q.answers.length;
  const statusClass=result?(s.kind==='story'||result.reported||result.unverified?'':result.aiClose?'close':result.spelling?'close':result.correct?'correct':'wrong'):'';
  const answerText=result?q.answers.join(' + '):'';
  const sameAsExplanation=result&&q.explanation&&answerText.trim().toLowerCase()===q.explanation.trim().toLowerCase();
  const answeredCount=s.answers.slice(0,s.queue.length).filter(Boolean).length;
  const speedNow=speed?speedStats(s.answers):null;
  return <section><div className="wh-round-top"><button className="wh-back-btn wh-nav-btn" onClick={speed?endSpeed:onBack}>{speed?'End round':'Save and leave'}</button><span className="wh-round-meta">{combo>=2&&<span key={combo} className="wh-combo"><Flame size={13}/> {combo} in a row</span>}{speed?<><span className={`wh-speed-timer ${timeLeft<=10?'urgent':''}`}><Zap size={13}/> {timeLeft}s</span><span>{speedNow.points} pts</span></>:<span>{s.title} · {s.index+1}/{s.queue.length}</span>}{onToggleSound&&<button className="wh-icon-btn" onClick={onToggleSound} title={sound?"Mute sounds":"Turn sounds on"} aria-label={sound?"Mute sounds":"Turn sounds on"}>{sound?<Volume2 size={13}/>:<VolumeX size={13}/>}</button>}</span></div>{speed?<div className="wh-session-progress" role="progressbar" aria-label="Time left" aria-valuemin={0} aria-valuemax={s.seconds||SPEED_SECONDS} aria-valuenow={timeLeft}><span style={{width:`${timeLeft/(s.seconds||SPEED_SECONDS)*100}%`}}/></div>:<div className="wh-session-progress" role="progressbar" aria-valuemin={0} aria-valuemax={s.queue.length} aria-valuenow={answeredCount}><span style={{width:`${s.queue.length?answeredCount/s.queue.length*100:0}%`}}/></div>}{s.kind==='practice'&&s.initialLength<(s.targetLength||12)&&<p className="wh-v2-notice">Short session: {s.initialLength} valid questions (usual goal: {s.targetLength||12}).</p>}{s.text&&<details className="wh-v2-story" open={s.index===0}><summary>Read the story</summary><p><AskableText text={s.text} onAskWord={onAskWord} onListen={setYouglishTerm} /></p></details>}<div className="wh-card" ref={cardRef}>{result&&statusClass==='correct'&&<div className="wh-stamp correct">SUCCESS</div>}<div className="wh-file-row"><span>{MODE_META[q.mode]?.label||MODE_LABELS_V2[q.mode]||q.mode}</span>{!speed&&<div>{onAskWord && <button className="wh-back-btn" onClick={()=>onAskWord(q.targets?.[0]||'')}>Ask AI</button>} <button className="wh-back-btn" disabled={!result} title={result?undefined:"Available after you answer (it would give the answer away)"} onClick={()=>setYouglishTerm(q.targets?.[0]||'')}><Volume2 size={12}/> Listen</button> <button className="wh-back-btn" disabled={!!result&&(result.reported||s.kind==='story')} onClick={()=>{setReportReason("");setReportDetails("");setReportReview(null);setReportOpen(true);}}>Report question</button></div>}</div>{(q.picture||q.photo)&&<div className="wh-picture-q"><WordPicture word={q} className="wh-picture-img"/></div>}<p className="wh-sentence"><AskableText text={q.prompt} onAskWord={onAskWord} onListen={setYouglishTerm} /></p>{q.type==='multi'&&<p>Choose {q.answers.length} words.</p>}<AnswerControl key={q.id} q={q} draft={draft} onChange={draft=>save({draft})} disabled={!!result} onSubmit={submit}/>{!result&&!speed&&prefs.hints!==false&&q.hints?.length>0&&<><button className="wh-back-btn" disabled={(draft.hints||0)>=q.hints.length} onClick={()=>save({draft:{...draft,hints:(draft.hints||0)+1}})}>Hint ({draft.hints||0}/{q.hints.length})</button>{q.hints.slice(0,draft.hints||0).map((h,i)=><p key={i}>{h}</p>)}</>}{speed?(result&&<div role="status" className={`wh-feedback ${statusClass}`}>{result.correct?'Correct!':`It was: ${answerText}`}</div>):!result?<button className="wh-level-btn wh-submit-btn" disabled={!ready||aiChecking} onClick={submit}>{aiChecking?'Checking with AI…':'Submit'}</button>:<><div role="status" className={`wh-feedback ${statusClass}`}>{s.kind==='story'?'Answer saved. Feedback follows at the end.':result.reported?'Reported; excluded from mastery.':result.aiFailed?'AI check failed. Tap Retry to try again, or Continue without grading this one.':result.dontKnow?"No worries — here's the answer:":result.unverified?'Different from the model. Not graded: a text match cannot check all valid sentences.':result.aiClose?'Almost — close, but not quite right yet.':result.spelling?'Close spelling; this is not a full recall success.':result.correct?'Correct'+(result.assisted?' with help.':'.'):'Try this answer:'}</div>{s.kind!=='story'&&!result.reported&&!result.aiFailed&&<div className="wh-result-details"><WordPicture word={correctWord}/><p>{answerText}</p>{!sameAsExplanation&&<p>{q.explanation}</p>}{result.aiFeedback&&<p className="wh-ai-feedback">{result.aiFeedback}</p>}</div>}{result.aiFailed&&<button className="wh-level-btn wh-result-continue" onClick={retry}>Retry</button>}<button ref={continueRef} className="wh-level-btn wh-result-continue" onClick={next}>Continue</button></>}</div>{reportOpen&&<div className="wh-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&reportReview?.status!=='reviewing')closeReport();}}><div className="wh-panel wh-confirm-panel" role="alertdialog">{!reportReview?<><p><b>Report this question?</b></p><p>Pick what's wrong (optional), or add your own note below. AI will check it right away.{result?.correct?' Your correct answer won\'t count for this word while the report is open.':''}</p><div className="wh-options wh-report-reasons">{REPORT_REASONS.map(reason=><button type="button" key={reason} className={`wh-option ${reportReason===reason?'picked':''}`} onClick={()=>setReportReason(current=>current===reason?"":reason)}>{reason}</button>)}</div><textarea className="wh-freeform" style={{width:"100%",minHeight:60,boxSizing:"border-box",marginTop:8}} value={reportDetails} onChange={e=>setReportDetails(e.target.value)} placeholder="What's wrong? Write it in your own words (Arabic is fine)"/><div className="wh-ai-actions"><button onClick={()=>setReportOpen(false)}>Cancel</button><button className="primary" disabled={!reportReason&&!reportDetails.trim()} onClick={submitReport}>Submit report</button></div></>:reportReview.status==='reviewing'?<><p><b>Report saved.</b></p><p className="wh-ai-feedback"><Sparkles size={13}/> AI is checking this question…</p></>:reportReview.status==='failed'?<><p><b>Report saved.</b></p><p>AI couldn't check it right now. It's still in the admin's report list, and this question won't count against you.</p><div className="wh-ai-actions"><button className="primary" onClick={closeReport}>Continue</button></div></>:<><p><b>{reportReview.review.verdict==='flawed'?'AI agrees — this question has a problem.':reportReview.review.verdict==='repeated'?'Got it — this one keeps coming back.':reportReview.review.verdict==='fine'?'AI thinks this question is OK.':"AI isn't sure about this one."}</b></p>{reportReview.review.explanation&&<p className="wh-ai-feedback">{reportReview.review.explanation}</p>}{reportReview.review.learnerAnswerAcceptable===true&&<p>Your answer looks acceptable too.</p>}{reportReview.review.verdict==='flawed'&&<p><small>{reportReview.review.fixed?'A fix is drafted and waiting for admin review.':'Saved for admin review.'} The question won't count against you.</small></p>}{reportReview.review.verdict!=='flawed'&&<p><small>Your report is still saved for the admin, and this question won't count against you. You can withdraw it if you agree with the AI.</small></p>}<div className="wh-ai-actions">{reportReview.review.verdict!=='flawed'&&<button onClick={withdrawReport}>{reportReview.prior?'Withdraw report':'Withdraw & answer it'}</button>}<button className="primary" onClick={closeReport}>{reportReview.review.verdict!=='flawed'?'Keep report':'Continue'}</button></div></>}</div></div>}{youglishTerm&&<PronunciationModal term={youglishTerm} onClose={()=>setYouglishTerm(null)}/>}</section>;
}

return SessionView;
})();
