import {
  LuPhoneCall,
  LuSparkles,
  LuClock,
  LuChartLine,
  LuCircleCheck,
} from "../../icons";
import KpiStrip from "./KpiStrip";

const AGENT_KPI_CONFIG = [
  {
    key: "callsToday",
    label: "Calls today",
    icon: LuPhoneCall,
    accent: "cyan",
    formatValue: (s) => s.callsToday ?? 0,
  },
  {
    key: "avgScoreToday",
    label: "Avg score today",
    icon: LuSparkles,
    accent: "teal",
    formatValue: (s) =>
      s.avgScoreToday != null ? `${Number(s.avgScoreToday).toFixed(1)}%` : "—",
  },
  {
    key: "lastDay",
    label: "Last active day",
    icon: LuClock,
    accent: "amber",
    formatValue: (s) => s.lastDaySummary ?? "—",
  },
  {
    key: "totalCalls",
    label: "Total calls",
    icon: LuChartLine,
    accent: "emerald",
    formatValue: (s) => s.totalCallsAllTime ?? 0,
  },
  {
    key: "csat",
    label: "C-SAT transfers",
    icon: LuCircleCheck,
    accent: "teal",
    formatValue: (s) => s.csatLabel ?? "—",
  },
];

export default function AgentKpiStrip({ stats }) {
  return (
    <KpiStrip
      config={AGENT_KPI_CONFIG}
      stats={stats}
      gridClassName="reports-kpi-grid--agent"
    />
  );
}
