import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollectionsDashboardSection from './CollectionsDashboardSection';
import { getCollectionsDashboard } from '../../services/reportsService';

jest.mock('../../services/reportsService', () => ({
  getCollectionsDashboard: jest.fn(),
}));

jest.mock('../reports/ReportChartCard', () => function MockReportChartCard({ title, subtitle, className = '', children }) {
  return (
    <article className={`report-chart-card ${className}`.trim()}>
      {subtitle && <span>{subtitle}</span>}
      <h3>{title}</h3>
      {children}
    </article>
  );
});

jest.mock('../reports/DonutInsightChart', () => function MockDonutInsightChart() {
  return <div data-testid="donut-chart" />;
});

describe('CollectionsDashboardSection', () => {
  beforeEach(() => {
    getCollectionsDashboard.mockResolvedValue({
      available: true,
      kpis: {
        ptpCount: 12,
        ptpStrongCount: 8,
        ptpWeakCount: 4,
        ptpRate: 30,
        rpcRate: 91.2,
        rpcFailCount: 3,
        fatalCount: 3,
        redAlertCount: 2,
        ztpCount: 1,
        rag: { green: 4, amber: 2, red: 6 },
      },
      dispositionMix: [{ name: 'Promise to pay', count: 5 }],
      campaignMix: [{ name: 'PDM', count: 7 }],
      languageMix: [
        { name: 'Hindi', count: 88 },
        { name: 'Marathi', count: 19 },
        { name: 'Bengali', count: 3 },
      ],
      auditCoverage: { aiOnly: 90, manualReviewed: 23, avgAi: 82.4, avgManual: 79.1 },
      drilldowns: {
        rag: {},
        ptp: 'token-ptp',
        ptpStrong: 'token-strong',
        ptpWeak: 'token-weak',
        aiOnly: 'token-ai',
        manualReviewed: 'token-man',
      },
    });
  });

  it('removes rubric weightage and keeps the remaining chart cards in a compact order', async () => {
    const { container } = render(<CollectionsDashboardSection filters={{}} />);

    await screen.findByText('Quality grade (RAG)');
    expect(screen.queryByText('Weightage by group')).not.toBeInTheDocument();

    await waitFor(() => {
      const cards = container.querySelectorAll([
        '.collections-dash__charts > .report-chart-card',
        '.collections-dash__charts > .quality-rag-card',
        '.collections-dash__charts > .campaign-mix-card',
        '.collections-dash__charts > .language-mix-card',
        '.collections-dash__charts > .ai-vs-manual-card',
      ].join(', '));
      expect(cards).toHaveLength(5);
      expect(cards[0]).toHaveTextContent('Quality grade (RAG)');
      expect(cards[1]).toHaveTextContent('Campaign mix');
      expect(cards[2]).toHaveTextContent('Language mix');
      expect(cards[3]).toHaveTextContent('AI vs Manual');
      expect(cards[4]).toHaveTextContent('Disposition distribution');
      expect(cards[4]).toHaveClass('collections-dash__distribution-card');
    });
  });

  it('renders the Language mix card inside the collections dashboard host', async () => {
    render(<CollectionsDashboardSection filters={{}} />);
    await screen.findByText('Language mix');
    expect(screen.getByText('AUDIO LANGUAGE')).toBeInTheDocument();
  });

  it('renders the AI vs Manual card beside Language mix', async () => {
    render(<CollectionsDashboardSection filters={{}} />);
    await screen.findByText('AI vs Manual');
    expect(screen.getByText('AUDIT COVERAGE')).toBeInTheDocument();
  });

  it('publishes RPC snapshot for the top KPI strip', async () => {
    const onSnapshot = jest.fn();
    render(<CollectionsDashboardSection filters={{}} onSnapshot={onSnapshot} />);
    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        kpis: expect.objectContaining({ rpcRate: 91.2, rpcFailCount: 3 }),
      }));
    });
  });

  it('replaces PTP conversion with Strong and Weak PTP cards', async () => {
    const onDrilldown = jest.fn();
    render(<CollectionsDashboardSection filters={{}} onDrilldown={onDrilldown} />);

    await screen.findByText('PTP secured');
    expect(screen.queryByText('PTP rate')).not.toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('PTP conversion')).not.toBeInTheDocument();
    expect(screen.queryByText('Open PTP calls')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/view 8 strong ptp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/view 4 weak ptp/i)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/view 8 strong ptp/i));
    expect(onDrilldown).toHaveBeenCalledWith('token-strong');
    await userEvent.click(screen.getByLabelText(/view 4 weak ptp/i));
    expect(onDrilldown).toHaveBeenCalledWith('token-weak');
  });
});
