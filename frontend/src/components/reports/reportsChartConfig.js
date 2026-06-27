/**
 * Premium report chart styling — gradients, motion, and readable defaults.
 * Volume + distribution combo charts share the same model as DashboardStatistics.
 */
import { Chart } from "chart.js";
import {
  baseChartOptions,
  doughnutChartOptions,
  durationTrendChartOptions,
  inboundOutboundAreaDatasets,
  readChartPalette,
  shortWeekdayLabels,
} from "../../theme/chartTheme";

export const CHART_COLORS = {
  inbound: "#10b981",
  inboundSoft: "rgba(16, 185, 129, 0.14)",
  outbound: "#0d9488",
  outboundSoft: "rgba(13, 148, 136, 0.12)",
  score: "#f59e0b",
  scoreSoft: "rgba(245, 158, 11, 0.08)",
  grid: "rgba(148, 163, 184, 0.16)",
};

const SQL_WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** Hover vertical guide — premium combo-chart flow */
export const comboCrosshairPlugin = {
  id: "comboCrosshair",
  afterDraw(chart) {
    const { ctx, chartArea, tooltip } = chart;
    if (!tooltip?.opacity || !tooltip?.dataPoints?.length) return;
    const x = tooltip.caretX;
    if (x < chartArea.left || x > chartArea.right) return;
    const p = readChartPalette();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top + 6);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colorWithAlpha(p.accent, 0.45);
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.restore();
  },
};

export const COMBO_CHART_PLUGINS = [comboCrosshairPlugin];

function softAreaGradient(color) {
  return (context) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) return colorWithAlpha(color, 0.12);
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, colorWithAlpha(color, 0.28));
    g.addColorStop(0.65, colorWithAlpha(color, 0.08));
    g.addColorStop(1, colorWithAlpha(color, 0));
    return g;
  };
}

/** Align AI score line X to bar centers — Chart.js draws the smooth curve (same as volume trends). */
export const distributionLineAlignPlugin = {
  id: "distributionLineAlign",
  afterLayout(chart) {
    const inboundMeta = chart.getDatasetMeta(0);
    const lineIndex = chart.data.datasets.findIndex((ds) => ds.label === "Avg AI score");
    if (lineIndex < 0 || !inboundMeta?.data?.length) return;
    const lineMeta = chart.getDatasetMeta(lineIndex);
    lineMeta.data.forEach((point, index) => {
      if (!point) return;
      const bar = inboundMeta.data[index];
      if (bar && !bar.skip) point.x = bar.x;
    });
  },
};

export const DISTRIBUTION_CHART_PLUGINS = [
  distributionLineAlignPlugin,
  comboCrosshairPlugin,
];

/** Snap total-volume spline to stacked bar centers */
export const unifiedVolumeLineAlignPlugin = {
  id: "unifiedVolumeLineAlign",
  afterLayout(chart) {
    const barMeta = chart.getDatasetMeta(0);
    const lineIndex = chart.data.datasets.findIndex((ds) => ds.label === "Total volume");
    if (lineIndex < 0 || !barMeta?.data?.length) return;
    const lineMeta = chart.getDatasetMeta(lineIndex);
    lineMeta.data.forEach((point, index) => {
      if (!point) return;
      const bar = barMeta.data[index];
      if (bar && !bar.skip) point.x = bar.x;
    });
  },
};

export const UNIFIED_VOLUME_PLUGINS = [
  unifiedVolumeLineAlignPlugin,
  comboCrosshairPlugin,
];

export const VIBRANT_SERIES = [
  "#22d3ee",
  "#0d9488",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#60a5fa",
  "#2dd4bf",
  "#f472b6",
];

function colorWithAlpha(color, alpha) {
  if (!color) return `rgba(34, 211, 238, ${alpha})`;
  if (color.startsWith("#")) {
    const h = color.slice(1);
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const nums = color.match(/\d+/g);
  if (nums?.length >= 3) return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
  return color;
}

function barGradient(context, from, to) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return from;
  const g = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

function verticalBarGradient(context, from, to) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return from;
  const g = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  g.addColorStop(0, colorWithAlpha(from, 0.35));
  g.addColorStop(0.55, from);
  g.addColorStop(1, to);
  return g;
}

