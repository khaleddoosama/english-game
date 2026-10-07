import { useCancelAiOnLeave } from "../../../lib/aiLifecycle.js";
// Word editor (Admin -> Words -> a word, or New word): every field as a
// form, the picture (upload, copy from a link, remove), AI to fill empty
// fields, and an "as JSON" view for anything unusual. Saving validates the
// word the same way imports do.
import { useMemo, useState } from "react";
import { Code2, ImagePlus, Link2, Sparkles, Trash2, X } from "lucide-react";
import { V2 } from "../../../engine/v2";
import { askAiForWord } from "../../../engine/ai";
import { IMAGE_LINKS, WordPicture, checkImageLink } from "../../media/media";
import { importImageLink, uploadWordImage } from "../../../lib/images";
import { Badge, ConfirmDialog, Drawer, Notice } from "../adminUi";

const TYPES = ["vocab", "idiom", "phrasal", "binomial", "fyi"];
// The level: a course level (A1.2 …, shown in "By course level", its
// sessions are the word's units) or a plain difficulty (A1 – C2).
const LEVELS = ["", ...V2.COURSE_LEVELS, "A1", "A2", "B1", "B2", "C1", "C2"];
const lines = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
const commas = (v) => String(v || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const ARABIC = /[؀-ۿ]/;

// Word -> form fields (strings), and back. Lists may be missing or, in
// older content, plain text; both show as text.
const arr = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const familyText = (v) => (Array.isArray(v) ? v.map((f) => (f && typeof f === "object" ? (f.pos ? `${f.pos}: ${f.word}` : f.word) : String(f))).join("\n") : v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
export function toForm(w = {}) {
  const situations = Array.isArray(w.situations) && w.situations.length ? w.situations : w.situation ? [w.situation] : [];
  const gaps = Array.isArray(w.gaps) && w.gaps.length ? w.gaps : w.gap ? [w.gap] : [];
  const mistake = w.commonMistake || (Array.isArray(w.commonMistakes) ? w.commonMistakes[0] : null) || {};
  return {
    word: w.word || "", type: w.type || "vocab", category: w.category || "", subCategory: w.subCategory || "", units: arr(w.units).join(", "),
    level: w.level || "", register: w.register || "", partsOfSpeech: arr(w.partsOfSpeech).join(", "),
    meaning: w.meaning || "", situations: situations.join("\n"), gaps: gaps.join("\n"), hints: arr(w.hints).join("\n"),
    synonyms: arr(w.synonyms).join(", "), antonyms: arr(w.antonyms).join(", "), opposite: w.opposite || "",
    collocations: arr(w.collocations).join("\n"), wordFamily: familyText(w.wordFamily),
    mistakeSentence: mistake.sentence || "", mistakeCorrection: mistake.correction || "", mistakeWhy: mistake.why || "",
  };
}
export function fromForm(f, base = {}) {
  const situations = lines(f.situations), gaps = lines(f.gaps);
  const mistake = f.mistakeSentence.trim() || f.mistakeCorrection.trim() ? { sentence: f.mistakeSentence.trim(), correction: f.mistakeCorrection.trim(), why: f.mistakeWhy.trim() } : null;
  const next = {
    ...base,
    word: f.word.trim(), type: f.type, category: f.category.trim(), subCategory: f.subCategory.trim() || undefined, units: commas(f.units),
    level: f.level || undefined, register: f.register.trim() || undefined, partsOfSpeech: commas(f.partsOfSpeech),
    meaning: f.meaning.trim(), situation: situations[0] || "", situations, gap: gaps[0] || "", gaps, hints: lines(f.hints),
    synonyms: commas(f.synonyms), antonyms: commas(f.antonyms), opposite: f.opposite.trim() || undefined,
    collocations: lines(f.collocations),
    wordFamily: lines(f.wordFamily).map((l) => { const m = /^([a-z ]+):\s*(.+)$/i.exec(l); return m ? { pos: m[1].trim().toLowerCase(), word: m[2].trim() } : { word: l }; }),
    commonMistake: mistake || undefined, commonMistakes: mistake ? [mistake] : undefined,
  };
  // Keep the saved word tidy: no empty lists or undefined keys.
  for (const [k, v] of Object.entries(next)) if (v === undefined || (Array.isArray(v) && !v.length && !(k in base))) delete next[k];
  // One sentence stays a single field unless the word already had lists.
  if (!Array.isArray(base.situations) && (next.situations || []).length <= 1) delete next.situations;
  if (!Array.isArray(base.gaps) && (next.gaps || []).length <= 1) delete next.gaps;
  if (!Array.isArray(base.commonMistakes)) delete next.commonMistakes;
  // Fields the admin didn't touch keep their exact original values, so
  // saving never reshapes a word (and the Activity log shows real edits).
  const orig = toForm(base);
  if (Object.keys(base).length) for (const [formKeys, itemKeys] of GROUPS) {
    if (formKeys.every((k) => f[k] === orig[k])) for (const k of itemKeys) { if (k in base) next[k] = base[k]; else delete next[k]; }
  }
  return next;
}
const GROUPS = [
  [["word"], ["word"]], [["type"], ["type"]], [["category"], ["category"]], [["subCategory"], ["subCategory"]], [["units"], ["units"]],
  [["level"], ["level"]], [["register"], ["register"]], [["partsOfSpeech"], ["partsOfSpeech"]], [["meaning"], ["meaning"]],
  [["situations"], ["situation", "situations"]], [["gaps"], ["gap", "gaps"]], [["hints"], ["hints"]], [["synonyms"], ["synonyms"]],
  [["antonyms"], ["antonyms"]], [["opposite"], ["opposite"]], [["collocations"], ["collocations"]], [["wordFamily"], ["wordFamily"]],
  [["mistakeSentence", "mistakeCorrection", "mistakeWhy"], ["commonMistake", "commonMistakes"]],
];
// Same content regardless of key order.
export const sameItem = (a, b) => stable(a) === stable(b);
function stable(v) { return JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)); }

