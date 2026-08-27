import { tenureBand } from "./auditTenure";

describe("tenureBand", () => {
  it("returns Unknown when the start date is missing or invalid", () => {
    expect(tenureBand(null, "2026-08-01")).toBe("Unknown");
    expect(tenureBand("not-a-date", "2026-08-01")).toBe("Unknown");
  });

  it("uses the locked ICICI HFC bands", () => {
    expect(tenureBand("2026-06-01", "2026-08-01")).toBe("0–6 months");
    expect(tenureBand("2025-10-01", "2026-08-01")).toBe("6–12 months");
    expect(tenureBand("2024-08-01", "2026-08-01")).toBe("1–3 years");
    expect(tenureBand("2022-08-01", "2026-08-01")).toBe("3+ years");
  });
});
