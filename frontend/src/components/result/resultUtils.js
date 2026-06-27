export const ANALYSIS_TABS = [
  { key: 'scoring', label: 'Scoring' },
  { key: 'intel', label: 'Call Intelligence' },
  { key: 'policy', label: 'Policy Words' },
  { key: 'tone', label: 'Tone Analysis' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'script', label: 'Compliance' },
];

export const QUERY_TYPE_COLORS = {
  'Balance/Account Enquiry': '#0d9488',
  'ATM/Debit Card Issue': '#6366f1',
  'New ATM/Debit Card Request': '#8b5cf6',
  'Complaint/Grievance': '#ef4444',
  'Branch Referral': '#f59e0b',
  'Application/App Issue': '#0ea5e9',
  'Loan Enquiry': '#16a34a',
  'Bank Server/Technical Issue': '#dc2626',
  'Payment Deducted/Failed Transaction': '#db2777',
  'KYC/Document Update': '#7c3aed',
  'Other/General Info': '#64748b',
};

export const RUBRIC = [
  'Opening Speech', 'Empathy', 'Query Handling', 'Adherence to Protocol',
  'Resolution Assurance', 'Query Resolution', 'Polite Tone',
  'Authentication Verification', 'Escalation Handling', 'Closing Speech',
];

export const SPEAKER_COLORS = {
  agent: '#0d9488',
  customer: '#3b82f6',
};

export function parseToSeconds(val) {
  if (val == null || val === '') return NaN;
  if (!isNaN(val)) return Number(val);
  const parts = String(val).split(':').map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2 && parts.every((n) => !isNaN(n))) return parts[0] * 60 + parts[1];
  return NaN;
}

export function formatTimeSec(totalSec) {
  const sec = Math.floor(parseToSeconds(totalSec));
  if (isNaN(sec) || sec <= 0) return '0s';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatWPM(wpm) {
  return isNaN(wpm) ? 'N/A' : Number(wpm).toFixed(0);
}

export function formatToneFrequency(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)} MHz`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

export function alphaColor(hex, opacity) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function hexA(hex, a) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return hex || `rgba(15,118,110,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function num(v) {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isNaN(n) ? 0 : n;
}

export function rubricPercent(v) {
  const n = num(v);
  if (n <= 0) return 0;
  if (n <= 10) return n * 10;
  return Math.min(100, n);
}

export function formatScoreCell(val) {
  const n = rubricPercent(val);
  if (n <= 0 && (val == null || val === '')) return '—';
  return `${n}%`;
}

export function getScoreBand(pct) {
  if (pct >= 80) return 'excellent';
  if (pct >= 60) return 'good';
  if (pct >= 40) return 'fair';
  if (pct > 0) return 'poor';
  return '';
}

export function generateStrongPassword(length = 16) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const symbols = '!@#$%&*_+-=?';
  const all = upper + lower + digits + symbols;
  const mandatory = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
  const rest = Array.from({ length: length - mandatory.length }, () =>
    all[Math.floor(Math.random() * all.length)]
  );
  return [...mandatory, ...rest].sort(() => Math.random() - 0.5).join('');
}
