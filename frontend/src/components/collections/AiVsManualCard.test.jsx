import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AiVsManualCard from "./AiVsManualCard";

jest.mock("react-chartjs-2", () => ({
  Doughnut: () => <div data-testid="stub-doughnut" />,
}));

jest.mock("../reports/ReportChartCard", () => function MockReportChartCard({
  title, subtitle, insight, className = "", empty, emptyMessage, children,
}) {
  return (
    <article className={`report-chart-card ${className}`.trim()}>
      {subtitle && <span className="report-chart-card__eyebrow">{subtitle}</span>}
      <h3 className="report-chart-card__title">{title}</h3>
      {insight && <p>{insight}</p>}
      {empty ? <div className="report-chart-card__state--empty">{emptyMessage}</div> : children}
    </article>
  );
});

const COVERAGE = { aiOnly: 90, manualReviewed: 23, avgAi: 82.4, avgManual: 79.1 };
const TOKENS = { aiOnly: "tok-ai", manualReviewed: "tok-man" };

describe("AiVsManualCard", () => {
  it("renders the serif title and AUDIT COVERAGE eyebrow", () => {
    render(<AiVsManualCard coverage={COVERAGE} tokens={TOKENS} />);
    expect(screen.getByText("AI vs Manual")).toBeInTheDocument();
    expect(screen.getByText("AUDIT COVERAGE")).toBeInTheDocument();
    expect(screen.getByText("AI scored only")).toBeInTheDocument();
    expect(screen.getByText("Manually audited")).toBeInTheDocument();
    expect(screen.getByText(/Avg AI 82.4/)).toBeInTheDocument();
  });

  it("invokes onDrilldown with the AI scored only row when that legend is clicked", async () => {
    const user = userEvent.setup();
    const onDrilldown = jest.fn();
    render(<AiVsManualCard coverage={COVERAGE} tokens={TOKENS} onDrilldown={onDrilldown} />);
    await user.click(screen.getByRole("button", { name: /View 90 calls for AI scored only/i }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({
      name: "AI scored only",
      drilldownToken: "tok-ai",
    }));
  });

  it("uses a backend-upgrade message when auditCoverage is missing", () => {
    render(<AiVsManualCard coverage={null} />);
    expect(screen.getByText(/AI vs Manual needs the latest backend/i)).toBeInTheDocument();
  });

  it("shows an honest empty state when both counts are zero", () => {
    render(<AiVsManualCard coverage={{ aiOnly: 0, manualReviewed: 0, avgAi: null, avgManual: null }} />);
    expect(screen.getByText(/No audit-coverage data for this period/i)).toBeInTheDocument();
  });
});