export function wordProblems(item, all, original) {
  const out = [];
  if (!item.word) out.push("The word can't be empty.");
  else if (all.some((w) => w !== original && V2.norm(w.word) === V2.norm(item.word))) out.push(`“${item.word}” already exists.`);
  if (!item.category) out.push("Pick or type a category.");
  if (ARABIC.test(JSON.stringify(item))) out.push("Game content must be in English only (no Arabic).");
  if (item.gap && !/_{2,}/.test(item.gap)) out.push("The first gap sentence needs a blank: ___");
  return out;
}

export function Area({ label, hint, value, onChange, rows = 2, mono }) {
  return <label className="adm-field"><span>{label}{hint && <small className="adm-muted"> · {hint}</small>}</span><textarea className={`adm-input adm-textarea ${mono ? "mono" : ""}`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
export function Text({ label, hint, value, onChange, list, placeholder, readOnly = false }) {
  return <label className="adm-field"><span>{label}{hint && <small className="adm-muted"> · {hint}</small>}</span><input className="adm-input" value={value} readOnly={readOnly} list={list} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function WordEditor({ word, content, stats, onSave, onDelete, onClose, personal = false, generateWord }) {
  const isNew = !word;
  const words = content.words || [];
  const categories = useMemo(() => [...new Set([...(content.levels || []).map((l) => l.title), ...words.map((w) => w.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b)), [content, words]);
  const [form, setForm] = useState(() => toForm(word || { type: "vocab", category: "" }));
  const [extra, setExtra] = useState(() => ({ image: word?.image, illustration: word?.illustration })); // picture fields
  const [json, setJson] = useState(null); // string while editing as JSON
  const [errors, setErrors] = useState([]);
  const [note, setNote] = useState(null);
  useCancelAiOnLeave(['Ask AI about a word', 'Add a word to my library'], word?.word);
  const [busy, setBusy] = useState(null);
  const [link, setLink] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrors([]); };
  const item = useMemo(() => {
    const next = fromForm(form, word || {});
    delete next.image; delete next.illustration;
    if (extra.image) next.image = extra.image;
    if (extra.illustration) next.illustration = extra.illustration;
    return next;
  }, [form, extra, word]);
  const dirty = json != null || !sameItem(item, word || fromForm(toForm({ type: "vocab", category: "" })));
  const gapWarn = lines(form.gaps).filter((g) => !/_{2,}/.test(g));

  async function save() {
    let next = item;
    if (json != null) { try { next = JSON.parse(json); } catch { setErrors(["The JSON isn't valid. Fix it or switch back to the form."]); return; } }
    const problems = wordProblems(next, words, word);
    if (personal && word && next.word !== word.word) problems.push("Keep the word spelling unchanged to preserve your progress.");
    if (!problems.length) problems.push(...V2.validateContent({ schemaVersion: 2, kind: "content", words: [next] }, content).slice(0, 5));
    if (problems.length) { setErrors(problems); return; }
    if (next._autoStub && next.meaning && next.situation) delete next._autoStub;
    setBusy("save");
    try { await onSave(next, word); } catch (e) { setErrors([e.message]); } finally { setBusy(null); }
  }
  async function aiFill() {
    if (!form.word.trim()) { setErrors(["Type the word first."]); return; }
    setBusy("ai"); setErrors([]); setNote(null);
    try {
      const g = generateWord ? await generateWord(form.word, item) : await askAiForWord(form.word, item);
      if (generateWord) { const incoming = toForm(g); setForm(f => Object.fromEntries(Object.entries(f).map(([k,v]) => [k, (isNew && k === "type" && v === "vocab") ? incoming[k] : String(v || "").trim() ? v : incoming[k]]))); setNote("AI filled the empty fields. Review them before saving."); setBusy(null); return; }
      const filled = [];
      const fill = (k, v) => { if (!String(form[k] || "").trim() && v) { filled.push(k); return v; } return form[k]; };
      setForm((f) => ({
        ...f,
        type: f.type || g.type, category: fill("category", g.category), meaning: fill("meaning", g.meaning), situations: fill("situations", g.situation),
        gaps: fill("gaps", g.gap), hints: fill("hints", (g.hints || []).join("\n")),
        mistakeSentence: fill("mistakeSentence", g.commonMistake?.sentence), mistakeCorrection: fill("mistakeCorrection", g.commonMistake?.correction), mistakeWhy: fill("mistakeWhy", g.commonMistake?.why),
      }));
      setNote(filled.length ? `AI filled: ${filled.join(", ")}. Check them, then save.` : "Every field already has text; AI changed nothing.");
    } catch (e) { setErrors([e.message || "AI couldn't fill the word."]); }
    setBusy(null);
  }
  async function upload(file) {
    setBusy("picture"); setErrors([]);
    try { const url = await uploadWordImage(file); setExtra((x) => ({ ...x, image: url })); setNote("Picture uploaded (resized to WebP). Save to keep it."); }
    catch (e) { setErrors([e.message]); }
    setBusy(null);
  }
  async function useLink() {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { setErrors(["The link must start with http:// or https://"]); return; }
    setBusy("link"); setErrors([]);
    try { const copy = await importImageLink(url); setExtra((x) => ({ ...x, image: copy })); setLink(""); setNote("Picture copied into your storage, so the link can't break. Save to keep it."); setBusy(null); return; }
    catch (e) { console.warn("Copy failed, checking the link itself:", e.message); }
    IMAGE_LINKS.delete(url);
    const ok = await checkImageLink(url);
    setBusy(null);
    if (!ok) { setErrors(["This link didn't load (broken, not a direct image, or the site blocks it). Right-click the picture → Copy image address."]); return; }
    setExtra((x) => ({ ...x, image: url })); setLink(""); setNote("Couldn't copy it, but the link works. Save to keep it.");
  }
  const close = () => (dirty ? setConfirmClose(true) : onClose());

  return (
    <Drawer title={isNew ? "New word" : word.word} subtitle={isNew ? "Fill the form, or type the word and let AI fill the rest" : `${word.category || "no category"}${stats ? ` · ${stats.players} player${stats.players === 1 ? "" : "s"} · ${stats.attempts} answers` : ""}`} onClose={close}
      actions={<>{word?._autoStub && <Badge tone="warning">stub</Badge>}{word?._aiAdded && <Badge tone="info">AI-added</Badge>}</>}>
      <div className="adm-editor">
        {errors.length > 0 && <Notice tone="error">{errors.map((e, i) => <div key={i}>{e}</div>)}</Notice>}
        {note && <Notice>{note}</Notice>}
        {json != null ? <>
          <Area label="Word as JSON" hint="for fields the form doesn't show" rows={22} mono value={json} onChange={setJson} />
          <div className="adm-row"><button className="adm-btn ghost" onClick={() => { try { const parsed = JSON.parse(json); setForm(toForm(parsed)); setExtra({ image: parsed.image, illustration: parsed.illustration }); setJson(null); } catch { setErrors(["The JSON isn't valid."]); } }}>Back to the form</button></div>
        </> : <>
          <section className="adm-editor-sec">
            <h4>Basics</h4>
            <div className="adm-form-grid">
              <Text label="Word" hint={isNew ? "" : personal ? "fixed to preserve your progress" : "renaming keeps players' progress"} value={form.word} readOnly={personal && !!word} onChange={set("word")} />
              <label className="adm-field"><span>Type</span><select className="adm-select" value={form.type} onChange={(e) => set("type")(e.target.value)}>{[...new Set([...TYPES, form.type])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <Text label="Category" hint="a new name makes a new category" value={form.category} onChange={set("category")} list="adm-word-cats" />
              <Text label="Unit / group" value={form.subCategory} onChange={set("subCategory")} />
              <label className="adm-field"><span>Level</span><select className="adm-select" value={form.level} onChange={(e) => set("level")(e.target.value)}>{[...new Set([...LEVELS, form.level])].map((l) => <option key={l} value={l}>{l || "—"}</option>)}</select></label>
              <Text label="Parts of speech" hint="comma-separated" value={form.partsOfSpeech} onChange={set("partsOfSpeech")} placeholder="noun, verb" />
              <Text label="Units" hint="comma-separated; with a course level, its sessions" value={form.units} onChange={set("units")} />
              <Text label="Register" value={form.register} onChange={set("register")} placeholder="informal" />
            </div>
            <datalist id="adm-word-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </section>
          <section className="adm-editor-sec">
            <h4>Meaning and sentences</h4>
            <Area label="Meaning" value={form.meaning} onChange={set("meaning")} />
            <Area label="Example sentences" hint="one per line; the first is the main one" value={form.situations} onChange={set("situations")} rows={3} />
            <Area label="Gap sentences" hint="one per line, ___ where the word goes" value={form.gaps} onChange={set("gaps")} rows={3} />
            {gapWarn.length > 0 && <p className="adm-warn-text">{gapWarn.length} gap sentence{gapWarn.length === 1 ? " has" : "s have"} no ___ blank.</p>}
            <Area label="Hints" hint="one per line" value={form.hints} onChange={set("hints")} />
          </section>
          <section className="adm-editor-sec">
            <h4>Word links</h4>
            <div className="adm-form-grid">
              <Text label="Synonyms" hint="comma-separated" value={form.synonyms} onChange={set("synonyms")} />
              <Text label="Antonyms" hint="comma-separated" value={form.antonyms} onChange={set("antonyms")} />
              <Text label="Opposite in the game" hint="another word in the game" value={form.opposite} onChange={set("opposite")} list="adm-word-list" />
            </div>
            <datalist id="adm-word-list">{words.slice(0, 2000).map((w) => <option key={w.word} value={w.word} />)}</datalist>
            <div className="adm-form-grid">
              <Area label="Word partners" hint="collocations, one per line" value={form.collocations} onChange={set("collocations")} />
              <Area label="Word family" hint="“noun: happiness”, one per line" value={form.wordFamily} onChange={set("wordFamily")} />
            </div>
          </section>
          <section className="adm-editor-sec">
            <h4>Common mistake</h4>
            <div className="adm-form-grid">
              <Text label="Wrong sentence" value={form.mistakeSentence} onChange={set("mistakeSentence")} />
              <Text label="Corrected" value={form.mistakeCorrection} onChange={set("mistakeCorrection")} />
            </div>
            <Text label="Why" value={form.mistakeWhy} onChange={set("mistakeWhy")} />
          </section>
          {!personal && <section className="adm-editor-sec">
            <h4>Picture</h4>
            <div className="adm-picture">
              {extra.image || extra.illustration ? <WordPicture word={{ ...item }} className="adm-picture-img" /> : <div className="adm-picture-empty">No picture</div>}
              <div className="adm-picture-actions">
                <label className="adm-btn ghost"><ImagePlus size={15} /> {busy === "picture" ? "Uploading…" : "Upload"}<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} /></label>
                <div className="adm-link-row"><input className="adm-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a picture link (https://…)" aria-label="Picture link" /><button className="adm-btn ghost" disabled={busy === "link" || !link.trim()} onClick={useLink}><Link2 size={15} /> {busy === "link" ? "Checking…" : "Use"}</button></div>
                {extra.image && <button className="adm-link" onClick={() => setExtra((x) => ({ ...x, image: undefined }))}><X size={13} /> Remove picture{extra.illustration ? " (the drawing stays)" : ""}</button>}
              </div>
            </div>
          </section>}
        </>}
        <footer className="adm-editor-foot">
          <button className="adm-btn primary" onClick={save} disabled={!!busy}>{isNew ? "Add word" : "Save changes"}</button>
          <button className="adm-btn ghost" onClick={aiFill} disabled={!!busy}><Sparkles size={15} /> {busy === "ai" ? "Asking AI…" : "Fill empty fields with AI"}</button>
          {json == null && <button className="adm-btn ghost" onClick={() => setJson(JSON.stringify(item, null, 2))}><Code2 size={15} /> JSON</button>}
          <span className="adm-toolbar-spacer" />
          {!isNew && <button className="adm-btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>}
        </footer>
      </div>
      {confirmDelete && <ConfirmDialog title={`Delete “${word.word}”?`} danger confirmLabel="Delete" body={<p>{personal ? "Remove it from your library? Your progress stays saved." : "It disappears from every player's game. Their learning history stays in their progress but stops counting. You can bring it back from the Activity log."}</p>} onCancel={() => setConfirmDelete(false)} onConfirm={async () => { setConfirmDelete(false); setBusy("save"); try { await onDelete(word); } catch(e) { setErrors([e.message]); } finally { setBusy(null); } }} />}
      {confirmClose && <ConfirmDialog title="Discard your changes?" confirmLabel="Discard" danger body={<p>The word hasn't been saved.</p>} onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />}
    </Drawer>
  );
}
