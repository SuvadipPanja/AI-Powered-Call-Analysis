/**
 * Chart.js theme — industrial-grade, token-driven, animated (day/night).
 */
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function cssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function readChartPalette() {
  return {
    accent: cssVar("--accent", "#0f766e"),
    accentSoft: cssVar("--accent-soft", "rgba(15,118,110,0.16)"),
    text: cssVar("--text", "#e6e9ee"),
    textMuted: cssVar("--text-muted", "#97a3b4"),
    border: cssVar("--border", "#2a323d"),
    surface: cssVar("--surface", "#151b23"),
    surface2: cssVar("--surface-2", "#1a2230"),
    success: cssVar("--success", "#22c55e"),
    warning: cssVar("--warning", "#f59e0b"),
    danger: cssVar("--danger", "#ef4444"),
    info: cssVar("--info", "#38bdf8"),
  };
}

const SERIES = () => {
  const p = readChartPalette();
  return [p.accent, p.success, p.warning, p.danger, p.info, "#a8a29e", "#0d9488", "#94a3b8"];
};

export function chartSeriesColors() {
  return SERIES();
}

export function applyChartDefaults() {
  const p = readChartPalette();
  ChartJS.defaults.color = p.textMuted;
  ChartJS.defaults.borderColor = p.border;
  ChartJS.defaults.backgroundColor = p.surface;
  ChartJS.defaults.font.family = cssVar("--font-sans", "DM Sans, system-ui, sans-serif");
  ChartJS.defaults.font.size = 12;
  ChartJS.defaults.animation.duration = 900;
  ChartJS.defaults.animation.easing = "easeOutQuart";
  ChartJS.defaults.plugins.legend.labels.color = p.text;
  ChartJS.defaults.plugins.legend.labels.usePointStyle = true;
  ChartJS.defaults.plugins.legend.labels.boxWidth = 8;
  ChartJS.defaults.plugins.legend.labels.padding = 14;
  ChartJS.defaults.plugins.tooltip.backgroundColor = p.surface;
  ChartJS.defaults.plugins.tooltip.titleColor = p.text;
  ChartJS.defaults.plugins.tooltip.bodyColor = p.textMuted;
  ChartJS.defaults.plugins.tooltip.borderColor = p.border;
  ChartJS.defaults.plugins.tooltip.borderWidth = 1;
  ChartJS.defaults.plugins.tooltip.padding = 12;
  ChartJS.defaults.plugins.tooltip.cornerRadius = 10;
  ChartJS.defaults.elements.bar.borderRadius = 8;
  ChartJS.defaults.elements.point.hoverRadius = 7;
}

export function baseChartOptions(overrides = {}) {
  const p = readChartPalette();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    animation: {
      duration: 900,
      easing: "easeOutQuart",
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: p.text, padding: 16, font: { weight: "600" } },
      },
      tooltip: {
        backgroundColor: p.surface,
        titleColor: p.text,
        bodyColor: p.textMuted,
        borderColor: p.border,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
      },
    },
    scales: {
      x: {
        grid: { color: p.border, drawBorder: false, lineWidth: 0.5 },
        ticks: { color: p.textMuted, maxRotation: 0, font: { size: 11 } },
      },
      y: {
        grid: { color: p.border, drawBorder: false, lineWidth: 0.5 },
        ticks: { color: p.textMuted, font: { size: 11 } },
        beginAtZero: true,
      },
    },
    ...overrides,
  };
}

export function doughnutChartOptions(overrides = {}) {
  const p = readChartPalette();
  return baseChartOptions({
    cutout: "62%",
    scales: {},
    plugins: {
      legend: { position: "bottom", labels: { color: p.text, padding: 14 } },
    },
    ...overrides,
  });
}

export function lineDataset(label, data, index = 0) {
  const colors = SERIES();
  const color = colors[index % colors.length];
  const p = readChartPalette();
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: p.accentSoft,
    pointBackgroundColor: color,
    pointBorderColor: p.surface,
    pointRadius: 4,
    pointHoverRadius: 7,
    borderWidth: 2.5,
    tension: 0.4,
    fill: true,
  };
}

export function barDataset(label, data, index = 0) {
  const colors = SERIES();
  const color = colors[index % colors.length];
  return {
    label,
    data,
    backgroundColor: color,
    borderColor: color,
    borderRadius: 8,
    borderSkipped: false,
    maxBarThickness: 48,
  };
}

