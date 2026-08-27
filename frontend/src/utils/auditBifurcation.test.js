import { summarizeAuditQueue } from "./auditBifurcation";

describe("summarizeAuditQueue", () => {
  it("groups the loaded queue by language, TL, and tenure", () => {
    const rows = [
      { language: "Hindi", supervisor: "Anita", agentCreationDate: "2026-06-01", callDate: "2026-08-01" },
      { language: "Hindi", supervisor: "Anita", agentCreationDate: "2026-06-01", callDate: "2026-08-01" },
      { language: "English", supervisor: "Rahul", agentCreationDate: "2022-08-01", callDate: "2026-08-01" },
      { language: "", supervisor: "", agentCreationDate: null, callDate: "2026-08-01" },
    ];
    const summary = summarizeAuditQueue(rows);
    expect(summary.byLanguage).toEqual([
      { name: "Hindi", count: 2 },
      { name: "English", count: 1 },
      { name: "Unknown", count: 1 },
    ]);
    expect(summary.byTl[0]).toEqual({ name: "Anita", count: 2 });
    expect(summary.byTenure).toEqual([
      { name: "0–6 months", count: 2 },
      { name: "3+ years", count: 1 },
      { name: "Unknown", count: 1 },
    ]);
  });
});
