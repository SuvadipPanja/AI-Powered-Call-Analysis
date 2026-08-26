import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportPreviewModal from "./ReportPreviewModal";
import { triggerBlobDownload } from "../../../utils/reportPreviewParse";

jest.mock("../../../utils/reportPreviewExport", () => ({
  buildCsvBlob: jest.fn(() => new Blob(["csv"], { type: "text/csv" })),
  buildExcelBlob: jest.fn(async () => new Blob(["xlsx"])),
  buildPdfBlob: jest.fn(() => new Blob(["pdf"], { type: "application/pdf" })),
}));

jest.mock("../../../utils/reportPreviewParse", () => {
  const actual = jest.requireActual("../../../utils/reportPreviewParse");
  return { ...actual, triggerBlobDownload: jest.fn() };
});

jest.mock("../../../services/reportsService", () => ({
  protectAnalyticsExport: jest.fn(),
}));

describe("ReportPreviewModal", () => {
  it("shows preview rows and a password box when protect is on", async () => {
    render(
      <ReportPreviewModal
        open
        onClose={() => {}}
        title="Audit sheet"
        periodLabel="this month"
        slug="audit"
        filters={{ fromDate: "2026-07-01", toDate: "2026-07-31" }}
        preview={{
          columns: ["Agent", "Score"],
          rows: [{ Agent: "Priya", Score: "88" }],
        }}
      />,
    );
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download XLSX/i })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/Password protect the file/i));
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download protected ZIP/i })).toBeInTheDocument();
  });

  it("fetches the official workbook only when Download official Excel is clicked", async () => {
    const rawBlob = new Blob(["official-xlsx"]);
    const onFetchOfficial = jest.fn().mockResolvedValue({
      blob: rawBlob,
      filename: "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
    });
    render(
      <ReportPreviewModal
        open
        onClose={() => {}}
        title="Quality workbook"
        periodLabel="2026-07-20 to 2026-08-20"
        slug="quality"
        filters={{ fromDate: "2026-07-20", toDate: "2026-08-20" }}
        onFetchOfficial={onFetchOfficial}
        preview={{
          columns: ["Sheet"],
          rows: [{ Sheet: "Summary" }],
          sheetNames: ["Summary", "Audit Sheet"],
          officialFilename: "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
          keepOriginal: true,
          formats: ["xlsx"],
          deferOfficialDownload: true,
        }}
      />,
    );
    expect(onFetchOfficial).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Download official Excel/i }));
    expect(onFetchOfficial).toHaveBeenCalledTimes(1);
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      rawBlob,
      "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
    );
  });

  it("downloads the official ICICI HFC workbook unchanged", async () => {
    const rawBlob = new Blob(["official-xlsx"]);
    render(
      <ReportPreviewModal
        open
        onClose={() => {}}
        title="Quality workbook"
        periodLabel="2026-07-20 to 2026-08-20"
        slug="quality"
        filters={{ fromDate: "2026-07-20", toDate: "2026-08-20" }}
        preview={{
          columns: ["Sheet"],
          rows: [{ Sheet: "Summary" }],
          sheetNames: ["Summary", "Audit Sheet"],
          rawBlob,
          rawKind: "xlsx",
          officialFilename: "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
          keepOriginal: true,
          formats: ["xlsx"],
        }}
      />,
    );
    expect(screen.queryByLabelText(/Password protect the file/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Download official Excel/i }));
    expect(triggerBlobDownload).toHaveBeenCalledWith(
      rawBlob,
      "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
    );
  });

  it("says the official workbook is ready after background prefetch", () => {
    render(
      <ReportPreviewModal
        open
        onClose={() => {}}
        title="Quality workbook"
        periodLabel="2026-07-20 to 2026-08-20"
        slug="quality"
        filters={{ fromDate: "2026-07-20", toDate: "2026-08-20" }}
        prefetchStatus="ready"
        preview={{
          columns: ["Sheet"],
          rows: [{ Sheet: "Summary" }],
          sheetNames: ["Summary", "Audit Sheet"],
          officialFilename: "ICICI_HFC_Quality_Report_2026-07-20_to_2026-08-20.xlsx",
          keepOriginal: true,
          formats: ["xlsx"],
          deferOfficialDownload: true,
        }}
      />,
    );
    expect(screen.getByText(/Workbook is ready — download is instant/i)).toBeInTheDocument();
  });
});
