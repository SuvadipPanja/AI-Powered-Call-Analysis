import { render, screen, waitFor } from "@testing-library/react";
import CollectionsRoleKpiStrip from "./CollectionsRoleKpiStrip";
import { getCollectionsDashboard } from "../../services/reportsService";

jest.mock("../../services/reportsService", () => ({
  getCollectionsDashboard: jest.fn(),
}));

describe("CollectionsRoleKpiStrip", () => {
  it("shows Strong and Weak PTP instead of PTP conversion", async () => {
    getCollectionsDashboard.mockResolvedValue({
      kpis: {
        totalAudited: 20,
        avgQuality: 88,
        ptpRate: 40,
        ptpStrongCount: 6,
        ptpWeakCount: 2,
        fatalCount: 0,
        redAlertCount: 0,
      },
    });
    render(<CollectionsRoleKpiStrip filters={{ fromDate: "2026-07-01", toDate: "2026-07-31" }} />);
    await waitFor(() => expect(screen.getByText("6")).toBeInTheDocument());
    expect(screen.getByText("Strong PTP")).toBeInTheDocument();
    expect(screen.getByText("Weak PTP")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("PTP conversion")).not.toBeInTheDocument();
  });
});
