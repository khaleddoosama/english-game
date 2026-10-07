import { runAiOperation, isAiCancelled } from "../../lib/aiOperations.js";
import { withRequestTimeout } from "../../lib/requestTimeout.js";
import { useEffect, useRef, useState } from "react";
import { Volume2, X } from "lucide-react";
import { V2 } from "../../engine/v2";
import { forgetSpeechUrl, speechUrl } from "../../lib/ai";
import { isStoredImage } from "../../lib/images";
// Pronunciation: two independent sources, tried in order.
//  1. dictionaryapi.dev — free, no key, returns real human-recorded audio.
//     May be blocked by a strict sandbox CSP, so failure is expected and fine.
//  2. The browser's built-in speechSynthesis — works fully offline with no
//     external request at all, so it is the reliable floor.
// YouGlish stays available only as an external link: its widget needs a
// third-party <script>, which this sandbox blocks outright.
export const audioCache = new Map();
// Remembered per device too, so reopening a word after a reload doesn't search again.
const DICT_KEY = "wh-dict-audio";
const dictStore = () => { try { return JSON.parse(localStorage.getItem(DICT_KEY) || "{}"); } catch { return {}; } };
const rememberDict = (key, result) => {
  try {
    const all = dictStore(); all[key] = result;
    const keys = Object.keys(all);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
    localStorage.setItem(DICT_KEY, JSON.stringify(all));
  } catch (_) {}
};
export async function fetchWordAudio(term, options = {}) {
  const key = String(term || "").trim().toLowerCase();
  if (!key) return null;
  if (audioCache.has(key)) return audioCache.get(key);
  const known = dictStore()[key];
  if (known !== undefined) { audioCache.set(key, known); return known; }
  // Only single words have dictionary entries; phrases go straight to TTS.
  if (/\s/.test(key)) { audioCache.set(key, null); return null; }
  const res = await withRequestTimeout(signal => fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, { signal }), 8000, "Dictionary audio took too long.", options.signal);
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`);
  const data = await res.json();
  // dictionaryapi.dev names its files by accent: word-us.mp3, word-uk.mp3,
  // word-au.mp3. Take the US one whenever it exists; only fall back to
  // another accent if there is no American recording at all, and say so in
  // the UI rather than passing it off as American.
  const urls = (Array.isArray(data) ? data : [])
    .flatMap((entry) => entry?.phonetics || [])
    .map((p) => p?.audio)
    .filter((a) => typeof a === "string" && a.trim());
  const us = urls.find((a) => /-us\.(mp3|ogg|wav)/i.test(a));
  const url = us || urls[0] || null;
  const result = url ? { url, isUS: !!us } : null;
  audioCache.set(key, result);
  rememberDict(key, result);
  return result;
}
// Setting utterance.lang alone is only a hint — browsers often keep whatever
// voice is default (frequently en-GB). Pick an explicitly en-US voice when
// the device has one, and report back which accent actually got used.
export function pickUSVoice() {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find((v) => v.lang === "en-US" || v.lang === "en_US")
    || voices.find((v) => /^en[-_]US/i.test(v.lang || ""))
    || null;
}
export function speakWithBrowser(term) {
  if (typeof window === "undefined" || !window.speechSynthesis) throw new Error("No speech support in this browser.");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(term));
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  const voice = pickUSVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return !!voice;
}
// Pictures chosen from the device are resized and uploaded by
// lib/images.js; words keep only the URL.
// Photo links on words, tried once in the background: url -> "ok" | "bad" |
// "pending". Picture Hunter only asks about a link-only picture that loaded.
export const IMAGE_LINKS = new Map();
export function checkImageLink(url, timeout = 10000) {
  if (IMAGE_LINKS.has(url) && IMAGE_LINKS.get(url) !== "bad") return;
  IMAGE_LINKS.set(url, "pending");
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; IMAGE_LINKS.set(url, ok ? "ok" : "bad"); resolve(ok); };
    img.referrerPolicy = "no-referrer";
    img.onload = () => finish(img.naturalWidth > 0);
    img.onerror = () => finish(false);
    setTimeout(() => finish(false), timeout);
    img.src = url;
  });
}
export function checkImageLinks(words) {
  if (typeof Image === "undefined") return;
  for (const w of words) if (typeof w.image === "string" && /^https?:\/\//i.test(w.image) && !isStoredImage(w.image)) checkImageLink(w.image);
}
// Pictures in our own storage always load; outside links count once seen loading.
export const imageLinkOk = (url) => isStoredImage(url) || IMAGE_LINKS.get(url) === "ok";
// A word's picture: the photo link if it loads, otherwise its drawing; a
// blocked or broken photo quietly falls back instead of showing an error.
export function WordPicture({ word, className = "wh-flashcard-img", lazy = false }) {
  const [failed, setFailed] = useState(false);
  const photo = typeof word?.photo === "string" ? word.photo : typeof word?.image === "string" ? word.image : null;
  const drawing = word?.picture || word?.illustration;
  useEffect(() => setFailed(false), [photo]);
  if (photo && !failed) return <img src={photo} alt="" referrerPolicy="no-referrer" decoding="async" loading={lazy ? "lazy" : "eager"} className={className} onError={() => setFailed(true)} />;
  if (V2.isIllustration(drawing)) return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(drawing)}`} alt="" decoding="async" className={`${className} wh-word-drawing`} />;
  return null;
}
// Finds the best recording for a term: a human one (single words, from
// dictionaryapi.dev), then Gemini's voice (phrases and sentences, cached on
// the server after the first request). It runs on its own, so closing the
// dialog doesn't stop it: the result is remembered, and the next time the
// word is opened it plays at once. A second ask for the same term shares the
// first one's work. Rejects when neither source worked.
const pendingPronunciation = new Map();
export function preparePronunciation(term, options = {}) {
  const key = String(term || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!options.signal && pendingPronunciation.has(key)) return pendingPronunciation.get(key);
  const job = runAiOperation("Pronunciation", async signal => {
    let found = null;
    try { found = await fetchWordAudio(term, { signal }); } catch (e) { if (isAiCancelled(e)) throw e; }
    signal.throwIfAborted();
    if (found?.url) return { source: "human", url: found.url, isUS: found.isUS };
    return { source: "ai", url: await speechUrl(term, { signal }), isUS: true };
  }, { background: true, ...options, timeoutMs: 60000 }).finally(() => { if (!options.signal) pendingPronunciation.delete(key); });
  if (!options.signal) pendingPronunciation.set(key, job);
  return job;
}
// Pronunciation, best source first (see preparePronunciation), then the
// browser's own voice, which is always one tap away.
export function PronunciationModal({ term, onClose }) {
  const [lastTerm, setLastTerm] = useState(term);
  useEffect(() => { if (term) setLastTerm(term); }, [term]);
  // Keep the audio element mounted when the dialog closes, including while
  // its recording is being prepared. Opening another term replaces it.
  return lastTerm ? <PronunciationPlayer term={lastTerm} onClose={onClose} hidden={!term}/> : null;
}
function PronunciationPlayer({ term, onClose, hidden }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("loading"); // loading | human | ai | ttsOnly
  const [audioUrl, setAudioUrl] = useState(null);
  const [isUS, setIsUS] = useState(false);
  const [ttsIsUS, setTtsIsUS] = useState(false);
  const audioRef = useRef(null);
  const browserVoiceUsed = useRef(false); // the player chose the browser voice: a recording that arrives later doesn't talk over it
  const speak = () => { try { setTtsIsUS(speakWithBrowser(term)); } catch (e) { /* no speech support */ } };
  const speakNow = () => { browserVoiceUsed.current = true; speak(); };
  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    // Voice list loads asynchronously in most browsers; without this the
    // first call can run before any en-US voice is known.
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.getVoices();
    browserVoiceUsed.current = false;
    // A new term replaces playback; closing the dialog leaves it running.
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    preparePronunciation(term)
      .then((found) => {
        if (cancelled) return;
        setAudioUrl(found.url); setIsUS(found.isUS); setStatus(found.source);
      })
      .catch(error => { if (!cancelled) { setStatus("ttsOnly"); if (!isAiCancelled(error) && !browserVoiceUsed.current) speak(); } });
    return () => {
      cancelled = true;

    };
  }, [term, attempt]);
  // Autoplay the human recording once it is available. Browsers can refuse
  // autoplay without a user gesture, so the visible Play button stays the
  // guaranteed path.
  useEffect(() => { if ((status === "human" || status === "ai") && audioRef.current && !browserVoiceUsed.current) audioRef.current.play().catch(() => {}); }, [status, audioUrl]);
  const youglishUrl = `https://youglish.com/pronounce/${encodeURIComponent(term)}/english/us`;
  const accentNote = status === "human"
    ? (isUS ? "American recording" : "Non-US accent — no American recording found")
    : status === "ai" ? "AI voice · American"
    : status === "ttsOnly"
      ? (ttsIsUS ? "Browser voice · American" : "Browser voice · no US voice on this device")
      : "Searching…";
  return <div className="wh-modal-overlay" style={hidden ? { display: "none" } : undefined} aria-hidden={hidden || undefined} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="wh-panel wh-say-panel" role="dialog" aria-label={`Pronunciation of ${term}`}>
      <div className="wh-say-head">
        <div>
          <div className="wh-say-label">PRONUNCIATION</div>
          <h2 className="wh-say-term">{term}</h2>
        </div>
        {status === "ttsOnly" && <button className="wh-back-btn" onClick={() => setAttempt(value => value + 1)}>Retry audio</button>}
        <button className="wh-icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button>
      </div>

      <div className={`wh-say-badge ${(status === "human" && isUS) || status === "ai" ? "is-us" : status === "loading" ? "is-loading" : "is-soft"}`}>
        <Volume2 size={12}/> {accentNote}
      </div>

      {status === "loading" && <div className="wh-say-body">
        <p className="wh-say-muted">Looking for an American recording… You can close this: it keeps loading in the background and remembers the word.</p>
        <button className="wh-say-secondary" onClick={speakNow}><Volume2 size={12}/> Browser voice instead</button>
      </div>}

      {(status === "human" || status === "ai") && <div className="wh-say-body">
        <audio ref={audioRef} src={audioUrl} controls preload="auto" className="wh-say-audio" onError={() => { if (status === "ai") { forgetSpeechUrl(term); setStatus("ttsOnly"); speakNow(); } }}/>
        <button className="wh-say-secondary" onClick={speakNow}><Volume2 size={12}/> Browser voice instead</button>
      </div>}

      {status === "ttsOnly" && <div className="wh-say-body">
        <button className="wh-say-play" onClick={speak}><Volume2 size={16}/> Play</button>
        {!ttsIsUS && <p className="wh-say-muted">No American voice is installed on this device, so the accent may differ.</p>}
      </div>}

      <a className="wh-say-link" href={youglishUrl} target="_blank" rel="noopener noreferrer">Hear real Americans say it on YouGlish →</a>
    </div>
  </div>;
}
