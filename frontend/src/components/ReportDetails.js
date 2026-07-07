/**
 * Report dashboard with smart chart adaptation and dynamic filtering.
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import 'chart.js/auto';
import config from "../utils/envConfig";
import { PageLoading, PageError } from './ui';
import KuberPageHero from './layout/KuberPageHero';
import './layout/kuber-hero.css';
import ReportKpiStrip from './reports/ReportKpiStrip';
import ReportVolumeSection from './reports/sections/ReportVolumeSection';
import ReportQualitySection from './reports/sections/ReportQualitySection';
import ReportIntentSection from './reports/sections/ReportIntentSection';
import ReportAgentSection from './reports/sections/ReportAgentSection';
import ReportAuditSection from './reports/sections/ReportAuditSection';
import { fetchLoanLeadsReport } from '../utils/loanLeadsData';
import {
  mapToneSentimentChart,
  mapQueryTypeChart,
  mapEscalationReport,
  mapHoldReport,
  mapLeadClassificationChart,
} from '../utils/dashboardChartMappers';
import { formatKpiDelta } from '../utils/dashboardKpiUtils';
import {
  getAgentHandlingSummary,
  getAgentPerformanceMetrics,
  getCallResolutionStatus,
  getCallVolumeByTime,
  getCallVolumeTrendsEnhanced,
  getEscalationSummary,
  getHoldSummary,
  getLanguagePreferences,
  getLeadClassification,
  getMetricsOverview,
  getPerformanceComparison,
  getQueryTypeDistribution,
  getRealtimeMetrics,
  getRubricComparison,
  getToneSentimentSummary,
} from '../services/reportsService';
import { getTeamAuditList, getTeamAuditSummary } from '../services/auditService';
import { exportTeamAudits } from '../services/uploadService';
import {
  buildUnifiedCallVolumeChart,
  unifiedCallVolumeOptions,
  buildPeakTimeChart,
  modernPeakTimeOptions,
  buildModernDoughnutData,
  modernDoughnutOptions,
  buildAgentRankingChart,
  modernAgentRankingOptions,
  buildModernRadarChart,
  modernRadarOptions,
  formatVolumeTrendLabels,
} from './reports/reportsChartConfig';
import { appendReportFilters, buildReportQueryParams } from '../utils/dashboardFilters';
import useReportFilters from '../hooks/useReportFilters';
import { LuChartBar } from '../icons';

function calculateDateDifference(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const diffTime = Math.abs(to - from);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function determineChartTypes(fromDate, toDate) {
  const days = calculateDateDifference(fromDate, toDate);

  const chartConfig = {
    inboundType: 'monthly',
    outboundType: 'monthly',
    distributionType: 'daily',
  };

  if (days <= 1) {
    chartConfig.inboundType = 'hourly';
    chartConfig.outboundType = 'hourly';
    chartConfig.distributionType = 'hourly';
  } else if (days <= 7) {
    chartConfig.inboundType = 'daily';
    chartConfig.outboundType = 'daily';
    chartConfig.distributionType = 'daily';
  } else if (days <= 30) {
    chartConfig.inboundType = 'weekly';
    chartConfig.outboundType = 'weekly';
    chartConfig.distributionType = 'weekly';
  } else if (days <= 90) {
    chartConfig.inboundType = 'monthly';
    chartConfig.outboundType = 'monthly';
    chartConfig.distributionType = 'monthly';
  }

  return chartConfig;
}

const ReportDetails = () => {
  /***************************************
   * 2) STATE MANAGEMENT
   ***************************************/
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Chart data
  const [volumeTrendsData, setVolumeTrendsData] = useState(null);
  const [volumeTrendsRows, setVolumeTrendsRows] = useState([]);
  const [periodAvgScore, setPeriodAvgScore] = useState(null);
  const [resolutionData, setResolutionData] = useState(null);
  const [agentPerformanceData, setAgentPerformanceData] = useState(null);
  const [agentSummaryData, setAgentSummaryData] = useState([]);
  const [languagePreferencesData, setLanguagePreferencesData] = useState(null);
  const [callVolumeByTimeData, setCallVolumeByTimeData] = useState(null);
  const [rubricChartData, setRubricChartData] = useState(null);
  const [rubricRows, setRubricRows] = useState([]);
  const [toneChartData, setToneChartData] = useState(null);
  const [leadChartData, setLeadChartData] = useState(null);
  const [queryTypeData, setQueryTypeData] = useState(null);
  const [escalationData, setEscalationData] = useState(null);
  const [escalationDonut, setEscalationDonut] = useState(null);
  const [loanLeadData, setLoanLeadData] = useState(null);
  const [loanTypeDonut, setLoanTypeDonut] = useState(null);
  const [holdData, setHoldData] = useState(null);

  const volumeChartRef = useRef(null);
  const languageChartRef = useRef(null);
  const timeChartRef = useRef(null);
  const resolutionChartRef = useRef(null);
  const rubricChartRef = useRef(null);
  const toneChartRef = useRef(null);
  const leadChartRef = useRef(null);
  const agentPerfChartRef = useRef(null);
  const queryTypeChartRef = useRef(null);
  const escalationChartRef = useRef(null);
  const loanTypeChartRef = useRef(null);

  const fetchAllDataRef = useRef(null);

  // Chart configuration states
  const [chartConfig, setChartConfig] = useState({
    inboundType: 'monthly',
    outboundType: 'monthly',
    distributionType: 'daily'
  });

  const [realTimeStats, setRealTimeStats] = useState({
    totalCallsToday: 0,
    activeAgents: 0,
    avgScoreToday: 0,
    resolutionRateToday: 0,
    inboundToday: 0,
    outboundToday: 0
  });

  const [performanceComparison, setPerformanceComparison] = useState({
    callsGrowth: 0,
    scoreGrowth: 0,
    resolutionGrowth: 0,
    currentCalls: 0,
    previousCalls: 0,
    currentScore: null,
    currentResolution: null,
  });

  const [metricsOverview, setMetricsOverview] = useState({
    avgAiScoring: null,
    prevAvgAiScoring: null,
  });

  const [auditMetrics, setAuditMetrics] = useState(null);
  const [auditActivity, setAuditActivity] = useState([]);
  const [auditActivityLoading, setAuditActivityLoading] = useState(false);

  /***************************************
   * 3) DATA FETCHING
   ***************************************/
  const handleAutoApply = useCallback((activeFilters) => {
    setChartConfig(determineChartTypes(activeFilters.fromDate, activeFilters.toDate));
    fetchAllDataRef.current?.(activeFilters);
  }, []);

  const {
    filters,
    filtersRef,
    kuberHeroProps,
    selectedLocation,
    applyFilters: commitReportFilters,
    resetFilters: resetReportFilters,
  } = useReportFilters({
    mode: 'auto',
    maxRangeDays: null,
    onAutoApply: handleAutoApply,
  });

  const buildBulkExportBody = useCallback((callType) => ({
    fromDate: filters.fromDate || null,
    toDate: filters.toDate || null,
    location: filters.location !== 'All' ? filters.location : null,
    supervisor: filters.supervisor !== 'All' ? filters.supervisor : null,
    ...(callType ? { callType } : {}),
  }), [filters]);

  /***************************************
   * 5) ENHANCED API FUNCTIONS
   ***************************************/

  const stampReportFilters = (queryParams, activeFilters = filtersRef.current) => {
    appendReportFilters(queryParams, activeFilters);
    return queryParams;
  };

  const API_BASE_URL = config.apiBaseUrl;


  const fetchRealTimeMetrics = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getRealtimeMetrics(queryParams);
      if (result?.success && result.data) {
        setRealTimeStats(result.data);
      }
    } catch (error) {
      console.error('Error fetching real-time metrics:', error);
    }
  };

  const fetchPerformanceComparison = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getPerformanceComparison(queryParams);
      if (result?.success && result.data) {
        setPerformanceComparison(result.data);
      }
    } catch (error) {
      console.error('Error fetching performance comparison:', error);
    }
  };

  const fetchMetricsOverview = async (f = filtersRef.current) => {
    try {
      if (!f.fromDate || !f.toDate) return;
      const queryParams = new URLSearchParams();
      queryParams.append('fromDate', f.fromDate);
      queryParams.append('toDate', f.toDate);
      if (f.location && f.location !== 'All') queryParams.append('location', f.location);
      const supervisor = f.supervisor ?? f.tl;
      if (supervisor && supervisor !== 'All') queryParams.append('tl', supervisor);
      if (f.callType && f.callType !== 'All') {
        queryParams.append('callType', String(f.callType).toLowerCase());
      }
      if (f.agent && f.agent !== 'All') queryParams.append('agent', f.agent);

      const result = await getMetricsOverview(queryParams);
      if (result?.success) {
        setMetricsOverview({
          avgAiScoring: result.avgAiScoring ?? null,
          prevAvgAiScoring: result.prevPeriodData?.avgAiScoring ?? null,
        });
      }
    } catch (error) {
      console.error('Error fetching metrics overview:', error);
    }
  };

  const fetchLanguagePreferencesData = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getLanguagePreferences(queryParams);
      if (result?.success && result.data?.length > 0) {
        setLanguagePreferencesData(buildModernDoughnutData(
          result.data.map((item) => item.language || 'Unknown'),
          result.data.map((item) => item.count),
        ));
      } else {
        setLanguagePreferencesData(null);
      }
    } catch (error) {
      console.error('Error fetching language preferences data:', error);
    }
  };

  const fetchCallVolumeByTimeData = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getCallVolumeByTime(queryParams);
      if (result?.success && result.data?.length) {
        const labels = result.data.map((item) => item.timePeriod);
        const values = result.data.map((item) => item.callCount || 0);
        setCallVolumeByTimeData(buildPeakTimeChart(labels, values));
      } else {
        setCallVolumeByTimeData(null);
      }
    } catch (error) {
      console.error('Error fetching call volume by time data:', error);
    }
  };

  const fetchVolumeTrendsData = async (f = filtersRef.current) => {
    try {
      const days = calculateDateDifference(f.fromDate, f.toDate);
      const queryParams = new URLSearchParams();
      if (days <= 1) {
        queryParams.append('period', 'daily');
        setChartConfig((prev) => ({ ...prev, inboundType: 'hourly', outboundType: 'hourly' }));
      } else if (days <= 7) {
        queryParams.append('period', 'daily');
        setChartConfig((prev) => ({ ...prev, inboundType: 'daily', outboundType: 'daily' }));
      } else if (days <= 30) {
        queryParams.append('period', 'weekly');
        setChartConfig((prev) => ({ ...prev, inboundType: 'weekly', outboundType: 'weekly' }));
      } else {
        queryParams.append('period', 'monthly');
        setChartConfig((prev) => ({ ...prev, inboundType: 'monthly', outboundType: 'monthly' }));
      }
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getCallVolumeTrendsEnhanced(queryParams);
      if (result?.success && result.data?.length > 0) {
        const sorted = [...result.data].reverse();
        const labels = formatVolumeTrendLabels(sorted, days);
        const inbound = sorted.map((item) => item.inboundCalls || 0);
        const outbound = sorted.map((item) => item.outboundCalls || 0);
        let scoreSum = 0;
        let scoreWeight = 0;
        sorted.forEach((item) => {
          const score = Number(item.avgScore);
          const weight = (item.inboundCalls || 0) + (item.outboundCalls || 0);
          if (Number.isFinite(score) && score > 0 && weight > 0) {
            scoreSum += score * weight;
            scoreWeight += weight;
          }
        });
        setPeriodAvgScore(scoreWeight > 0 ? scoreSum / scoreWeight : null);
        setVolumeTrendsRows(sorted.map((item, i) => ({
          Period: labels[i],
          Inbound: inbound[i],
          Outbound: outbound[i],
          Total: inbound[i] + outbound[i],
        })));
        setVolumeTrendsData(buildUnifiedCallVolumeChart(labels, inbound, outbound));
      } else {
        setPeriodAvgScore(null);
        setVolumeTrendsRows([]);
        setVolumeTrendsData(null);
      }
    } catch (error) {
      console.error('Error fetching volume trends:', error);
    }
  };

  const fetchRubricComparison = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const result = await getRubricComparison(queryParams);
      if (result?.success && result.data?.length) {
        const rows = result.data.filter((d) => d.ai != null || d.manual != null);
        setRubricRows(rows.map((d) => ({
          Dimension: d.dimension,
          'AI score': d.ai ?? '',
          'Manual score': d.manual ?? '',
        })));
        const labels = rows.map((d) => d.dimension);
        setRubricChartData(buildModernRadarChart(
          labels,
          rows.map((d) => d.ai || 0),
          rows.map((d) => d.manual || 0),
        ));
      } else {
        setRubricRows([]);
        setRubricChartData(null);
      }
    } catch (error) {
      console.error('Error fetching rubric comparison:', error);
    }
  };

  const fetchToneSentiment = async (f = filtersRef.current) => {
    try {
      const result = await getToneSentimentSummary(buildReportQueryParams(f));
      setToneChartData(mapToneSentimentChart(result));
    } catch (error) {
      console.error('Error fetching sentiment summary:', error);
    }
  };

  const fetchLeadClassification = async (f = filtersRef.current) => {
    try {
      const result = await getLeadClassification(buildReportQueryParams(f));
      setLeadChartData(mapLeadClassificationChart(result));
    } catch (error) {
      console.error('Error fetching lead classification:', error);
    }
  };

  const fetchQueryTypeDistribution = async (f = filtersRef.current) => {
    try {
      const result = await getQueryTypeDistribution(buildReportQueryParams(f));
      setQueryTypeData(mapQueryTypeChart(result));
    } catch (error) {
      console.error('Error fetching query-type distribution:', error);
    }
  };

  const fetchEscalationSummary = async (f = filtersRef.current) => {
    try {
      const result = await getEscalationSummary(buildReportQueryParams(f));
      const { totals, donut } = mapEscalationReport(result);
      setEscalationData(totals);
      setEscalationDonut(donut);
    } catch (error) {
      console.error('Error fetching escalation summary:', error);
    }
  };

  const fetchHoldSummary = async (f = filtersRef.current) => {
    try {
      const result = await getHoldSummary(buildReportQueryParams(f));
      setHoldData(mapHoldReport(result));
    } catch (error) {
      console.error('Error fetching hold summary:', error);
    }
  };

  const fetchLoanLeads = async (f = filtersRef.current) => {
    try {
      const { totals, donutData } = await fetchLoanLeadsReport(buildReportQueryParams(f).toString());
      setLoanLeadData(totals);
      setLoanTypeDonut(donutData);
    } catch (error) {
      console.error('Error fetching loan leads:', error);
      setLoanLeadData(null);
      setLoanTypeDonut(null);
    }
  };

  const fetchAuditMetrics = async () => {
    try {
      const data = await getTeamAuditSummary();
      if (data?.success) {
        setAuditMetrics(data);
      }
    } catch { /* audit metrics optional */ }
  };

  const formatAuditTimestamp = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const fetchAuditActivity = async (f = filtersRef.current) => {
    setAuditActivityLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('from', f.fromDate);
      if (f.toDate) queryParams.append('to', f.toDate);
      if (f.location && f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor && f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      const data = await getTeamAuditList(queryParams.toString());
      if (data?.success) {
        setAuditActivity(data.audits || []);
      } else {
        setAuditActivity([]);
      }
    } catch {
      setAuditActivity([]);
    } finally {
      setAuditActivityLoading(false);
    }
  };

  const handleAuditExport = async () => {
    try {
      const blob = await exportTeamAudits('');
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit_report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch { console.error('Audit export failed'); }
  };

  const fetchResolutionData = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const result = await getCallResolutionStatus(queryParams);
      if (result?.success && result.data?.length > 0) {
        setResolutionData(buildModernDoughnutData(
          result.data.map((item) => item.resolutionStatus || 'Unknown'),
          result.data.map((item) => item.count),
        ));
      } else {
        setResolutionData(null);
      }
    } catch (error) {
      console.error('Error fetching resolution data:', error);
    }
  };

  const fetchAgentPerformanceData = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      queryParams.append('limit', '5');
      stampReportFilters(queryParams, f);

      const result = await getAgentPerformanceMetrics(queryParams);
      if (result?.success && result.data?.length > 0) {
        const sortedData = [...result.data]
          .sort((a, b) => parseFloat(b.avgAIScore || 0) - parseFloat(a.avgAIScore || 0))
          .slice(0, 5);

        setAgentPerformanceData(buildAgentRankingChart(
          sortedData.map((item) => item.AgentName),
          sortedData.map((item) => parseFloat(item.avgAIScore || 0)),
        ));
      } else {
        setAgentPerformanceData(null);
      }
    } catch (error) {
      console.error('Error fetching agent performance data:', error);
    }
  };

  const fetchAgentSummaryData = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);

      const result = await getAgentHandlingSummary(queryParams);
      if (result?.success) {
        setAgentSummaryData(result.data || []);
      } else {
        setAgentSummaryData([]);
      }
    } catch (error) {
      console.error('Error fetching agent summary data:', error);
    }
  };

  /***************************************
   * 7) FILTER HANDLERS
   ***************************************/
  const applyFilters = () => {
    const result = commitReportFilters();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError('');
    setChartConfig(determineChartTypes(result.resolved.fromDate, result.resolved.toDate));
    fetchAllData(result.resolved);
  };

  const resetFilters = () => {
    const result = resetReportFilters();
    setError('');
    setChartConfig(determineChartTypes(result.resolved.fromDate, result.resolved.toDate));
    fetchAllData(result.resolved);
  };

  const fetchAllData = async (activeFilters = filtersRef.current) => {
    filtersRef.current = activeFilters;
    setLoading(true);
    setError('');
    try {
      await Promise.all([
        fetchVolumeTrendsData(activeFilters),
        fetchResolutionData(activeFilters),
        fetchAgentPerformanceData(activeFilters),
        fetchAgentSummaryData(activeFilters),
        fetchRealTimeMetrics(activeFilters),
        fetchPerformanceComparison(activeFilters),
        fetchMetricsOverview(activeFilters),
        fetchLanguagePreferencesData(activeFilters),
        fetchCallVolumeByTimeData(activeFilters),
        fetchRubricComparison(activeFilters),
        fetchToneSentiment(activeFilters),
        fetchLeadClassification(activeFilters),
        fetchQueryTypeDistribution(activeFilters),
        fetchEscalationSummary(activeFilters),
        fetchHoldSummary(activeFilters),
        fetchLoanLeads(activeFilters),
        fetchAuditMetrics(),
        fetchAuditActivity(activeFilters),
      ]);
    } catch (error) {
      setError('Error loading dashboard data. Please try again.');
      console.error('Error fetching all data:', error);
    } finally {
      setLoading(false);
    }
  };

  fetchAllDataRef.current = fetchAllData;

  const agentTableColumns = useMemo(() => ([
    { key: 'agent', label: 'Agent' },
    { key: 'AgentLocation', label: 'Location' },
    { key: 'AgentSupervisor', label: 'Supervisor' },
    { key: 'totalCalls', label: 'Calls' },
    { key: 'callsWithHold', label: 'With hold' },
    { key: 'holdRatePct', label: 'Hold %' },
    { key: 'avgHoldSec', label: 'Avg hold (s)' },
    { key: 'avgHandlingTime', label: 'Avg time' },
    { key: 'avgAIScore', label: 'AI score' },
    { key: 'avgManualScore', label: 'Manual score' },
    { key: 'satisfaction', label: 'Resolution' },
  ]), []);

  const holdTableColumns = useMemo(() => ([
    { key: 'totalCalls', label: 'Total calls' },
    { key: 'withHold', label: 'Calls with hold' },
    { key: 'holdPct', label: 'Hold rate %' },
    { key: 'avgHoldSec', label: 'Avg hold (sec)' },
    { key: 'longestHoldSec', label: 'Longest hold (sec)' },
    { key: 'totalHoldEvents', label: 'Hold episodes' },
    { key: 'totalHoldSec', label: 'Total hold (sec)' },
  ]), []);

  const holdTableRows = useMemo(() => {
    if (!holdData) return [];
    const total = Number(holdData.total) || 0;
    const withHold = Number(holdData.withHold) || 0;
    return [{
      totalCalls: total,
      withHold,
      holdPct: total > 0 ? `${Math.round((withHold / total) * 100)}%` : '0%',
      avgHoldSec: holdData.avgHoldSec != null ? Number(holdData.avgHoldSec).toFixed(1) : '—',
      longestHoldSec: holdData.longestHoldSec != null ? Number(holdData.longestHoldSec).toFixed(1) : '—',
      totalHoldEvents: holdData.totalHoldEvents ?? 0,
      totalHoldSec: holdData.totalHoldSec != null ? Number(holdData.totalHoldSec).toFixed(1) : '—',
    }];
  }, [holdData]);

  const formatDelta = formatKpiDelta;

  const chartOptions = useMemo(() => ({
    volume: unifiedCallVolumeOptions(volumeTrendsData),
    peak: modernPeakTimeOptions(),
    doughnut: modernDoughnutOptions(),
    agent: modernAgentRankingOptions(),
    radar: modernRadarOptions(),
  }), [volumeTrendsData]);

  const volumeChartRenderData = useMemo(() => {
    if (!volumeTrendsData) return null;
    const { _meta, ...rest } = volumeTrendsData;
    return rest;
  }, [volumeTrendsData]);

  const volumeSummary = useMemo(() => {
    if (!volumeTrendsRows.length) return null;
    const inbound = volumeTrendsRows.reduce((s, r) => s + (Number(r.Inbound) || 0), 0);
    const outbound = volumeTrendsRows.reduce((s, r) => s + (Number(r.Outbound) || 0), 0);
    return `${inbound + outbound} calls · ${inbound} inbound · ${outbound} outbound`;
  }, [volumeTrendsRows]);

  const toKpiScorePercent = (raw) => {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
  };

  const kpiComparison = useMemo(() => {
    const metricsScoreDelta = metricsOverview.avgAiScoring != null && metricsOverview.prevAvgAiScoring != null
      ? (Number(metricsOverview.avgAiScoring) - Number(metricsOverview.prevAvgAiScoring)) * 100
      : null;
    const hasComparisonScore = toKpiScorePercent(performanceComparison.currentScore) != null;
    return {
      ...performanceComparison,
      scoreGrowth: hasComparisonScore
        ? (performanceComparison.scoreGrowth ?? 0)
        : (metricsScoreDelta ?? performanceComparison.scoreGrowth ?? 0),
    };
  }, [performanceComparison, metricsOverview]);

  const kpiDisplayStats = useMemo(() => {
    const periodInbound = volumeTrendsRows.reduce((s, r) => s + (Number(r.Inbound) || 0), 0);
    const periodOutbound = volumeTrendsRows.reduce((s, r) => s + (Number(r.Outbound) || 0), 0);
    const periodTotal = periodInbound + periodOutbound;
    const resolvedTotal = resolutionData?.datasets?.[0]?.data?.reduce((a, b) => a + (Number(b) || 0), 0) || 0;
    const resolvedLabelIdx = resolutionData?.labels?.findIndex((l) =>
      String(l).toLowerCase().includes('resolved')
    );
    const resolvedCount = resolvedLabelIdx >= 0
      ? Number(resolutionData.datasets[0].data[resolvedLabelIdx]) || 0
      : 0;
    const resolutionFromChart = resolvedTotal > 0
      ? Math.round((resolvedCount / resolvedTotal) * 100)
      : null;

    const avgScore = toKpiScorePercent(performanceComparison.currentScore)
      ?? toKpiScorePercent(
        metricsOverview.avgAiScoring != null ? Number(metricsOverview.avgAiScoring) * 100 : null,
      )
      ?? toKpiScorePercent(periodAvgScore)
      ?? toKpiScorePercent(realTimeStats.avgScoreToday);

    return {
      totalCalls: periodTotal || Number(performanceComparison.currentCalls) || 0,
      avgScore,
      resolutionRate: performanceComparison.currentResolution || resolutionFromChart,
      inbound: periodInbound,
      outbound: periodOutbound,
      activeAgents: agentSummaryData.length || realTimeStats.activeAgents || 0,
    };
  }, [
    performanceComparison,
    metricsOverview,
    periodAvgScore,
    volumeTrendsRows,
    realTimeStats.avgScoreToday,
    realTimeStats.activeAgents,
    agentSummaryData.length,
    resolutionData,
  ]);

  /***************************************
   * 10) RENDER
   ***************************************/
  return (
    <div className="app-page reports-page">
      <KuberPageHero
        hideTitle
        title="Reports"
        icon={LuChartBar}
        locationLabel={selectedLocation === 'All' ? 'All locations' : selectedLocation}
        {...kuberHeroProps}
        hideApply
        onSubmit={applyFilters}
        onReset={resetFilters}
      />

      {error && (
        <PageError
          message={error}
          onRetry={() => fetchAllData(filtersRef.current)}
          retryLabel="Retry"
        />
      )}

      {loading && (
        <PageLoading inline message="Updating analytics…" />
      )}

      <>
          <ReportKpiStrip
            stats={kpiDisplayStats}
            comparison={kpiComparison}
            formatDelta={formatDelta}
          />

          <ReportVolumeSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            chartConfig={chartConfig}
            volumeSummary={volumeSummary}
            volumeTrendsData={volumeTrendsData}
            volumeChartRenderData={volumeChartRenderData}
            volumeTrendsRows={volumeTrendsRows}
            callVolumeByTimeData={callVolumeByTimeData}
            languagePreferencesData={languagePreferencesData}
            volumeChartRef={volumeChartRef}
            timeChartRef={timeChartRef}
            languageChartRef={languageChartRef}
            chartOptions={chartOptions}
          />

          <ReportQualitySection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            rubricChartData={rubricChartData}
            rubricRows={rubricRows}
            resolutionData={resolutionData}
            toneChartData={toneChartData}
            leadChartData={leadChartData}
            rubricChartRef={rubricChartRef}
            resolutionChartRef={resolutionChartRef}
            toneChartRef={toneChartRef}
            leadChartRef={leadChartRef}
            chartOptions={chartOptions}
          />

          <ReportIntentSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            queryTypeData={queryTypeData}
            escalationData={escalationData}
            escalationDonut={escalationDonut}
            loanLeadData={loanLeadData}
            loanTypeDonut={loanTypeDonut}
            holdData={holdData}
            holdTableColumns={holdTableColumns}
            holdTableRows={holdTableRows}
            queryTypeChartRef={queryTypeChartRef}
            escalationChartRef={escalationChartRef}
            loanTypeChartRef={loanTypeChartRef}
            chartOptions={chartOptions}
          />

          <ReportAgentSection
            loading={loading}
            filters={filters}
            apiBaseUrl={API_BASE_URL}
            buildBulkExportBody={buildBulkExportBody}
            agentPerformanceData={agentPerformanceData}
            agentSummaryData={agentSummaryData}
            agentTableColumns={agentTableColumns}
            agentPerfChartRef={agentPerfChartRef}
            chartOptions={chartOptions}
          />

          <ReportAuditSection
            auditMetrics={auditMetrics}
            auditActivity={auditActivity}
            auditActivityLoading={auditActivityLoading}
            onAuditExport={handleAuditExport}
            formatAuditTimestamp={formatAuditTimestamp}
          />
      </>

    </div>
  );
};

export default ReportDetails;
