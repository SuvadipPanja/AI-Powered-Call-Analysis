import { Bar } from 'react-chartjs-2';
import { LuUsers, LuTable } from 'react-icons/lu';
import { Badge } from '../../ui';
import ReportChartCard from '../ReportChartCard';

export default function ReportAgentSection({
  loading,
  filters,
  apiBaseUrl,
  buildBulkExportBody,
  agentPerformanceData,
  agentSummaryData,
  agentTableColumns,
  agentPerfChartRef,
  chartOptions,
}) {
  return (
    <section className="reports-section">
      <div className="reports-section__head">
        <h2>Agent performance</h2>
        <p>Leaderboard ranking and full team scorecard.</p>
      </div>
      <div className="reports-chart-grid">
        <ReportChartCard
          variant="agent"
          icon={LuUsers}
          title="Top agent leaderboard"
          subtitle="Top 5 · overall AI score"
          insight="Horizontal gradient bars — fastest way to spot standouts."
          loading={loading}
          empty={!agentPerformanceData}
          chartRef={agentPerfChartRef}
          chartData={agentPerformanceData}
          exportSlug="top_agent_scores"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          bulkExport={{ endpoint: '/api/reports/download-agentwise', body: buildBulkExportBody(), label: 'Download agent-wise report (CSV)' }}
          height={300}
          stagger={0.05}
        >
          {agentPerformanceData && (
            <Bar ref={agentPerfChartRef} data={agentPerformanceData} options={chartOptions.agent} />
          )}
        </ReportChartCard>

        <ReportChartCard
          className="report-chart-card--wide"
          variant="agent"
          icon={LuTable}
          title="Agent performance table"
          subtitle={`${agentSummaryData.length} agents`}
          insight="Per-agent volume, handling time, scores, and resolution."
          loading={loading}
          empty={!agentSummaryData.length}
          tableColumns={agentTableColumns}
          tableRows={agentSummaryData}
          exportSlug="agent_performance_table"
          filters={filters}
          apiBaseUrl={apiBaseUrl}
          bulkExport={{ endpoint: '/api/reports/download-agentwise', body: buildBulkExportBody(), label: 'Download full agent dataset (CSV)' }}
          height={340}
          stagger={0.1}
        >
          <div className="reports-agent-table-wrap ui-table-wrap ui-table-wrap--stack">
            <table className="ui-table ui-table--stack-sm">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Location</th>
                  <th className="ui-table__col--hide-sm">Supervisor</th>
                  <th>Calls</th>
                  <th>Avg time</th>
                  <th>AI score</th>
                  <th className="ui-table__col--hide-sm">Manual</th>
                  <th className="ui-table__col--hide-sm">Resolution</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {agentSummaryData.map((row, index) => (
                  <tr key={index}>
                    <td data-label="Agent">{row.agent || 'Unknown'}</td>
                    <td data-label="Location"><Badge>{row.AgentLocation || 'N/A'}</Badge></td>
                    <td className="ui-table__col--hide-sm" data-label="Supervisor">{row.AgentSupervisor || 'N/A'}</td>
                    <td data-label="Calls">{row.totalCalls || 0}</td>
                    <td data-label="Avg time">{row.avgHandlingTime || '—'}</td>
                    <td data-label="AI score">{row.avgAIScore ? `${row.avgAIScore}%` : '—'}</td>
                    <td className="ui-table__col--hide-sm" data-label="Manual">{row.avgManualScore ? `${row.avgManualScore}%` : '—'}</td>
                    <td className="ui-table__col--hide-sm" data-label="Resolution">{row.satisfaction || '—'}</td>
                    <td data-label="Status">
                      <Badge variant={(row.avgAIScore || 0) >= 80 ? 'success' : (row.avgAIScore || 0) >= 60 ? 'info' : 'warning'}>
                        {(row.avgAIScore || 0) >= 80 ? 'Excellent' : (row.avgAIScore || 0) >= 60 ? 'Good' : 'Improving'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ReportChartCard>
      </div>
    </section>
  );
}
