// Ask AI about a word, the steps with no state: the term that is asked, the course entry made from an answer, and why
// an entry cannot be added. No React, no AI call. Moved unchanged out of the app shell (src/app/WordHunter.jsx); see
// docs/modules/ai-media/ask-ai.md.
import { V2 } from "../../engine/v2";

// Trimmed, single spaces, at most 80 characters.
export const askTerm = (term) => String(term || "").trim().replace(/\s+/g, " ").slice(0, 80);

// The category a new word goes to: the one the player is on (the current level, or a practice round), if any.
export const contextCategoryOf = (currentLevel, activeSession) => currentLevel?.title || (activeSession?.kind === "practice" ? activeSession.title : null);

// The course entry made from an answer. contextCategory wins over the AI's category, else "AI Discoveries".
export function aiWordEntry(result, contextCategory) {
  return { word: result.word, type: result.type, ...(result.partsOfSpeech?.length ? { partsOfSpeech: result.partsOfSpeech } : {}), category: contextCategory || result.category || "AI Discoveries", meaning: result.meaning, situation: result.situation, gap: result.gap, hints: result.hints || [], _aiAdded: true, ...(result.commonMistake ? { commonMistake: result.commonMistake } : {}) };
}

// Why the entry cannot be added (shown in the drawer), or null. The answer's check leaves the gap empty when it was
// unusable (askAiCard.js).
export function aiWordProblem(entry, live) {
  if (/[\u0600-\u06FF]/.test(JSON.stringify(entry))) return "The generated card contains non-English text. Regenerate it before adding.";
  if (!entry.gap) return "This card has no usable gap sentence. Ask again before adding.";
  const errors = V2.validateContent({ schemaVersion: 2, kind: "content", words: [entry] }, live);
  return errors.length ? `Cannot add this card: ${errors[0]}` : null;
}
