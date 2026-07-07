import { LuPlay, LuShield } from '../../icons';
import { Badge, EmptyState, ResponsiveTableWrap } from '../ui';
import { formatTimeSec } from './resultUtils';

/** Taboo / policy phrase hits panel — shared by scoring, compliance, and policy tabs. */
export default function TabooAnalysisPanel({ toneAnalysis, showEmptyHint = false, onSeek }) {
  const taboo = toneAnalysis?.taboo_analysis;

  if (!taboo) {
    if (!showEmptyHint) return null;
    return (
      <EmptyState icon={<LuShield />} title="Policy analysis not available">
        <p>
          Taboo / prohibited phrase results appear here after AI processing with the latest version.
          Re-upload or re-process this call to run policy checks against your Bank Config rules.
        </p>
      </EmptyState>
    );
  }

  const hits = taboo.hits || [];
  if (!hits.length) {
    return (
      <div className="rp-taboo-panel rp-taboo-panel--clean">
        <div className="rp-taboo-panel__head">
          <LuShield />
          <div>
            <h4>Prohibited Phrases</h4>
            <p>{taboo.summary || 'No taboo or prohibited phrases detected.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const severityColor = (sev) => (
    sev === 'high' ? 'var(--color-danger)' : sev === 'low' ? 'var(--color-warning)' : 'var(--color-accent)'
  );

  return (
    <div className="rp-taboo-panel">
      <div className="rp-taboo-panel__head">
        <LuShield />
        <div>
          <h4>Prohibited Phrases Detected</h4>
          <p>{taboo.summary}</p>
          {taboo.total_penalty > 0 && (
            <Badge variant="danger">Score impact: -{taboo.total_penalty} overall (agent)</Badge>
          )}
        </div>
      </div>
      <ResponsiveTableWrap className="rp-taboo-table-wrap" label="Policy phrase hits" minWidth="42rem">
        <table className="ui-table ui-table--stack-sm rp-taboo-table">
          <thead>
            <tr>
              <th scope="col">Word</th>
              <th scope="col">Speaker</th>
              <th scope="col">Audio time</th>
              <th scope="col">Severity</th>
              <th scope="col">Score impact</th>
              <th scope="col">Context</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, idx) => (
              <tr key={`taboo-${idx}`} className={hit.role === 'Agent' ? 'is-agent-violation' : ''}>
                <td data-label="Word"><strong>{hit.word}</strong></td>
                <td data-label="Speaker">{hit.role}</td>
                <td data-label="Audio time">
                  <button
                    type="button"
                    className="rp-taboo-seek"
                    onClick={() => onSeek?.(hit.start)}
                    title="Play from this moment"
                  >
                    <LuPlay size={10} />
                    {formatTimeSec(hit.start)}
                    {hit.end ? ` – ${formatTimeSec(hit.end)}` : ''}
                  </button>
                </td>
                <td data-label="Severity">
                  <span className="rp-taboo-sev" style={{ color: severityColor(hit.severity) }}>
                    {hit.severity}
                  </span>
                  <span className="rp-taboo-cat">{hit.category}</span>
                </td>
                <td data-label="Score impact">
                  {hit.role === 'Agent' && hit.score_impact ? (
                    <span>
                      Overall {hit.score_impact.Overall_Scoring},
                      {' '}Tone {hit.score_impact.Polite_Tone},
                      {' '}Protocol {hit.score_impact.Adherence_to_Protocol}
                    </span>
                  ) : '—'}
                </td>
                <td className="rp-taboo-context" data-label="Context">{hit.matched_in}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ResponsiveTableWrap>
    </div>
  );
}
