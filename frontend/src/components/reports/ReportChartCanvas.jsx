/** Fixed-height wrapper so Chart.js can measure and render correctly. */
export default function ReportChartCanvas({ height = 280, children }) {
  return (
    <div className="report-chart-canvas" style={{ height }}>
      {children}
    </div>
  );
}
