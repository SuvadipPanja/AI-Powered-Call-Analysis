import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReportsDownloadTab from "./ReportsDownloadTab";
import { downloadCollectionsQualityReport } from "../../../services/reportsService";
import { clearQualityWorkbookCache } from "../../../utils/qualityWorkbookCache";
import { triggerBlobDownload } from "../../../utils/reportPreviewParse";

jest.mock("./ReportPreviewModal", () => (props) => (
  props.open ? <div data-testid="report-preview-open">{props.title}</div> : null
));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ username: "AdminUser" }),
}));
jest.mock("../../../services/reportsService", () => ({
  downloadCollectionsQualityReport: jest.fn(),
  exportReportCsv: jest.fn(),
  getCollectionsAgentPerformance: jest.fn(),
  getEscalationSummary: jest.fn(),
  getHoldSummary: jest.fn(),
  getLoanLeads: jest.fn(),
  getQueryTypeDistribution: jest.fn(),
}));
jest.mock("../../../utils/reportPreviewParse", () => ({
  ...jest.requireActual("../../../utils/reportPreviewParse"),
  triggerBlobDownload: jest.fn(),
}));

const filters = { fromDate: "2026-07-21", toDate: "2026-08-21", location: "All", supervisor: "All" };

describe("ReportsDownloadTab", () => {
  beforeEach(() => {
    clearQualityWorkbookCache();
    downloadCollectionsQualityReport.mockReset();
    downloadCollectionsQualityReport.mockResolvedValue(new Blob(["official-xlsx"]));
    triggerBlobDownload.mockReset();
  });

  it("shows equal Quality workbook and extract cards on collections", async () => {
    render(
      <ReportsDownloadTab
        filters={filters}
        isCollections
        periodLabel="2026-07-21 to 2026-08-21"
        buildBulkExportBody={() => ({})}
      />,
    );
    await waitFor(() => expect(downloadCollectionsQualityReport).toHaveBeenCalled());
    expect(screen.getByText("Quality workbook")).toBeInTheDocument();
    expect(screen.getByText(/Official ICICI HFC multi-sheet workbook/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download \.xlsx/i })).toBeInTheDocument();
    expect(screen.getByText("Call-wise extract")).toBeInTheDocument();
    expect(screen.queryByText("Loan details")).not.toBeInTheDocument();
    expect(screen.queryByText("Outbound extract")).not.toBeInTheDocument();
    expect(screen.queryByText("Production report center")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Preview & download/i })).toHaveLength(3);
  });

  it("shows banking cards including loan details when not collections", () => {
    render(
      <ReportsDownloadTab
        filters={filters}
        isCollections={false}
        periodLabel="the selected period"
        buildBulkExportBody={() => ({})}
      />,
    );
    expect(screen.queryByText("Quality workbook")).not.toBeInTheDocument();
    expect(screen.getByText("Outbound extract")).toBeInTheDocument();
    expect(screen.getByText("Loan details")).toBeInTheDocument();
    expect(screen.getByText("Agent-wise extract")).toBeInTheDocument();
    expect(downloadCollectionsQualityReport).not.toHaveBeenCalled();
  });

  it("starts the official workbook in the background and downloads without a second fetch", async () => {
    render(
      <ReportsDownloadTab
        filters={filters}
        isCollections
        periodLabel="2026-07-21 to 2026-08-21"
        buildBulkExportBody={() => ({})}
      />,
    );
    await waitFor(() => expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Download \.xlsx/i })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: /Download \.xlsx/i }));
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Download \.xlsx/i }));
    expect(triggerBlobDownload).toHaveBeenCalledTimes(2);
    expect(downloadCollectionsQualityReport).toHaveBeenCalledTimes(1);
  });

  it("shows a busy Download button and no preview or marketing copy", async () => {
    let resolveWorkbook;
    downloadCollectionsQualityReport.mockReturnValue(
      new Promise((resolve) => { resolveWorkbook = resolve; }),
    );

    render(
      <ReportsDownloadTab
        filters={filters}
        isCollections
        periodLabel="2026-07-21 to 2026-08-21"
        buildBulkExportBody={() => ({})}
      />,
    );

    const busyButton = await screen.findByRole("button", { name: /Preparing workbook/i });
    expect(busyButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Preview sheets/i })).not.toBeInTheDocument();

    resolveWorkbook(new Blob(["official-xlsx"]));

    const ready = await screen.findByRole("button", { name: /Download \.xlsx/i });
    expect(ready).toBeEnabled();
    expect(screen.queryByText(/download is instant/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Same one-click Excel download as before/i)).not.toBeInTheDocument();
  });
});
