import { downloadCollectionsQualityReport } from "../../../services/reportsService";
import { clearQualityWorkbookCache } from "../../../utils/qualityWorkbookCache";
import {
  downloadOfficialQualityWorkbook,
  listReportCards,
  previewQualityWorkbook,
  qualityReportFilename,
  qualityReportQuery,
} from "./reportCatalog";

jest.mock("../../../services/reportsService", () => ({
  downloadCollectionsQualityReport: jest.fn(),
  exportReportCsv: jest.fn(),
  getCollectionsAgentPerformance: jest.fn(),
  getEscalationSummary: jest.fn(),
  getHoldSummary: jest.fn(),
  getLoanLeads: jest.fn(),
  getQueryTypeDistribution: jest.fn(),
}));

describe("quality workbook helpers", () => {
  beforeEach(() => {
    clearQualityWorkbookCache();
    downloadCollectionsQualityReport.mockReset();
  });

  it("uses the official ICICI HFC filename for the selected dates", () => {
    expect(qualityReportFilename("2026-07-20", "2026-08-20")).toBe(
      "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
    );
  });

  it("sends the same date and TL filters as the previous workbook download", () => {
    expect(qualityReportQuery({
      fromDate: "2026-07-20",
      toDate: "2026-08-20",
      location: "Mumbai",
      supervisor: "Anita",
      agent: "Priya",
    })).toEqual({
      fromDate: "2026-07-20",
      toDate: "2026-08-20",
      location: "Mumbai",
      tl: "Anita",
      agent: "Priya",
    });
  });

  it("builds an instant official preview without calling the API", () => {
    const preview = previewQualityWorkbook({ fromDate: "2026-07-20", toDate: "2026-08-20" });
    expect(preview.keepOriginal).toBe(true);
    expect(preview.deferOfficialDownload).toBe(true);
    expect(preview.officialFilename).toBe("ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx");
    expect(preview.sheetNames).toContain("Audit Sheet");
    expect(downloadCollectionsQualityReport).not.toHaveBeenCalled();
  });

  it("caches the official workbook in session memory for the second download", async () => {
    clearQualityWorkbookCache();
    const blob = new Blob(["official"]);
    downloadCollectionsQualityReport.mockResolvedValue(blob);
    const filters = { fromDate: "2026-07-20", toDate: "2026-08-20" };
    const first = await downloadOfficialQualityWorkbook(filters, "AdminUser");
    const second = await downloadOfficialQualityWorkbook(filters, "AdminUser");
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.blob).toBe(blob);
    expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(1);
  });

  it("does not share a cached workbook between users", async () => {
    clearQualityWorkbookCache();
    downloadCollectionsQualityReport.mockResolvedValue(new Blob(["a"]));
    const filters = { fromDate: "2026-07-20", toDate: "2026-08-20" };
    await downloadOfficialQualityWorkbook(filters, "AdminUser");
    await downloadOfficialQualityWorkbook(filters, "OtherAdmin");
    expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight official download for the same user and filters", async () => {
    clearQualityWorkbookCache();
    let resolveBlob;
    downloadCollectionsQualityReport.mockReturnValue(new Promise((resolve) => {
      resolveBlob = resolve;
    }));
    const filters = { fromDate: "2026-07-20", toDate: "2026-08-20" };
    const first = downloadOfficialQualityWorkbook(filters, "AdminUser");
    const second = downloadOfficialQualityWorkbook(filters, "AdminUser");
    resolveBlob(new Blob(["shared"]));
    const [a, b] = await Promise.all([first, second]);
    expect(a.blob).toBe(b.blob);
    expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(1);
  });
});

describe("listReportCards", () => {
  it("keeps four collections cards and hides leftover banking extracts", () => {
    const keys = listReportCards({ isCollections: true }).map((c) => c.key);
    expect(keys).toEqual(["quality", "callwise", "escalations", "hold"]);
  });

  it("keeps banking extracts when not collections", () => {
    expect(listReportCards({ isCollections: false }).map((c) => c.key)).toEqual([
      "callwise", "inbound", "outbound", "audit",
      "agentwise", "escalations", "hold", "query", "loan",
    ]);
  });
});
