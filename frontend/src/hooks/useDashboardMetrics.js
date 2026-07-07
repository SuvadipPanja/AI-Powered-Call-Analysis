import { useState, useCallback, useMemo } from "react";
import { resolveDashboardDateRange, buildDashboardQueryParams } from "../utils/dashboardFilters";
import { getMetricsOverview } from "../services/reportsService";
import {
  buildKpiStats,
  computeKpiComparison,
  formatKpiDelta,
} from "../utils/dashboardKpiUtils";

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
      const data = await getMetricsOverview(buildDashboardQueryParams(filters));

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
        const prevData = await getMetricsOverview(prevQs);
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

  const kpiStats = useMemo(() => buildKpiStats({
    totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScoring,
    avgManualScoring,
    aht,
  }), [
    totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScoring,
    avgManualScoring,
    aht,
  ]);

  const kpiComparison = useMemo(() => computeKpiComparison(
    {
      totalCallsProcessed,
      successCount,
      failedCount,
      avgAiScoring,
      avgManualScoring,
      aht,
    },
    prevPeriodData,
  ), [
    totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScoring,
    avgManualScoring,
    aht,
    prevPeriodData,
  ]);

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
    successRate: kpiStats.successRate,
    kpiStats,
    kpiComparison,
    formatDelta: formatKpiDelta,
    isNoData,
  };
}
