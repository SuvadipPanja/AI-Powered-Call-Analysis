/**
 * File: ReportDetails.js
 * Purpose: Modern Industrial-Standard Report Dashboard with Smart Chart Adaptation
 * Created By: $Panja
 * Creation Date: 2025-06-22
 * Updated: 2025-06-23 with Dynamic Location and Supervisor Fetching
 * Enhanced: 2025-06-28 with Language Preferences and Call Volume by Time Charts
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Compliance: IS Policy, ISO 27001, ISO 9001, Web Page Policy
 * Features: Smart chart adaptation, modern UI, industrial design, dynamic filtering, real-time metrics
 * Notes: All locations and supervisors are fetched dynamically from the database.
 *        API URLs use config.apiBaseUrl from envConfig.js.
 */

import React, { useState, useRef, useMemo, useCallback } from 'react';
import 'chart.js/auto';
import config from "../utils/envConfig";
import { Spinner } from './ui';
import KuberPageHero from './layout/KuberPageHero';
import './layout/kuber-hero.css';
import ReportKpiStrip from './reports/ReportKpiStrip';
import ReportVolumeSection from './reports/sections/ReportVolumeSection';
import ReportQualitySection from './reports/sections/ReportQualitySection';
import ReportIntentSection from './reports/sections/ReportIntentSection';
import ReportAgentSection from './reports/sections/ReportAgentSection';
import ReportAuditSection from './reports/sections/ReportAuditSection';
import { fetchLoanLeadsReport } from '../utils/loanLeadsData';
import './reports/reports-page.css';
import {
  buildUnifiedCallVolumeChart,
  unifiedCallVolumeOptions,
  buildPeakTimeChart,
  modernPeakTimeOptions,
  buildModernDoughnutData,
  buildColoredDoughnutData,
  buildSentimentSummaryChart,
  modernDoughnutOptions,
  buildAgentRankingChart,
  modernAgentRankingOptions,
  buildModernRadarChart,
  modernRadarOptions,
  formatVolumeTrendLabels,
} from './reports/reportsChartConfig';
import { appendReportFilters } from '../utils/dashboardFilters';
import { parseReportResponse as parseReportApiResponse } from '../utils/apiHelpers';
import useReportFilters from '../hooks/useReportFilters';
import { LuChartBar } from 'react-icons/lu';
const ReportDetails = () => {
  /***************************************
   * 1) CODE INTEGRITY CHECK
   ***************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised.");
    }
  };
  verifySignature(signature);

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
  const [auditMetricsLoading, setAuditMetricsLoading] = useState(false);
  const [auditActivity, setAuditActivity] = useState([]);
  const [auditActivityLoading, setAuditActivityLoading] = useState(false);

  /***************************************
   * 3) UTILITY FUNCTIONS
   ***************************************/
  const calculateDateDifference = (fromDate, toDate) => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const diffTime = Math.abs(to - from);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const determineChartTypes = (fromDate, toDate) => {
    const days = calculateDateDifference(fromDate, toDate);
    
    let config = {
      inboundType: 'monthly',
      outboundType: 'monthly',
      distributionType: 'daily'
    };

    if (days <= 1) {
      config.inboundType = 'hourly';
      config.outboundType = 'hourly';
      config.distributionType = 'hourly';
    } else if (days <= 7) {
      config.inboundType = 'daily';
      config.outboundType = 'daily';
      config.distributionType = 'daily';
    } else if (days <= 30) {
      config.inboundType = 'weekly';
      config.outboundType = 'weekly';
      config.distributionType = 'weekly';
    } else if (days <= 90) {
      config.inboundType = 'monthly';
      config.outboundType = 'monthly';
      config.distributionType = 'monthly';
    } else {
      config.inboundType = 'monthly';
      config.outboundType = 'monthly';
      config.distributionType = 'monthly';
    }

    return config;
  };

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
    maxRangeDays: 365,
    onAutoApply: handleAutoApply,
  });

  const buildBulkExportBody = useCallback((callType) => ({
    fromDate: filters.fromDate || null,
    toDate: filters.toDate || null,
    location: filters.location !== 'All' ? filters.location : null,
    supervisor: filters.supervisor !== 'All' ? filters.supervisor : null,
    ...(callType ? { callType } : {}),
  }), [filters]);

  const getDateRange = (type) => {
    const today = new Date();
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    switch (type) {
      case 'today':
        return {
          fromDate: formatDate(today),
          toDate: formatDate(today)
        };
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return {
          fromDate: formatDate(yesterday),
          toDate: formatDate(yesterday)
        };
      case 'lastWeek':
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 6);
        return {
          fromDate: formatDate(lastWeekStart),
          toDate: formatDate(lastWeekEnd)
        };
      case 'lastMonth':
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return {
          fromDate: formatDate(lastMonthStart),
          toDate: formatDate(lastMonthEnd)
        };
      case 'lastYear':
        const lastYearEnd = new Date(today.getFullYear() - 1, 11, 31);
        const lastYearStart = new Date(today.getFullYear() - 1, 0, 1);
        return {
          fromDate: formatDate(lastYearStart),
          toDate: formatDate(lastYearEnd)
        };
      default:
        return { fromDate: '', toDate: '' };
    }
  };

  /***************************************
   * 5) ENHANCED API FUNCTIONS
   ***************************************/
  const API_BASE_URL = config.apiBaseUrl;

  const stampReportFilters = (queryParams, activeFilters = filtersRef.current) => {
    appendReportFilters(queryParams, activeFilters);
    return queryParams;
  };


  const fetchRealTimeMetrics = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.location !== 'All') queryParams.append('location', f.location);
      if (f.supervisor !== 'All') queryParams.append('supervisor', f.supervisor);
      stampReportFilters(queryParams, f);

      const response = await fetch(`${API_BASE_URL}/api/reports/realtime-metrics?${queryParams}`);
      const result = await parseReportApiResponse(response, 'realtime-metrics');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/performance-comparison?${queryParams}`);
      const result = await parseReportApiResponse(response, 'performance-comparison');
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

      const response = await fetch(`${API_BASE_URL}/api/metrics-overview?${queryParams}`);
      const result = await parseReportApiResponse(response, 'metrics-overview');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/language-preferences?${queryParams}`);
      const result = await parseReportApiResponse(response, 'language-preferences');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/call-volume-by-time?${queryParams}`);
      const result = await parseReportApiResponse(response, 'call-volume-by-time');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/call-volume-trends-enhanced?${queryParams}`);
      const result = await parseReportApiResponse(response, 'call-volume-trends');
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
      const response = await fetch(`${API_BASE_URL}/api/reports/rubric-comparison?${queryParams}`);
      const result = await parseReportApiResponse(response, 'rubric-comparison');
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
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const response = await fetch(`${API_BASE_URL}/api/reports/tone-sentiment-summary?${queryParams}`);
      const result = await parseReportApiResponse(response, 'tone-sentiment');
      if (result?.success && result.data?.length) {
        setToneChartData(buildSentimentSummaryChart(result.data));
      } else {
        setToneChartData(null);
      }
    } catch (error) {
      console.error('Error fetching sentiment summary:', error);
    }
  };

  const fetchLeadClassification = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const response = await fetch(`${API_BASE_URL}/api/reports/lead-classification?${queryParams}`);
      const result = await parseReportApiResponse(response, 'lead-classification');
      if (result?.success && result.data?.length) {
        setLeadChartData(buildModernDoughnutData(
          result.data.map((item) => item.label || 'Unknown'),
          result.data.map((item) => item.count),
        ));
      } else {
        setLeadChartData(null);
      }
    } catch (error) {
      console.error('Error fetching lead classification:', error);
    }
  };

  const fetchQueryTypeDistribution = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const response = await fetch(`${API_BASE_URL}/api/reports/query-type-distribution?${queryParams}`);
      const result = await parseReportApiResponse(response, 'query-type-distribution');
      if (result?.success && result.data?.length) {
        setQueryTypeData(buildColoredDoughnutData(
          result.data.map((item) => item.label || 'Unclassified'),
          result.data.map((item) => item.count),
          result.data.map((item) => item.color),
        ));
      } else {
        setQueryTypeData(null);
      }
    } catch (error) {
      console.error('Error fetching query-type distribution:', error);
    }
  };

  const fetchEscalationSummary = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const response = await fetch(`${API_BASE_URL}/api/reports/escalation-summary?${queryParams}`);
      const result = await parseReportApiResponse(response, 'escalation-summary');
      if (result?.success && result.data) {
        setEscalationData(result.data.totals || null);
        const cats = result.data.byCategory || [];
        setEscalationDonut(cats.length
          ? buildModernDoughnutData(cats.map((c) => c.label), cats.map((c) => c.count))
          : null);
      } else {
        setEscalationData(null);
        setEscalationDonut(null);
      }
    } catch (error) {
      console.error('Error fetching escalation summary:', error);
    }
  };

  const fetchLoanLeads = async (f = filtersRef.current) => {
    try {
      const queryParams = new URLSearchParams();
      if (f.fromDate) queryParams.append('fromDate', f.fromDate);
      if (f.toDate) queryParams.append('toDate', f.toDate);
      stampReportFilters(queryParams, f);
      const { totals, donutData } = await fetchLoanLeadsReport(queryParams.toString());
      setLoanLeadData(totals);
      setLoanTypeDonut(donutData);
    } catch (error) {
      console.error('Error fetching loan leads:', error);
      setLoanLeadData(null);
      setLoanTypeDonut(null);
    }
  };

  const fetchAuditMetrics = async () => {
    setAuditMetricsLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/audits/team/summary`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success) {
          setAuditMetrics(data);
        }
      }
    } catch { /* audit metrics optional */ }
    finally { setAuditMetricsLoading(false); }
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
      const resp = await fetch(`${API_BASE_URL}/api/audits/team/list?${queryParams}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success) {
          setAuditActivity(data.audits || []);
        } else {
          setAuditActivity([]);
        }
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
      const resp = await fetch(`${API_BASE_URL}/api/audits/team/export`);
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
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

      const response = await fetch(`${API_BASE_URL}/api/reports/call-resolution-status?${queryParams}`);
      const result = await parseReportApiResponse(response, 'call-resolution-status');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/agent-performance-metrics?${queryParams}`);
      const result = await parseReportApiResponse(response, 'agent-performance-metrics');
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

      const response = await fetch(`${API_BASE_URL}/api/reports/agent-handling-summary?${queryParams}`);
      const result = await parseReportApiResponse(response, 'agent-handling-summary');
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
    { key: 'avgHandlingTime', label: 'Avg time' },
    { key: 'avgAIScore', label: 'AI score' },
    { key: 'avgManualScore', label: 'Manual score' },
    { key: 'satisfaction', label: 'Resolution' },
  ]), []);

  const formatDelta = (value, suffix = '%') => {
    const n = Number(value) || 0;
    const sign = n > 0 ? '+' : '';
    return `${sign}${Math.round(n * 10) / 10}${suffix}`;
  };

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
        <div className="auth-alert auth-alert--error">{error}</div>
      )}

      {loading && (
        <div className="reports-loading reports-loading--inline">
          <Spinner />
          <p>Updating analytics…</p>
        </div>
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
