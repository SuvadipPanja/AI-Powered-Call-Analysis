import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LuClipboardList,
  LuCircleCheck,
  LuTriangleAlert,
  LuShieldAlert,
  LuChartPie,
  LuTags,
  LuMegaphone,
} from '../../icons';
import ReportChartCard from '../reports/ReportChartCard';
import DonutInsightChart from '../reports/DonutInsightChart';
import LanguageMixCard from './LanguageMixCard';
import AiVsManualCard from './AiVsManualCard';
import { EmptyState, PageLoading } from '../ui/index';
import { getCollectionsDashboard } from '../../services/reportsService';
import { resolveDashboardDateRange } from '../../utils/dashboardFilters';
import {
  buildColoredDoughnutData,
  buildModernDoughnutData,
  modernDoughnutOptions,
} from '../reports/reportsChartConfig';
import './collections-dashboard.css';

// Hex only — Chart.js canvas cannot paint CSS `var(...)` strings (renders black).
const RAG_COLORS = {
  green: '#16a34a',
  amber: '#d97706',
  red: '#dc2626',
};

const DISPOSITION_COLORS = [
  { match: /promise\s*to\s*pay/i, color: '#16a34a' },
  { match: /confirm.*ecs/i, color: '#0f766e' },
  { match: /call\s*back/i, color: '#0ea5e9' },
  { match: /claim\s*paid/i, color: '#2563eb' },
  { match: /will\s*not\s*clear/i, color: '#dc2626' },
  { match: /wrong\s*number/i, color: '#64748b' },
];

function dispositionColor(label) {
  const semantic = DISPOSITION_COLORS.find((entry) => entry.match.test(String(label || '')));
  return semantic?.color || '#78909c';
}

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

function MixDonutCard({
  title,
  subtitle,
  icon: Icon,
  variant = 'volume',
  items,
  emptyLabel = 'No data for this period.',
  centerLabel = 'Total',
  onDrilldown,
}) {
  const chartRef = useRef(null);
  const rows = useMemo(() => summarizeDonutRows(items), [items]);
  const chartData = useMemo(() => {
    if (!rows.length) return null;
    const labels = rows.map((r) => r.name || 'Unknown');
    const values = rows.map((r) => Number(r.count) || 0);
    // Prefer per-row color so filtered-out zero bands (e.g. Amber=0) never
    // shift Green/Red onto the wrong palette index.
    if (rows.some((r) => r.color)) {
      return buildColoredDoughnutData(labels, values, rows.map((r) => r.color));
    }
    return buildModernDoughnutData(labels, values);
  }, [rows]);
  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.count) || 0), 0),
    [rows],
  );
  const opts = useMemo(() => modernDoughnutOptions({ cutout: '68%' }), []);

  return (
    <ReportChartCard
      variant={variant}
      icon={Icon}
      title={title}
      subtitle={subtitle}
      empty={!chartData}
      emptyMessage={emptyLabel}
      canvasWrapper={false}
      height={220}
    >
      {chartData && (
        <DonutInsightChart
          chartRef={chartRef}
          data={chartData}
          options={opts}
          centerValue={total}
          centerLabel={centerLabel}
          height={164}
          onItemActivate={onDrilldown ? (index) => onDrilldown(rows[index]) : undefined}
        />
      )}
    </ReportChartCard>
  );
}

