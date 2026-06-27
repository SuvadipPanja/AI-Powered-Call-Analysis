import { Bar, Chart } from 'react-chartjs-2';
import { LuActivity, LuClock, LuLanguages } from 'react-icons/lu';
import ReportChartCard from '../ReportChartCard';
import DonutInsightChart from '../DonutInsightChart';
import { UNIFIED_VOLUME_PLUGINS } from '../reportsChartConfig';
import { sumChartValues } from '../reportsChartConfig';

export default function ReportVolumeSection({
  loading,
  filters,
  apiBaseUrl,
  buildBulkExportBody,
  chartConfig,
  volumeSummary,
  volumeTrendsData,
  volumeChartRenderData,
  volumeTrendsRows,
  callVolumeByTimeData,
  languagePreferencesData,
  volumeChartRef,
  timeChartRef,
  languageChartRef,
  chartOptions,
}) {
  const peakTotal = sumChartValues(callVolumeByTimeData);
  const languageTotal = sumChartValues(languagePreferencesData);

  return (
    <section className="reports-section">
      <div className="reports-section__head">
        <h2>Call volume & trends</h2>
        <p>Unified pulse view of inbound vs outbound volume, peak hours, and language mix.</p>
      </div>
      <div className="reports-chart-grid reports-chart-grid--wide">
        <ReportChartCard
          className="report-chart-card--wide report-chart-card--hero-volume"
          variant="volume"
          icon={LuActivity}
          stat={volumeSummary}
          title="Call volume pulse"
          subtitle={chartConfig.inboundType}
          insight="Stacked gradient bars show inbound & outbound; the gold ribbon tracks total volume and marks the peak period."
          loading={loading}
          empty={!volumeTrendsData}
          chartRef={volumeChartRef}
          chartData={volumeTrendsData}
          tableColumns={['Period', 'Inbound', 'Outbound', 'Total']}
          tableRows={volumeTrendsRows}
          exportSlug="call_volume_pulse"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          bulkExport={{ endpoint: '/api/reports/download-callwise', body: { ...buildBulkExportBody('all'), callType: 'all' }, label: 'Download all call details (CSV)' }}
          height={420}
          stagger={0.05}
        >
          {volumeChartRenderData && (
            <Chart
              type="bar"
              key={`pulse-${volumeChartRenderData.labels?.join('-')}`}
              ref={volumeChartRef}
              data={volumeChartRenderData}
              options={chartOptions.volume}
              plugins={UNIFIED_VOLUME_PLUGINS}
            />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="volume"
          icon={LuClock}
          stat={peakTotal ? `${peakTotal} calls across periods` : null}
          title="Peak call times"
          subtitle="Time of day"
          insight="Purple-to-cyan gradient bars highlight staffing hotspots."
          loading={loading}
          empty={!callVolumeByTimeData}
          chartRef={timeChartRef}
          chartData={callVolumeByTimeData}
          exportSlug="call_volume_by_time"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={300}
          stagger={0.15}
        >
          {callVolumeByTimeData && (
            <Bar ref={timeChartRef} data={callVolumeByTimeData} options={chartOptions.peak} />
          )}
        </ReportChartCard>

        <ReportChartCard
          variant="insight"
          icon={LuLanguages}
          stat={languagePreferencesData ? `${languageTotal} calls` : null}
          title="Language mix"
          subtitle="Audio language"
          insight="Donut with share bars — see which languages dominate."
          loading={loading}
          empty={!languagePreferencesData}
          chartRef={languageChartRef}
          chartData={languagePreferencesData}
          exportSlug="language_mix"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          height={280}
          stagger={0.2}
          canvasWrapper={false}
        >
          {languagePreferencesData && (
            <DonutInsightChart
              chartRef={languageChartRef}
              data={languagePreferencesData}
              options={chartOptions.doughnut}
              centerLabel="Calls"
            />
          )}
        </ReportChartCard>
      </div>
    </section>
  );
}
