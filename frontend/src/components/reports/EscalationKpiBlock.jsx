/**
 * Escalation summary KPIs — shared on dashboard and reports (muted semantic colors).
 */
export default function EscalationKpiBlock({ data, showCsat = false }) {
  if (!data) return null;

  return (
    <div className="reports-kpi-block reports-escalation-kpis">
      <div className="reports-kpi-row reports-kpi-row--centered">
        <div className="reports-kpi">
          <span className="reports-kpi__value">{data.requested || 0}</span>
          <span className="reports-kpi__label">Senior requests</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value reports-kpi__value--positive">
            {data.actioned || 0}
          </span>
          <span className="reports-kpi__label">Actioned</span>
        </div>
        <div className="reports-kpi">
          <span className="reports-kpi__value reports-kpi__value--negative">
            {data.notActioned || 0}
          </span>
          <span className="reports-kpi__label">Not actioned</span>
        </div>
      </div>
      {showCsat && (
        <div className="reports-kpi-row reports-kpi-row--spaced reports-kpi-row--centered">
          <div className="reports-kpi">
            <span className="reports-kpi__value reports-kpi__value--positive">
              {data.csatTransferred || 0}
            </span>
            <span className="reports-kpi__label">C-SAT transferred</span>
          </div>
          <div className="reports-kpi">
            <span className="reports-kpi__value">
              {data.total > 0
                ? `${Math.round(((data.csatTransferred || 0) / data.total) * 100)}%`
                : "—"}
            </span>
            <span className="reports-kpi__label">of {data.total || 0} calls</span>
          </div>
        </div>
      )}
    </div>
  );
}
