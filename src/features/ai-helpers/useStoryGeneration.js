// Story generation (admin): the chosen categories, the story being written, its preview, and Add / Discard. The
// choice of targets is in storyRules.js. Docs: docs/modules/ai-media/story-generation.md.
import { useEffect, useRef, useState } from "react";
import { GRAMMAR, WORDS } from "../../engine/data";
import { generateStory } from "../../engine/ai";
import { cancelAiTasks } from "../../lib/aiOperations";
import { storyPlan } from "./storyRules";

const TASK = "Write a story";

// stories, setStories   the custom stories (Add appends to them; the content save follows)
// mastery, confusions   the player's progress (weak words first)
// viewKey               changes when the screen or address changes: a story still loading is dropped
export function useStoryGeneration({ stories, setStories, mastery, confusions, viewKey }) {
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [state, setState] = useState(null); // null | "loading" | "error" | {title,text,targetWords,questions}
  // A story or an error that arrives after a newer request, a category change, or leaving the page is dropped.
  const epoch = useRef(0);

  useEffect(() => () => { epoch.current++; setState((current) => (current === "loading" ? null : current)); }, [viewKey]);

  async function generate() {
    if (!categories.length) { setError("Choose at least one category first."); return; }
    const mine = ++epoch.current;
    cancelAiTasks([TASK]);
    setState("loading");
    setError("");
    try {
      const { targets, grammarRules } = storyPlan({ words: WORDS, grammar: GRAMMAR, categories, stories, mastery, confusions });
      const story = await generateStory(targets, categories, grammarRules);
      if (mine !== epoch.current) return;
      setState(story);
    } catch (e) {
      if (mine !== epoch.current) return;
      console.error("Word Hunter: story generation failed", e);
      setError(e.message || "Story generation failed.");
      setState("error");
    }
  }
  function toggleCategory(category) {
    epoch.current++; cancelAiTasks([TASK]); setState(null); setError("");
    setCategories((current) => (current.includes(category) ? current.filter((item) => item !== category) : [...current, category]));
  }
  function add() { setStories((previous) => [...previous, state]); setState(null); }
  function discard() { setState(null); }

  return { categories, error, state, generate, toggleCategory, add, discard };
}
