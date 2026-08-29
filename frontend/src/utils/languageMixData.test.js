import { buildLanguageMixBreakdown } from "./languageMixData";

describe("buildLanguageMixBreakdown", () => {
  it("normalizes names, drops zero-count rows, and computes percentages", () => {
    const { rows, total, hasData } = buildLanguageMixBreakdown([
      { name: "Hindi", count: 88 },
      { name: "  Marathi  ", count: 19 },
      { name: "Bengali", count: 3 },
      { name: "Kannada", count: 2 },
      { name: "Tamil", count: 1 },
      { name: "Empty", count: 0 },
    ]);
    expect(total).toBe(113);
    expect(hasData).toBe(true);
    expect(rows[0]).toEqual({ name: "Hindi", count: 88, percent: 78 });
    expect(rows[1]).toEqual({ name: "Marathi", count: 19, percent: 17 });
    expect(rows[2]).toEqual({ name: "Bengali", count: 3, percent: 3 });
    expect(rows[3]).toEqual({ name: "Kannada", count: 2, percent: 2 });
    expect(rows[4]).toEqual({ name: "Tamil", count: 1, percent: 1 });
    expect(rows.find((r) => r.name === "Empty")).toBeUndefined();
  });

  it("satisfies the counts-equal-total identity", () => {
    const { rows, total } = buildLanguageMixBreakdown([
      { name: "Hindi", count: 88 },
      { name: "Marathi", count: 19 },
      { name: "Bengali", count: 3 },
      { name: "Kannada", count: 2 },
      { name: "Tamil", count: 1 },
    ]);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(total);
  });

  it("returns an empty, no-data breakdown for an empty input", () => {
    const { rows, total, hasData } = buildLanguageMixBreakdown([]);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(hasData).toBe(false);
  });

  it("returns an empty, no-data breakdown when every row is zero", () => {
    const { rows, total, hasData } = buildLanguageMixBreakdown([
      { name: "Hindi", count: 0 },
      { name: "Marathi", count: 0 },
    ]);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(hasData).toBe(false);
  });

  it("omits the chart (hasData=false) when all languages are Unknown", () => {
    const { rows, total, hasData } = buildLanguageMixBreakdown([
      { name: "Unknown", count: 40 },
      { name: "", count: 10 },
      { name: null, count: 5 },
    ]);
    expect(total).toBe(55);
    expect(hasData).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(["Unknown", "Unknown", "Unknown"]);
  });

  it("flags a missing languageMix field from an old backend", () => {
    const missing = buildLanguageMixBreakdown(undefined);
    expect(missing.missing).toBe(true);
    expect(missing.hasData).toBe(false);
    expect(missing.rows).toEqual([]);
    const alsoNull = buildLanguageMixBreakdown(null);
    expect(alsoNull.missing).toBe(true);
    expect(buildLanguageMixBreakdown([]).missing).toBe(false);
  });

  it("still reports hasData=true when at least one non-Unknown language exists", () => {
    const { hasData } = buildLanguageMixBreakdown([
      { name: "Unknown", count: 40 },
      { name: "Hindi", count: 10 },
    ]);
    expect(hasData).toBe(true);
  });

  it("rounds percentages to whole numbers and never exceeds 100 in sum drift", () => {
    const { rows } = buildLanguageMixBreakdown([
      { name: "A", count: 1 },
      { name: "B", count: 1 },
      { name: "C", count: 1 },
    ]);
    const sum = rows.reduce((s, r) => s + r.percent, 0);
    expect(sum).toBeLessThanOrEqual(100);
    rows.forEach((r) => expect(r.percent).toBe(33));
  });

  it("buckets tail rows into 'Other languages' when there are more than maxRows", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Lang${i + 1}`, count: 10 - i }));
    const { rows, total } = buildLanguageMixBreakdown(many, { maxRows: 8 });
    expect(rows).toHaveLength(8);
    expect(rows[7].name).toBe("Other languages");
    // counts-equal-total identity holds after bucketing
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(total);
  });
});
