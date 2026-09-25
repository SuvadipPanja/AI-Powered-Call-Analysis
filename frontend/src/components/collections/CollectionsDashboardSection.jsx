import { useEffect, useMemo, useState } from 'react';
import {
  LuClipboardList,
  LuCircleCheck,
  LuTriangleAlert,
  LuShieldAlert,
} from '../../icons';
import LanguageMixCard from './LanguageMixCard';
import AiVsManualCard from './AiVsManualCard';
import DispositionDistribution from './DispositionDistribution';
import QualityRagCard from '../dashboard/GlassCharts/QualityRagCard';
import CampaignMixCard from '../dashboard/GlassCharts/CampaignMixCard';
import { EmptyState, PageLoading } from '../ui/index';
import { getCollectionsDashboard } from '../../services/reportsService';
import { resolveDashboardDateRange } from '../../utils/dashboardFilters';
import { formatCompactPercent } from '../../utils/dashboardKpiUtils';
import './collections-dashboard.css';

function toQueryParams(filters) {
  const { fromDate, toDate } = resolveDashboardDateRange(filters || {});
  const params = {};
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  if (filters?.location && filters.location !== 'All') params.location = filters.location;
  if (filters?.tl && filters.tl !== 'All') params.tl = filters.tl;
  if (filters?.agent && filters.agent !== 'All') params.agent = filters.agent;
  if (filters?.callType && filters.callType !== 'All') params.callType = filters.callType;
  if (filters?.leadClassification && filters.leadClassification !== 'All') params.leadClassification = filters.leadClassification;
  return params;
}

export function summarizeDonutRows(items = [], maxRows = 8) {
  const validRows = items.filter((row) => Number(row.count) > 0);
  if (validRows.length <= maxRows) return validRows;

  const visibleRows = validRows.slice(0, maxRows - 1);
  const remainingCount = validRows
    .slice(maxRows - 1)
    .reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const otherIndex = visibleRows.findIndex((row) => String(row.name).trim().toLowerCase() === 'other');

  if (otherIndex >= 0) {
    const current = visibleRows[otherIndex];
    visibleRows[otherIndex] = {
      ...current,
      count: (Number(current.count) || 0) + remainingCount,
      groupedItems: [...(current.groupedItems || [current]), ...validRows.slice(maxRows - 1)],
    };
  } else {
    visibleRows.push({
      name: 'Other categories',
      count: remainingCount,
      color: '#94a3b8',
      groupedItems: validRows.slice(maxRows - 1),
    });
  }

  return visibleRows;
}