/** Inbound (green) / Outbound (blue) paired bar datasets */
export function inboundOutboundBarDatasets(inboundData, outboundData, labels) {
  const p = readChartPalette();
  void labels;
  return [
    {
      label: "Inbound",
      data: inboundData,
      backgroundColor: p.success,
      borderColor: p.success,
      borderRadius: { topLeft: 10, topRight: 10, bottomLeft: 4, bottomRight: 4 },
      borderSkipped: false,
      maxBarThickness: 36,
    },
    {
      label: "Outbound",
      data: outboundData,
      backgroundColor: p.accent,
      borderColor: p.accent,
      borderRadius: { topLeft: 10, topRight: 10, bottomLeft: 4, bottomRight: 4 },
      borderSkipped: false,
      maxBarThickness: 36,
    },
  ];
}

function colorWithAlpha(color, alpha) {
  if (!color) return `rgba(15, 118, 110, ${alpha})`;
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const nums = color.match(/\d+/g);
  if (nums && nums.length >= 3) {
    return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
  }
  return color;
}

function areaFillGradient(color) {
  return (context) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return colorWithAlpha(color, 0.2);
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, colorWithAlpha(color, 0.38));
    gradient.addColorStop(0.55, colorWithAlpha(color, 0.12));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    return gradient;
  };
}

/** Smooth area-line datasets for daily duration trends */
export function inboundOutboundAreaDatasets(inboundData, outboundData) {
  const p = readChartPalette();
  return [
    {
      label: "Inbound",
      data: inboundData,
      borderColor: p.success,
      backgroundColor: areaFillGradient(p.success),
      pointBackgroundColor: p.success,
      pointBorderColor: p.surface,
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 9,
      pointHoverBorderWidth: 3,
      borderWidth: 2.5,
      tension: 0.45,
      fill: true,
      spanGaps: true,
    },
    {
      label: "Outbound",
      data: outboundData,
      borderColor: p.accent,
      backgroundColor: areaFillGradient(p.accent),
      pointBackgroundColor: p.accent,
      pointBorderColor: p.surface,
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 9,
      pointHoverBorderWidth: 3,
      borderWidth: 2.5,
      borderDash: [7, 5],
      tension: 0.45,
      fill: true,
      spanGaps: true,
    },
  ];
}

export function durationTrendChartOptions(overrides = {}) {
  const p = readChartPalette();
  return baseChartOptions({
    animation: {
      duration: 1100,
      easing: "easeOutQuart",
    },
    elements: {
      line: { capBezierPoints: true },
      point: { hoverBorderColor: p.surface },
    },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: { usePointStyle: true, boxWidth: 8, padding: 16, font: { weight: "600" } },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} min`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: p.textMuted, maxRotation: 0, font: { size: 11, weight: "600" } },
      },
      y: {
        beginAtZero: true,
        grid: { color: colorWithAlpha(p.border, 0.65), drawBorder: false, lineWidth: 0.5 },
        ticks: { color: p.textMuted, font: { size: 11 }, padding: 8 },
        title: { display: true, text: "Minutes", color: p.textMuted, font: { size: 11, weight: "600" } },
      },
    },
    ...overrides,
  });
}

export function shortWeekdayLabels(fullLabels) {
  const map = {
    Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu",
    Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
  };
  return (fullLabels || []).map((d) => map[d] || d);
}

export function comparisonBarOptions(overrides = {}) {
  return baseChartOptions({
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: { usePointStyle: true, boxWidth: 8, padding: 16 },
      },
    },
    ...overrides,
  });
}

export function horizontalBarDataset(label, data, index = 0) {
  return { ...barDataset(label, data, index), borderRadius: 6 };
}

export function doughnutDataset(data, labels, colors) {
  const p = readChartPalette();
  const bg = colors || doughnutColors(data.length);
  return {
    labels,
    datasets: [
      {
        data,
        backgroundColor: bg,
        borderColor: p.surface,
        borderWidth: 3,
        hoverOffset: 12,
      },
    ],
  };
}

export function doughnutColors(count) {
  const colors = SERIES();
  return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
}

export function sentimentDoughnutColors() {
  const p = readChartPalette();
  const neutral = cssVar("--text-faint-solid", "#78838f");
  return [p.success, neutral, p.danger];
}

/** Line chart options for tone / frequency analysis panels */
export function toneLineChartOptions(yMax, extra = {}) {
  const p = readChartPalette();
  return baseChartOptions({
    plugins: {
      legend: { position: "top", labels: { color: p.text } },
      ...extra.plugins,
    },
    scales: {
      y: {
        min: 0,
        max: yMax,
        ticks: {
          color: p.textMuted,
          stepSize: Math.max(100, Math.ceil(yMax / 5 / 100) * 100),
        },
        grid: { color: p.border, drawBorder: false },
        title: { display: true, text: "Tone Energy", color: p.textMuted },
      },
      x: {
        ticks: { color: p.textMuted, maxRotation: 45 },
        grid: { color: p.border, lineWidth: 0.5 },
      },
    },
    ...extra,
  });
}

export function refreshChartTheme() {
  applyChartDefaults();
}
