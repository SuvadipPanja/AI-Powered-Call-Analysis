import { render, screen } from "@testing-library/react";
import DashboardStatistics from "./DashboardStatistics";
import {
  getDailyDurationWeek,
  getInboundOutboundWeek,
  getTopScorerAgentsWeek,
} from "../services/reportsService";

// Charts need a canvas; the messaging under test is plain DOM.
jest.mock("react-chartjs-2", () => {
  const React = require("react");
  return {
    Bar: React.forwardRef(() => <div data-testid="volume-chart" />),
    Line: React.forwardRef(() => <div data-testid="duration-chart" />),
  };
});
// Pulls in jsPDF/ExcelJS, which need browser encoders jsdom does not provide.
jest.mock("./reports/ReportChartCard", () => ({ title, children }) => (
  <div>
    <h3>{title}</h3>
    {children}
  </div>
));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isValidatingSession: false,
    initializationComplete: true,
  }),
}));
jest.mock("../services/reportsService", () => ({
  getInboundOutboundWeek: jest.fn(),
  getDailyDurationWeek: jest.fn(),
  getTopScorerAgentsWeek: jest.fn(),
}));

const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const zeros = [0, 0, 0, 0, 0, 0, 0];

const volume = (outbound) => ({ success: true, labels, inbound: zeros, outbound });
const duration = () => ({ success: true, labels, inbound: zeros, outbound: zeros });

describe("DashboardStatistics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("still renders volume charts when only top scorers fail", async () => {
    getInboundOutboundWeek.mockResolvedValue(volume([4, 0, 2, 0, 0, 0, 0]));
    getDailyDurationWeek.mockResolvedValue(duration());
    getTopScorerAgentsWeek.mockRejectedValue(new Error("Server error."));

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    expect(await screen.findByTestId("volume-chart")).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows a plain-language empty message when there are no calls", async () => {
    getInboundOutboundWeek.mockResolvedValue(volume(zeros));
    getDailyDurationWeek.mockResolvedValue(duration());
    getTopScorerAgentsWeek.mockResolvedValue({ success: true, inbound: null, outbound: null });

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    expect(await screen.findByText(/No call trends for this period yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
  });

  it("only shows a retry when every trends request fails", async () => {
    getInboundOutboundWeek.mockRejectedValue(new Error("Server error."));
    getDailyDurationWeek.mockRejectedValue(new Error("Server error."));
    getTopScorerAgentsWeek.mockRejectedValue(new Error("Server error."));

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    expect(
      await screen.findByText(/Trends could not be loaded right now/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
  });
});
