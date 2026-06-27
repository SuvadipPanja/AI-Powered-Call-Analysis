import { LuShieldCheck, LuClipboardCheck } from 'react-icons/lu';
import { Badge, Spinner, Button, Card } from '../../ui';

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
              <div style={{ overflowX: 'auto' }}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Avg AI Score</th>
                      <th>Avg Manual Score</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditMetrics.parameterAverages.map((pa) => {
                      const diff = (pa.avgManual != null && pa.avgAI != null)
                        ? (pa.avgManual - pa.avgAI).toFixed(1) : null;
                      return (
                        <tr key={pa.ParameterName}>
                          <td style={{ fontWeight: 600 }}>{pa.ParameterName}</td>
                          <td>{pa.avgAI != null ? `${parseFloat(pa.avgAI).toFixed(1)}%` : '—'}</td>
                          <td>{pa.avgManual != null ? `${parseFloat(pa.avgManual).toFixed(1)}%` : '—'}</td>
                          <td>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 24, color: 'var(--text-muted)' }}>
            <Spinner /> Loading audit activity…
          </div>
        ) : auditActivity.length > 0 ? (
          <Card style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Call / File</th>
                    <th>Agent</th>
                    <th>Audited By</th>
                    <th>Role</th>
                    <th>Supervisor</th>
                    <th>Audited On</th>
                    <th>Manual Score</th>
                  </tr>
                </thead>
                <tbody>
                  {auditActivity.map((row) => {
                    const auditedOn = formatAuditTimestamp(row.UpdatedAt || row.CreatedAt);
                    const isTeamLeader = String(row.AuditorRole || '').toLowerCase() === 'team leader';
                    return (
                      <tr key={row.AuditID || `${row.AudioFileName}-${auditedOn}`}>
                        <td>
                          <span className="ellipsis" title={row.AudioFileName} style={{ maxWidth: 220, display: 'inline-block' }}>
                            {row.AudioFileName}
                          </span>
                        </td>
                        <td>{row.AgentName || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{row.AuditorUsername || '—'}</td>
                        <td>
                          <Badge variant={isTeamLeader ? 'accent' : 'info'}>
                            {row.AuditorRole || '—'}
                          </Badge>
                        </td>
                        <td>{row.AgentSupervisor || '—'}</td>
                        <td>{auditedOn}</td>
                        <td>
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
          <Card style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            No manual audits found for the selected date range and filters.
          </Card>
        )}
      </section>
    </>
  );
}
