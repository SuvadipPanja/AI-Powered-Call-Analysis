import { LuChartLine } from '../../../icons';
import { EmptyState, Spinner } from '../../ui';
import ScoreRing from '../ScoreRing';
import { QUERY_TYPE_COLORS, hexA } from '../resultUtils';

export default function ResultIntelligenceTab({
  loading,
  error,
  intelligence,
  categoryColors = {},
}) {
  if (loading) {
    return (
      <div className="rp-analysis-loading">
        <Spinner />
        <span>Loading call intelligence…</span>
      </div>
    );
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

  const chip = (label, color) => (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 999,
        background: hexA(color, 0.12),
        color,
        border: `1px solid ${hexA(color, 0.35)}`,
        fontSize: 13,
        fontWeight: 600,
        margin: '3px 6px 3px 0',
      }}
    >
      {label}
    </span>
  );

  const fmtMoney = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
  const cardStyle = {
    background: 'var(--surface, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  };
  const labelStyle = {
    fontSize: 12,
    color: 'var(--text-muted, #64748b)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
  const valStyle = { fontSize: 15, fontWeight: 600, color: 'var(--text, #0f172a)' };
  const colorFor = (name) => categoryColors[name] || QUERY_TYPE_COLORS[name] || '#64748b';
  const primaryColor = colorFor(i.primaryQueryType);

  return (
    <div className="rp-intel">
      <div style={cardStyle}>
        <div style={labelStyle}>Customer Query</div>
        <div style={{ marginTop: 10 }}>
          {chip(i.primaryQueryType, primaryColor)}
          <span style={{ fontSize: 12, color: 'var(--text-muted,#64748b)', marginLeft: 4 }}>primary</span>
        </div>
        {Array.isArray(i.secondaryQueryTypes) && i.secondaryQueryTypes.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {i.secondaryQueryTypes.map((q) => chip(q, colorFor(q)))}
            <span style={{ fontSize: 12, color: 'var(--text-muted,#64748b)', marginLeft: 4 }}>also discussed</span>
          </div>
        )}
        {i.summary && <p style={{ marginTop: 12, color: 'var(--text,#0f172a)', fontSize: 14 }}>{i.summary}</p>}
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>Escalation</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 12 }}>
          <div>
            <div style={labelStyle}>Senior transfer requested</div>
            <div style={{ ...valStyle, color: escalated ? '#dc2626' : '#16a34a' }}>{escalated ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div style={labelStyle}>Agent actioned it</div>
            <div style={{ ...valStyle, color: !escalated ? '#64748b' : (actioned ? '#16a34a' : '#dc2626') }}>
              {i.escalationActioned}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Category</div>
            <div style={valStyle}>{i.escalationCategory}</div>
          </div>
        </div>
        {escalated && !actioned && (
          <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
            ⚠ Customer requested a senior but the transfer was not actioned.
          </p>
        )}
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>C-SAT Feedback Transfer</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <div style={{ ...valStyle, color: csatDone ? '#16a34a' : '#64748b' }}>
            {csatDone ? 'Transferred to C-SAT' : 'Not transferred'}
          </div>
          {csatDone && chip('C-SAT captured', '#16a34a')}
        </div>
        <p style={{ marginTop: 8, color: 'var(--text-muted,#64748b)', fontSize: 13 }}>
          {csatDone
            ? 'Agent routed the call to the feedback/scoring (C-SAT) system so the customer could rate the call.'
            : 'Agent did not transfer the call to the feedback/scoring (C-SAT) system.'}
        </p>
      </div>

      {isLoan ? (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={labelStyle}>Loan Lead</div>
              <div style={{ marginTop: 8 }}>{chip(i.loanType, '#16a34a')}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <ScoreRing value={i.successProbability} label="success" size={84} />
              <div style={{ ...labelStyle, marginTop: 4 }}>Conversion likelihood</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 16 }}>
            <div>
              <div style={labelStyle}>Customer interest</div>
              <div style={valStyle}>{i.customerInterest}</div>
            </div>
            <div>
              <div style={labelStyle}>Can pay EMI on time</div>
              <div style={valStyle}>{i.emiAffordability}</div>
            </div>
            <div>
              <div style={labelStyle}>EMI amount</div>
              <div style={valStyle}>{fmtMoney(i.emiAmount)}</div>
            </div>
            <div>
              <div style={labelStyle}>Loan amount</div>
              <div style={valStyle}>{fmtMoney(i.loanAmount)}</div>
            </div>
            <div>
              <div style={labelStyle}>Agent convinced customer</div>
              <div style={valStyle}>{i.agentConvinced}</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={labelStyle}>Loan Lead</div>
          <p style={{ marginTop: 8, color: 'var(--text-muted,#64748b)', fontSize: 14 }}>No loan was discussed on this call.</p>
        </div>
      )}
    </div>
  );
}
