import { useEffect, useState } from 'react';
import { BookOpen, Flame, Target, Trophy } from 'lucide-react';
import { fetchLeaderboard } from '../social/socialApi';
import { dueWords } from './learning';
export default function JourneyAside({ words, mastery, learner, today, goal, streak, showRanks, onOpen }) {
 const [ranks,setRanks]=useState([]), [rankError,setRankError]=useState(false);
 useEffect(()=>{if(!showRanks)return;let stopped=false;setRankError(false);fetchLeaderboard('week').then(rows=>{if(!stopped)setRanks(rows.slice(0,5));}).catch(()=>{if(!stopped)setRankError(true);});return()=>{stopped=true;};},[showRanks]);
 const due=dueWords(words,mastery,learner.reviews).length;
 return <aside className="lq-journey-aside"><section><h3><Flame size={18}/> {streak}-day streak</h3><p>A little practice each day adds up.</p></section><section><h3><Target size={18}/> Daily goal</h3><strong>{Math.min(100,Math.round(today.answered/goal*100))}%</strong><progress value={today.answered} max={goal}/><p>{today.answered} of {goal} questions today</p></section>{showRanks && <section><h3><Trophy size={18}/> Weekly league</h3>{ranks.map((p,i)=><div className="lq-mini-rank" key={p.id}><b>{i+1}</b><span>{p.username}</span><strong>{p.week_score} XP</strong></div>)}{!ranks.length&&<p>{rankError?'Scores are unavailable. Open League to retry.':'No scores yet this week.'}</p>}<button className="lq-back" onClick={()=>onOpen('leaderboard')}>See all →</button></section>}<section><h3><BookOpen size={18}/> {due} words due</h3><p>Keep the words you’ve learned.</p><button className="lq-secondary" onClick={()=>onOpen('review')}>Review</button></section></aside>;
}
