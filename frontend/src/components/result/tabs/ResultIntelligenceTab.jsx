import { LuChartLine, LuTriangleAlert, LuClock } from '../../../icons';
import { EmptyState, PageLoading } from '../../ui';
import ScoreRing from '../ScoreRing';
import { QUERY_TYPE_COLORS, hexA } from '../resultUtils';

export default function ResultIntelligenceTab({
  loading,
  error,
  intelligence,
  categoryColors = {},
}) {
  if (loading) {
    return <PageLoading inline message="Loading call intelligence…" />;
  }
  if (error || !intelligence) {
    return (
      <EmptyState icon={<LuChartLine />} title="Call intelligence unavailable">
        {error || 'This call has not been analyzed for intelligence yet.'}
      </EmptyState>
    );
  }

  const i = intelligence;
  const isLoan = String(i.isLoanCall).toLowerCase() === 'yes';
  const escalated = String(i.escalationRequested).toLowerCase() === 'yes';
  const actioned = String(i.escalationActioned).toLowerCase() === 'yes';
  const csatDone = String(i.csatTransferred).toLowerCase() === 'yes';

  const colorFor = (name) => categoryColors[name] || QUERY_TYPE_COLORS[name] || 'var(--text-muted)';
  const primaryColor = colorFor(i.primaryQueryType);

  const chip = (label, color) => (
    <span
      className="rp-intel__chip"
      style={{
        background: hexA(color, 0.12),
        color,
        border: `1px solid ${hexA(color, 0.35)}`,
      }}
    >
      {label}
    </span>
  );

  const fmtMoney = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);

  const fmtHoldDuration = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return '0s';
    const total = Math.round(n);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const holdDetected = String(i.holdDetected || 'No').toLowerCase() === 'yes';
  const holdEvents = Array.isArray(i.holdEvents) ? i.holdEvents : [];

  return (
    <div className="rp-intel">
      {/* Customer Query */}
      <div className="rp-intel__card">
        <div className="rp-intel__label">Customer Query</div>
        <div style={{ marginTop: 10 }}>
          {chip(i.primaryQueryType, primaryColor)}
          <span className="rp-intel__label" style={{ marginLeft: 4 }}>primary</span>
        </div>
        {Array.isArray(i.secondaryQueryTypes) && i.secondaryQueryTypes.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {i.secondaryQueryTypes.map((q) => chip(q, colorFor(q)))}
            <span className="rp-intel__label" style={{ marginLeft: 4 }}>also discussed</span>
          </div>
        )}
        {i.summary && <p className="rp-intel__summary">{i.summary}</p>}
      </div>

      {/* Escalation */}
      <div className="rp-intel__card">
        <div className="rp-intel__label">Escalation</div>
        <div className="rp-intel__row">
          <div>
            <div className="rp-intel__label">Senior transfer requested</div>
            <div className={`rp-intel__val ${escalated ? 'rp-intel__val--negative' : 'rp-intel__val--positive'}`}>
              {escalated ? 'Yes' : 'No'}
            </div>
          </div>
          <div>
            <div className="rp-intel__label">Agent actioned it</div>
            <div className={`rp-intel__val ${!escalated ? 'rp-intel__val--muted' : actioned ? 'rp-intel__val--positive' : 'rp-intel__val--negative'}`}>
              {i.escalationActioned}
            </div>
          </div>
          <div>
            <div className="rp-intel__label">Category</div>
            <div className="rp-intel__val">{i.escalationCategory}</div>
          </div>
        </div>
        {escalated && !actioned && (
          <p className="rp-intel__warning">
            <LuTriangleAlert size={14} aria-hidden />
            Customer requested a senior but the transfer was not actioned.
          </p>
        )}
      </div>

      {/* C-SAT */}
      <div className="rp-intel__card">
        <div className="rp-intel__label">C-SAT Feedback Transfer</div>
        <div className="rp-intel__csat-row">
          <div className={`rp-intel__val ${csatDone ? 'rp-intel__val--positive' : 'rp-intel__val--muted'}`}>
            {csatDone ? 'Transferred to C-SAT' : 'Not transferred'}
          </div>
          {csatDone && chip('C-SAT captured', '#16a34a')}
        </div>
        <p className="rp-intel__note">
          {csatDone
            ? 'Agent routed the call to the feedback/scoring (C-SAT) system so the customer could rate the call.'
            : 'Agent did not transfer the call to the feedback/scoring (C-SAT) system.'}
        </p>
      </div>

      {/* Agent Hold Time */}
      <div className="rp-intel__card">
        <div className="rp-intel__label">
          <LuClock size={14} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
          Agent Hold Time
        </div>
        {holdDetected ? (
          <>
            <div className="rp-intel__row">
              <div>
                <div className="rp-intel__label">Hold detected</div>
                <div className="rp-intel__val rp-intel__val--negative">Yes</div>
              </div>
              <div>
                <div className="rp-intel__label">Episodes</div>
                <div className="rp-intel__val">{i.holdCount || holdEvents.length || 0}</div>
              </div>
              <div>
                <div className="rp-intel__label">Total hold</div>
                <div className="rp-intel__val">{fmtHoldDuration(i.holdTotalSec)}</div>
              </div>
              <div>
                <div className="rp-intel__label">Longest hold</div>
                <div className="rp-intel__val">{fmtHoldDuration(i.holdLongestSec)}</div>
              </div>
            </div>
            {holdEvents.length > 0 && (
              <ul className="rp-intel__hold-list">
                {holdEvents.map((ev, idx) => (
                  <li key={`hold-${idx}`}>
                    Episode {idx + 1}: {fmtHoldDuration(ev.duration_sec)}
                    {' · '}
                    {ev.trigger === 'phrase' ? 'Explicit hold phrase' : 'Long silence gap'}
                    {' · '}
                    {Number(ev.start_sec).toFixed(1)}s–{Number(ev.end_sec).toFixed(1)}s
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="rp-intel__note">No agent hold was detected on this call.</p>
        )}
      </div>

      {/* Loan Lead */}
      {isLoan ? (
        <div className="rp-intel__card">
          <div className="rp-intel__loan-header">
            <div>
              <div className="rp-intel__label">Loan Lead</div>
              <div style={{ marginTop: 8 }}>{chip(i.loanType, '#16a34a')}</div>
            </div>
            <div className="rp-intel__loan-ring">
              <ScoreRing value={i.successProbability} label="success" size={84} />
              <div className="rp-intel__label" style={{ marginTop: 4 }}>Conversion likelihood</div>
            </div>
          </div>
          <div className="rp-intel__row">
            <div>
              <div className="rp-intel__label">Customer interest</div>
              <div className="rp-intel__val">{i.customerInterest}</div>
            </div>
            <div>
              <div className="rp-intel__label">Can pay EMI on time</div>
              <div className="rp-intel__val">{i.emiAffordability}</div>
            </div>
            <div>
              <div className="rp-intel__label">EMI amount</div>
              <div className="rp-intel__val">{fmtMoney(i.emiAmount)}</div>
            </div>
            <div>
              <div className="rp-intel__label">Loan amount</div>
              <div className="rp-intel__val">{fmtMoney(i.loanAmount)}</div>
            </div>
            <div>
              <div className="rp-intel__label">Agent convinced customer</div>
              <div className="rp-intel__val">{i.agentConvinced}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rp-intel__card">
          <div className="rp-intel__label">Loan Lead</div>
          <p className="rp-intel__note">No loan was discussed on this call.</p>
        </div>
      )}
    </div>
  );
}
