// The screens after a round, each one a card with a stamp, a title, the
// numbers and the buttons. They only show what they are given.
const TITLE = { fontFamily: "'Special Elite', monospace", fontSize: 20 };
const Card = ({ stamp, children }) => <div className="wh-results-card"><div className="wh-results-stamp">{stamp}</div>{children}</div>;

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