function SnapshotMetric({ label, value, note, rate, tone = 'neutral', onClick }) {
  return (
    <article
      className={`collections-dash__snapshot-metric collections-dash__snapshot-metric--${tone}${rate ? ' collections-dash__snapshot-metric--dual' : ''}${onClick ? ' collections-dash__snapshot-metric--clickable' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      aria-label={onClick ? `View ${value} ${label}${rate ? `, ${rate}` : ''}` : undefined}
    >
      <span>{label}</span>
      <div className="collections-dash__snapshot-metric-figures">
        <strong>{value}</strong>
        {rate ? <em>{rate}</em> : null}
      </div>
      <small>{note}</small>
    </article>
  );
}

/**
 * Collections AQM aggregate dashboard — rendered ONLY when a collections vendor
 * profile is active. Uses the same ReportChartCard / DonutInsightChart shell as
 * the rest of the reports UI so cards align, breathe, and stay readable.
 */
export default function CollectionsDashboardSection({ filters, onDrilldown, onSnapshot }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const paramsKey = useMemo(() => JSON.stringify(toQueryParams(filters)), [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const resp = await getCollectionsDashboard(JSON.parse(paramsKey));
        if (active) setData(resp || null);
      } catch (err) {
        if (active) setError(err?.message || 'Failed to load collections metrics');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [paramsKey]);

  useEffect(() => {
    if (!onSnapshot || !data) return;
    onSnapshot({
      kpis: data.kpis || null,
      drilldowns: data.drilldowns || null,
    });
  }, [data, onSnapshot]);

  const kpis = data?.kpis;
  const rag = kpis?.rag || { red: 0, amber: 0, green: 0 };

  const activateRow = (row) => {
    if (row?.drilldownToken) onDrilldown?.(row.drilldownToken);
  };

  const ragBands = useMemo(() => ([
    { key: 'red', name: 'Red (<80%)', count: rag.red || 0, drilldownToken: data?.drilldowns?.rag?.red },
    { key: 'amber', name: 'Amber (80–84.99%)', count: rag.amber || 0, drilldownToken: data?.drilldowns?.rag?.amber },
    { key: 'green', name: 'Green (≥85%)', count: rag.green || 0, drilldownToken: data?.drilldowns?.rag?.green },
  ]), [rag.green, rag.amber, rag.red, data?.drilldowns]);

  return (
    <section className="reports-section collections-dash">
      {loading ? (
        <PageLoading message="Loading collections metrics…" />
      ) : error ? (
        <EmptyState compact fill icon={<LuTriangleAlert aria-hidden />} title="Could not load collections metrics">
          {error}
        </EmptyState>
      ) : !data?.available ? (
        <EmptyState compact fill icon={<LuClipboardList aria-hidden />} title="No collections audits yet">
          No collections-scored calls in this period. Process a collections call to populate these tiles.
        </EmptyState>
      ) : (
        <div className="collections-dash__stack">
          <div className="collections-dash__snapshot" aria-label="Collections performance snapshot">
            <section className="collections-dash__snapshot-group collections-dash__snapshot-group--outcomes" aria-labelledby="collections-outcomes-title">
              <header className="collections-dash__snapshot-head">
                <span className="collections-dash__snapshot-icon collections-dash__snapshot-icon--success" aria-hidden="true">
                  <LuCircleCheck />
                </span>
                <div>
                  <h2 id="collections-outcomes-title">Outcomes</h2>
                  <p>Promise-to-pay performance</p>
                </div>
              </header>
              <div className="collections-dash__snapshot-metrics collections-dash__snapshot-metrics--outcomes">
                <SnapshotMetric
                  label="PTP secured"
                  value={kpis.ptpCount ?? 0}
                  rate={kpis.ptpRate != null ? formatCompactPercent(kpis.ptpRate) : null}
                  note="Successful promises"
                  tone="success"
                  onClick={() => onDrilldown?.(data?.drilldowns?.ptp)}
                />
                <SnapshotMetric
                  label="Strong PTP"
                  value={kpis.ptpStrongCount ?? 0}
                  note="Genuine promises"
                  tone="success"
                  onClick={() => onDrilldown?.(data?.drilldowns?.ptpStrong)}
                />
                <SnapshotMetric
                  label="Weak PTP"
                  value={kpis.ptpWeakCount ?? 0}
                  note="Doubtful promises"
                  tone="warning"
                  onClick={() => onDrilldown?.(data?.drilldowns?.ptpWeak)}
                />
              </div>
            </section>

            <span className="collections-dash__snapshot-divider" aria-hidden="true" />

            <section className="collections-dash__snapshot-group collections-dash__snapshot-group--risk" aria-labelledby="collections-risk-title">
              <header className="collections-dash__snapshot-head">
                <span className="collections-dash__snapshot-icon collections-dash__snapshot-icon--risk" aria-hidden="true">
                  <LuShieldAlert />
                </span>
                <div>
                  <h2 id="collections-risk-title">Risk &amp; compliance</h2>
                  <p>Calls requiring attention</p>
                </div>
              </header>
              <div className="collections-dash__snapshot-metrics">
                <SnapshotMetric label="Fatal calls" value={kpis.fatalCount ?? 0} note="Critical review" tone="danger" onClick={() => onDrilldown?.(data?.drilldowns?.fatal)} />
                <SnapshotMetric label="Red alerts" value={kpis.redAlertCount ?? 0} note="Immediate attention" tone="danger" onClick={() => onDrilldown?.(data?.drilldowns?.redAlert)} />
                <SnapshotMetric label="ZTP violations" value={kpis.ztpCount ?? 0} note="Policy exceptions" tone="warning" onClick={() => onDrilldown?.(data?.drilldowns?.ztp)} />
              </div>
            </section>
          </div>

          <div className="reports-chart-grid collections-dash__charts">
            <QualityRagCard bands={ragBands} onDrilldown={activateRow} />
            <CampaignMixCard items={data.campaignMix} onDrilldown={activateRow} />
            <LanguageMixCard
              items={data.languageMix}
              onDrilldown={activateRow}
            />
            <AiVsManualCard
              coverage={data.auditCoverage}
              tokens={{
                allScored: data?.drilldowns?.audited,
                aiOnly: data?.drilldowns?.aiOnly,
                manualReviewed: data?.drilldowns?.manualReviewed,
              }}
              onDrilldown={activateRow}
            />
            <DispositionDistribution
              items={data.dispositionMix}
              onSelect={activateRow}
            />
          </div>
        </div>
      )}
    </section>
  );
}
