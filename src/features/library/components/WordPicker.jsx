import { useMemo, useState } from "react";
import { V2 } from "../../../engine/v2";
import { searchWords } from "../libraryTree";
import { count } from "./format";

const PAGE = 60;

// Picking words from a list: search, narrow by lesson and course level, tick
// one by one or "Select all shown", and see what is already in. The picker
// only shows and reports; the caller owns the selection and what to do with it.
//   words     - the pool to pick from          selected - Set of picked keys
//   disabled  - keys that are already in (shown ticked, can't be changed)
//   onToggle(key)    onSetMany(keys, on)    empty(query) - what to show when nothing matches
//   tagOf(key) - a small note after a word (for example how many views it is in)
export default function WordPicker({ words, selected, onToggle, onSetMany, disabled = new Set(), disabledLabel = "already in", tagOf = null, placeholder = "Search by word or meaning", searchLabel = "Search words", empty = null, children }) {
  const [query, setQuery] = useState("");
  const [lesson, setLesson] = useState("");
  const [level, setLevel] = useState("");
  const [shown, setShown] = useState(PAGE);

  const lessons = useMemo(() => [...new Set(words.map((w) => w.category).filter(Boolean))].sort(), [words]);
  const levels = useMemo(() => [...new Set(words.map((w) => V2.courseLevelOf(w)).filter(Boolean))].sort((a, b) => V2.courseLevelRank(a) - V2.courseLevelRank(b)), [words]);
  const list = useMemo(() => {
    const base = query.trim() ? searchWords(words, query, 5000) : words;
    return base.filter((w) => (!lesson || w.category === lesson) && (!level || V2.courseLevelOf(w) === level));
  }, [words, query, lesson, level]);
  const pickable = list.filter((w) => !disabled.has(w.word));
  const allPicked = pickable.length > 0 && pickable.every((w) => selected.has(w.word));
  const reset = (fn) => (e) => { fn(e.target.value); setShown(PAGE); };

  return (
    <div className="lib-picker">
      <input className="lib-search" value={query} onChange={reset(setQuery)} placeholder={placeholder} aria-label={searchLabel} />
      {(lessons.length > 1 || levels.length > 0) && (
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
        </div>
      )}
      {children}
      {list.length > 0 && (
        <>
          <div className="lib-pickbar">
            <span>{count(list.length, "word")} shown · {selected.size} selected</span>
            <span>
              <button className="lib-link" disabled={!pickable.length} onClick={() => onSetMany(pickable.map((w) => w.word), !allPicked)}>{allPicked ? "Clear shown" : `Select all shown (${pickable.length})`}</button>
            </span>
          </div>
          <ul className="lib-results">
            {list.slice(0, shown).map((w) => {
              const inAlready = disabled.has(w.word);
              return (
                <li key={w.word} className={inAlready ? "in" : ""}>
                  <label>
                    <input type="checkbox" checked={inAlready || selected.has(w.word)} disabled={inAlready} onChange={() => onToggle(w.word)} />
                    <b>{w.word}</b><small>{w.meaning}</small>
                    {inAlready ? <i className="lib-tag">{disabledLabel}</i> : tagOf && tagOf(w.word) && <i className="lib-tag">{tagOf(w.word)}</i>}
                  </label>
                </li>
              );
            })}
          </ul>
          {list.length > shown && <button className="lib-link" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
        </>
      )}
      {!list.length && empty && empty(query.trim())}
    </div>
  );
}
