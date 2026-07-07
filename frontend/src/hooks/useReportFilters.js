import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { listTeamLeaders, listAgentsDropdown } from "../services/dropdownsService";
import useLocations from "./useLocations";
import {
  DEFAULT_DASHBOARD_FILTERS,
  buildResolvedFilters,
  buildDashboardQueryParams,
  isDefaultDashboardFilters,
  validateFilterDateRange,
} from "../utils/dashboardFilters";

/**
 * Shared report/dashboard filter state for KuberPageHero + API query building.
 *
 * mode:
 * - manual — user clicks Apply (dashboard); exposes appliedFilters after apply/reset
 * - auto — debounced commit when UI filters change (reports page)
 */
export default function useReportFilters({
  defaultDateRange = DEFAULT_DASHBOARD_FILTERS.dateRange,
  mode = "manual",
  maxRangeDays = null,
  autoDebounceMs = 80,
  autoDebounceCustomMs = 350,
  onAutoApply,
} = {}) {
  const { locations: locationListRaw, loading: locationsLoading } = useLocations();
  const locationList = useMemo(
    () => locationListRaw.filter((loc) => loc && loc !== "All"),
    [locationListRaw],
  );

  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [customFromDate, setCustomFromDate] = useState(null);
  const [customToDate, setCustomToDate] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [selectedTL, setSelectedTL] = useState("All");
  const [selectedCallType, setSelectedCallType] = useState("All");
  const [selectedAgent, setSelectedAgent] = useState("All");

  const [tlList, setTlList] = useState([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [agentList, setAgentList] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

  const [appliedFilters, setAppliedFilters] = useState(() => ({
    ...DEFAULT_DASHBOARD_FILTERS,
    dateRange: defaultDateRange,
  }));
  const [isFilterApplied, setIsFilterApplied] = useState(false);
  const [filterError, setFilterError] = useState("");

  const initialResolved = useMemo(
    () => buildResolvedFilters({ dateRange: defaultDateRange }),
    [defaultDateRange],
  );
  const [committedFilters, setCommittedFilters] = useState(initialResolved);
  const filtersRef = useRef(initialResolved);

  const filtersReady = dateRange !== "Custom" || (customFromDate && customToDate);

  const activeFilters = useMemo(
    () => buildResolvedFilters({
      dateRange,
      customFromDate,
      customToDate,
      location: selectedLocation,
      tl: selectedTL,
      callType: selectedCallType,
      agent: selectedAgent,
    }),
    [
      dateRange,
      customFromDate,
      customToDate,
      selectedLocation,
      selectedTL,
      selectedCallType,
      selectedAgent,
    ],
  );

  const fetchTlList = useCallback(async (location) => {
    setTlLoading(true);
    try {
      const teamLeaders = await listTeamLeaders(
        location && location !== "All" ? { location } : {},
      );
      setTlList(teamLeaders);
    } catch (err) {
      console.error("[useReportFilters] team leaders:", err);
      setTlList([]);
    } finally {
      setTlLoading(false);
    }
  }, []);

  const fetchAgentList = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const names = await listAgentsDropdown();
      setAgentList(names);
    } catch (err) {
      console.error("[useReportFilters] agents:", err);
      setAgentList([]);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentList();
  }, [fetchAgentList]);

  useEffect(() => {
    fetchTlList(selectedLocation);
    setSelectedTL("All");
  }, [selectedLocation, fetchTlList]);

  const buildDashboardPayload = useCallback(() => ({
    location: selectedLocation,
    tl: selectedTL,
    callType: selectedCallType,
    agent: selectedAgent,
    dateRange,
    customFromDate,
    customToDate,
  }), [
    selectedLocation,
    selectedTL,
    selectedCallType,
    selectedAgent,
    dateRange,
    customFromDate,
    customToDate,
  ]);

  const applyFilters = useCallback(() => {
    const validation = validateFilterDateRange({
      dateRange,
      customFromDate,
      customToDate,
      maxRangeDays,
    });
    if (!validation.ok) {
      setFilterError(validation.error);
      return { ok: false, error: validation.error };
    }

    setFilterError("");
    const payload = buildDashboardPayload();
    const resolved = buildResolvedFilters(payload);

    setAppliedFilters(payload);
    setIsFilterApplied(!isDefaultDashboardFilters(payload));
    setCommittedFilters(resolved);
    filtersRef.current = resolved;

    return { ok: true, filters: payload, resolved };
  }, [
    dateRange,
    customFromDate,
    customToDate,
    maxRangeDays,
    buildDashboardPayload,
  ]);

  const resetFilters = useCallback(() => {
    setDateRange(defaultDateRange);
    setCustomFromDate(null);
    setCustomToDate(null);
    setSelectedLocation("All");
    setSelectedTL("All");
    setSelectedCallType("All");
    setSelectedAgent("All");
    setFilterError("");

    const payload = {
      ...DEFAULT_DASHBOARD_FILTERS,
      dateRange: defaultDateRange,
    };
    const resolved = buildResolvedFilters(payload);

    setAppliedFilters(payload);
    setIsFilterApplied(false);
    setCommittedFilters(resolved);
    filtersRef.current = resolved;

    return { ok: true, filters: payload, resolved };
  }, [defaultDateRange]);

  useEffect(() => {
    if (mode !== "auto" || !filtersReady) return undefined;

    const validation = validateFilterDateRange({
      dateRange,
      customFromDate,
      customToDate,
      maxRangeDays,
    });
    if (!validation.ok) return undefined;

    const delay = dateRange === "Custom" ? autoDebounceCustomMs : autoDebounceMs;
    const timer = setTimeout(() => {
      setCommittedFilters(activeFilters);
      filtersRef.current = activeFilters;
      onAutoApply?.(activeFilters);
    }, delay);

    return () => clearTimeout(timer);
  }, [
    mode,
    filtersReady,
    activeFilters,
    dateRange,
    customFromDate,
    customToDate,
    maxRangeDays,
    autoDebounceMs,
    autoDebounceCustomMs,
    onAutoApply,
  ]);

  const kuberHeroProps = useMemo(() => ({
    dateRange,
    customFromDate,
    customToDate,
    locationList,
    tlList,
    agentList,
    selectedLocation,
    selectedTL,
    selectedCallType,
    selectedAgent,
    tlLoading,
    agentsLoading,
    locationsLoading,
    onLocationChange: setSelectedLocation,
    onTlChange: setSelectedTL,
    onCallTypeChange: setSelectedCallType,
    onAgentChange: setSelectedAgent,
    onDateRangeChange: setDateRange,
    onCustomFromChange: setCustomFromDate,
    onCustomToChange: setCustomToDate,
  }), [
    dateRange,
    customFromDate,
    customToDate,
    locationList,
    tlList,
    agentList,
    selectedLocation,
    selectedTL,
    selectedCallType,
    selectedAgent,
    tlLoading,
    agentsLoading,
    locationsLoading,
  ]);

  const toQueryString = useCallback(
    (filters) => buildDashboardQueryParams(filters ?? buildDashboardPayload()),
    [buildDashboardPayload],
  );

  return {
    locationList,
    locationsLoading,
    tlList,
    agentList,
    tlLoading,
    agentsLoading,
    dateRange,
    customFromDate,
    customToDate,
    selectedLocation,
    selectedTL,
    selectedCallType,
    selectedAgent,
    setDateRange,
    setCustomFromDate,
    setCustomToDate,
    setSelectedLocation,
    setSelectedTL,
    setSelectedCallType,
    setSelectedAgent,
    activeFilters,
    appliedFilters,
    isFilterApplied,
    filters: committedFilters,
    filtersRef,
    filtersReady,
    filterError,
    setFilterError,
    applyFilters,
    resetFilters,
    kuberHeroProps,
    toQueryString,
  };
}
