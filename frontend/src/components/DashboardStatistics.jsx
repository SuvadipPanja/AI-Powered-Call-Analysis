import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Bar, Line } from "react-chartjs-2";

import { useAuth } from "../context/AuthContext";

import { LuTrophy, LuChartBar, LuClock, LuInbox, LuCircleX } from "../icons";

import {

  getDailyDurationWeek,

  getInboundOutboundWeek,

  getTopScorerAgentsWeek,

} from "../services/reportsService";

import { buildDashboardQueryParams, DEFAULT_DASHBOARD_FILTERS } from "../utils/dashboardFilters";

import KpiCard from "./shared/KpiCard";

import ReportChartCard from "./reports/ReportChartCard";

import {

  comparisonBarOptions,

  durationTrendChartOptions,

  inboundOutboundAreaDatasets,

  inboundOutboundBarDatasets,

  shortWeekdayLabels,

} from "../theme/chartTheme";

import "./dashboard-statistics.css";

import { EmptyState, PageError, PageLoading } from "./ui";



const EMPTY_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];



function TopScorerCard({ type, scorer, delay }) {

  const isInbound = type === "inbound";

  const label = isInbound ? "Inbound top scorer" : "Outbound top scorer";

  const agent = scorer?.agentName && scorer.agentName !== "—" ? scorer.agentName : "No data yet";

  const score = scorer?.avgScore ?? "—";

  const calls = scorer?.callCount ?? 0;



  return (

    <KpiCard

      className="dashboard-stats__scorer-kpi"

      style={{ animationDelay: `${delay}s` }}

      accent={isInbound ? "teal" : "amber"}

      label={label}

      value={score !== "—" ? `${score}%` : "—"}

      icon={LuTrophy}

    >

      <p className="reports-kpi__sub">{agent}</p>

      <p className="reports-kpi__sub">

        {calls > 0 ? `${calls} call${calls === 1 ? "" : "s"} in period` : "Top AI score in selected period"}

      </p>

    </KpiCard>

  );

}



