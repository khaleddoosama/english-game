import { unitOptions } from "./unitFilter";

export default function UnitFilter({ items, value, onChange, label = "Units", className = "" }) {
  const options = unitOptions(items);
  return <>
    <select className={className} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All units</option>
      <option value="none">Without unit</option>
      {value.startsWith("unit:") && !options.includes(value.slice(5)) && <option value={value}>{value.slice(5)} (unavailable)</option>}
      {options.map((unit) => <option key={unit} value={`unit:${unit}`}>{unit}</option>)}
    </select>
    {value && <button type="button" className={className === "adm-select" ? "adm-link" : "lib-link"} onClick={() => onChange("")} aria-label={`Clear ${label.toLowerCase()} filter`}>Clear unit filter</button>}
  </>;
}
