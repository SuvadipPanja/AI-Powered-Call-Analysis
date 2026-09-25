import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import AiVsManualCard from "./AiVsManualCard";

jest.mock("../reports/ReportChartCard", () => function MockReportChartCard({
  title, subtitle, stat, className = "", empty, emptyMessage, children,
}) {
  return (
    <article className={`report-chart-card ${className}`.trim()}>
      {subtitle && <span className="report-chart-card__eyebrow">{subtitle}</span>}
      <h3 className="report-chart-card__title">{title}</h3>
      {stat && <span className="report-chart-card__stat">{stat}</span>}
      {empty ? <div className="report-chart-card__state--empty">{emptyMessage}</div> : children}
    </article>
  );
});

const COVERAGE = { aiOnly: 112, manualReviewed: 1, avgAi: 82.4, avgManual: 79.1 };
const TOKENS = { allScored: "tok-all", aiOnly: "tok-ai", manualReviewed: "tok-man" };

describe("AiVsManualCard", () => {
  it("compares average scores on two gauges", () => {
    const { container } = render(<AiVsManualCard coverage={COVERAGE} tokens={TOKENS} />);
    expect(screen.getByText("AI vs Manual")).toBeInTheDocument();
    expect(screen.getByText("AUDIT COVERAGE")).toBeInTheDocument();
    expect(screen.getByText("AI score")).toBeInTheDocument();
    expect(screen.getByText("Manual score")).toBeInTheDocument();
    expect(screen.getByText("82.4")).toBeInTheDocument();
    expect(screen.getByText("79.1")).toBeInTheDocument();
    expect(screen.getByText("113 calls scored")).toBeInTheDocument();
    expect(screen.getByText("1 call audited")).toBeInTheDocument();
    expect(container.querySelectorAll(".audit-gauge__value")).toHaveLength(2);
    expect(container.querySelector(".report-donut-insight")).toBeNull();
  });

  it("draws each gauge in proportion to its score", () => {
    const { container } = render(<AiVsManualCard coverage={COVERAGE} tokens={TOKENS} />);
    const aiArc = container.querySelector('.audit-gauge__value[data-variant="ai"]');
    const manualArc = container.querySelector('.audit-gauge__value[data-variant="manual"]');
    const length = Math.PI * 58;
    expect(aiArc.getAttribute("stroke-dasharray")).toBe(
      `${(length * 0.824).toFixed(2)} ${length.toFixed(2)}`,
    );
    expect(manualArc.getAttribute("stroke-dasharray")).toBe(
      `${(length * 0.791).toFixed(2)} ${length.toFixed(2)}`,
    );
  });

  it("drills into all scored calls from the AI tile and audited calls from the manual tile", async () => {
    const user = userEvent.setup();
    const onDrilldown = jest.fn();
    render(<AiVsManualCard coverage={COVERAGE} tokens={TOKENS} onDrilldown={onDrilldown} />);
    await user.click(screen.getByRole("button", { name: /View 113 calls for AI score/i }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({
      name: "AI score",
      drilldownToken: "tok-all",
    }));
    await user.click(screen.getByRole("button", { name: /View 1 call for Manual score/i }));
    expect(onDrilldown).toHaveBeenCalledWith(expect.objectContaining({
      name: "Manual score",
      drilldownToken: "tok-man",
    }));
  });

  it("keeps the manual side inert and gap-free when nothing was audited", () => {
    const onDrilldown = jest.fn();
    const { container } = render(
      <AiVsManualCard
        coverage={{ aiOnly: 20, manualReviewed: 0, avgAi: 81, avgManual: null }}
        tokens={TOKENS}
        onDrilldown={onDrilldown}
      />,
    );
    expect(screen.getByText("Awaiting audit")).toBeInTheDocument();
    expect(screen.getByText("\u2014")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manual score/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".audit-gauge__value")).toHaveLength(1);
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
