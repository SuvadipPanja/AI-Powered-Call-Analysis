import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  LuCircleX,
  LuMessageSquare,
  LuX,
  LuHeart,
  LuUsers,
  LuLayers,
  LuPhoneForwarded,
  LuBanknote,
  LuClock,
  LuInbox,
} from "../icons";
import DashboardStatistics from "./DashboardStatistics";
import DashboardKpiStrip from "./reports/DashboardKpiStrip";
import { Bar } from "react-chartjs-2";
import "react-datepicker/dist/react-datepicker.css";
import { useWebSocket } from "../context/WebSocketContext";
import useDashboard from "../hooks/useDashboard";
import { resolveDashboardDateRange } from "../utils/dashboardFilters";
import { Badge, EmptyState, PageError, PageLoading } from "./ui/index";
import KuberPageHero from "./layout/KuberPageHero";
import "./layout/kuber-hero.css";
import { baseChartOptions } from "../theme/chartTheme";
import ReportChartCard from "./reports/ReportChartCard";
import DonutInsightChart from "./reports/DonutInsightChart";
import { buildColoredDoughnutData, modernDoughnutOptions } from "./reports/reportsChartConfig";
import LoanLeadsPanel from "./reports/LoanLeadsPanel";
import EscalationKpiBlock from "./reports/EscalationKpiBlock";
import HoldKpiBlock from "./reports/HoldKpiBlock";
import { useAuth } from "../context/AuthContext";

const CSAT_DONUT_COLORS = ["#6b9080", "#94a3b8"];

const AfterLogin = () => {
  const { username, userType, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { chatMessages } = useWebSocket();

  const {
    appliedFilters,
    isFilterApplied,
    applyAndRefresh,
    resetAndRefresh,
    kuberHeroProps,
    selectedLocation,
    metrics,
    charts,
  } = useDashboard();

  const {
    loading: metricsLoading,
    error: metricsError,
    fetchMetrics,
    kpiStats: dashboardKpiStats,
    kpiComparison: dashboardKpiComparison,
    formatDelta: formatDashboardDelta,
    isNoData,
  } = metrics;

  const {
    toneData,
    agentWiseData,
    queryTypeData,
    escalationTotals,
    loanLeadData,
    loanTypeData,
    holdTotals,
  } = charts;

  const [chatPopupVisible, setChatPopupVisible] = useState(false);
  const [currentChatMessages, setCurrentChatMessages] = useState([]);

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

  const handleFilterSubmit = () => {
    const result = applyAndRefresh();
    if (!result.ok) {
      alert(result.error);
    }
  };

  const handleRetryFetchMetrics = () => {
    fetchMetrics(appliedFilters);
  };

  const handleResetFilters = () => {
    resetAndRefresh();
  };

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
    if (!appliedFilters || appliedFilters.dateRange === "All Time") {
      return "All time";
    }
    if (appliedFilters.dateRange === "1 Month") {
      return "Last 1 month";
    }
    if (appliedFilters.dateRange === "1 Week") {
      return "Last 1 week";
    }
    if (appliedFilters.dateRange === "Today") {
      return "Today";
    }
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
              <LuMessageSquare /> Incoming Messages
            </h3>
            <button
              className="ui-chat-popup__close"
              onClick={() => setChatPopupVisible(false)}
              aria-label="Close Chat Popup"
            >
              <LuX />
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
          <PageLoading message="Loading metrics…" />
        ) : metricsError ? (
          <PageError
            message={metricsError}
            onRetry={handleRetryFetchMetrics}
            retryLabel="Retry"
            icon={<LuCircleX aria-hidden />}
          />
        ) : isNoData ? (
          <EmptyState
            compact
            fill
            icon={<LuInbox aria-hidden />}
            title="No data for filters"
          >
            No data available for the selected filters.
          </EmptyState>
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
          <div className="clickable-chart" onClick={() => navigate("/reports/details")}>
            <ReportChartCard
              variant="agent"
              icon={LuClock}
              title="Agent hold time"
              subtitle={filterPeriodLabel}
              empty={!holdTotals}
              height={300}
              stagger={0.22}
            >
              {holdTotals && (
                <HoldKpiBlock data={holdTotals} />
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