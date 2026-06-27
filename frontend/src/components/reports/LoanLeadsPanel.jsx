import DonutInsightChart from "./DonutInsightChart";
import { formatConversionPct, formatInr } from "../../utils/loanLeadsData";

/**
 * Shared loan KPI block + optional loan-type donut (dashboard, reports, team leader).
 */
export default function LoanLeadsPanel({
  totals,
  donutData,
  chartRef,
  donutOptions,
  showChart = true,
  centerLabel = "Loans",
}) {
  if (!totals) return null;

  return (
    <div className="reports-loan-grid">
      <div className="reports-kpi-block reports-loan-grid__kpis">
        <div className="reports-kpi-row">
          <div className="reports-kpi">
            <span className="reports-kpi__value">{totals.loanCalls || 0}</span>
            <span className="reports-kpi__label">Loan calls</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi__value reports-kpi__value--positive">
              {formatConversionPct(totals.avgSuccessProbability)}
            </span>
            <span className="reports-kpi__label">Avg conversion</span>
          </div>
        </div>
        <div className="reports-kpi-row reports-kpi-row--spaced">
          <div className="reports-kpi">
            <span className="reports-kpi__value reports-kpi__value--positive">
              {totals.emiAffordableYes || 0}
            </span>
            <span className="reports-kpi__label">Can pay EMI</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi__value reports-kpi__value--negative">
              {totals.emiAffordableNo || 0}
            </span>
            <span className="reports-kpi__label">Cannot pay EMI</span>
          </div>
        </div>
        <div className="reports-kpi-row reports-kpi-row--spaced">
          <div className="reports-kpi">
            <span className="reports-kpi__value">{formatInr(totals.totalEmiAmount)}</span>
            <span className="reports-kpi__label">Total EMI committed</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi__value">{formatInr(totals.totalLoanAmount)}</span>
            <span className="reports-kpi__label">Total loan value</span>
          </div>
        </div>
      </div>
      {showChart && donutData && (
        <div className="reports-loan-grid__chart">
          <DonutInsightChart
            chartRef={chartRef}
            data={donutData}
            options={donutOptions}
            centerLabel={centerLabel}
          />
        </div>
      )}
    </div>
  );
}
