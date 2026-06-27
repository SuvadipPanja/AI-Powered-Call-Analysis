import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";

/**
 * Doughnut with center metric and side legend with animated share bars.
 */
export default function DonutInsightChart({
  chartRef,
  data,
  options,
  centerValue,
  centerLabel = "Total",
  height = 220,
}) {
  const labels = data?.labels || [];
  const values = useMemo(() => data?.datasets?.[0]?.data || [], [data]);
  const colors = data?.datasets?.[0]?.backgroundColor || [];

  const total = useMemo(
    () => values.reduce((sum, v) => sum + (Number(v) || 0), 0),
    [values]
  );

  const displayCenter = centerValue ?? total;

  return (
    <div className="report-donut-insight">
      <div className="report-donut-insight__chart" style={{ height }}>
        <Doughnut ref={chartRef} data={data} options={options} />
        <div className="report-donut-insight__center" aria-hidden="true">
          <strong>{displayCenter}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="report-donut-insight__legend">
        {labels.map((label, i) => {
          const val = Number(values[i]) || 0;
          const pct = total ? Math.round((val / total) * 100) : 0;
          const color = Array.isArray(colors) ? colors[i] : colors;
          return (
            <li key={`${label}-${i}`} className="report-donut-insight__row">
              <span className="report-donut-insight__dot" style={{ background: color }} />
              <span className="report-donut-insight__label">{label}</span>
              <span className="report-donut-insight__value">{val}</span>
              <div className="report-donut-insight__bar">
                <div className="report-donut-insight__bar-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="report-donut-insight__pct">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
