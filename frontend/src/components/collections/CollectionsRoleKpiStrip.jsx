import { useEffect, useMemo, useState } from 'react';
import {
  LuClipboardList,
  LuGauge,
  LuHandshake,
  LuTriangleAlert,
  LuShieldAlert,
} from '../../icons';
import { getCollectionsDashboard } from '../../services/reportsService';
import { resolveDashboardDateRange } from '../../utils/dashboardFilters';

/**
 * Compact collections KPI strip for Agent / TL surfaces.
 * Tenant-gated by the parent (only mount when isCollections).
 */
export default function CollectionsRoleKpiStrip({
  filters = {},
  title = 'Collections quality',
  subtitle = 'AQM metrics for the selected period',
}) {
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  const paramsKey = useMemo(() => {
    const { fromDate, toDate } = resolveDashboardDateRange(filters || {});
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    if (filters?.tl && filters.tl !== 'All') params.tl = filters.tl;
    if (filters?.agent && filters.agent !== 'All') params.agent = filters.agent;
    if (filters?.location && filters.location !== 'All') params.location = filters.location;
    return JSON.stringify(params);
  }, [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const resp = await getCollectionsDashboard(JSON.parse(paramsKey));
        if (active) setKpis(resp?.kpis || null);
      } catch {
        if (active) setKpis(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [paramsKey]);

  const tiles = [
    {
      label: 'Calls audited',
      value: kpis?.totalAudited ?? 0,
      icon: LuClipboardList,
    },
    {
      label: 'Avg quality',
      value: kpis?.avgQuality != null ? `${Number(kpis.avgQuality).toFixed(1)}%` : '—',
      icon: LuGauge,
    },
    {
      label: 'Strong PTP',
      value: kpis?.ptpStrongCount ?? 0,
      icon: LuHandshake,
    },
    {
      label: 'Weak PTP',
      value: kpis?.ptpWeakCount ?? 0,
      icon: LuHandshake,
    },
    {
      label: 'Fatal calls',
      value: kpis?.fatalCount ?? 0,
      icon: LuTriangleAlert,
      danger: (kpis?.fatalCount || 0) > 0,
    },
    {
      label: 'Red alerts',
      value: kpis?.redAlertCount ?? 0,
      icon: LuShieldAlert,
      danger: (kpis?.redAlertCount || 0) > 0,
    },
  ];

  return (
    <section className="reports-section collections-role-kpi">
      <div className="reports-section__head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="collections-role-kpi__grid">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.label}
              className={`collections-role-kpi__tile${t.danger ? ' collections-role-kpi__tile--danger' : ''}`}
            >
              <span className="collections-role-kpi__icon" aria-hidden>
                <Icon size={16} />
              </span>
              <div>
                <div className="collections-role-kpi__value">
                  {loading ? '…' : t.value}
                </div>
                <div className="collections-role-kpi__label">{t.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
