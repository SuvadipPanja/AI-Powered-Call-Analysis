import { num, getScoreBand } from './resultUtils';

export default function ScoreRing({ value, size = 72, strokeWidth = 6, label, variant }) {
  const pct = Math.min(100, Math.max(0, num(value)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const band = variant || getScoreBand(pct);

  return (
    <div className="rp-score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--border)" strokeWidth={strokeWidth}
        />
        <circle
          className={`rp-score-ring__progress rp-score-ring__progress--${band}`}
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="rp-score-ring__inner">
        <span className="rp-score-ring__value">{pct > 0 ? `${pct}` : '—'}</span>
        {label && <span className="rp-score-ring__label">{label}</span>}
      </div>
    </div>
  );
}
