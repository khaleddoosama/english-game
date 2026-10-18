// New practice sentences and variants, written by the AI in the background: what is pending (one request per word
// pool or variant key), the wait after a failed variant, and adding the answers to the pools. The steps with no state
// are in generationRules.js. Nothing here blocks a round: a failure is logged and the game keeps what it has.
// Docs: docs/modules/ai-media/pool-generation.md.
import { useRef } from "react";
import { V2 } from "../../engine/v2";
import { WORDS } from "../../engine/data";
import { generateComboVariant, generateContent, generateGrammarVariant } from "../../engine/ai";
import { comboVariantFields, grammarVariantAsk, grammarVariantFields, idOfKey, mayRetryVariant, withGeneratedTexts, withVariantItem } from "./generationRules";

// liveContent()      the live content (combos and grammar rules are looked up in it)
// poolsRef, setPools the question pools
// seenSentences()    the sentences read recently (to tell whether a grammar rule has anything unseen left)
export function useAiGeneration({ liveContent, poolsRef, setPools, seenSentences }) {
  // "word::poolType" and "variant::poolType::key" while a request for them is running.
  const pendingRef = useRef(new Set());
  // id -> time of the last failed variant try.
  const variantFailedRef = useRef(new Map());

  // batch: [{ word, poolType }]; pairs already pending are left out.
  async function triggerGeneration(batch, poolsSnapshot) {
    const filtered = batch.filter((b) => !pendingRef.current.has(`${b.word}::${b.poolType}`));
    if (!filtered.length) return;
    filtered.forEach((b) => pendingRef.current.add(`${b.word}::${b.poolType}`));
    try {
      const results = await generateContent(filtered, poolsSnapshot);
      setPools((prev) => withGeneratedTexts(prev, results, WORDS));
    } catch (e) {
      console.error("Content generation failed:", e);
    } finally {
      filtered.forEach((b) => pendingRef.current.delete(`${b.word}::${b.poolType}`));
    }
  }

  // poolType: "combo" | "grammar"; key: the question's progress key ("combo:<id>", "grammar:<id>").
  async function triggerVariantGeneration(poolType, key) {
    const genKey = `variant::${poolType}::${key}`;
    if (pendingRef.current.has(genKey)) return;
    pendingRef.current.add(genKey);
    try {
      const id = idOfKey(key);
      const content = liveContent();
      if (poolType === "combo") {
        const combo = (content.combos || []).find((c) => c.id === id);
        if (!combo) return;
        const variant = await generateComboVariant(combo);
        setPools((prev) => {
          const next = withVariantItem(prev, key, comboVariantFields(variant));
          poolsRef.current = next;
          return next;
        });
      } else if (poolType === "grammar") {
        const g = (content.grammar || []).find((x) => x.id === id);
        if (!g) return;
        const { spec, used } = grammarVariantAsk(g, poolsRef.current, key);
        const variant = await generateGrammarVariant(spec, used);
        setPools((prev) => {
          const next = withVariantItem(prev, key, grammarVariantFields(variant));
          poolsRef.current = next;
          return next;
        });
      }
    } catch (e) {
      console.error("Variant generation failed:", e);
      variantFailedRef.current.set(idOfKey(key), Date.now());
    } finally {
      pendingRef.current.delete(genKey);
    }
  }

  // After a grammar question is asked: if nothing is ready for that rule next time, write a new one in the
  // background, so the next round shows it instead of the same question again. A failed try (AI off, busy, over the
  // day's limit) waits ten minutes before the next.
  function keepGrammarFresh(id) {
    const g = (liveContent().grammar || []).find((x) => x.id === id);
    if (!g || !V2.grammarNeedsVariant(g, poolsRef.current, seenSentences())) return;
    if (!mayRetryVariant(variantFailedRef.current.get(id))) return;
    triggerVariantGeneration("grammar", `grammar:${id}`);
  }

  // Reset progress: nothing is pending any more, so a new request can start at once.
  function clearPending() { pendingRef.current = new Set(); }

  return { triggerGeneration, triggerVariantGeneration, keepGrammarFresh, clearPending };
}
