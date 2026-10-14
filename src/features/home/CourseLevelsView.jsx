import StageCard from "./StageCard";
import { describeItems } from "./homeState";

// The Gateway course: each course level (A1.1 …) with its sessions, from the
// course content. `levels` and `none` come from courseLevelGroups().
//   onPlay(title, items) - practise a card's items (when the player only sees their library)
//   onStartLevel(level, part) - practise a level or one of its sessions
export default function CourseLevelsView({ levels, none, mastery, limited = false, onPlay, onStartLevel }) {
  const card = (key, title, items, start) => (
    <StageCard key={key} title={title} meta={describeItems(items)} items={items} mastery={mastery} onPlay={limited ? () => onPlay(title, items) : start} />
  );
  const sessions = (n) => (n ? ` · ${n} session${n === 1 ? "" : "s"}` : "");
  return (
    <div className="wh-levels-list wh-course-levels">
      {!levels.length && <p className="wh-course-empty">No words have a course level yet. Give a word its course level (for example <b>A1.2</b>, or the Gateway level, <b>Level-4</b>) and its session in <b>units</b>, in the import file or the word editor, and it shows here.</p>}
      {levels.map((level) => (
        <div key={level.id} className="wh-level-group-block">
          <h3 className="wh-level-group-heading">{level.id}{level.gateway && <small> · Gateway level {level.gateway}</small>} <small>{describeItems(level.items)}{sessions(level.sessions.length)}</small></h3>
          {level.sessions.length > 0 && card(`${level.id}-all`, `All of ${level.id}`, level.items, () => onStartLevel(level))}
          {level.sessions.map((s) => card(`${level.id}-${s.unit}`, s.title, s.items, () => onStartLevel(level, { unit: s.unit, title: s.title })))}
          {level.sessions.length > 0 && level.unsorted.length > 0 && card(`${level.id}-other`, "Other words", level.unsorted, () => onStartLevel(level, { noUnit: true }))}
          {!level.sessions.length && card(`${level.id}-all`, level.id, level.items, () => onStartLevel(level))}
        </div>
      ))}
      {none.length > 0 && (
        <div className="wh-level-group-block">
          <h3 className="wh-level-group-heading">No course level yet <small>{describeItems(none)}</small></h3>
          {card("none", "Words without a course level", none, () => onStartLevel(null))}
        </div>
      )}
    </div>
  );
}
