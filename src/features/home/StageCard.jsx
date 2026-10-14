import { GraduationCap, Play } from "lucide-react";
import { levelStageBreakdown } from "../../engine/data";

// One card of Home: a title, what it holds, a bar and the counts of how far
// the player is (mastered · learned · familiar · new), and a Practice button.
// Used for course levels and sessions and for the player's own views.
//   items   - [{ kind, obj }] the card's words and rules (for the progress)
//   actions - extra buttons before Practice (edit, add a view inside)
export default function StageCard({ title, meta, items, mastery, onPlay, disabled = false, actions = null, icon = <GraduationCap size={20} />, playClass = "wh-level-btn" }) {
  const c = levelStageBreakdown({ items }, mastery);
  const pct = (n) => `${items.length ? (n / items.length) * 100 : 0}%`;
  return (
    <div className="wh-level-card">
      <div className="wh-level-icon">{icon}</div>
      <div className="wh-level-info">
        <div className="wh-level-title">{title}</div>
        <div className="wh-level-meta">{meta}</div>
        <div className="wh-level-stage-bar" aria-hidden="true">
          <span className="wh-level-stage-seg mastered" style={{ width: pct(c.Mastered) }} />
          <span className="wh-level-stage-seg learned" style={{ width: pct(c.Learned) }} />
          <span className="wh-level-stage-seg familiar" style={{ width: pct(c.Familiar) }} />
        </div>
        <div className="wh-level-meta wh-level-stage-detail">{c.Mastered} mastered · {c.Learned} learned · {c.Familiar} familiar · {c.New} new</div>
      </div>
      {actions}
      <button className={playClass} disabled={disabled} onClick={onPlay}><Play size={13} /> Practice</button>
    </div>
  );
}
