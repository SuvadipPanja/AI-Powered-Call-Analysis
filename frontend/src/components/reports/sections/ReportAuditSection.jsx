import { LuShieldCheck, LuClipboardCheck } from 'react-icons/lu';
import { Badge, Button, Card, EmptyState, PageLoading } from '../../ui';

export default function ReportAuditSection({
  auditMetrics,
  auditActivity,
  auditActivityLoading,
  onAuditExport,
  formatAuditTimestamp,
}) {
  return (
    <>
      {auditMetrics?.summary && (
        <section className="reports-section" style={{ marginTop: 32 }}>
          <div className="reports-section__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2><LuShieldCheck style={{ marginRight: 8, verticalAlign: 'middle' }} />Audit Metrics</h2>
              <p>Manual audit statistics and AI vs Manual score comparison</p>
            </div>
            <Button variant="secondary" onClick={onAuditExport} style={{ flexShrink: 0 }}>
              Download Audit Report (CSV)
            </Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--accent)' }}>
                {auditMetrics.summary.totalAudits || 0}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Audits
              </div>
            </Card>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div className="reports-kpi__value reports-kpi__value--positive" style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                {auditMetrics.summary.avgManualScore != null ? `${parseFloat(auditMetrics.summary.avgManualScore).toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Avg Manual Score
              </div>
            </Card>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                {auditMetrics.summary.avgAIScore != null ? `${parseFloat(auditMetrics.summary.avgAIScore).toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Avg AI Score
              </div>
            </Card>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                {auditMetrics.summary.uniqueAgents || 0}
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Agents Audited
              </div>
            </Card>
          </div>
          {auditMetrics.parameterAverages?.length > 0 && (
            <Card style={{ overflow: 'hidden' }}>
              <div className="ui-table-wrap ui-table-wrap--stack">
                <table className="ui-table ui-table--stack-sm" aria-label="Audit parameter score comparison">
                  <thead>
                    <tr>
                      <th scope="col">Parameter</th>
                      <th scope="col">Avg AI Score</th>
                      <th scope="col">Avg Manual Score</th>
                      <th scope="col">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditMetrics.parameterAverages.map((pa) => {
                      const diff = (pa.avgManual != null && pa.avgAI != null)
                        ? (pa.avgManual - pa.avgAI).toFixed(1) : null;
                      return (
                        <tr key={pa.ParameterName}>
                          <td data-label="Parameter" style={{ fontWeight: 600 }}>{pa.ParameterName}</td>
                          <td data-label="Avg AI Score">{pa.avgAI != null ? `${parseFloat(pa.avgAI).toFixed(1)}%` : '—'}</td>
                          <td data-label="Avg Manual Score">{pa.avgManual != null ? `${parseFloat(pa.avgManual).toFixed(1)}%` : '—'}</td>
                          <td data-label="Delta">
                            {diff != null && (
                              <Badge variant={parseFloat(diff) > 2 ? 'success' : parseFloat(diff) < -2 ? 'error' : 'info'}>
                                {parseFloat(diff) > 0 ? '+' : ''}{diff}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>
      )}

      <section className="reports-section" style={{ marginTop: 32 }}>
        <div className="reports-section__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2><LuClipboardCheck style={{ marginRight: 8, verticalAlign: 'middle' }} />Manual Audit Activity</h2>
            <p>Calls manually audited by team leaders and other auditors — who audited, which call, and when</p>
          </div>
          <Button variant="secondary" onClick={onAuditExport} style={{ flexShrink: 0 }}>
            Download Audit Report (CSV)
          </Button>
        </div>

        {auditActivityLoading ? (
          <PageLoading inline message="Loading audit activity…" />
        ) : auditActivity.length > 0 ? (
          <Card style={{ overflow: 'hidden' }}>
            <div className="ui-table-wrap ui-table-wrap--stack">
              <table className="ui-table ui-table--stack-sm" aria-label="Manual audit activity log">
                <thead>
                  <tr>
                    <th scope="col">Call / File</th>
                    <th scope="col">Agent</th>
                    <th scope="col">Audited By</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="ui-table__col--hide-sm">Supervisor</th>
                    <th scope="col">Audited On</th>
                    <th scope="col">Manual Score</th>
                  </tr>
                </thead>
                <tbody>
                  {auditActivity.map((row) => {
                    const auditedOn = formatAuditTimestamp(row.UpdatedAt || row.CreatedAt);
                    const isTeamLeader = String(row.AuditorRole || '').toLowerCase() === 'team leader';
                    return (
                      <tr key={row.AuditID || `${row.AudioFileName}-${auditedOn}`}>
                        <td data-label="Call / File">
                          <span className="ellipsis" title={row.AudioFileName} style={{ maxWidth: 220, display: 'inline-block' }}>
                            {row.AudioFileName}
                          </span>
                        </td>
                        <td data-label="Agent">{row.AgentName || '—'}</td>
                        <td data-label="Audited By" style={{ fontWeight: 600 }}>{row.AuditorUsername || '—'}</td>
                        <td data-label="Role">
                          <Badge variant={isTeamLeader ? 'accent' : 'info'}>
                            {row.AuditorRole || '—'}
                          </Badge>
                        </td>
                        <td className="ui-table__col--hide-sm" data-label="Supervisor">{row.AgentSupervisor || '—'}</td>
                        <td data-label="Audited On">{auditedOn}</td>
                        <td data-label="Manual Score">
                          {row.OverallManualScore != null
                            ? `${parseFloat(row.OverallManualScore).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={<LuClipboardCheck />}
            title="No manual audits"
            variant="fill"
          >
            No manual audits found for the selected date range and filters.
          </EmptyState>
        )}
      </section>
    </>
  );
}