export default function DashboardStatistics({ filters = DEFAULT_DASHBOARD_FILTERS, filterPeriodLabel }) {

  const { isLoggedIn, isValidatingSession, initializationComplete } = useAuth();

  // Fetching before the session is restored 401s and leaves the charts empty
  // until a manual refresh — wait for auth to be ready.
  const authReady = isLoggedIn && initializationComplete && !isValidatingSession;

  const [loading, setLoading] = useState(true);

  const [fetchError, setFetchError] = useState(null);

  const [callVolume, setCallVolume] = useState({ labels: EMPTY_WEEK, inbound: [], outbound: [] });

  const [duration, setDuration] = useState({ labels: EMPTY_WEEK, inbound: [], outbound: [] });

  const [topScorers, setTopScorers] = useState({ inbound: null, outbound: null });



  const fetchStats = useCallback(async () => {

    setLoading(true);

    setFetchError(null);

    try {

      const qs = buildDashboardQueryParams(filters);

      const [vol, dur, top] = await Promise.all([

        getInboundOutboundWeek(qs),

        getDailyDurationWeek(qs),

        getTopScorerAgentsWeek(qs),

      ]);



      if (!vol?.success || !dur?.success || !top?.success) {

        throw new Error(

          vol?.message || dur?.message || top?.message || "Statistics could not be loaded."

        );

      }



      setCallVolume({

        labels: vol.labels || EMPTY_WEEK,

        inbound: vol.inbound || [],

        outbound: vol.outbound || [],

      });

      setDuration({

        labels: dur.labels || EMPTY_WEEK,

        inbound: dur.inbound || [],

        outbound: dur.outbound || [],

      });

      setTopScorers({ inbound: top.inbound, outbound: top.outbound });

    } catch (err) {

      console.error("Failed to fetch dashboard statistics:", err);

      setFetchError(err.message || "Failed to load statistics. Please try again.");

      setCallVolume({ labels: EMPTY_WEEK, inbound: [], outbound: [] });

      setDuration({ labels: EMPTY_WEEK, inbound: [], outbound: [] });

      setTopScorers({ inbound: null, outbound: null });

    } finally {

      setLoading(false);

    }

  }, [filters]);



  useEffect(() => {

    if (!authReady) return;

    fetchStats();

  }, [authReady, fetchStats]);



  const volumeChartRef = useRef(null);

  const durationChartRef = useRef(null);



  const chartOpts = useMemo(() => comparisonBarOptions(), []);

  const durationChartOpts = useMemo(() => durationTrendChartOptions(), []);



  const callVolumeChart = useMemo(() => ({

    labels: shortWeekdayLabels(callVolume.labels),

    datasets: inboundOutboundBarDatasets(callVolume.inbound, callVolume.outbound, callVolume.labels),

  }), [callVolume]);



  const durationChart = useMemo(() => ({

    labels: shortWeekdayLabels(duration.labels),

    datasets: inboundOutboundAreaDatasets(duration.inbound, duration.outbound),

  }), [duration]);



  const totalInbound = callVolume.inbound.reduce((a, b) => a + b, 0);

  const totalOutbound = callVolume.outbound.reduce((a, b) => a + b, 0);

  const totalInboundMin = duration.inbound.reduce((a, b) => a + b, 0);

  const totalOutboundMin = duration.outbound.reduce((a, b) => a + b, 0);

  const hasNoData = !loading && !fetchError && totalInbound === 0 && totalOutbound === 0;



  const periodSubtitle = filterPeriodLabel || "Selected period";



  return (

    <section className="reports-section">

      <div className="reports-section__head">

        <h2>Statistics</h2>

        <p>Inbound vs outbound — volume, duration & top performers · {periodSubtitle}</p>

      </div>

      {loading ? (

        <PageLoading message="Loading statistics…" />

      ) : fetchError ? (

        <PageError

          message={fetchError}

          onRetry={fetchStats}

          retryLabel="Retry"

          icon={<LuCircleX aria-hidden />}

        />

      ) : hasNoData ? (

        <EmptyState

          compact

          fill

          icon={<LuInbox aria-hidden />}

          title="No call statistics for this period"

        >

          Try widening the date range (e.g. All time) or upload calls to see volume and duration charts here.

        </EmptyState>

      ) : (

        <div className="dashboard-stats">

          <div className="dashboard-stats__scorers reports-kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>

            <TopScorerCard type="inbound" scorer={topScorers.inbound} delay={0.05} />

            <TopScorerCard type="outbound" scorer={topScorers.outbound} delay={0.1} />

          </div>



          <div className="reports-chart-grid dashboard-stats__charts">

            <ReportChartCard

              variant="volume"

              icon={LuChartBar}

              title="Inbound vs Outbound Calls"

              subtitle={periodSubtitle}

              stat={`${totalInbound} inbound · ${totalOutbound} outbound`}

              chartRef={volumeChartRef}

              chartData={callVolumeChart}

              height={320}

              stagger={0.05}

              empty={totalInbound === 0 && totalOutbound === 0}

            >

              <Bar ref={volumeChartRef} data={callVolumeChart} options={chartOpts} />

            </ReportChartCard>



            <ReportChartCard

              variant="volume"

              icon={LuClock}

              title="Daily Duration — Inbound vs Outbound"

              subtitle={periodSubtitle}

              stat={`${totalInboundMin} min inbound · ${totalOutboundMin} min outbound`}

              chartRef={durationChartRef}

              chartData={durationChart}

              height={320}

              stagger={0.1}

              empty={totalInboundMin === 0 && totalOutboundMin === 0}

            >

              <Line ref={durationChartRef} data={durationChart} options={durationChartOpts} />

            </ReportChartCard>

          </div>

        </div>

      )}

    </section>

  );

}


