// Pure helpers behind the admin tables and charts.
import { describe, expect, it } from "vitest";
import { pageWindow, paginate, sortRows, toCsv } from "../src/features/admin/DataTable";
import { formatCompact, niceTicks } from "../src/features/admin/charts";

describe("table helpers", () => {
  const rows = Array.from({ length: 53 }, (_, i) => ({ id: i + 1, name: `w${i + 1}`, score: (i * 37) % 101 }));
  const cols = [{ key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "score", label: "Score" }];

  it("paginates with clamped pages and a from/to range", () => {
    expect(paginate(rows, 1, 25)).toMatchObject({ page: 1, pages: 3, from: 1, to: 25 });
    expect(paginate(rows, 3, 25)).toMatchObject({ page: 3, from: 51, to: 53 });
    expect(paginate(rows, 9, 25).page).toBe(3);
    expect(paginate([], 1, 25)).toMatchObject({ pages: 1, from: 0, to: 0 });
  });

  it("windows page buttons with ellipses", () => {
    expect(pageWindow(6, 20)).toEqual([1, "…", 5, 6, 7, "…", 20]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it("sorts numbers numerically and text naturally, empties last", () => {
    expect(sortRows(rows, cols, { key: "score", dir: "desc" })[0].score).toBe(100);
    const names = sortRows([{ name: "w10" }, { name: "w2" }, { name: null }], cols, { key: "name", dir: "asc" }).map((r) => r.name);
    expect(names).toEqual(["w2", "w10", null]);
  });

  it("writes CSV with quoting", () => {
    const csv = toCsv([{ id: 1, name: 'a, "b"', score: 3 }], cols);
    expect(csv).toBe('ID,Name,Score\r\n1,"a, ""b""",3');
  });
});

describe("chart helpers", () => {
  it("makes nice ticks that cover the max", () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(4)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("compacts big numbers", () => {
    expect(formatCompact(1284)).toBe("1.3K");
    expect(formatCompact(12900)).toBe("13K");
    expect(formatCompact(4200000)).toBe("4.2M");
    expect(formatCompact(87)).toBe("87");
  });
});
