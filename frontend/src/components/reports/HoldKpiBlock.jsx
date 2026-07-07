/**
 * Hold-time summary KPIs — shared on dashboard and reports (muted semantic colors).
 */
function fmtDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '0s';
  const total = Math.round(n);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function HoldKpiBlock({ data }) {
  if (!data) return null;

  const totalCalls = Number(data.total) || 0;
  const withHold = Number(data.withHold) || 0;
  const pct = totalCalls > 0 ? Math.round((withHold / totalCalls) * 100) : 0;

  return (
    <div className="reports-kpi-block reports-hold-kpis">
      <div className="reports-kpi-row reports-kpi-row--centered">
        <div className="reports-kpi">
          <span className="reports-kpi__value">{withHold}</span>
          <span className="reports-kpi__label">Calls with hold</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value">{pct}%</span>
          <span className="reports-kpi__label">of {totalCalls} calls</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value">{fmtDuration(data.avgHoldSec)}</span>
          <span className="reports-kpi__label">Avg hold (when detected)</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value reports-kpi__value--negative">
            {fmtDuration(data.longestHoldSec)}
          </span>
          <span className="reports-kpi__label">Longest hold</span>
        </div>
      </div>
      <div className="reports-kpi-row reports-kpi-row--spaced reports-kpi-row--centered">
        <div className="reports-kpi">
          <span className="reports-kpi__value">{Number(data.totalHoldEvents) || 0}</span>
          <span className="reports-kpi__label">Hold episodes</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value">{fmtDuration(data.totalHoldSec)}</span>
          <span className="reports-kpi__label">Total hold time</span>
        </div>
      </div>
    </div>
  );
}
