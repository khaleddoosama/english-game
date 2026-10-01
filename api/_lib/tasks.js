// The AI features the app has, and who may use them. The server decides
// from the task name: what the browser says about admin-only doesn't
// count, and a name that isn't here is refused. maxChars is the largest
// prompt the feature sends (instructions plus its input).
const SMALL = 20000;     // checking or explaining one answer
const BATCH = 60000;     // a batch of practice sentences
const ADMIN = 120000;    // content tools

export const AI_TASKS = {
  // Players (and the admin)
  "Ask AI about a word": { maxChars: SMALL },
  "Check a written answer": { maxChars: SMALL },
  "Check another word in a gap": { maxChars: SMALL },
  "Check a final case report": { maxChars: SMALL },
  "Grammar court": { maxChars: SMALL },
  "Explain a wrong answer": { maxChars: SMALL },
  "Review a reported question": { maxChars: SMALL },
  "New combo question": { maxChars: SMALL },
  "New grammar question": { maxChars: SMALL },
  "Write new practice sentences": { maxChars: BATCH },
  "Check new practice sentences": { maxChars: BATCH },
  // Admin only
  "Fix an import file": { adminOnly: true, maxChars: ADMIN },
  "Suggest a fix for a report": { adminOnly: true, maxChars: ADMIN },
  "Suggest category merges": { adminOnly: true, maxChars: ADMIN },
  "Content health fix": { adminOnly: true, maxChars: ADMIN },
  "Rewrite a word": { adminOnly: true, maxChars: ADMIN },
  "Write a story": { adminOnly: true, maxChars: ADMIN },
  "Write grammar questions": { adminOnly: true, maxChars: ADMIN },
};

export const aiTask = (name) => (typeof name === "string" && Object.hasOwn(AI_TASKS, name) ? { name, adminOnly: false, ...AI_TASKS[name] } : null);
