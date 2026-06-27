import { LuLayers, LuPhoneForwarded, LuBanknote } from 'react-icons/lu';
import ReportChartCard from '../ReportChartCard';
import DonutInsightChart from '../DonutInsightChart';
import LoanLeadsPanel from '../LoanLeadsPanel';
import EscalationKpiBlock from '../EscalationKpiBlock';

export default function ReportIntentSection({
  loading,
  filters,
  apiBaseUrl,
  queryTypeData,
  escalationData,
  escalationDonut,
  loanLeadData,
  loanTypeDonut,
  queryTypeChartRef,
  escalationChartRef,
  loanTypeChartRef,
  chartOptions,
}) {
  return (
    <section className="reports-section">
      <div className="reports-section__head">
        <h2>Customer intent &amp; escalation</h2>
        <p>What customers called about, escalation handling, and loan lead conversion.</p>
      </div>
      <div className="reports-chart-grid">
        <ReportChartCard
          variant="insight"
          icon={LuLayers}
          title="Customer query types"
          subtitle="Primary query category"
          insight="What customers actually called about, across all calls."
          loading={loading}
          empty={!queryTypeData}
          chartRef={queryTypeChartRef}
          chartData={queryTypeData}
          exportSlug="query_type_distribution"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={300}
          stagger={0.05}
          canvasWrapper={false}
        >
          {queryTypeData && (
            <DonutInsightChart
              chartRef={queryTypeChartRef}
              data={queryTypeData}
              options={chartOptions.doughnut}
              centerLabel="Calls"
            />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="insight"
          icon={LuPhoneForwarded}
          title="Escalations"
          subtitle="Senior transfer requests"
          insight="How often customers ask for a senior and whether agents action it."
          loading={loading}
          empty={!escalationData}
          chartRef={escalationChartRef}
          chartData={escalationDonut}
          exportSlug="escalation_summary"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={300}
          stagger={0.1}
          canvasWrapper={false}
        >
          {escalationData && (
            <div className="reports-kpi-block">
              <EscalationKpiBlock data={escalationData} showCsat />
              {escalationDonut && (
                <div style={{ height: 200, marginTop: 12 }}>
                  <DonutInsightChart
                    chartRef={escalationChartRef}
                    data={escalationDonut}
                    options={chartOptions.doughnut}
                    centerLabel="By type"
                  />
                </div>
              )}
            </div>
          )}
        </ReportChartCard>

        <ReportChartCard
          className="report-chart-card--wide"
          variant="insight"
          icon={LuBanknote}
          title="Loan leads &amp; conversion"
          subtitle="Loan-related calls"
          insight="Loan pipeline: interest, EMI affordability and predicted conversion."
          loading={loading}
          empty={!loanLeadData}
          chartRef={loanTypeChartRef}
          chartData={loanTypeDonut}
          exportSlug="loan_leads"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={320}
          stagger={0.15}
          canvasWrapper={false}
        >
          {loanLeadData && (
            <LoanLeadsPanel
              totals={loanLeadData}
              donutData={loanTypeDonut}
              chartRef={loanTypeChartRef}
              donutOptions={chartOptions.doughnut}
            />
          )}
        </ReportChartCard>
      </div>
    </section>
  );
}