export function modernDoughnutColors(count) {
  return Array.from({ length: count }, (_, i) => VIBRANT_SERIES[i % VIBRANT_SERIES.length]);
}

export function buildModernDoughnutData(labels, values) {
  const colors = modernDoughnutColors(values.length);
  const p = readChartPalette();
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderColor: p.surface,
        borderWidth: 4,
        hoverOffset: 16,
        spacing: 2,
        borderRadius: 6,
      },
    ],
  };
}

/**
 * Doughnut data with explicit per-slice colours (admin-defined or value-based).
 * Missing/blank colours fall back to the modern palette so it never breaks.
 */
export function buildColoredDoughnutData(labels, values, colors) {
  const fallback = modernDoughnutColors(values.length);
  const resolved = labels.map((_, i) => {
    const c = Array.isArray(colors) ? colors[i] : undefined;
    return c && String(c).trim() ? c : fallback[i % fallback.length];
  });
  const p = readChartPalette();
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: resolved,
        borderColor: p.surface,
        borderWidth: 4,
        hoverOffset: 16,
        spacing: 2,
        borderRadius: 6,
      },
    ],
  };
}

const SENTIMENT_BUCKETS = ["Positive", "Neutral", "Negative", "Unknown"];

function readNeutralToneColor() {
  if (typeof document !== "undefined") {
    const slate = getComputedStyle(document.documentElement)
      .getPropertyValue("--text-faint-solid")
      .trim();
    if (slate) return slate;
  }
  return "#78838f";
}

/** Semantic palette for Positive / Neutral / Negative tone segments (no purple). */
export function toneSegmentColorMap() {
  const p = readChartPalette();
  return {
    Positive: p.success,
    Neutral: readNeutralToneColor(),
    Negative: p.danger,
    Unknown: colorWithAlpha(p.border, 0.85),
  };
}

function buildToneSegmentDoughnut(labels, values) {
  const p = readChartPalette();
  const colorMap = toneSegmentColorMap();
  const colors = labels.map((label) => colorMap[label] || p.accent);

  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderColor: p.surface,
        borderWidth: 4,
        hoverOffset: 14,
        spacing: 3,
        borderRadius: 8,
      },
    ],
  };
}

/** AI Tone Analysis donut — dashboard `/api/tone-analysis-7days` labels + values. */
export function buildToneAnalysisChart(labels = [], values = []) {
  if (!labels.length || !values.length || values.every((v) => !Number(v))) return null;
  return buildToneSegmentDoughnut(labels, values);
}

/** Customer sentiment donut — green / gray / red buckets instead of raw JSON labels. */
export function buildSentimentSummaryChart(items = []) {
  const byLabel = new Map(
    (items || []).map((item) => [item.label, Number(item.count) || 0]),
  );

  const labels = [];
  const values = [];

  SENTIMENT_BUCKETS.forEach((label) => {
    const count = byLabel.get(label) || 0;
    if (count > 0) {
      labels.push(label);
      values.push(count);
    }
  });

  if (!values.length) return null;

  return buildToneSegmentDoughnut(labels, values);
}

export function modernDoughnutOptions(extra = {}) {
  const p = readChartPalette();
  return doughnutChartOptions({
    cutout: "72%",
    layout: { padding: 4 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colorWithAlpha(p.surface, 0.96),
        titleFont: { weight: "700", size: 13 },
        bodyFont: { size: 12 },
        padding: 14,
        cornerRadius: 12,
        callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
          },
        },
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 1200,
      easing: "easeOutQuart",
    },
    ...extra,
  });
}

