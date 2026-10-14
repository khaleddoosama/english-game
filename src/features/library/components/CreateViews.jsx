import { useState } from "react";
import { FolderPlus } from "lucide-react";

// Make a view at the top level, or start one from a course level (its words
// and rules go in at once).
export default function CreateViews({ api, ids, levels, busy, act, onCreated, autoFocus = false }) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");

  async function create(e) {
    e.preventDefault();
    const id = await act(() => api.create(name), `Created “${name.trim()}”.`);
    if (id) { setName(""); onCreated(id); }
  }
  async function fromLevel() {
    const lv = levels.find((l) => l.id === level);
    if (!lv) return;
    const id = await act(async () => {
      const made = await api.create(lv.id);
      const words = lv.items.filter((i) => i.kind === "word").map((i) => ids.senseOf(i.obj.word)).filter(Boolean);
      const rules = lv.items.filter((i) => i.kind === "grammar").map((i) => ids.ruleOf(i.obj.id)).filter(Boolean);
      for (let i = 0; i < words.length; i += 200) await api.add(made, words.slice(i, i + 200));
      for (let i = 0; i < rules.length; i += 200) await api.addRules(made, rules.slice(i, i + 200));
      return made;
    }, `Made a view from ${lv.id}.`);
    if (id) { setLevel(""); onCreated(id); }
  }

  return (
    <div className="lib-make">
      <form onSubmit={create} className="lib-inline">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New view, e.g. A1.1" aria-label="New view name" autoFocus={autoFocus} />
        <button className="ui-row-btn" disabled={busy || !name.trim()}><FolderPlus size={15} /> Create</button>
      </form>
      {levels.length > 0 && (
        <div className="lib-inline">
          <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Start from a course level">
            <option value="">…or start from a course level</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.id} · {l.items.length} items</option>)}
          </select>
          <button className="ui-row-btn" disabled={busy || !level} onClick={fromLevel}>Make it</button>
        </div>
      )}
    </div>
  );
}
