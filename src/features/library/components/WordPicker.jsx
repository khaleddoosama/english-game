import { useMemo, useState } from "react";
import { V2 } from "../../../engine/v2";
import { NO_UNIT, inUnit, unitOptions } from "../../../engine/units";
import { searchWords } from "../libraryTree";
import { count } from "./format";

const PAGE = 60;

// Picking words from a list: search, narrow by lesson, course level and unit
// (the content's `units`; the options come only from `words`), tick one by
// one or "Select all shown", and see what is already in. The picker only
// shows and reports; the caller owns the selection and what to do with it.
//   words     - the pool to pick from          selected - Set of picked keys
//   disabled  - keys that are already in (shown ticked, can't be changed)
//   onToggle(key)    onSetMany(keys, on)    empty(query) - what to show when nothing matches
//   tagOf(key) - a small note after a word (for example how many views it is in)
export default function WordPicker({ words, selected, onToggle, onSetMany, disabled = new Set(), disabledLabel = "already in", tagOf = null, keyOf = (w) => w.word, nameOf = (w) => w.word, noun = "word", placeholder = "Search by word or meaning", searchLabel = "Search words", empty = null, children }) {
  const [query, setQuery] = useState("");
  const [lesson, setLesson] = useState("");
  const [level, setLevel] = useState("");
  const [unit, setUnit] = useState("");
  const [shown, setShown] = useState(PAGE);

  const lessons = useMemo(() => [...new Set(words.map((w) => w.category).filter(Boolean))].sort(), [words]);
  const levels = useMemo(() => [...new Set(words.map((w) => V2.courseLevelOf(w)).filter(Boolean))].sort((a, b) => V2.courseLevelRank(a) - V2.courseLevelRank(b)), [words]);
  const units = useMemo(() => unitOptions(words), [words]);
  const list = useMemo(() => {
    const base = query.trim() ? searchWords(words, query, 5000) : words;
    return base.filter((w) => (!lesson || w.category === lesson) && (!level || V2.courseLevelOf(w) === level) && inUnit(w, unit));
  }, [words, query, lesson, level, unit]);
  const pickable = list.filter((w) => !disabled.has(keyOf(w)));
  const allPicked = pickable.length > 0 && pickable.every((w) => selected.has(keyOf(w)));
  const reset = (fn) => (e) => { fn(e.target.value); setShown(PAGE); };
  const allUnits = () => { setUnit(""); setShown(PAGE); };
  // A unit picked earlier that this list no longer has stays shown as picked, so the empty list makes sense.
  const staleUnit = unit && unit !== NO_UNIT && !units.includes(unit);

  return (
    <div className="lib-picker">
      <input className="lib-search" value={query} onChange={reset(setQuery)} placeholder={placeholder} aria-label={searchLabel} />
      {(lessons.length > 1 || levels.length > 0 || units.length > 0 || unit) && (
        <div className="lib-filters">
          {lessons.length > 1 && (
            <select value={lesson} onChange={reset(setLesson)} aria-label="Lesson">
              <option value="">All lessons</option>
              {lessons.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {levels.length > 0 && (
            <select value={level} onChange={reset(setLevel)} aria-label="Course level">
              <option value="">All levels</option>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {(units.length > 0 || unit) && (
            <select value={unit} onChange={reset(setUnit)} aria-label="Unit">
              <option value="">All units</option>
              <option value={NO_UNIT}>Without unit</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
              {staleUnit && <option value={unit}>{unit}</option>}
            </select>
          )}
        </div>
      )}
      {children}
      {list.length > 0 && (
        <>
          <div className="lib-pickbar">
            <span>{count(list.length, noun)} shown · {selected.size} selected</span>
            <span>
              <button className="lib-link" disabled={!pickable.length} onClick={() => onSetMany(pickable.map(keyOf), !allPicked)}>{allPicked ? "Clear shown" : `Select all shown (${pickable.length})`}</button>
            </span>
          </div>
          <ul className="lib-results">
            {list.slice(0, shown).map((w) => {
              const key = keyOf(w), inAlready = disabled.has(key);
              return (
                <li key={key} className={inAlready ? "in" : ""}>
                  <label>
                    <input type="checkbox" checked={inAlready || selected.has(key)} disabled={inAlready} onChange={() => onToggle(key)} />
                    <b>{nameOf(w)}</b><small>{w.meaning}</small>
                    {inAlready ? <i className="lib-tag">{disabledLabel}</i> : tagOf && tagOf(key) && <i className="lib-tag">{tagOf(key)}</i>}
                  </label>
                </li>
              );
            })}
          </ul>
          {list.length > shown && <button className="lib-link" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
        </>
      )}
      {!list.length && (unit
        ? <p className="ui-muted">No {noun}s match {unit === NO_UNIT ? "without a unit" : <>in “{unit}”</>}. <button className="lib-link" onClick={allUnits}>Show all units</button></p>
        : empty && empty(query.trim()))}
    </div>
  );
}