/** Unique, readable X-axis labels for volume trends (fixes duplicate "Jun 2026"). */
export function formatVolumeTrendLabels(data, days) {
  const seen = new Map();
  return data.map((item, index) => {
    const rawDate = item?.date ? new Date(item.date) : null;
    const validDate = rawDate && !Number.isNaN(rawDate.getTime()) ? rawDate : null;

    let label;
    if (days <= 1) {
      label = item.dateLabel
        || validDate?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        || `Slot ${index + 1}`;
    } else if (days <= 7) {
      label = validDate
        ? validDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        : item.dateLabel || `Day ${index + 1}`;
    } else if (days <= 30) {
      label = item.dateLabel?.startsWith("Week")
        ? item.dateLabel
        : validDate
          ? `Wk of ${validDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : `Week ${index + 1}`;
    } else if (validDate) {
      label = validDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else {
      label = item.dateLabel || `Period ${index + 1}`;
    }

    const count = seen.get(label) || 0;
    seen.set(label, count + 1);
    if (count > 0 && validDate) {
      label = validDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
    }
    return label;
  });
}

export function formatDistributionLabels(labels) {
  return shortWeekdayLabels(labels).map((l) => {
    if (typeof l === "string" && l.length > 4 && !l.includes(" ")) {
      return l.slice(0, 3);
    }
    return l;
  });
}

function isWeekdayLabelSet(labels) {
  if (!labels?.length || labels.length > 7) return false;
  return labels.every((label) => SQL_WEEKDAYS.some(
    (day) => day === label
      || day.toLowerCase().startsWith(String(label).toLowerCase().slice(0, 3)),
  ));
}

/** Fill Sun–Sat so distribution bars flow evenly (matches dashboard week model). */
export function normalizeWeekdayDistribution(labels, inbound, outbound, avgScores) {
  if (!isWeekdayLabelSet(labels)) {
    return { labels, inbound, outbound, avgScores };
  }

  const byIndex = new Map();
  labels.forEach((label, i) => {
    const idx = SQL_WEEKDAYS.findIndex(
      (day) => day === label
        || day.toLowerCase().startsWith(String(label).toLowerCase().slice(0, 3)),
    );
    if (idx >= 0) {
      const total = (inbound[i] || 0) + (outbound[i] || 0);
      byIndex.set(idx, {
        inbound: inbound[i] || 0,
        outbound: outbound[i] || 0,
        avg: total > 0 ? (avgScores[i] ?? null) : null,
      });
    }
  });

  return {
    labels: SQL_WEEKDAYS,
    inbound: SQL_WEEKDAYS.map((_, idx) => byIndex.get(idx)?.inbound ?? 0),
    outbound: SQL_WEEKDAYS.map((_, idx) => byIndex.get(idx)?.outbound ?? 0),
    avgScores: SQL_WEEKDAYS.map((_, idx) => byIndex.get(idx)?.avg ?? null),
  };
}

function areaTrendLegend() {
  const p = readChartPalette();
  return {
    position: "top",
    align: "end",
    labels: {
      color: p.text,
      usePointStyle: true,
      pointStyle: "circle",
      boxWidth: 7,
      boxHeight: 7,
      padding: 18,
      font: { size: 11, weight: "600" },
      generateLabels(chart) {
        const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        return defaults.map((item) => {
          const ds = chart.data.datasets[item.datasetIndex];
          if (ds?.borderDash?.length) {
            return { ...item, lineDash: ds.borderDash, lineWidth: 2.5 };
          }
          return item;
        });
      },
    },
  };
}

function comboLegend() {
  const p = readChartPalette();
  return {
    position: "top",
    align: "end",
    labels: {
      color: p.text,
      usePointStyle: true,
      pointStyle: "circle",
      boxWidth: 7,
      boxHeight: 7,
      padding: 18,
      font: { size: 11, weight: "600" },
      generateLabels(chart) {
        const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        return defaults.map((item) => {
          const ds = chart.data.datasets[item.datasetIndex];
          if (ds?.borderDash?.length) {
            return { ...item, lineDash: ds.borderDash, lineWidth: 2.5 };
          }
          if (ds?.label === "Avg AI score") {
            return {
              ...item,
              pointStyle: "circle",
              fillStyle: p.surface,
              strokeStyle: CHART_COLORS.score,
              lineWidth: 2,
            };
          }
          return item;
        });
      },
    },
  };
}

function polishedTooltip(p) {
  return {
    enabled: true,
    mode: "index",
    intersect: false,
    backgroundColor: colorWithAlpha(p.surface, 0.97),
    titleColor: p.text,
    bodyColor: p.textMuted,
    borderColor: colorWithAlpha(p.border, 0.8),
    borderWidth: 1,
    padding: 14,
    cornerRadius: 12,
    titleFont: { size: 12, weight: "700" },
    bodyFont: { size: 11, weight: "600" },
    boxPadding: 6,
    usePointStyle: true,
  };
}

export function buildVolumeTrendChart(labels, inbound, outbound) {
  const maxCalls = Math.max(...inbound, ...outbound, 1);
  const areaDatasets = inboundOutboundAreaDatasets(inbound, outbound).map((ds) => ({
    ...ds,
    pointRadius: 0,
    pointHoverRadius: 9,
    pointHitRadius: 14,
  }));

  return {
    labels,
    datasets: areaDatasets,
    _meta: { maxCalls },
  };
}

/** Single hero chart — stacked pulse bars + flowing total-volume ribbon */
export function buildUnifiedCallVolumeChart(labels, inbound, outbound) {
  const p = readChartPalette();
  const total = inbound.map((v, i) => (v || 0) + (outbound[i] || 0));
  const maxStack = Math.max(...total, 1);
  const peakValue = Math.max(...total);
  const peakIdx = total.indexOf(peakValue);

  return {
    labels,
    datasets: [
      {
        label: "Inbound",
        data: inbound,
        type: "bar",
        backgroundColor: (ctx) => verticalBarGradient(ctx, p.success, "#34d399"),
        hoverBackgroundColor: p.success,
        borderSkipped: false,
        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 12, bottomRight: 12 },
        maxBarThickness: 56,
        stack: "volume",
        order: 2,
      },
      {
        label: "Outbound",
        data: outbound,
        type: "bar",
        backgroundColor: (ctx) => verticalBarGradient(ctx, p.accent, "#22d3ee"),
        hoverBackgroundColor: p.accent,
        borderSkipped: false,
        borderRadius: { topLeft: 12, topRight: 12, bottomLeft: 0, bottomRight: 0 },
        maxBarThickness: 56,
        stack: "volume",
        order: 3,
      },
      {
        label: "Total volume",
        data: total,
        type: "line",
        borderColor: "#fbbf24",
        backgroundColor: softAreaGradient("#fbbf24"),
        pointBackgroundColor: p.surface,
        pointBorderColor: "#fbbf24",
        pointBorderWidth: 3,
        pointRadius: (ctx) => (ctx.dataIndex === peakIdx ? 8 : 0),
        pointHoverRadius: 10,
        pointHitRadius: 16,
        borderWidth: 3,
        tension: 0.42,
        fill: true,
        order: 1,
        spanGaps: true,
      },
    ],
    _meta: { maxStack, peakIdx, peakValue },
  };
}

export function unifiedCallVolumeOptions(chartData) {
  const p = readChartPalette();
  const maxStack = chartData?._meta?.maxStack || 4;
  const peakValue = chartData?._meta?.peakValue;

  return durationTrendChartOptions({
    layout: { padding: { top: 18, right: 12, bottom: 6, left: 8 } },
    animation: {
      duration: 1200,
      easing: "easeOutQuart",
      delay: (ctx) => (ctx.type === "data" ? ctx.dataIndex * 55 + ctx.datasetIndex * 70 : 0),
    },
    interaction: { mode: "index", intersect: false },
    elements: {
      bar: { borderRadius: 12 },
      line: { capBezierPoints: true },
      point: { hoverBorderWidth: 3 },
    },
    plugins: {
      legend: unifiedVolumeLegend(),
      tooltip: {
        ...polishedTooltip(p),
        callbacks: {
          title: (items) => items[0]?.label || "",
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (v == null || Number.isNaN(v)) return null;
            return ` ${ctx.dataset.label}: ${v} call${v === 1 ? "" : "s"}`;
          },
          footer: (items) => {
            const inb = items.find((i) => i.dataset.label === "Inbound")?.parsed?.y || 0;
            const out = items.find((i) => i.dataset.label === "Outbound")?.parsed?.y || 0;
            const sum = inb + out;
            if (!sum) return "";
            const peakNote = peakValue && sum === peakValue ? "  ★ Peak period" : "";
            return ` Total: ${sum} calls${peakNote}`;
          },
          labelColor: (ctx) => {
            const color = ctx.dataset.borderColor
              || ctx.dataset.backgroundColor
              || CHART_COLORS.inbound;
            const resolved = typeof color === "function" ? CHART_COLORS.inbound : color;
            return {
              borderColor: resolved,
              backgroundColor: resolved,
              borderWidth: 2,
              borderRadius: 4,
            };
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        offset: true,
        grid: { display: false, drawBorder: false },
        ticks: {
          color: p.textMuted,
          font: { size: 11, weight: "700" },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
          padding: 10,
        },
        border: { display: false },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        suggestedMax: maxStack + Math.max(2, Math.ceil(maxStack * 0.18)),
        grid: {
          color: CHART_COLORS.grid,
          drawBorder: false,
          lineWidth: 1,
          tickLength: 0,
        },
        ticks: {
          color: p.textMuted,
          precision: 0,
          padding: 10,
          font: { size: 10 },
        },
        border: { display: false },
        title: {
          display: true,
          text: "Calls",
          color: p.textMuted,
          font: { size: 10, weight: "700" },
          padding: { bottom: 8 },
        },
      },
    },
  });
}

function unifiedVolumeLegend() {
  const p = readChartPalette();
  return {
    position: "top",
    align: "end",
    labels: {
      color: p.text,
      usePointStyle: true,
      pointStyle: "circle",
      boxWidth: 8,
      boxHeight: 8,
      padding: 20,
      font: { size: 11, weight: "700" },
      generateLabels(chart) {
        const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
        return defaults.map((item) => {
          const ds = chart.data.datasets[item.datasetIndex];
          if (ds?.label === "Total volume") {
            return {
              ...item,
              pointStyle: "circle",
              fillStyle: p.surface,
              strokeStyle: "#fbbf24",
              lineWidth: 3,
            };
          }
          return item;
        });
      },
    },
  };
}

export function modernVolumeTrendOptions(chartData) {
  const p = readChartPalette();
  const maxCalls = chartData?._meta?.maxCalls
    || Math.max(...(chartData?.datasets?.[0]?.data || [0]), ...(chartData?.datasets?.[1]?.data || [0]), 4);

  return durationTrendChartOptions({
    layout: { padding: { top: 12, right: 8, bottom: 4, left: 6 } },
    animation: {
      duration: 1100,
      easing: "easeOutQuart",
      delay: (ctx) => (ctx.type === "data" ? ctx.dataIndex * 40 + ctx.datasetIndex * 80 : 0),
    },
    elements: {
      line: { capBezierPoints: true },
      point: { hoverBorderWidth: 3 },
    },
    plugins: {
      legend: areaTrendLegend(),
      tooltip: {
        ...polishedTooltip(p),
        callbacks: {
          title: (items) => items[0]?.label || "",
          label: (ctx) => {
            const v = ctx.parsed.y;
            return ` ${ctx.dataset.label}: ${v} call${v === 1 ? "" : "s"}`;
          },
          labelColor: (ctx) => {
            const color = ctx.dataset.borderColor || CHART_COLORS.inbound;
            return {
              borderColor: color,
              backgroundColor: color,
              borderWidth: 2,
              borderRadius: 4,
            };
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false, drawBorder: false },
        ticks: {
          color: p.textMuted,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { size: 10, weight: "600" },
          padding: 8,
        },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        suggestedMax: maxCalls + Math.max(2, Math.ceil(maxCalls * 0.2)),
        grid: {
          color: CHART_COLORS.grid,
          drawBorder: false,
          lineWidth: 1,
          tickLength: 0,
        },
        ticks: {
          color: p.textMuted,
          padding: 10,
          precision: 0,
          font: { size: 10 },
        },
        border: { display: false },
        title: {
          display: true,
          text: "Calls",
          color: p.textMuted,
          font: { size: 10, weight: "700" },
          padding: { bottom: 6 },
        },
      },
    },
  });
}

export function buildModernDistributionChart(labels, inbound, outbound, avgScores) {
  const p = readChartPalette();
  const isFullWeek = isWeekdayLabelSet(labels) && labels.length === 7;
  const normalized = isFullWeek
    ? normalizeWeekdayDistribution(labels, inbound, outbound, avgScores)
    : { labels, inbound, outbound, avgScores };

  const displayLabels = formatDistributionLabels(normalized.labels);
  const maxStack = Math.max(
    ...normalized.inbound.map((v, i) => (v || 0) + (normalized.outbound[i] || 0)),
    1,
  );

  return {
    labels: displayLabels,
    datasets: [
      {
        label: "Inbound",
        data: normalized.inbound,
        backgroundColor: (ctx) => verticalBarGradient(ctx, p.success, "#34d399"),
        hoverBackgroundColor: p.success,
        borderSkipped: false,
        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 8, bottomRight: 8 },
        maxBarThickness: 40,
        stack: "calls",
        order: 2,
      },
      {
        label: "Outbound",
        data: normalized.outbound,
        backgroundColor: (ctx) => verticalBarGradient(ctx, p.accent, "#22d3ee"),
        hoverBackgroundColor: p.accent,
        borderSkipped: false,
        borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
        maxBarThickness: 40,
        stack: "calls",
        order: 3,
      },
      {
        label: "Avg AI score",
        data: normalized.avgScores,
        type: "line",
        borderColor: CHART_COLORS.score,
        backgroundColor: softAreaGradient(CHART_COLORS.score),
        pointBackgroundColor: p.surface,
        pointBorderColor: CHART_COLORS.score,
        pointBorderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 8,
        pointHitRadius: 14,
        borderWidth: 2.25,
        tension: 0.45,
        fill: true,
        yAxisID: "y1",
        order: 1,
        spanGaps: true,
      },
    ],
    _meta: { maxStack },
  };
}

export function modernDistributionOptions(chartData) {
  const p = readChartPalette();
  const maxStack = chartData?._meta?.maxStack || 4;

  return durationTrendChartOptions({
    layout: { padding: { top: 12, right: 8, bottom: 4, left: 6 } },
    animation: {
      duration: 1100,
      easing: "easeOutQuart",
      delay: (ctx) => (ctx.type === "data" ? ctx.dataIndex * 40 + ctx.datasetIndex * 60 : 0),
    },
    interaction: { mode: "index", intersect: false },
    elements: {
      line: { capBezierPoints: true },
      point: { hoverBorderWidth: 3 },
    },
    plugins: {
      legend: comboLegend(),
      tooltip: {
        ...polishedTooltip(p),
        callbacks: {
          title: (items) => items[0]?.label || "",
          label: (ctx) => {
            if (ctx.dataset.label === "Avg AI score") {
              const v = ctx.parsed.y;
              if (v == null || Number.isNaN(v)) return null;
              return ` ${ctx.dataset.label}: ${Math.round(v * 10) / 10}%`;
            }
            return ` ${ctx.dataset.label}: ${ctx.parsed.y} call${ctx.parsed.y === 1 ? "" : "s"}`;
          },
          footer: (items) => {
            const inb = items.find((i) => i.dataset.label === "Inbound")?.parsed?.y || 0;
            const out = items.find((i) => i.dataset.label === "Outbound")?.parsed?.y || 0;
            const total = inb + out;
            return total > 0 ? ` Total: ${total} calls` : "";
          },
          labelColor: (ctx) => {
            const color = ctx.dataset.borderColor || CHART_COLORS.inbound;
            return {
              borderColor: color,
              backgroundColor: color,
              borderWidth: 2,
              borderRadius: 4,
            };
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        offset: true,
        grid: { display: false, drawBorder: false },
        ticks: {
          color: p.textMuted,
          font: { size: 10, weight: "600" },
          maxRotation: 0,
          autoSkip: false,
        },
        border: { display: false },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        suggestedMax: maxStack + Math.max(2, Math.ceil(maxStack * 0.15)),
        grid: { color: colorWithAlpha(p.border, 0.5), drawBorder: false },
        ticks: { color: p.textMuted, precision: 0 },
        border: { display: false },
        title: {
          display: true,
          text: "Calls",
          color: p.textMuted,
          font: { size: 10, weight: "700" },
        },
      },
      y1: {
        position: "right",
        beginAtZero: true,
        max: 100,
        grid: { drawOnChartArea: false },
        ticks: {
          color: CHART_COLORS.score,
          callback: (v) => `${v}%`,
          font: { size: 10 },
          padding: 8,
        },
        border: { display: false },
        title: {
          display: true,
          text: "AI score",
          color: CHART_COLORS.score,
          font: { size: 10, weight: "700" },
        },
      },
    },
  });
}

export function buildPeakTimeChart(labels, values) {
  return {
    labels,
    datasets: [
      {
        label: "Calls",
        data: values,
        backgroundColor: (ctx) => barGradient(ctx, "#0d9488", "#22d3ee"),
        borderSkipped: false,
        borderRadius: 12,
        maxBarThickness: 36,
      },
    ],
  };
}

export function modernPeakTimeOptions() {
  const p = readChartPalette();
  return baseChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.parsed.y} calls`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: p.textMuted, maxRotation: 45, font: { size: 9, weight: "600" } },
      },
      y: {
        beginAtZero: true,
        grid: { color: colorWithAlpha(p.border, 0.45), drawBorder: false },
        ticks: { color: p.textMuted, precision: 0 },
      },
    },
  });
}

