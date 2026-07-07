import { useState, useCallback } from "react";
import { buildDashboardQueryParams } from "../utils/dashboardFilters";
import {
  getToneSentimentSummary,
  getAgentWiseAiScoring,
  getQueryTypeDistribution,
  getEscalationSummary,
  getLoanLeads,
  getHoldSummary,
} from "../services/reportsService";
import {
  mapToneSentimentChart,
  mapAgentWiseChart,
  mapQueryTypeChart,
  mapEscalationTotals,
  mapLoanLeadsChart,
  mapHoldReport,
} from "../utils/dashboardChartMappers";

/**
 * Fetches insight chart data for the main dashboard (tone, agent scores, query types, etc.).
 */
export default function useDashboardCharts() {
  const [toneData, setToneData] = useState(null);
  const [agentWiseData, setAgentWiseData] = useState(null);
  const [queryTypeData, setQueryTypeData] = useState(null);
  const [escalationTotals, setEscalationTotals] = useState(null);
  const [loanLeadData, setLoanLeadData] = useState(null);
  const [loanTypeData, setLoanTypeData] = useState(null);
  const [holdTotals, setHoldTotals] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchCharts = useCallback(async (filters) => {
    const qs = buildDashboardQueryParams(filters);
    setLoading(true);
    try {
      const [toneRes, agentRes, queryRes, escalationRes, loanRes, holdRes] = await Promise.all([
        getToneSentimentSummary(qs),
        getAgentWiseAiScoring(qs),
        getQueryTypeDistribution(qs),
        getEscalationSummary(qs),
        getLoanLeads(qs),
        getHoldSummary(qs),
      ]);
      setToneData(mapToneSentimentChart(toneRes));
      setAgentWiseData(mapAgentWiseChart(agentRes));
      setQueryTypeData(mapQueryTypeChart(queryRes));
      setEscalationTotals(mapEscalationTotals(escalationRes));
      const { totals, donutData } = mapLoanLeadsChart(loanRes);
      setLoanLeadData(totals);
      setLoanTypeData(donutData);
      setHoldTotals(mapHoldReport(holdRes));
    } catch (err) {
      console.error("[useDashboardCharts]", err);
      setToneData(null);
      setAgentWiseData(null);
      setQueryTypeData(null);
      setEscalationTotals(null);
      setLoanLeadData(null);
      setLoanTypeData(null);
      setHoldTotals(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    toneData,
    agentWiseData,
    queryTypeData,
    escalationTotals,
    loanLeadData,
    loanTypeData,
    holdTotals,
    loading,
    fetchCharts,
  };
}
