import { useState } from 'react';
import { ArrowLeft, BookOpen, BriefcaseBusiness, Check, Compass, GraduationCap, MessageCircle, Target } from 'lucide-react';

const GOALS = [['Work & career', BriefcaseBusiness], ['Travel', Compass], ['Exams', GraduationCap], ['Everyday conversation', MessageCircle]];
export default function Onboarding({ initial = {}, levels, onComplete, onBack }) {
  const [step, setStep] = useState(1), [goal, setGoal] = useState(initial.goal || 'Everyday conversation');
  const [minutes, setMinutes] = useState(initial.minutes || 10), [level, setLevel] = useState(initial.preferredLevel || levels[0]?.id || '');
  return <section className="lq-onboarding">
    <div className="lq-page-heading"><button className="lq-back" onClick={step === 1 ? onBack : () => setStep(1)}><ArrowLeft size={18}/> Back</button><small>{step} / 2</small></div>
    <div className="lq-onboard-icon">{step === 1 ? <Target size={42}/> : <BookOpen size={42}/>}</div>
    <h2>{step === 1 ? 'Why are you learning English?' : 'Choose your starting focus'}</h2>
    <p>{step === 1 ? 'Make a little room for English every day.' : 'These levels come from your course. You can explore the units before training.'}</p>
    {step === 1 ? <><div className="lq-choice-list">{GOALS.map(([name, Icon]) => <button key={name} aria-pressed={goal === name} onClick={() => setGoal(name)}><Icon/><span>{name}</span>{goal === name && <Check/>}</button>)}</div><h3>Daily study time</h3><div className="lq-tabs">{[5,10,15,20].map(n => <button key={n} aria-pressed={minutes === n} onClick={() => setMinutes(n)}>{n} min</button>)}</div><button className="lq-primary" onClick={() => setStep(2)}>Continue</button></> : <><div className="lq-choice-list">{levels.filter(l => l.id !== 'Unassigned').map(l => <button key={l.id} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}><BookOpen/><span><b>{l.title}</b><small>{l.units.length} units</small></span>{level === l.id && <Check/>}</button>)}</div><p className="lq-muted">Your focus does not bypass unit tests or unlock a locked level.</p><button className="lq-primary" disabled={!level} onClick={() => onComplete({ ...initial, goal, minutes, preferredLevel: level, onboarded: true })}>Start my journey</button></>}
  </section>;
}
