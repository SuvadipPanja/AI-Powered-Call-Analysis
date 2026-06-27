import { Radar } from 'react-chartjs-2';
import { LuShieldCheck, LuCircleCheck, LuHeart, LuTarget } from 'react-icons/lu';
import ReportChartCard from '../ReportChartCard';
import DonutInsightChart from '../DonutInsightChart';

export default function ReportQualitySection({
  loading,
  filters,
  apiBaseUrl,
  buildBulkExportBody,
  rubricChartData,
  rubricRows,
  resolutionData,
  toneChartData,
  leadChartData,
  rubricChartRef,
  resolutionChartRef,
  toneChartRef,
  leadChartRef,
  chartOptions,
}) {
  return (
    <section className="reports-section">
      <div className="reports-section__head">
        <h2>Quality & outcomes</h2>
        <p>Rubric radar, resolution, sentiment, and outbound lead quality.</p>
      </div>
      <div className="reports-chart-grid">
        <ReportChartCard
          variant="quality"
          icon={LuShieldCheck}
          title="AI vs manual quality"
          subtitle="Rubric comparison"
          insight="Glowing radar — compare AI and human scores per dimension."
          loading={loading}
          empty={!rubricChartData}
          chartRef={rubricChartRef}
          chartData={rubricChartData}
          tableColumns={['Dimension', 'AI score', 'Manual score']}
          tableRows={rubricRows}
          exportSlug="rubric_comparison"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={320}
          stagger={0.05}
        >
          {rubricChartData && (
            <Radar ref={rubricChartRef} data={rubricChartData} options={chartOptions.radar} />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="quality"
          icon={LuCircleCheck}
          title="Resolution status"
          subtitle="Call outcomes"
          insight="How conversations ended — resolved, pending, or escalated."
          loading={loading}
          empty={!resolutionData}
          chartRef={resolutionChartRef}
          chartData={resolutionData}
          exportSlug="resolution_status"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={280}
          stagger={0.1}
          canvasWrapper={false}
        >
          {resolutionData && (
            <DonutInsightChart
              chartRef={resolutionChartRef}
              data={resolutionData}
              options={chartOptions.doughnut}
              centerLabel="Calls"
            />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="quality"
          icon={LuHeart}
          title="Customer sentiment"
          subtitle="Tone analysis"
          insight="Positive, neutral, and negative tone distribution."
          loading={loading}
          empty={!toneChartData}
          chartRef={toneChartRef}
          chartData={toneChartData}
          exportSlug="sentiment_summary"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={280}
          stagger={0.15}
          canvasWrapper={false}
        >
          {toneChartData && (
            <DonutInsightChart
              chartRef={toneChartRef}
              data={toneChartData}
              options={chartOptions.doughnut}
              centerLabel="Calls"
            />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="insight"
          icon={LuTarget}
          title="Outbound lead quality"
          subtitle="Lead classification"
          insight="AI lead grades for outbound campaigns."
          loading={loading}
          empty={!leadChartData}
          chartRef={leadChartRef}
          chartData={leadChartData}
          exportSlug="lead_classification"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          bulkExport={{ endpoint: '/api/reports/download-outbound', body: buildBulkExportBody(), label: 'Download outbound calls (CSV)' }}
          height={280}
          stagger={0.2}
          canvasWrapper={false}
        >
          {leadChartData && (
            <DonutInsightChart
              chartRef={leadChartRef}
              data={leadChartData}
              options={chartOptions.doughnut}
              centerLabel="Leads"
            />
          )}
        </ReportChartCard>
      </div>
    </section>
  );
}
