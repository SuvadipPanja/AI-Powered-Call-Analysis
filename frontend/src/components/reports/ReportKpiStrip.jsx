import {
  LuPhone,
  LuSparkles,
  LuCircleCheck,
  LuPhoneIncoming,
  LuPhoneOutgoing,
  LuUsers,
} from "react-icons/lu";
import KpiStrip from "./KpiStrip";

const REPORT_KPI_CONFIG = [
  { key: "calls", label: "Total calls", icon: LuPhone, accent: "cyan", showDelta: true, deltaKey: "callsGrowth", formatValue: (s) => s.totalCalls ?? 0 },
  { key: "score", label: "Avg AI score", icon: LuSparkles, accent: "teal", showDelta: true, deltaKey: "scoreGrowth", deltaSuffix: " pts", formatValue: (s) => (s.avgScore != null && s.avgScore !== "" ? `${Math.round(Number(s.avgScore))}%` : "—") },
  { key: "resolution", label: "Resolution rate", icon: LuCircleCheck, accent: "emerald", showDelta: true, deltaKey: "resolutionGrowth", deltaSuffix: " pts", formatValue: (s) => (s.resolutionRate != null && s.resolutionRate !== "" ? `${Math.round(Number(s.resolutionRate))}%` : "—") },
  { key: "inbound", label: "Inbound", icon: LuPhoneIncoming, accent: "teal", formatValue: (s) => s.inbound ?? 0 },
  { key: "outbound", label: "Outbound", icon: LuPhoneOutgoing, accent: "amber", formatValue: (s) => s.outbound ?? 0 },
  { key: "agents", label: "Active agents", icon: LuUsers, accent: "rose", formatValue: (s) => s.activeAgents ?? 0 },
];

export default function ReportKpiStrip({ stats, comparison, formatDelta }) {
  return (
    <KpiStrip
      config={REPORT_KPI_CONFIG}
      stats={stats}
      comparison={comparison}
      formatDelta={formatDelta}
    />
  );
}
