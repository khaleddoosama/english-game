// Short synthesized cues for answers, no audio files.
//  correct: a quick rising pair that climbs a little with the combo;
//  wrong:   two falling notes ("uh-oh"). Both sit above about 300 Hz and use
//           a triangle wave, because a phone's speaker barely plays a low sine
//           (the old single note at 196 Hz was silent on phones).
let ctx = null;
function context() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx ||= new Ctx();
  // Browsers start audio suspended until a tap; a cue played from a timer or
  // an effect needs it resumed.
  if (ctx.state === "suspended") ctx.resume?.().catch?.(() => {});
  return ctx;
}
// The first tap or key press on the page unlocks audio for the rest of the visit.
let unlockListening = false;
export function unlockAudioOnFirstTouch() {
  if (unlockListening || typeof window === "undefined") return;
  unlockListening = true;
  const unlock = () => {
    context();
    for (const e of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(e, unlock, true);
  };
  for (const e of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(e, unlock, true);
}
export const CUES = {
  correct: (combo) => { const up = Math.pow(2, Math.min(combo, 8) / 12); return { notes: [523.25 * up, 659.25 * up], gap: 0.09, len: 0.14, type: "triangle", gain: 0.18 }; },
  wrong: () => ({ notes: [329.63, 246.94], gap: 0.13, len: 0.24, type: "triangle", gain: 0.26 }),
};
export function playCue(kind, combo = 0) {
  try {
    const c = context();
    if (!c) return;
    const cue = (CUES[kind] || CUES.wrong)(combo), t = c.currentTime;
    cue.notes.forEach((freq, i) => {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = cue.type; osc.frequency.value = freq;
      const start = t + i * cue.gap;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(cue.gain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + cue.len);
      osc.connect(gain).connect(c.destination);
      osc.start(start); osc.stop(start + cue.len + 0.02);
    });
  } catch { /* no audio: the game plays on */ }
}
