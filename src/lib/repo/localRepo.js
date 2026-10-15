// The repo for local mode and tests: content and progress in the browser's
// IndexedDB only, no server. Same interface as the Supabase repo.
import { idb } from "../idb";
import { emptyContent, hasContent } from "./contentPlan";
import { CONTENT_FIELDS } from "./progressShape";
import { createStatusHub } from "./status";

export function createLocalRepo() {
  const status = createStatusHub();
  return {
    mode: "local",
    status,
    async loadContent() { const c = await idb.get("local:content"); return hasContent(c) ? c : null; },
    async saveContent(content) { if (!(await idb.set("local:content", { ...emptyContent(), ...content }))) throw new Error("This browser didn't let the game store its content (storage full or blocked)."); },
    async loadProgress() { return (await idb.get("local:progress")) || null; },
    async saveProgress(data) {
      status.set("saving");
      const clean = {};
      for (const [k, v] of Object.entries(data)) if (!CONTENT_FIELDS.has(k)) clean[k] = v;
      status.set((await idb.set("local:progress", clean)) ? "saved" : "error");
    },
    async resetProgress() { await idb.del("local:progress"); },
    async wipeContent() { await idb.del("local:content"); },
    dispose() {},
  };
}
