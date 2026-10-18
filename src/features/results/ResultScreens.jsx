import { normalizeAnswerText } from "../../engine/text";

// The screens after a round, each one a card with a stamp, a title, the
// numbers and the buttons. They only show what they are given.
const TITLE = { fontFamily: "'Special Elite', monospace", fontSize: 20 };
const Card = ({ stamp, children }) => <div className="wh-results-card"><div className="wh-results-stamp">{stamp}</div>{children}</div>;

// The Final Case: write a short report using the evidence words.
export function FinalReport({ level, recall, words, text, onText, evidenceUsed, busy, error, onSubmit, onBack }) {
  const used = (word) => normalizeAnswerText(text).includes(normalizeAnswerText(word));
  return (
    <Card stamp="RECALL SECURED">
      <div style={TITLE}>FINAL CASE — {level.title}</div>
      <div className="wh-results-score">Recall: <b>{recall.correct}/{recall.total}</b> correct</div>
      <div className="wh-case-report">
        <div style={{ fontFamily: "'Special Elite', monospace", fontSize: 18 }}>CASE REPORT</div>
        <div className="wh-results-note">Write 1–3 understandable sentences using the evidence words naturally. AI checks meaning, not just string presence.</div>
        <div className="wh-evidence-list">{words.map((w) => <span key={w.word} className={`wh-evidence-chip ${used(w.word) ? "used" : ""}`}>{used(w.word) ? "✓ " : ""}{w.word}</span>)}</div>
        <textarea value={text} onChange={(e) => onText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (text.trim() && !busy) onSubmit(); } }} placeholder="Write your case report here…" disabled={busy} />
        <div className="wh-results-note">Evidence text detected: {evidenceUsed}/{words.length}. Semantic credit is decided only after evaluation.</div>
        {error && <div className="wh-feedback-card">{error}</div>}
      </div>
      <div className="wh-results-actions"><button className="primary" onClick={onSubmit} disabled={!text.trim() || busy}>{busy ? "Examining report…" : "Submit Case Report"}</button><button className="secondary" onClick={onBack}>Leave Case</button></div>
    </Card>
  );
}

// The verdict on the Final Case report.
export function FinalResults({ level, result, onBack }) {
  return (
    <Card stamp="FINAL CASE SOLVED">
      <div style={TITLE}>{level.title}</div>
      <div className="wh-results-score">Report quality: <b>{result.quality}</b></div>
      <div className="wh-evidence-list">{result.words.map((item) => <span key={item.word} className={`wh-evidence-chip ${item.productionSuccess ? "used" : ""}`}>{item.word} {item.productionSuccess ? "✅" : item.used ? "⚠️" : "❌"}</span>)}</div>
      <div className="wh-results-note">{result.feedback || "Production evidence was recorded only for words used with the correct meaning. Normal mastery requirements still apply."}</div>
      <div className="wh-results-actions"><button className="secondary" onClick={onBack}>Back to levels</button></div>
    </Card>
  );
}

// After the Speed Round.
export function SpeedResults({ score, correct, answered, bestCombo, best, onAgain, onBack }) {
  return (
    <Card stamp="Time's Up">
      <div style={TITLE}>Speed Round</div>
      <div className="wh-results-score"><b>{score}</b> points — {correct}/{answered} correct · best combo x{bestCombo}</div>
      {score >= best && score > 0 && <div className="wh-results-unlock">🏆 New best score!</div>}
      <div className="wh-results-actions">
        <button className="primary" onClick={onAgain}>Play again</button>
        <button className="secondary" onClick={onBack}>Back to levels</button>
      </div>
    </Card>
  );
}
