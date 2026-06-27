import { useState, useCallback, useMemo } from "react";
import { resolveDashboardDateRange, buildDashboardQueryParams } from "../utils/dashboardFilters";
import { apiGetQuery } from "../utils/apiHelpers";

const EMPTY_PREV = {
  totalCallsProcessed: 0,
  avgAiScoring: 0,
  avgManualScoring: 0,
  aht: 0,
  successCount: 0,
  failedCount: 0,
};

/**
 * Fetches /api/metrics-overview for current + previous period (dashboard KPI strip).
 */
export default function useDashboardMetrics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const [totalCallsProcessed, setTotalCallsProcessed] = useState(0);
  const [avgAiScoring, setAvgAiScoring] = useState(0);
  const [avgManualScoring, setAvgManualScoring] = useState(0);
  const [aht, setAht] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [prevPeriodData, setPrevPeriodData] = useState(EMPTY_PREV);

  const resetMetrics = useCallback(() => {
    setTotalCallsProcessed(0);
    setAvgAiScoring(0);
    setAvgManualScoring(0);
    setAht(0);
    setSuccessCount(0);
    setFailedCount(0);
    setPrevPeriodData(EMPTY_PREV);
  }, []);

  const fetchMetrics = useCallback(async (filters, retryCount = 0) => {
    const maxRetries = 3;
    setLoading(true);
    setError(null);
    setFetchFailed(false);

    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const { fromDate, toDate } = resolveDashboardDateRange(filters);

      if (fromDate > todayStr || toDate > todayStr) {
        throw new Error("Selected date range cannot be in the future.");
      }

      const startDate = new Date(fromDate);
      const endDate = new Date(toDate);
      const qs = buildDashboardQueryParams(filters);
      const data = await apiGetQuery("/api/metrics-overview", qs, { label: "metrics-overview" });

      if (!data.success) {
        setFetchFailed(true);
        setError(data.message || "Failed to fetch metrics data. Please try again.");
        resetMetrics();
        return;
      }

      setTotalCallsProcessed(data.totalCallsProcessed || 0);
      setAvgAiScoring(data.avgAiScoring || 0);
      setAvgManualScoring(data.avgManualScoring || 0);
      setAht(data.aht || 0);
      setSuccessCount(data.successCount || 0);
      setFailedCount(data.failedCount || 0);

      const daysDiff = Math.max(1, (endDate - startDate) / (1000 * 60 * 60 * 24));
      const prevStartDate = new Date(startDate);
      const prevEndDate = new Date(endDate);
      prevStartDate.setDate(prevStartDate.getDate() - daysDiff - 1);
      prevEndDate.setDate(prevEndDate.getDate() - daysDiff - 1);

      const prevQs = buildDashboardQueryParams({
        ...filters,
        dateRange: "Custom",
        customFromDate: prevStartDate,
        customToDate: prevEndDate,
      });

      try {
        const prevData = await apiGetQuery("/api/metrics-overview", prevQs, { label: "metrics-overview-prev" });
        if (prevData.success) {
          setPrevPeriodData({
            totalCallsProcessed: prevData.totalCallsProcessed || 0,
            avgAiScoring: prevData.avgAiScoring || 0,
            avgManualScoring: prevData.avgManualScoring || 0,
            aht: prevData.aht || 0,
            successCount: prevData.successCount || 0,
            failedCount: prevData.failedCount || 0,
          });
        } else {
          setPrevPeriodData(EMPTY_PREV);
          setError("No previous period data available for the selected date range. Displaying current data.");
        }
      } catch {
        setPrevPeriodData(EMPTY_PREV);
      }
    } catch (err) {
      console.error("[useDashboardMetrics]", err);
      if (retryCount < maxRetries && String(err.message).includes("HTTP")) {
        setTimeout(() => fetchMetrics(filters, retryCount + 1), 2000);
        return;
      }
      resetMetrics();
      setFetchFailed(true);
      setError(
        String(err.message).includes("HTTP")
          ? "Failed to fetch metrics due to a server error. Please try again later."
          : `An error occurred while fetching metrics: ${err.message}`,
      );
    } finally {
      if (retryCount === 0) setLoading(false);
    }
  }, [resetMetrics]);

  const successRate = totalCallsProcessed > 0
    ? ((successCount / totalCallsProcessed) * 100).toFixed(1)
    : "0.0";

  const kpiStats = useMemo(() => ({
    totalCalls: totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScore: avgAiScoring * 100,
    avgManualScore: avgManualScoring * 100,
    aht,
    successRate,
  }), [
    totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScoring,
    avgManualScoring,
    aht,
    successRate,
  ]);

  const kpiComparison = useMemo(() => {
    const pctChange = (current, previous) => {
      if (current === 0 && previous === 0) return 0;
      return previous !== 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
    };
    const scorePts = (current, previous) => (current - previous) * 100;
    return {
      totalCallsGrowth: pctChange(totalCallsProcessed, prevPeriodData.totalCallsProcessed),
      successGrowth: pctChange(successCount, prevPeriodData.successCount),
      failedGrowth: -pctChange(failedCount, prevPeriodData.failedCount),
      avgAiGrowth: scorePts(avgAiScoring, prevPeriodData.avgAiScoring),
      avgManualGrowth: scorePts(avgManualScoring, prevPeriodData.avgManualScoring),
      ahtGrowth: pctChange(aht, prevPeriodData.aht),
    };
  }, [
    totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScoring,
    avgManualScoring,
    aht,
    prevPeriodData,
  ]);

  const formatDelta = useCallback((value, suffix = "%") => {
    const n = Number(value) || 0;
    const sign = n > 0 ? "+" : "";
    return `${sign}${Math.round(n * 10) / 10}${suffix}`;
  }, []);

  const isNoData = !loading && !error && totalCallsProcessed === 0;

  return {
    loading,
    error,
    fetchFailed,
    totalCallsProcessed,
    avgAiScoring,
    avgManualScoring,
    aht,
    successCount,
    failedCount,
    prevPeriodData,
    fetchMetrics,
    successRate,
    kpiStats,
    kpiComparison,
    formatDelta,
    isNoData,
  };
}
