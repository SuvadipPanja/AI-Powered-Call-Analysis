import { render, screen } from '@testing-library/react';
import ReportAuditSection from './ReportAuditSection';

describe('ReportAuditSection', () => {
  const formatAuditTimestamp = (value) => (value ? String(value).slice(0, 10) : '—');

  it('renders stacked audit activity table with accessible name', () => {
    render(
      <ReportAuditSection
        auditMetrics={null}
        auditActivity={[
          {
            AuditID: 1,
            AudioFileName: 'call-001.mp3',
            AgentName: 'Agent A',
            AuditorUsername: 'tl_user',
            AuditorRole: 'Team Leader',
            AgentSupervisor: 'Supervisor',
            UpdatedAt: '2026-06-01T10:00:00Z',
            OverallManualScore: 88.5,
          },
        ]}
        auditActivityLoading={false}
        onAuditExport={jest.fn()}
        formatAuditTimestamp={formatAuditTimestamp}
      />,
    );

    expect(screen.getByRole('table', { name: /manual audit activity log/i })).toBeInTheDocument();
    expect(screen.getByText('call-001.mp3')).toBeInTheDocument();
    expect(screen.getByText('88.5%')).toBeInTheDocument();
  });

  it('shows empty state message when no audit activity', () => {
    render(
      <ReportAuditSection
        auditMetrics={null}
        auditActivity={[]}
        auditActivityLoading={false}
        onAuditExport={jest.fn()}
        formatAuditTimestamp={formatAuditTimestamp}
      />,
    );

    expect(screen.getByText(/no manual audits found/i)).toBeInTheDocument();
  });

  it('renders parameter comparison table when metrics exist', () => {
    render(
      <ReportAuditSection
        auditMetrics={{
          summary: { totalAudits: 2, avgManualScore: 80, avgAIScore: 75, uniqueAgents: 1 },
          parameterAverages: [
            { ParameterName: 'Empathy', avgAI: 70, avgManual: 85 },
          ],
        }}
        auditActivity={[]}
        auditActivityLoading={false}
        onAuditExport={jest.fn()}
        formatAuditTimestamp={formatAuditTimestamp}
      />,
    );

    expect(screen.getByRole('table', { name: /audit parameter score comparison/i })).toBeInTheDocument();
    expect(screen.getByText('Empathy')).toBeInTheDocument();
  });
});
