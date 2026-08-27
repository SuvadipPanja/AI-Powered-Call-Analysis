const BANDS = ["0–6 months", "6–12 months", "1–3 years", "3+ years", "Unknown"];

export function tenureBand(startDate, asOfDate) {
  const start = Date.parse(startDate);
  const asOf = Date.parse(asOfDate);
  if (!Number.isFinite(start) || !Number.isFinite(asOf) || asOf < start) return "Unknown";
  const months = (asOf - start) / (1000 * 60 * 60 * 24 * 30.4375);
  if (months < 6) return "0–6 months";
  if (months < 12) return "6–12 months";
  if (months < 36) return "1–3 years";
  return "3+ years";
}

export const TENURE_BANDS = BANDS;
