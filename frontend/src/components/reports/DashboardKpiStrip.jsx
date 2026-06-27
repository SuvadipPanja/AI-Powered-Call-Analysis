import {
  LuActivity,
  LuCircleCheck,
  LuCircleX,
  LuSparkles,
  LuClipboardCheck,
  LuClock,
  LuPercent,
} from "react-icons/lu";
import KpiStrip from "./KpiStrip";

const DASHBOARD_KPI_CONFIG = [
  {
    key: "totalCalls",
    label: "Total calls",
    icon: LuActivity,
    accent: "cyan",
    showDelta: true,
    deltaKey: "totalCallsGrowth",
    formatValue: (s) => s.totalCalls ?? 0,
  },
  {
    key: "successCount",
    label: "Success",
    icon: LuCircleCheck,
    accent: "emerald",
    showDelta: true,
    deltaKey: "successGrowth",
    formatValue: (s) => s.successCount ?? 0,
  },
  {
    key: "failedCount",
    label: "Failed",
    icon: LuCircleX,
    accent: "rose",
    showDelta: true,
    deltaKey: "failedGrowth",
    invertDelta: true,
    formatValue: (s) => s.failedCount ?? 0,
  },
  {
    key: "avgAiScore",
    label: "Avg AI score",
    icon: LuSparkles,
    accent: "teal",
    showDelta: true,
    deltaKey: "avgAiGrowth",
    deltaSuffix: " pts",
    formatValue: (s) => (s.avgAiScore != null ? `${Number(s.avgAiScore).toFixed(1)}%` : "—"),
  },
  {
    key: "avgManualScore",
    label: "Manual score",
    icon: LuClipboardCheck,
    accent: "teal",
    showDelta: true,
    deltaKey: "avgManualGrowth",
    deltaSuffix: " pts",
    formatValue: (s) => (s.avgManualScore != null ? `${Number(s.avgManualScore).toFixed(1)}%` : "—"),
  },
  {
    key: "aht",
    label: "AHT (mins)",
    icon: LuClock,
    accent: "amber",
    showDelta: true,
    deltaKey: "ahtGrowth",
    formatValue: (s) => (s.aht != null ? Number(s.aht).toFixed(2) : "—"),
  },
  {
    key: "successRate",
    label: "Success rate",
    icon: LuPercent,
    accent: "emerald",
    formatValue: (s) => (s.successRate != null ? `${s.successRate}%` : "—"),
  },
];

export default function DashboardKpiStrip({ stats, comparison, formatDelta }) {
  return (
    <KpiStrip
      config={DASHBOARD_KPI_CONFIG}
      stats={stats}
      comparison={comparison}
      formatDelta={formatDelta}
      gridClassName="reports-kpi-grid--dashboard"
    />
  );
}
