// Before/after views for the activity log and AI fixes: which fields
// changed, and inside a changed text, which words.

const isPlain = (v) => v == null || typeof v !== "object";
const show = (v) => (v === undefined || v === null || v === "" ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

// { field: { before, after } } -> rows for the fields that differ.
export function fieldChanges(before, after) {
  const a = before || {}, b = after || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys
    .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
    .map((k) => ({ field: k, before: a[k], after: b[k] }));
}
export const changesToRows = (changes) => Object.entries(changes || {}).map(([field, v]) => ({ field, before: v?.before, after: v?.after }));

// Word-level diff (longest common subsequence over words and spaces).
export function wordDiff(before, after, maxTokens = 600) {
  const split = (s) => String(s ?? "").split(/(\s+)/).filter((t) => t !== "");
  const a = split(before), b = split(after);
  if (a.length * b.length > maxTokens * maxTokens) return [...a.map((t) => ({ t, op: "del" })), ...b.map((t) => ({ t, op: "ins" }))];
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ t: a[i], op: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], op: "del" });
    else out.push({ t: b[j++], op: "ins" });
  }
  while (i < a.length) out.push({ t: a[i++], op: "del" });
  while (j < b.length) out.push({ t: b[j++], op: "ins" });
  // Merge neighbours with the same op for tidier markup.
  return out.reduce((acc, x) => { const last = acc[acc.length - 1]; if (last && last.op === x.op) last.t += x.t; else acc.push({ ...x }); return acc; }, []);
}

// Arrays of strings: what was added and removed.
export function listDiff(before, after) {
  const a = Array.isArray(before) ? before.map(String) : [], b = Array.isArray(after) ? after.map(String) : [];
  return { removed: a.filter((x) => !b.includes(x)), added: b.filter((x) => !a.includes(x)), kept: b.filter((x) => a.includes(x)) };
}

// side "before": unchanged words plain, removed words marked; "after":
// unchanged plain, added words marked.
function Inline({ before, after, side }) {
  const parts = wordDiff(before, after).filter((p) => p.op === "same" || p.op === (side === "before" ? "del" : "ins"));
  return <span className="adm-diff-inline">{parts.map((p, i) => (p.op === "same" ? <span key={i}>{p.t}</span> : p.op === "del" ? <del key={i}>{p.t}</del> : <ins key={i}>{p.t}</ins>))}</span>;
}
function Chips({ items, mark, tag: Tag }) {
  return <span className="adm-diff-list">{items.map((x) => (mark.has(x) ? <Tag key={x} className="adm-chip">{x}</Tag> : <span key={x} className="adm-chip">{x}</span>))}{!items.length && <span className="adm-muted">(none)</span>}</span>;
}

function Value({ value, tone }) {
  if (value === undefined || value === null || value === "") return <span className="adm-muted">(empty)</span>;
  return isPlain(value) ? <span className={tone}>{String(value)}</span> : <pre className={`adm-diff-json ${tone || ""}`}>{show(value)}</pre>;
}

// rows: [{ field, before, after }]; mode "update" shows both sides,
// "create" only after, "delete" only before.
export function DiffTable({ rows, mode = "update", labels = {} }) {
  if (!rows?.length) return <p className="adm-muted">No field changed.</p>;
  return (
    <table className={`adm-diff ${mode}`}>
      <thead><tr><th>Field</th>{mode !== "create" && <th>Before</th>}{mode !== "delete" && <th>After</th>}</tr></thead>
      <tbody>
        {rows.map(({ field, before, after }) => {
          const strings = typeof before === "string" && typeof after === "string";
          const lists = Array.isArray(before) && Array.isArray(after) && [...before, ...after].every((x) => isPlain(x));
          const l = lists ? listDiff(before, after) : null;
          return (
            <tr key={field} className="changed">
              <th scope="row">{labels[field] || field}</th>
              {mode !== "create" && <td>
                {strings ? <Inline before={before} after={after} side="before" />
                  : lists ? <Chips items={before.map(String)} mark={new Set(l.removed)} tag="del" />
                  : <Value value={before} tone={mode === "delete" ? "" : "adm-diff-old"} />}
              </td>}
              {mode !== "delete" && <td>
                {strings ? <Inline before={before} after={after} side="after" />
                  : lists ? <Chips items={after.map(String)} mark={new Set(l.added)} tag="ins" />
                  : <Value value={after} tone={mode === "create" ? "" : "adm-diff-new"} />}
              </td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