export function buildAgentRankingChart(agents, scores) {
  return {
    labels: agents,
    datasets: [
      {
        label: "Overall AI score",
        data: scores,
        backgroundColor: (ctx) => barGradient(ctx, "#34d399", "#22d3ee"),
        borderSkipped: false,
        borderRadius: 8,
        barThickness: 14,
      },
    ],
  };
}

export function modernAgentRankingOptions() {
  const p = readChartPalette();
  return baseChartOptions({
    indexAxis: "y",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.parsed.x}% overall`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        grid: { color: colorWithAlpha(p.border, 0.45), drawBorder: false },
        ticks: { color: p.textMuted, callback: (v) => `${v}%` },
      },
      y: {
        grid: { display: false },
        ticks: { color: p.text, font: { size: 11, weight: "700" } },
      },
    },
  });
}

export function buildModernRadarChart(labels, aiValues, manualValues) {
  const p = readChartPalette();
  return {
    labels,
    datasets: [
      {
        label: "AI scoring",
        data: aiValues,
        backgroundColor: colorWithAlpha("#22d3ee", 0.22),
        borderColor: "#22d3ee",
        borderWidth: 2.5,
        pointBackgroundColor: "#22d3ee",
        pointBorderColor: p.surface,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
      },
      {
        label: "Manual scoring",
        data: manualValues,
        backgroundColor: colorWithAlpha("#34d399", 0.18),
        borderColor: "#34d399",
        borderWidth: 2.5,
        pointBackgroundColor: "#34d399",
        pointBorderColor: p.surface,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
      },
    ],
  };
}

export function modernRadarOptions() {
  const p = readChartPalette();
  return baseChartOptions({
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        angleLines: { color: colorWithAlpha(p.border, 0.65) },
        grid: { color: colorWithAlpha(p.border, 0.45) },
        ticks: {
          stepSize: 25,
          color: p.textMuted,
          backdropColor: "transparent",
          font: { size: 9 },
        },
        pointLabels: {
          color: p.text,
          font: { size: 10, weight: "700" },
        },
      },
    },
    plugins: {
      legend: {
        position: "top",
        align: "end",
        labels: { usePointStyle: true, boxWidth: 8, padding: 16 },
      },
    },
    animation: { duration: 1300, easing: "easeOutQuart" },
  });
}

export function sumChartValues(chartData) {
  const data = chartData?.datasets?.[0]?.data;
  if (!data?.length) return 0;
  return data.reduce((a, b) => a + (Number(b) || 0), 0);
}
