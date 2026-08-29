import { buildAuditCoverageBreakdown } from "./auditCoverageData";

describe("buildAuditCoverageBreakdown", () => {
  it("flags a missing auditCoverage field from an old backend", () => {
    expect(buildAuditCoverageBreakdown(undefined).missing).toBe(true);
    expect(buildAuditCoverageBreakdown(null).missing).toBe(true);
    expect(buildAuditCoverageBreakdown(undefined).hasData).toBe(false);
  });

  it("builds two clickable rows whose counts equal the total", () => {
    const { rows, total, hasData, missing, insight } = buildAuditCoverageBreakdown(
      { aiOnly: 90, manualReviewed: 23, avgAi: 82.4, avgManual: 79.1 },
      { aiOnly: "tok-ai", manualReviewed: "tok-man" },
    );
    expect(missing).toBe(false);
    expect(hasData).toBe(true);
    expect(total).toBe(113);
    expect(rows.map((r) => r.count).reduce((s, n) => s + n, 0)).toBe(total);
    expect(rows[0]).toEqual({
      name: "AI scored only",
      count: 90,
      color: "#0f766e",
      percent: 80,
      drilldownToken: "tok-ai",
    });
    expect(rows[1]).toEqual({
      name: "Manually audited",
      count: 23,
      color: "#d97706",
      percent: 20,
      drilldownToken: "tok-man",
    });
    expect(insight).toBe("Avg AI 82.4 · Avg manual 79.1 on audited calls");
  });

  it("omits the average insight when either average is null", () => {
    const { insight } = buildAuditCoverageBreakdown(
      { aiOnly: 10, manualReviewed: 0, avgAi: null, avgManual: null },
      {},
    );
    expect(insight).toBeUndefined();
  });

  it("returns no data when both counts are zero", () => {
    const { hasData, rows } = buildAuditCoverageBreakdown(
      { aiOnly: 0, manualReviewed: 0, avgAi: null, avgManual: null },
      {},
    );
    expect(hasData).toBe(false);
    expect(rows).toEqual([]);
  });
});
