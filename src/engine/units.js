// The course units a word or grammar rule belongs to (its `units` field, from
// the Anki tags; not its lesson or level), and narrowing a list to one unit.
// Used by the admin's Words and Grammar lists and the library's pickers. Pure.

// The filter value for "Without unit": no `units`, or only empty ones. A real
// unit with this exact name would be read as "Without unit" (units come from
// course tags such as "Goals-and-Dreams", so this is not expected).
export const NO_UNIT = "__none__";

// The item's units: trimmed, without empty ones, each once.
function unitsOf(item) {
  const list = Array.isArray(item?.units) ? item.units : [];
  return [...new Set(list.filter((u) => typeof u === "string").map((u) => u.trim()).filter(Boolean))];
}

// Every unit used in the list, once, in natural order ("Unit 2" before "Unit 10").
export function unitOptions(items) {
  const all = new Set((items || []).flatMap(unitsOf));
  return [...all].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
}

// "" (all units) matches everything; NO_UNIT matches items without a unit;
// a unit name matches every item in it, also when the item is in others too.
export function inUnit(item, unit) {
  if (!unit) return true;
  const units = unitsOf(item);
  return unit === NO_UNIT ? units.length === 0 : units.includes(unit);
}
