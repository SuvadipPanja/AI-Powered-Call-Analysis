import {
  clearQualityWorkbookCache,
  getQualityWorkbook,
  qualityWorkbookCacheKey,
  qualityWorkbookCacheSize,
  setQualityWorkbook,
  takeQualityWorkbookWork,
} from "./qualityWorkbookCache";

describe("qualityWorkbookCache", () => {
  beforeEach(() => {
    clearQualityWorkbookCache();
  });

  it("keeps users and filters in separate keys", () => {
    expect(qualityWorkbookCacheKey("A", { fromDate: "2026-07-01", toDate: "2026-07-31" }))
      .not.toBe(qualityWorkbookCacheKey("B", { fromDate: "2026-07-01", toDate: "2026-07-31" }));
  });

  it("evicts the oldest of more than three workbooks", () => {
    setQualityWorkbook("a", new Blob(["1"]));
    setQualityWorkbook("b", new Blob(["2"]));
    setQualityWorkbook("c", new Blob(["3"]));
    setQualityWorkbook("d", new Blob(["4"]));
    expect(qualityWorkbookCacheSize()).toBe(3);
    expect(getQualityWorkbook("a")).toBeNull();
    expect(getQualityWorkbook("d")).toBeTruthy();
  });

  it("clears every entry", () => {
    setQualityWorkbook("a", new Blob(["1"]));
    clearQualityWorkbookCache();
    expect(qualityWorkbookCacheSize()).toBe(0);
    expect(getQualityWorkbook("a")).toBeNull();
  });

  it("returns a cached workbook without starting another fetch", async () => {
    const blob = new Blob(["cached"]);
    setQualityWorkbook("k", blob);
    const start = jest.fn();
    const result = await takeQualityWorkbookWork("k", start);
    expect(result.cached).toBe(true);
    expect(result.blob).toBe(blob);
    expect(start).not.toHaveBeenCalled();
  });
});
