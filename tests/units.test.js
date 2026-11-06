// The units filter rules shared by the admin's Words and Grammar lists and the library's pickers.
import { describe, expect, it } from "vitest";
import { NO_UNIT, inUnit, unitOptions } from "../src/engine/units.js";

const items = [
  { word: "a", units: ["Unit 10", "Unit 2"] },          // two units
  { word: "b", units: ["Unit 2"] },
  { word: "c", units: [" Unit 1 ", "Unit 1"] },          // the same unit twice, once with spaces
  { word: "d", units: [] },                               // empty list
  { word: "e" },                                          // no field
  { word: "f", units: ["", "  "] },                       // only empty names
  { word: "g", units: "Unit 2" },                         // not a list (the validator refuses it): no unit
  { word: "h", category: "Unit 3", level: "B1" },         // lesson and level are not units
];

describe("unit options", () => {
  it("every unit once, trimmed, in natural order (Unit 2 before Unit 10), without empty names", () => {
    expect(unitOptions(items)).toEqual(["Unit 1", "Unit 2", "Unit 10"]);
  });
  it("no items, or none with a unit: no options", () => {
    expect(unitOptions([])).toEqual([]);
    expect(unitOptions(undefined)).toEqual([]);
    expect(unitOptions([{ word: "x" }, { word: "y", units: [] }])).toEqual([]);
  });
  it("names that differ only in case both stay (the game treats them as two units), in a fixed order", () => {
    expect(unitOptions([{ units: ["unit 1"] }, { units: ["Unit 1"] }])).toEqual(["Unit 1", "unit 1"]);
    expect(unitOptions([{ units: ["Unit 1"] }, { units: ["unit 1"] }])).toEqual(["Unit 1", "unit 1"]);
  });
});

describe("matching a unit", () => {
  const pick = (unit) => items.filter((it) => inUnit(it, unit)).map((it) => it.word);
  it("all units: everything", () => {
    expect(pick("")).toEqual(items.map((it) => it.word));
  });
  it("one unit: every item in it, also items that are in other units too", () => {
    expect(pick("Unit 2")).toEqual(["a", "b"]);
    expect(pick("Unit 10")).toEqual(["a"]);
    expect(pick("Unit 1")).toEqual(["c"]);
  });
  it("without unit: no field, an empty list, only empty names, or not a list", () => {
    expect(pick(NO_UNIT)).toEqual(["d", "e", "f", "g", "h"]);
  });
  it("a unit nobody has: nothing; the lesson or level of that name does not count", () => {
    expect(pick("Unit 3")).toEqual([]);
  });
  it("reads the item only", () => {
    const item = { units: [" Unit 1 "] };
    inUnit(item, "Unit 1"); unitOptions([item]);
    expect(item).toEqual({ units: [" Unit 1 "] });
  });
});
