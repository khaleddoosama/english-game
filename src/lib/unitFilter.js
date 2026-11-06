// Filter values are tagged so a real unit named "Without unit" cannot collide.
const unitsOf = (item) => Array.isArray(item?.units) ? item.units.filter((u) => typeof u === "string" && u.trim()) : [];
export function unitOptions(items) {
  return [...new Set(items.flatMap(unitsOf))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }) || a.localeCompare(b));
}
export function matchesUnit(item, value) {
  const units = unitsOf(item);
  return !value || (value === "none" ? units.length === 0 : units.includes(value.slice(5)) && value.startsWith("unit:"));
}
