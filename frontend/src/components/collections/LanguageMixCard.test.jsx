import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import LanguageMixCard from "./LanguageMixCard";

jest.mock("react-chartjs-2", () => ({
  Doughnut: () => <div data-testid="stub-doughnut" />,
}));

jest.mock("../reports/ReportChartCard", () => function MockReportChartCard({
  title, subtitle, className = "", empty, emptyMessage, children,
}) {
  return (
    <article className={`report-chart-card ${className}`.trim()}>
      {subtitle && <span className="report-chart-card__eyebrow">{subtitle}</span>}
      <h3 className="report-chart-card__title">{title}</h3>
      {empty ? <div className="report-chart-card__state--empty">{emptyMessage}</div> : children}
    </article>
  );
});

const SAMPLE = [
  { name: "Hindi", count: 88 },
  { name: "Marathi", count: 19 },
  { name: "Bengali", count: 3 },
  { name: "Kannada", count: 2 },
  { name: "Tamil", count: 1 },
];

describe("LanguageMixCard", () => {
  it("renders the serif title and AUDIO LANGUAGE eyebrow", () => {
    render(<LanguageMixCard items={SAMPLE} />);
    expect(screen.getByText("Language mix")).toBeInTheDocument();
    expect(screen.getByText("AUDIO LANGUAGE")).toBeInTheDocument();
  });

  it("renders the center total (113 calls) and each language row", () => {
    render(<LanguageMixCard items={SAMPLE} />);
    expect(screen.getByText("113")).toBeInTheDocument();
    expect(screen.getByText("Hindi")).toBeInTheDocument();
    expect(screen.getByText("Marathi")).toBeInTheDocument();
    expect(screen.getByText("Bengali")).toBeInTheDocument();
    expect(screen.getByText("Kannada")).toBeInTheDocument();
    expect(screen.getByText("Tamil")).toBeInTheDocument();
  });

  it("renders raw counts and percentages for each language", () => {
    render(<LanguageMixCard items={SAMPLE} />);
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("17%")).toBeInTheDocument();
    expect(screen.getByText("3%")).toBeInTheDocument();
  });

  it("omits the donut and shows an honest empty state when there are 0 calls", () => {
    render(<LanguageMixCard items={[]} />);
    expect(screen.queryByTestId("stub-doughnut")).not.toBeInTheDocument();
    expect(screen.getByText(/No language data/i)).toBeInTheDocument();
  });

  it("omits the donut when every language is Unknown", () => {
    render(<LanguageMixCard items={[{ name: "Unknown", count: 40 }]} />);
    expect(screen.queryByTestId("stub-doughnut")).not.toBeInTheDocument();
    expect(screen.getByText(/No language data/i)).toBeInTheDocument();
  });

  it("applies the language-mix-card class so the responsive CSS applies", () => {
    const { container } = render(<LanguageMixCard items={SAMPLE} />);
    expect(container.querySelector(".language-mix-card")).not.toBeNull();
  });
});