function RankedDistributionCard({
  title,
  subtitle,
  icon: Icon,
  items,
  emptyLabel = 'No data for this period.',
  onDrilldown,
}) {
  const rows = useMemo(() => summarizeDonutRows(items, 8), [items]);
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    [rows],
  );

  return (
    <ReportChartCard
      variant="volume"
      icon={Icon}
      title={title}
      subtitle={subtitle}
      stat={total ? `${total} calls` : undefined}
      empty={!rows.length}
      emptyMessage={emptyLabel}
      canvasWrapper={false}
      height={240}
      className="collections-dash__distribution-card"
    >
      {rows.length > 0 && (
        <div className="collections-dash__ranked" aria-label={title}>
          {rows.map((row) => {
            const count = Number(row.count) || 0;
            const percent = total ? Math.round((count / total) * 100) : 0;
            const color = row.color || dispositionColor(row.name);
            const interactive = Boolean(onDrilldown && row.drilldownToken);
            const content = (
              <>
                <span className="collections-dash__ranked-label" title={String(row.name || 'Unknown')}>
                  <span className="collections-dash__ranked-dot" style={{ backgroundColor: color }} aria-hidden="true" />
                  <span>{row.name || 'Unknown'}</span>
                </span>
                <span className="collections-dash__ranked-bar" aria-hidden="true">
                  <span style={{ width: `${percent}%`, backgroundColor: color }} />
                </span>
                <strong className="collections-dash__ranked-count">{count}</strong>
                <span className="collections-dash__ranked-percent">{percent}%</span>
              </>
            );

            return interactive ? (
              <button
                type="button"
                className="collections-dash__ranked-row collections-dash__ranked-row--button"
                key={row.name}
                onClick={() => onDrilldown(row)}
                aria-label={`View ${count} calls for ${row.name}`}
              >
                {content}
              </button>
            ) : (
              <div className="collections-dash__ranked-row" key={row.name}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </ReportChartCard>
  );
}

function SnapshotMetric({ label, value, note, tone = 'neutral', onClick }) {
  return (
    <article
      className={`collections-dash__snapshot-metric collections-dash__snapshot-metric--${tone}${onClick ? ' collections-dash__snapshot-metric--clickable' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      aria-label={onClick ? `View ${value} ${label}` : undefined}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

/**
 * Collections AQM aggregate dashboard — rendered ONLY when a collections vendor
 * profile is active. Uses the same ReportChartCard / DonutInsightChart shell as
 * the rest of the reports UI so cards align, breathe, and stay readable.
 */
export default function CollectionsDashboardSection({ filters, onDrilldown }) {
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

  const kpis = data?.kpis;
  const rag = kpis?.rag || { red: 0, amber: 0, green: 0 };

  const activateRow = (row) => {
    if (row?.drilldownToken) onDrilldown?.(row.drilldownToken);
  };

  const ragItems = useMemo(() => ([
    { name: 'Green (≥85%)', count: rag.green || 0, color: RAG_COLORS.green },
    { name: 'Amber (80–84.99%)', count: rag.amber || 0, color: RAG_COLORS.amber },
    { name: 'Red (<80%)', count: rag.red || 0, color: RAG_COLORS.red },
  ]).map((item, index) => ({
    ...item,
    drilldownToken: [
      data?.drilldowns?.rag?.green,
      data?.drilldowns?.rag?.amber,
      data?.drilldowns?.rag?.red,
    ][index],
  })), [rag.green, rag.amber, rag.red, data?.drilldowns]);

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
            <MixDonutCard
              title="Quality grade (RAG)"
              subtitle="Share of audited calls by score band"
              icon={LuChartPie}
              variant="quality"
              items={ragItems}
              emptyLabel="No graded calls yet."
              onDrilldown={activateRow}
            />
            <MixDonutCard
              title="Campaign (AI: PDM / COLL)"
              subtitle="Inferred drive type from the call — not CRM campaign name"
              icon={LuMegaphone}
              variant="insight"
              items={data.campaignMix}
              onDrilldown={activateRow}
              emptyLabel="No campaign labels yet — re-run AI on older calls if needed."
            />
            <LanguageMixCard
              items={data.languageMix}
              onDrilldown={activateRow}
            />
            <AiVsManualCard
              coverage={data.auditCoverage}
              tokens={{
                aiOnly: data?.drilldowns?.aiOnly,
                manualReviewed: data?.drilldowns?.manualReviewed,
              }}
              onDrilldown={activateRow}
            />
            <RankedDistributionCard
              title="Disposition distribution"
              subtitle="AI call outcome (ICIC disposition list)"
              icon={LuTags}
              items={data.dispositionMix}
              onDrilldown={activateRow}
              emptyLabel="No dispositions yet — re-run AI on older calls if needed."
            />
          </div>
        </div>
      )}
    </section>
  );
}
