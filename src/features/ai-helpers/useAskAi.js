// Ask AI about a word: the drawer's state, the question to the AI, and (admin) adding the answer to the course. The
// pronunciation window's term is kept here too. The steps with no state are in askAiRules.js. Docs:
// docs/modules/ai-media/ask-ai.md.
import { useEffect, useRef, useState } from "react";
import { V2 } from "../../engine/v2";
import { askAiForWord } from "../../lib/aiPrompts";
import { cancelAiTasks } from "../../lib/aiOperations";
import { aiWordEntry, aiWordProblem, askTerm } from "./askAiRules";

const TASK = "Ask AI about a word";

// isAdmin          only the admin can add a word
// liveContent()    the live content, to check a new word against
// content          { customWords, customGrammar, customChallenges }
// set              { setCustomWords, setDataVersion, setToast }
// contextCategory  the category the player is on (contextCategoryOf), or null
// onWordAdded(entry)   after a word is added (the shell keeps it in the admin's library)
export function useAskAi({ isAdmin, gameContent, setGameContent, liveContent, content, set, contextCategory, onWordAdded }) {
  const { customWords, customGrammar, customChallenges } = content;
  const { setCustomWords, setDataVersion, setToast } = set;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [listenTerm, setListenTerm] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // An answer for an older question, or one that arrives after the drawer closed, is dropped.
  const epoch = useRef(0);

  useEffect(() => { if (!open) { epoch.current++; cancelAiTasks([TASK]); setBusy(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [open]);

  async function openAskAi(raw = "") {
    const clean = askTerm(raw);
    setOpen(true); setError(null); setResult(null);
    if (clean) { setTerm(clean); await runAskAi(clean); }
  }

  async function runAskAi(raw = term) {
    const clean = String(raw || "").trim(); if (!clean) return;
    const mine = ++epoch.current;
    cancelAiTasks([TASK]);
    setBusy(true); setError(null); setResult(null);
    try {
      const existing = V2.findWord(gameContent().words, clean);
      const answer = await askAiForWord(clean, existing);
      if (mine !== epoch.current) return;
      setResult({ ...answer, alreadyInCollection: !!(existing || V2.findWord(gameContent().words, answer.word)) });
    } catch (e) {
      if (mine !== epoch.current) return;
      console.error("Ask AI failed", e);
      setError(e.message || "AI explanation is unavailable. Try again.");
    } finally { if (mine === epoch.current) setBusy(false); }
  }

  function addAiWord() {
    if (!isAdmin || !result || result.alreadyInCollection) return;
    const entry = aiWordEntry(result, contextCategory);
    const problem = aiWordProblem(entry, liveContent());
    if (problem) { setError(problem); return; }
    const next = [...customWords, entry];
    setGameContent(next, customGrammar, customChallenges, gameContent().levelOrder);
    setCustomWords(next); setDataVersion((v) => v + 1);
    setResult((previous) => ({ ...previous, alreadyInCollection: true }));
    setToast({ kind: "import", text: `${entry.word} added to your collection` });
    onWordAdded(entry);
  }

  return { open, setOpen, term, setTerm, listenTerm, setListenTerm, result, busy, error, openAskAi, runAskAi, addAiWord };
}
