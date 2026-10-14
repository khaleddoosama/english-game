import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { navigate, readQuery } from "../../lib/router";
import CreateViews from "./components/CreateViews";
import LibraryWords from "./components/LibraryWords";
import ShareInbox from "./components/ShareInbox";
import ViewPanel from "./components/ViewPanel";
import ViewTree from "./components/ViewTree";
import { count } from "./components/format";
import { useViews } from "./useViews";
import "../../styles/library.css";

// My library: views (folders) that can sit inside each other, the words and
// grammar rules in each, and a practice round from any of them.
//   api  - the library API (libraryApi.js)    ids  - word/rule key <-> server id (useLibrary)
//   words / grammar - the dictionary           levels - course levels, to start a view from one
//   onPractice(viewId, deep, name) - starts a round    friendsApi - to pick who a view is shared with
//   onInboxChanged() - the number of offers waiting changed
//   onAskWord(term) - opens the AI helper for a word that isn't in the dictionary yet
//   onRefreshIds() - reloads the key <-> id map (words added since the app started)
//   /library?view=<id> opens that view; /library?new=1 starts on making one
// The page only arranges the parts; each part owns its own little state.
export default function LibraryPage({ api, ids, words, grammar, levels = [], friendsApi = null, onPractice, onInboxChanged, onAskWord = null, onRefreshIds = null, isAdmin = false }) {
  const lib = useViews({ api, ids });
  const start = useMemo(() => readQuery(window.location.search), []);
  const newParent = start.parent ? lib.rows.find((v) => v.id === start.parent) || null : null;   // /library?new=1&parent=<id>
  const [offers, setOffers] = useState([]);
  const [tab, setTab] = useState("views");                 // "views" | "library"
  const libraryKeys = useMemo(() => new Set(lib.mine.words.map((w) => w.key)), [lib.mine.words]);
  const wordByKey = useMemo(() => new Map(words.map((w) => [w.word, w])), [words]);
  const libraryRuleKeys = useMemo(() => new Set(lib.mine.rules.map((r) => r.key)), [lib.mine.rules]);
  const ruleByKey = useMemo(() => new Map(grammar.map((g) => [g.id, g])), [grammar]);

  const loadOffers = useCallback(async () => { try { setOffers(await api.inbox()); } catch { setOffers([]); } }, [api]);
  useEffect(() => { loadOffers(); }, [loadOffers]);

  // /library?view=<id> (the pencil on home) opens that view, once it has loaded.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || lib.loading) return;
    opened.current = true;
    if (start.view && lib.rows.some((v) => v.id === start.view)) lib.select(start.view);
  }, [lib.loading, lib.rows, start.view]); // eslint-disable-line react-hooks/exhaustive-deps

  async function answer(offer, accept) {
    lib.setBusy(true); lib.setNotice(null);
    try {
      const out = accept ? await api.accept(offer.id) : await api.dismiss(offer.id);
      await Promise.all([lib.reloadTree(), loadOffers()]);
      onInboxChanged?.();
      if (accept) {
        lib.select(out.view);
        lib.setNotice({ kind: "ok", text: `Added “${out.name}”: ${count(out.words, "word")}${out.rules ? `, ${count(out.rules, "rule")}` : ""}${out.skipped ? ` (${out.skipped} private ${out.skipped === 1 ? "word was" : "words were"} not shared)` : ""}.` });
      }
    } catch (e) { lib.setNotice({ kind: "error", text: e.message }); await loadOffers(); onInboxChanged?.(); }
    finally { lib.setBusy(false); }
  }

  if (lib.loading) return <section className="ui-page"><div className="ui-skeleton-row" /></section>;
  return (
    <section className="ui-page lib">
      <header className="ui-page-head lib-head">
        <h2><BookOpen size={20} /> My library</h2>
        <button className="wh-back-btn" onClick={() => navigate("/profile")}>Back</button>
      </header>
      {lib.notice && <p className={`lib-notice ${lib.notice.kind}`} role={lib.notice.kind === "error" ? "alert" : "status"}>{lib.notice.text}</p>}

      <ShareInbox offers={offers} busy={lib.busy} onAnswer={answer} />
      <div className="lib-tabs" role="tablist" aria-label="Library or views">
        <button role="tab" aria-selected={tab === "views"} className={tab === "views" ? "on" : ""} onClick={() => setTab("views")}>Views <small>{lib.flat.length}</small></button>
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "on" : ""} onClick={() => setTab("library")}>Library <small>{lib.mine.words.length + lib.mine.rules.length}</small></button>
      </div>

      {tab === "library" && (
        <LibraryWords items={lib.mine} rows={lib.rows} grammar={grammar} isAdmin={isAdmin} wordByKey={wordByKey} busy={lib.busy}
          onAddRulesToView={(viewId, keys) => lib.act(() => api.addRules(viewId, keys.map(ids.ruleOf).filter(Boolean)), (n) => (n ? `Added ${count(n, "rule")} to the view.` : "Those are already in that view."))}
          onRemoveRules={(keys) => lib.act(async () => { for (const k of keys) await api.libraryRemoveRule(ids.ruleOf(k)); return keys.length; }, (n) => `Removed ${count(n, "rule")} from your library.`)}
          onAddToView={(viewId, keys) => lib.act(() => api.add(viewId, keys.map(ids.senseOf).filter(Boolean)), (n) => (n ? `Added ${n} to the view.` : "Those are already in that view."))}
          onNewView={async (name, keys) => {
            const id = await lib.act(async () => { const made = await api.create(name); await api.add(made, keys.map(ids.senseOf).filter(Boolean)); return made; }, `Made “${name.trim()}” with ${count(keys.length, "word")}.`);
            if (id) { lib.select(id); setTab("views"); }
            return id;
          }}
          onRemove={(keys) => lib.act(async () => { for (const k of keys) await api.libraryRemove(ids.senseOf(k)); return keys.length; }, (n) => `Removed ${count(n, "word")} from your library.`)} />
      )}

      {tab === "views" && (
        <>
          {!lib.flat.length && (
            <div className="lib-empty">
              <p><b>You have no views yet.</b> A view is a way to pick some of your library’s words, like “A1.1 › sports”. Make one, add words to it, practise just that, and send it to a friend or share a link.</p>
            </div>
          )}
          <CreateViews api={api} ids={ids} levels={levels} busy={lib.busy} act={lib.act} onCreated={lib.select} autoFocus={start.new === "1"} parent={newParent} />
          <ViewTree rows={lib.rows} selected={lib.view?.id} onSelect={lib.select} onPractice={onPractice}
            panel={lib.view && (
              <ViewPanel key={lib.view.id} view={lib.view} roots={lib.roots} inside={lib.inside} libraryKeys={libraryKeys} libraryRuleKeys={libraryRuleKeys} grammar={grammar} api={api} ids={ids} words={words} wordByKey={wordByKey} ruleByKey={ruleByKey}
                friendsApi={friendsApi} busy={lib.busy} act={lib.act} setNotice={lib.setNotice} onPractice={onPractice} onCreated={lib.select} onRemoved={() => lib.select(null)}
                onRefreshIds={onRefreshIds} onAskWord={onAskWord} />
            )} />
        </>
      )}
    </section>
  );
}
