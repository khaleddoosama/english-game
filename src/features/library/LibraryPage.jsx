import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { navigate } from "../../lib/router";
import CreateViews from "./components/CreateViews";
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
//   embedded - shown inside the home screen (no page header)
// The page only arranges the parts; each part owns its own little state.
export default function LibraryPage({ api, ids, words, grammar, levels = [], friendsApi = null, onPractice, onInboxChanged, onAskWord = null, onRefreshIds = null, embedded = false }) {
  const lib = useViews({ api, ids });
  const [offers, setOffers] = useState([]);
  const wordByKey = useMemo(() => new Map(words.map((w) => [w.word, w])), [words]);
  const ruleByKey = useMemo(() => new Map(grammar.map((g) => [g.id, g])), [grammar]);

  const loadOffers = useCallback(async () => { try { setOffers(await api.inbox()); } catch { setOffers([]); } }, [api]);
  useEffect(() => { loadOffers(); }, [loadOffers]);

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
    <section className={`${embedded ? "lib-embedded" : "ui-page"} lib`}>
      {!embedded && (
        <header className="ui-page-head lib-head">
          <h2><BookOpen size={20} /> My library</h2>
          <button className="wh-back-btn" onClick={() => navigate("/profile")}>Back</button>
        </header>
      )}
      {lib.notice && <p className={`lib-notice ${lib.notice.kind}`} role={lib.notice.kind === "error" ? "alert" : "status"}>{lib.notice.text}</p>}

      <ShareInbox offers={offers} busy={lib.busy} onAnswer={answer} />
      {!lib.flat.length && (
        <div className="lib-empty">
          <p><b>Your library is empty.</b> Make a view (a folder), like “A1.1” or “movies”, put the words you want in it, and practise just that. Views can sit inside each other.</p>
        </div>
      )}
      <CreateViews api={api} ids={ids} levels={levels} busy={lib.busy} act={lib.act} onCreated={lib.select} />
      <ViewTree rows={lib.rows} selected={lib.view?.id} onSelect={lib.select} onPractice={onPractice} />
      {lib.view && (
        <ViewPanel key={lib.view.id} view={lib.view} roots={lib.roots} inside={lib.inside} api={api} ids={ids} words={words} wordByKey={wordByKey} ruleByKey={ruleByKey}
          friendsApi={friendsApi} busy={lib.busy} act={lib.act} setNotice={lib.setNotice} onPractice={onPractice} onCreated={lib.select} onRemoved={() => lib.select(null)}
          onRefreshIds={onRefreshIds} onAskWord={onAskWord} />
      )}
    </section>
  );
}
