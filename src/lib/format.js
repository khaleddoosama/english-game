// A time in milliseconds as players read it: "42.5s" under a minute, "1:05" from a minute up. Used by Live (the
// race and the results) and by the profile's recent Live matches (social).
export function formatMs(ms) {
  const s = Math.max(0, Math.round(Number(ms || 0) / 100) / 10);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
