import { buildColoredDoughnutData } from "../components/reports/reportsChartConfig";
import { chartSeriesColors } from "../theme/chartTheme";
import { apiGetQuery } from "./apiHelpers";

/** Muted chart palette — aligned with dashboard theme (not neon). */
export function loanTypeChartColors(count) {
  const series = chartSeriesColors();
  return Array.from({ length: count }, (_, i) => series[i % series.length]);
}

export function parseLoanLeadsResponse(payload) {
  if (!payload?.success || !payload?.data) {
    return { totals: null, donutData: null, byLoanType: [] };
  }
  const totalsRaw = payload.data.totals || null;
  const totals =
    totalsRaw && Number(totalsRaw.loanCalls) > 0 ? totalsRaw : null;
  const byLoanType = payload.data.byLoanType || [];
  const donutData = byLoanType.length
    ? buildColoredDoughnutData(
        byLoanType.map((t) => t.label),
        byLoanType.map((t) => t.count),
        loanTypeChartColors(byLoanType.length),
      )
    : null;
  return { totals, donutData, byLoanType };
}

export async function fetchLoanLeadsReport(queryString) {
  const data = await apiGetQuery("/api/reports/loan-leads", queryString, { label: "loan-leads" });
  return parseLoanLeadsResponse(data);
}

export function formatInr(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

export function formatConversionPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Math.round(Number(value))}%`;
}
