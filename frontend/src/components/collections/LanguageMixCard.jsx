import { useMemo, useRef } from "react";
import { LuGlobe } from "../../icons";
import ReportChartCard from "../reports/ReportChartCard";
import DonutInsightChart from "../reports/DonutInsightChart";
import { buildColoredDoughnutData, modernDoughnutOptions } from "../reports/reportsChartConfig";
import { buildLanguageMixBreakdown } from "../../utils/languageMixData";
import { languageMixColors } from "../../utils/languageMixPalette";

/**
 * "Language mix" dashboard card (category AUDIO LANGUAGE). Donut with a center
 * total + a per-language breakdown list (color dot, count, share bar, %).
 * Reuses the existing ReportChartCard shell + DonutInsightChart so it matches
 * the collections dashboard design language and inherits the responsive
 * collapse. Colors come from the token-driven --viz-* palette (no hardcoded
 * reference-image hex). Empty/zero rows omit the chart. A missing `items`
 * array (old backend) uses a distinct upgrade message; Unknown-only still
 * shows the donut.
 */
export default function LanguageMixCard({
  items,
  subtitle = "AUDIO LANGUAGE",
  periodLabel,
  loading = false,
}) {
  const chartRef = useRef(null);
  const { rows, total, hasData, missing } = useMemo(() => buildLanguageMixBreakdown(items), [items]);

  const chartData = useMemo(() => {
    if (!hasData || !rows.length) return null;
    const labels = rows.map((r) => r.name);
    const values = rows.map((r) => Number(r.count) || 0);
    const colors = languageMixColors(labels);
    return buildColoredDoughnutData(labels, values, colors);
  }, [hasData, rows]);

  const opts = useMemo(() => modernDoughnutOptions({ cutout: "64%" }), []);

  return (
    <ReportChartCard
      className="language-mix-card"
      variant="insight"
      icon={LuGlobe}
      title="Language mix"
      subtitle={subtitle}
      stat={hasData ? `${total} call${total === 1 ? "" : "s"}` : undefined}
      empty={!chartData}
      emptyMessage={
        missing
          ? "Language mix needs the latest backend image."
          : "No language data for this period."
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
        />
      )}
    </ReportChartCard>
  );
}
