// Publishing course content the way the admin screen does it (the repo's
// saveContent), then copying it into the library tables (dictionary_sync),
// so a scenario can start from a course with a few made-up words in it.
import { createSupabaseRepo } from "../../src/lib/repo";
import { useDevice } from "./devices";

export async function adminPublisher(admin, device = "admin-publisher") {
  useDevice(device);
  const repo = createSupabaseRepo({ userId: admin.id, isAdmin: true, client: admin.client });
  let content = (await repo.loadContent()) || { words: [], grammar: [], challenges: [], stories: [], combos: [], levelOrder: [], note: "" };
  return {
    get content() { return content; },
    async publish(edit, opts) {
      useDevice(device);
      const next = structuredClone(content);
      edit(next);
      await repo.saveContent(next, opts);
      content = next;
      const sync = await admin.client.rpc("dictionary_sync");
      if (sync.error) throw sync.error;
    },
  };
}

export const rule = (id, extra = {}) => ({ id, rule: "Use the simple past", category: "General Grammar", prompt: "Yesterday I ______ home.", options: ["go", "went", "gone", "going"], answer: "went", explanation: "Past of go is went.", ...extra });
