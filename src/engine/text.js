// Plain text helpers of the game logic. No imports: both the question builders
// (questions.js) and the AI checks (ai.js) use them, so they live below both.

// The form two answers are compared in: accents split off, lower case, curly
// apostrophes straight, spaces collapsed, ends trimmed.
export function normalizeAnswerText(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}
