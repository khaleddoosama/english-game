import { useEffect, useState } from 'react';
import { Heart, BookOpen } from 'lucide-react';
import { heartsAt, HEART_INTERVAL, HEART_LIMIT } from './learning';
export default function Hearts({ state, onPractice, onBack }) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const hearts=heartsAt(state,now), remaining=Math.max(0,HEART_INTERVAL-(now-hearts.at)), minutes=Math.floor(remaining/60000), seconds=Math.floor(remaining/1000)%60;
  return <section className="lq-empty lq-hearts"><Heart size={64}/><h2>{hearts.count ? 'Ready for another quest' : 'You’re out of hearts'}</h2><p>{hearts.count} / {HEART_LIMIT} hearts</p><p>One heart refills every 30 minutes.{hearts.count<HEART_LIMIT && <> Next heart in <b>{minutes}:{String(seconds).padStart(2,'0')}</b>.</>}</p><div className="lq-review-callout"><BookOpen size={30}/><div><strong>Earn a heart with practice</strong><p>Finish a 5-question recovery round. No hearts needed.</p></div></div><button className="lq-primary" onClick={onPractice}>Practise now</button><button className="lq-back" onClick={onBack}>Back to journey</button></section>;
}
