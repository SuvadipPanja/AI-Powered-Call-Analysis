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
      drilldowns: {
        rag: {},
        ptp: 'token-ptp',
        ptpStrong: 'token-strong',
        ptpWeak: 'token-weak',
      },
    });
  });

  it('removes rubric weightage and keeps the remaining chart cards in a compact order', async () => {
    const { container } = render(<CollectionsDashboardSection filters={{}} />);

    await screen.findByText('Quality grade (RAG)');
    expect(screen.queryByText('Weightage by group')).not.toBeInTheDocument();

    await waitFor(() => {
      const cards = container.querySelectorAll('.collections-dash__charts > .report-chart-card');
      expect(cards).toHaveLength(4);
      expect(cards[0]).toHaveTextContent('Quality grade (RAG)');
      expect(cards[1]).toHaveTextContent('Campaign (AI: PDM / COLL)');
      expect(cards[2]).toHaveTextContent('Language mix');
      expect(cards[3]).toHaveTextContent('Disposition distribution');
      expect(cards[3]).toHaveClass('collections-dash__distribution-card');
    });
  });

  it('renders the Language mix card inside the collections dashboard host', async () => {
    render(<CollectionsDashboardSection filters={{}} />);
    await screen.findByText('Language mix');
    expect(screen.getByText('AUDIO LANGUAGE')).toBeInTheDocument();
  });

  it('replaces PTP conversion with Strong and Weak PTP cards', async () => {
    const onDrilldown = jest.fn();
    render(<CollectionsDashboardSection filters={{}} onDrilldown={onDrilldown} />);

    await screen.findByText('PTP secured');
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
