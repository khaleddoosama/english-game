// The Ask AI drawer and the pronunciation window it shares with the header. ask: what useAskAi returns.
// Docs: docs/modules/ai-media/ask-ai.md.
import { Volume2, X } from "lucide-react";
import { PronunciationModal } from "../media/media";

export function AskAiDrawer({ ask, isAdmin }) {
  const { open, setOpen, term, setTerm, listenTerm, setListenTerm, result, busy, error, runAskAi, addAiWord } = ask;
  return <>
    <PronunciationModal term={listenTerm} onClose={() => setListenTerm(null)} />
    {open && <div className="wh-ai-drawer" role="dialog" aria-modal="true" aria-label="Ask AI about a word" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <aside className="wh-ai-drawer-card">
        <div className="wh-ai-drawer-head"><div><div className="wh-ai-meta">WORD HUNTER FIELD GUIDE</div><h2>Ask AI</h2></div><button className="wh-icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button></div>
        <div className="wh-type-form"><input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); runAskAi(); } }} placeholder="Type a word or short phrase…" /><button className="wh-level-btn" disabled={busy || !term.trim()} onClick={() => runAskAi()}>{busy ? "Investigating…" : "Explain"}</button></div>
        <p className="wh-ai-meta">Tip: select a word inside any question or story to open this panel automatically.</p>
        {error && <div className="wh-import-error">{error}</div>}
        {result && <article className="wh-ai-card">
          <h2>{result.word}</h2><div className="wh-ai-meta">{result.partsOfSpeech?.length > 0 && <b>{result.partsOfSpeech.join(" / ")}</b>}{result.partsOfSpeech?.length > 0 && " · "}{result.type} · {result.category} · {result.pronunciation}</div>
          <p><b>Meaning:</b> {result.meaning}</p><p><b>Example:</b> {result.situation}</p>
          {!!result.nearWords?.length && <><b>Close words:</b>{result.nearWords.map((item) => <p key={item.word}><b>{item.word}:</b> {item.difference}</p>)}</>}
          {result.commonMistake && <p><b>Common mistake:</b> {result.commonMistake.sentence}<br /><b>Better:</b> {result.commonMistake.correction}<br />{result.commonMistake.why}</p>}
          <div className="wh-ai-actions"><button className="wh-back-btn" onClick={() => setListenTerm(result.word)}><Volume2 size={13} /> Listen</button>{result.alreadyInCollection ? <span className="wh-results-unlock">Already in your collection</span> : isAdmin ? <button className="wh-level-btn" onClick={() => addAiWord()}>Add to Collection</button> : null}</div>
        </article>}
      </aside>
    </div>}
  </>;
}
