import { useCallback, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import useReportFilters from "./useReportFilters";
import useDashboardMetrics from "./useDashboardMetrics";
import useDashboardCharts from "./useDashboardCharts";
import { DEFAULT_DASHBOARD_FILTERS } from "../utils/dashboardFilters";

/**
 * Composite hook for the main admin dashboard: filters + KPI metrics + insight charts.
 */
export default function useDashboard({
  autoLoad = true,
  defaultDateRange,
  ...filterOptions
} = {}) {
  const { isLoggedIn, isValidatingSession, initializationComplete } = useAuth();
  // Don't fetch until the session is restored/validated: the dashboard can
  // mount before auth is ready (fresh login, app boot), and a mount-only fetch
  // would 401 and leave the page empty until a manual refresh.
  const authReady = isLoggedIn && initializationComplete && !isValidatingSession;
  const reportFilters = useReportFilters({
    mode: "manual",
    defaultDateRange,
    ...filterOptions,
  });

  const metrics = useDashboardMetrics();
  const charts = useDashboardCharts();
  const { fetchMetrics } = metrics;
  const { fetchCharts } = charts;

  const refreshAll = useCallback((filters) => {
    fetchMetrics(filters);
    fetchCharts(filters);
  }, [fetchMetrics, fetchCharts]);

  const applyAndRefresh = useCallback(() => {
    const result = reportFilters.applyFilters();
    if (result.ok) refreshAll(result.filters);
    return result;
  }, [reportFilters, refreshAll]);

  const resetAndRefresh = useCallback(() => {
    const result = reportFilters.resetFilters();
    refreshAll(result.filters);
    return result;
  }, [reportFilters, refreshAll]);

  useEffect(() => {
    if (!autoLoad || !authReady) return;
    refreshAll(DEFAULT_DASHBOARD_FILTERS);
  }, [autoLoad, authReady, refreshAll]);

  return useMemo(() => ({
    ...reportFilters,
    metrics,
    charts,
    refreshAll,
    applyAndRefresh,
    resetAndRefresh,
  }), [reportFilters, metrics, charts, refreshAll, applyAndRefresh, resetAndRefresh]);
}
