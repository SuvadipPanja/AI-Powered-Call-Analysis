import { formatTimeSec } from './resultUtils';

export function parseToneLabel(label) {
  const matches = label.match(/(\d+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) return label;
  if (matches.length >= 2) {
    return `${formatTimeSec(parseFloat(matches[0]))} - ${formatTimeSec(parseFloat(matches[1]))}`;
  }
  return formatTimeSec(parseFloat(matches[0]));
}

export function calculateEnergy(distribution) {
  if (!distribution) return 0;
  let { High = 0, Medium = 0, Low = 0 } = distribution;
  const total = Number(High) + Number(Medium) + Number(Low);
  if (total > 0 && total <= 1.01) {
    const scale = 350;
    High = Number(High) * scale;
    Medium = Number(Medium) * scale;
    Low = Number(Low) * scale;
  }
  return High * 3 + Medium * 2 + Low * 1;
}

export function computeToneStats(speakerObj) {
  if (!speakerObj) return null;
  const keys = Object.keys(speakerObj);
  const segments = keys.length;
  let totalHigh = 0;
  let totalMed = 0;
  let totalLow = 0;
  const energies = [];
  keys.forEach((k) => {
    const d = speakerObj[k]?.tone_distribution || {};
    let H = Number(d.High || 0);
    let M = Number(d.Medium || 0);
    let L = Number(d.Low || 0);
    const sum = H + M + L;
    if (sum > 0 && sum <= 1.01) {
      H *= 350;
      M *= 350;
      L *= 350;
    }
    totalHigh += H;
    totalMed += M;
    totalLow += L;
    energies.push(H * 3 + M * 2 + L);
  });
  const total = totalHigh + totalMed + totalLow || 1;
  const pctHigh = (totalHigh / total) * 100;
  const pctMed = (totalMed / total) * 100;
  const pctLow = (totalLow / total) * 100;
  const avgEnergy = energies.reduce((a, b) => a + b, 0) / (energies.length || 1);
  const dominant = pctHigh >= pctMed && pctHigh >= pctLow
    ? 'Energetic'
    : pctLow >= pctMed ? 'Calm' : 'Moderate';
  const highSegments = energies.filter((e) => e > 700).length;
  return { segments, pctHigh, pctMed, pctLow, avgEnergy, dominant, highSegments, energies };
}
