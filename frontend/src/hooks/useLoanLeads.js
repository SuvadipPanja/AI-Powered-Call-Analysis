import { useState, useEffect, useCallback } from "react";
import { fetchLoanLeadsReport } from "../utils/loanLeadsData";

/**
 * Fetch loan-leads report for a pre-built query string (from buildDashboardQueryParams, etc.).
 */
export default function useLoanLeads(queryString, { enabled = true } = {}) {
  const [totals, setTotals] = useState(null);
  const [donutData, setDonutData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!enabled || !queryString) {
      setTotals(null);
      setDonutData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { totals: t, donutData: d } = await fetchLoanLeadsReport(queryString);
      setTotals(t);
      setDonutData(d);
    } catch (err) {
      console.error("[useLoanLeads]", err);
      setError(err);
      setTotals(null);
      setDonutData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { totals, donutData, loading, error, refetch };
}
