// Postgres jsonb reorders object keys, so "did this change?" compares a
// key-sorted serialisation; plain JSON.stringify would see every record
// loaded from the server as changed and re-send it.
export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined || typeof v === "function" ? "null" : stableJson(v))).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== "function").sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}
