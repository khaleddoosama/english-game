import { BookOpen, CheckCircle2, Lock, Play, Trash2 } from "lucide-react";
import { TOPIC_ICONS, formatStars, levelGroups, levelStageBreakdown } from "../../engine/data";

// By lesson: each lesson with how far the player is in it, its course units,
// and Practice and Final Case buttons. `levels` is what is shown (a player who
// sees only their library gets the lessons cut down to it); `indexOf(level)` is
// the lesson's place in the whole course, which the round is started from.
export default function LessonsView({ levels, indexOf, mastery, isAdmin, emptyLibrary = false, isUnlocked, clearedSet, starsOf, onStart, onFinalCase, onDelete, onOpenLibrary, onOpenCatalog }) {
  return (
    <div className="wh-levels-list">
      {emptyLibrary && (
        <div className="lib-empty">
          <p><b>Your library is empty.</b> Add words to your library and they show up here, in their lessons. Take a ready-made course from the <b>Catalog</b>, or open your library to add words yourself.</p>
          <button className="wh-level-btn" onClick={onOpenCatalog}>Browse the catalog</button> <button className="wh-level-btn" onClick={onOpenLibrary}>Open my library</button>
        </div>
      )}
      {levels.map((level) => {
        const i = indexOf(level);
        const unlocked = isUnlocked(i);
        const cleared = clearedSet.has(level.id);
        const counts = levelStageBreakdown(level, mastery);
        const LevelIcon = TOPIC_ICONS[level.title] || BookOpen;
        const units = levelGroups(level).filter((g) => g.id);        // the lesson's course units: a view inside the lesson
        const pct = (n) => `${(n / level.items.length) * 100}%`;
        return (
          <div key={level.id} className={`wh-level-card ${unlocked ? "" : "locked"}`}>
            {isAdmin && <button className="wh-level-delete-btn" title="Delete category" onClick={(e) => { e.stopPropagation(); onDelete(level); }}><Trash2 size={14} /></button>}
            <div className="wh-level-num">{String(i + 1).padStart(2, "0")}</div>
            <div className="wh-level-icon"><LevelIcon size={20} /></div>
            <div className="wh-level-info">
              <div className="wh-level-title">{level.title}{cleared && <CheckCircle2 size={14} color="var(--green, #4f7942)" />}</div>
              <div className="wh-level-meta">{level.items.length} words · {formatStars(starsOf(level.id))}</div>
              <div className="wh-level-stage-bar" aria-hidden="true">
                {level.items.length > 0 && (
                  <>
                    <span className="wh-level-stage-seg mastered" style={{ width: pct(counts.Mastered) }} />
                    <span className="wh-level-stage-seg learned" style={{ width: pct(counts.Learned) }} />
                    <span className="wh-level-stage-seg familiar" style={{ width: pct(counts.Familiar) }} />
                  </>
                )}
              </div>
              <div className="wh-level-meta wh-level-stage-detail">{counts.Mastered} mastered · {counts.Learned} learned · {counts.Familiar} familiar · {counts.New} new</div>
              {units.length > 0 && (
                <details className="wh-level-units">
                  <summary>{units.length} unit{units.length === 1 ? "" : "s"}</summary>
                  <ul>
                    {units.map((g) => (
                      <li key={g.id}>
                        <span>{g.title}<small>{g.items.length} word{g.items.length === 1 ? "" : "s"}</small></span>
                        <button className="wh-level-btn" disabled={!unlocked} onClick={() => onStart(i, g)}>{unlocked ? <Play size={13} /> : <Lock size={13} />} Practice</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <button className="wh-level-btn" disabled={!unlocked} onClick={() => onStart(i)}>
              {unlocked ? <Play size={13} /> : <Lock size={13} />}
              {cleared ? "Practice again" : unlocked ? "Practice" : "Locked"}
            </button>
            <button className="wh-back-btn" disabled={starsOf(level.id) < 1} title="Available after earning one star in Practice" onClick={() => onFinalCase(i)}>Final Case</button>
          </div>
        );
      })}
    </div>
  );
}
