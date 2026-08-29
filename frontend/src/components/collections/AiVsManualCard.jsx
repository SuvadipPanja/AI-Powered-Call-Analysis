import { useMemo, useRef } from "react";
import { LuClipboardCheck } from "../../icons";
import ReportChartCard from "../reports/ReportChartCard";
import DonutInsightChart from "../reports/DonutInsightChart";
import { buildColoredDoughnutData, modernDoughnutOptions } from "../reports/reportsChartConfig";
import { buildAuditCoverageBreakdown } from "../../utils/auditCoverageData";

export default function AiVsManualCard({
  coverage,
  tokens,
  loading = false,
  onDrilldown,
}) {
  const chartRef = useRef(null);
  const { rows, total, hasData, missing, insight } = useMemo(
    () => buildAuditCoverageBreakdown(coverage, tokens),
    [coverage, tokens],
  );

  const chartData = useMemo(() => {
    if (!hasData || !rows.length) return null;
    return buildColoredDoughnutData(
      rows.map((r) => r.name),
      rows.map((r) => r.count),
      rows.map((r) => r.color),
    );
  }, [hasData, rows]);

  const opts = useMemo(() => modernDoughnutOptions({ cutout: "64%" }), []);

  return (
    <ReportChartCard
      className="ai-vs-manual-card"
      variant="insight"
      icon={LuClipboardCheck}
      title="AI vs Manual"
      subtitle="AUDIT COVERAGE"
      insight={insight}
      stat={hasData ? `${total} call${total === 1 ? "" : "s"}` : undefined}
      empty={!chartData}
      emptyMessage={
        missing
          ? "AI vs Manual needs the latest backend image."
          : "No audit-coverage data for this period."
      }
      loading={loading}
      canvasWrapper={false}
      height={240}
    >
      {chartData && (
        <DonutInsightChart
          chartRef={chartRef}
          data={chartData}
          options={opts}
          centerValue={total}
          centerLabel="Calls"
          height={168}
          onItemActivate={onDrilldown ? (index) => onDrilldown(rows[index]) : undefined}
        />
      )}
    </ReportChartCard>
  );
}
