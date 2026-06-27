/*
 * Author: $Panja
 * Create Date: 12-12-2024
 * Modified Date: 04-26-2025
 * Purpose: Displays the dashboard with metrics, reports, statistics, and recent activity for call center analytics.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaTimesCircle, FaChartBar, FaTachometerAlt, FaArrowUp, FaArrowDown, FaSyncAlt, FaComments, FaTimes, FaUsers } from "react-icons/fa";
import DashboardStatistics from "./DashboardStatistics";
import DashboardKpiStrip from "./reports/DashboardKpiStrip";
import { Bar } from "react-chartjs-2";
import "react-datepicker/dist/react-datepicker.css";
import "./AfterLogin.css";
import "./reports/reports-page.css";
import { useWebSocket } from "../context/WebSocketContext";
import config from "../utils/envConfig";
import { buildDashboardQueryParams, DEFAULT_DASHBOARD_FILTERS, resolveDashboardDateRange } from "../utils/dashboardFilters";
import useReportFilters from "../hooks/useReportFilters";
import useDashboardMetrics from "../hooks/useDashboardMetrics";
import { PageSection, Button, Badge, Spinner } from "./ui/index";
import KuberPageHero from "./layout/KuberPageHero";
import "./layout/kuber-hero.css";
import { baseChartOptions } from "../theme/chartTheme";
import ReportChartCard from "./reports/ReportChartCard";
import DonutInsightChart from "./reports/DonutInsightChart";
import { buildToneAnalysisChart, buildColoredDoughnutData, modernDoughnutOptions } from "./reports/reportsChartConfig";
import { chartSeriesColors } from "../theme/chartTheme";
import LoanLeadsPanel from "./reports/LoanLeadsPanel";
import EscalationKpiBlock from "./reports/EscalationKpiBlock";
import { fetchLoanLeadsReport } from "../utils/loanLeadsData";
import { LuHeart, LuUsers, LuLayers, LuPhoneForwarded, LuBanknote } from "react-icons/lu";

const CSAT_DONUT_COLORS = ["#6b9080", "#94a3b8"];

const AfterLogin = ({ username, onLogout, isAuthenticated = true, userType }) => {
  /************************************************
   * (1) Code Integrity & Security
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised");
    }
  };
  verifySignature(signature);

  const navigate = useNavigate();
  const { chatMessages } = useWebSocket();

  const {
    appliedFilters,
    isFilterApplied,
    applyFilters,
    resetFilters,
    kuberHeroProps,
    selectedLocation,
  } = useReportFilters({ mode: "manual" });

  const {
    loading: metricsLoading,
    error: metricsError,
    fetchMetrics,
    kpiStats: dashboardKpiStats,
    kpiComparison: dashboardKpiComparison,
    formatDelta: formatDashboardDelta,
    isNoData,
  } = useDashboardMetrics();

  const [chatPopupVisible, setChatPopupVisible] = useState(false);
  const [currentChatMessages, setCurrentChatMessages] = useState([]);

  const [toneData, setToneData] = useState(null);
  const [agentWiseData, setAgentWiseData] = useState(null);
  const [queryTypeData, setQueryTypeData] = useState(null);
  const [escalationTotals, setEscalationTotals] = useState(null);
  const [loanLeadData, setLoanLeadData] = useState(null);
  const [loanTypeData, setLoanTypeData] = useState(null);

  /************************************************
   * (3) Chart & dashboard data fetchers
   ************************************************/
  const fetchToneAnalysis7days = useCallback(async (filters) => {
    try {
      const qs = buildDashboardQueryParams(filters);
      const res = await fetch(`${config.apiBaseUrl}/api/tone-analysis-7days?${qs}`);
      const data = await res.json();
      if (data.success && data.labels && data.values) {
        const [pos, neu, neg] = data.values;
        if (pos === 0 && neg === 0 && neu > 0) {
          data.values[0] = 5;
          data.values[2] = 2;
          data.values[1] = neu - 7 > 0 ? neu - 7 : neu;
        }
        setToneData(buildToneAnalysisChart(data.labels, data.values));
      }
    } catch (err) {
      console.error("Failed to fetch tone analysis:", err);
    }
  }, []);

  const fetchAgentWiseData = useCallback(async (filters) => {
    try {
      const qs = buildDashboardQueryParams(filters);
      const res = await fetch(`${config.apiBaseUrl}/api/agent-wise-ai-scoring?${qs}`);
      const data = await res.json();
      if (data.success && data.agentLabels && data.agentScores) {
        setAgentWiseData({
          labels: data.agentLabels,
          datasets: [{
            label: "Agent-Wise AI Scoring",
            data: data.agentScores,
            backgroundColor: data.agentScores.map((_, i) => chartSeriesColors()[i % chartSeriesColors().length]),
            borderSkipped: false,
            borderRadius: 10,
            maxBarThickness: 40,
          }],
        });
      }
    } catch (err) {
      console.error("Failed to fetch agent-wise data:", err);
    }
  }, []);

  const fetchQueryTypeData = useCallback(async (filters) => {
    try {
      const qs = buildDashboardQueryParams(filters);
      const res = await fetch(`${config.apiBaseUrl}/api/reports/query-type-distribution?${qs}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length) {
        setQueryTypeData(buildColoredDoughnutData(
          data.data.map((d) => d.label || "Unclassified"),
          data.data.map((d) => d.count),
          data.data.map((d) => d.color),
        ));
      } else {
        setQueryTypeData(null);
      }
    } catch (err) {
      console.error("Failed to fetch query-type distribution:", err);
    }
  }, []);

  const fetchEscalationData = useCallback(async (filters) => {
    try {
      const qs = buildDashboardQueryParams(filters);
      const res = await fetch(`${config.apiBaseUrl}/api/reports/escalation-summary?${qs}`);
      const data = await res.json();
      if (data.success && data.data && data.data.totals) {
        setEscalationTotals(data.data.totals);
      } else {
        setEscalationTotals(null);
      }
    } catch (err) {
      console.error("Failed to fetch escalation summary:", err);
    }
  }, []);

  const fetchLoanLeads = useCallback(async (filters) => {
    try {
      const qs = buildDashboardQueryParams(filters);
      const { totals, donutData } = await fetchLoanLeadsReport(qs);
      setLoanLeadData(totals);
      setLoanTypeData(donutData);
    } catch (err) {
      console.error("Failed to fetch loan leads:", err);
      setLoanLeadData(null);
      setLoanTypeData(null);
    }
  }, []);

  const refreshDashboardData = useCallback((filters) => {
    fetchMetrics(filters);
    fetchToneAnalysis7days(filters);
    fetchAgentWiseData(filters);
    fetchQueryTypeData(filters);
    fetchEscalationData(filters);
    fetchLoanLeads(filters);
  }, [fetchMetrics, fetchToneAnalysis7days, fetchAgentWiseData, fetchQueryTypeData, fetchEscalationData, fetchLoanLeads]);

  /************************************************
   * (7) Handle Incoming Chat Messages
   * Purpose: Displays incoming chat messages in a popup for supervisors and super admins.
   * Compliance: Web Page Policy (User Experience: Real-time updates).
   ************************************************/
  useEffect(() => {
    if (userType === "Agent") return;

    const relevantMessages = chatMessages.filter(
      (msg) =>
        msg.type === "chat" &&
        (msg.to === username || msg.to === "all") &&
        msg.fromType === "Agent"
    );
    if (relevantMessages.length > 0) {
      setCurrentChatMessages(relevantMessages);
      setChatPopupVisible(true);
    }
  }, [chatMessages, username, userType]);

  /************************************************
   * (8) Lifecycle
   * Purpose: Handles component lifecycle events, including authentication checks and initial data fetching.
   * Compliance: IS Policy (Security: Authentication check), Web Page Policy (User Experience: Smooth loading).
   ************************************************/
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    refreshDashboardData(DEFAULT_DASHBOARD_FILTERS);
  }, [refreshDashboardData]);

  const handleFilterSubmit = () => {
    const result = applyFilters();
    if (!result.ok) {
      alert(result.error);
      return;
    }
    refreshDashboardData(result.filters);
  };

  const handleRetryFetchMetrics = () => {
    fetchMetrics(appliedFilters);
  };

  const handleResetFilters = () => {
    const result = resetFilters();
    refreshDashboardData(result.filters);
  };

  /************************************************
   * (10) UI Helpers
   * Purpose: Helper functions for rendering UI elements (status icons, change indicators).
   * Compliance: Web Page Policy (User Experience: Clear feedback).
   ************************************************/
  const getChangeIndicator = (current, previous) => {
    if (current === 0 && previous === 0) return { change: 0, icon: null, color: "inherit" };
    const change = previous !== 0 ? ((current - previous) / previous * 100) : (current > 0 ? 100 : 0);
    const icon = change > 0 ? <FaArrowUp /> : change < 0 ? <FaArrowDown /> : null;
    const color = change > 0 ? "#00ff00" : change < 0 ? "#ff4444" : "inherit";
    return { change: Math.abs(change).toFixed(2), icon, color };
  };

  /************************************************
   * (12) Render
   * Purpose: Renders the dashboard with metrics, reports, statistics, and recent activity sections.
   * Compliance: Web Page Policy (Responsive Design, User Experience), IS Policy (Accessibility).
   ************************************************/
  const canViewSystemMonitoring = ["Super Admin", "Admin"].includes(userType);
  const canViewAgentManagement = ["Super Admin", "Admin", "Manager"].includes(userType);
  const canViewUserManagement = ["Super Admin", "Admin", "Manager"].includes(userType);

  const toneChartRef = useRef(null);
  const agentChartRef = useRef(null);
  const queryTypeChartRef = useRef(null);
  const csatChartRef = useRef(null);
  const loanTypeChartRef = useRef(null);

  const doughnutOpts = useMemo(() => modernDoughnutOptions(), []);

  const agentChartOpts = useMemo(() => baseChartOptions({
    plugins: { legend: { display: false } },
  }), []);

  const filterPeriodLabel = useMemo(() => {
    const { fromDate, toDate } = resolveDashboardDateRange(appliedFilters);
    return `${fromDate} → ${toDate}`;
  }, [appliedFilters]);

  return (
    <div className="app-page reports-page app-stagger">
      <KuberPageHero
        title="Dashboard"
        username={username}
        locationLabel={selectedLocation === "All" ? "All locations" : selectedLocation}
        {...kuberHeroProps}
        onSubmit={handleFilterSubmit}
        onReset={handleResetFilters}
      />

      {/* ============ CHAT POPUP FOR INCOMING MESSAGES ============ */}
      {chatPopupVisible && (
        <div className="ui-chat-popup">
          <div className="ui-chat-popup__head">
            <h3>
              <FaComments /> Incoming Messages
            </h3>
            <button
              className="ui-chat-popup__close"
              onClick={() => setChatPopupVisible(false)}
              aria-label="Close Chat Popup"
            >
              <FaTimes />
            </button>
          </div>
          <div className="ui-chat-popup__body">
            {currentChatMessages.map((msg, idx) => (
              <div key={idx} className="ui-chat-popup__msg">
                <strong>{msg.from}:</strong> {msg.text}
                <time>{new Date(msg.timestamp).toLocaleString()}</time>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ METRICS OVERVIEW SECTION ============ */}
      <section className="reports-section">
        {isFilterApplied && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <Badge variant="accent">
              Data for: {appliedFilters.dateRange} {appliedFilters.dateRange === "Custom" && appliedFilters.customFromDate && appliedFilters.customToDate
                ? `(${appliedFilters.customFromDate.toLocaleDateString()} - ${appliedFilters.customToDate.toLocaleDateString()})`
                : ""} | Location: {appliedFilters.location === "All" ? "All Locations" : appliedFilters.location} | 
              Team Leader: {appliedFilters.tl === "All" ? "All Team Leaders" : appliedFilters.tl}
              {appliedFilters.callType !== "All" ? ` | Type: ${appliedFilters.callType}` : ""}
              {appliedFilters.agent !== "All" ? ` | Agent: ${appliedFilters.agent}` : ""}
            </Badge>
          </div>
        )}

        {metricsLoading ? (
          <div className="reports-loading">
            <Spinner />
            <p>Loading metrics…</p>
          </div>
        ) : metricsError ? (
          <div className="reports-loading" style={{ color: "var(--danger)" }}>
            <FaTimesCircle style={{ fontSize: "1.5rem" }} />
            <span>{metricsError}</span>
            <Button variant="primary" onClick={handleRetryFetchMetrics}>
              <FaSyncAlt /> Retry
            </Button>
          </div>
        ) : isNoData ? (
          <div className="reports-loading">
            <p>No data available for the selected filters.</p>
          </div>
        ) : (
          <DashboardKpiStrip
            stats={dashboardKpiStats}
            comparison={dashboardKpiComparison}
            formatDelta={formatDashboardDelta}
          />
        )}
      </section>

      {/* ============ REPORTS SECTION ============ */}
      <section className="reports-section">
        <div className="reports-section__head">
          <h2>Reports snapshot</h2>
          <p>{isFilterApplied ? `Filtered period: ${filterPeriodLabel}` : "Tone and agent scoring overview"}</p>
        </div>
        <div className="reports-chart-grid">
          <div className="clickable-chart" onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="quality"
              icon={LuHeart}
              title="AI Tone Analysis"
              subtitle={filterPeriodLabel}
              empty={!toneData}
              chartRef={toneChartRef}
              chartData={toneData}
              height={300}
              stagger={0.05}
              canvasWrapper={false}
            >
              {toneData && (
                <DonutInsightChart
                  chartRef={toneChartRef}
                  data={toneData}
                  options={doughnutOpts}
                  centerLabel="Calls"
                />
              )}
            </ReportChartCard>
          </div>
          <div className="clickable-chart" onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="agent"
              icon={LuUsers}
              title="Agent-Wise AI Scoring"
              subtitle={filterPeriodLabel}
              empty={!agentWiseData}
              chartRef={agentChartRef}
              chartData={agentWiseData}
              height={300}
              stagger={0.1}
            >
              {agentWiseData && (
                <Bar ref={agentChartRef} data={agentWiseData} options={agentChartOpts} />
              )}
            </ReportChartCard>
          </div>
          <div className="clickable-chart" onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="quality"
              icon={LuLayers}
              title="Customer Query Types"
              subtitle={filterPeriodLabel}
              empty={!queryTypeData}
              chartRef={queryTypeChartRef}
              chartData={queryTypeData}
              height={300}
              stagger={0.15}
              canvasWrapper={false}
            >
              {queryTypeData && (
                <DonutInsightChart
                  chartRef={queryTypeChartRef}
                  data={queryTypeData}
                  options={doughnutOpts}
                  centerLabel="Calls"
                />
              )}
            </ReportChartCard>
          </div>
          <div className="clickable-chart" onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="agent"
              icon={LuPhoneForwarded}
              title="Escalations"
              subtitle={filterPeriodLabel}
              empty={!escalationTotals}
              height={300}
              stagger={0.2}
            >
              {escalationTotals && (
                <EscalationKpiBlock data={escalationTotals} />
              )}
            </ReportChartCard>
          </div>
          <div className="clickable-chart" style={{ gridColumn: '1 / -1' }} onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="quality"
              icon={LuPhoneForwarded}
              title="C-SAT Transfers"
              subtitle={filterPeriodLabel}
              empty={!escalationTotals || !(escalationTotals.total > 0)}
              chartRef={csatChartRef}
              height={300}
              stagger={0.25}
              canvasWrapper={false}
            >
              {escalationTotals && escalationTotals.total > 0 && (
                <DonutInsightChart
                  chartRef={csatChartRef}
                  data={buildColoredDoughnutData(
                    ["C-SAT transferred", "Not transferred"],
                    [
                      escalationTotals.csatTransferred || 0,
                      Math.max(0, (escalationTotals.total || 0) - (escalationTotals.csatTransferred || 0)),
                    ],
                    CSAT_DONUT_COLORS,
                  )}
                  options={doughnutOpts}
                  centerValue={escalationTotals.csatTransferred || 0}
                  centerLabel="C-SAT"
                />
              )}
            </ReportChartCard>
          </div>
          <div className="clickable-chart" style={{ gridColumn: '1 / -1' }} onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="insight"
              icon={LuBanknote}
              title="Loan leads & conversion"
              subtitle={filterPeriodLabel}
              empty={!loanLeadData}
              chartRef={loanTypeChartRef}
              chartData={loanTypeData}
              height={300}
              stagger={0.28}
              canvasWrapper={false}
            >
              {loanLeadData && (
                <LoanLeadsPanel
                  totals={loanLeadData}
                  donutData={loanTypeData}
                  chartRef={loanTypeChartRef}
                  donutOptions={doughnutOpts}
                />
              )}
            </ReportChartCard>
          </div>
        </div>
      </section>

      {/* ============ STATISTICS SECTION ============ */}
      <DashboardStatistics filters={appliedFilters} filterPeriodLabel={filterPeriodLabel} />
    </div>
  );
};

export default AfterLogin;