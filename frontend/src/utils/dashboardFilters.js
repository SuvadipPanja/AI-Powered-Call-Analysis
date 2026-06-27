/** Resolve dashboard filter state into API query dates (YYYY-MM-DD). */
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveDashboardDateRange(filters) {
  const now = new Date();

  if (filters?.dateRange === "Custom" && filters.customFromDate && filters.customToDate) {
    const start = new Date(filters.customFromDate);
    start.setHours(0, 0, 0, 0);
    const customEnd = new Date(filters.customToDate);
    customEnd.setHours(23, 59, 59, 999);
    const cappedEnd = customEnd > now ? now : customEnd;
    return { fromDate: formatDate(start), toDate: formatDate(cappedEnd) };
  }

  const end = new Date(now);
  let start = new Date(now);
  switch (filters?.dateRange) {
    case "Today":
      start.setHours(0, 0, 0, 0);
      break;
    case "1 Week":
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case "1 Month":
    default:
      start.setMonth(start.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { fromDate: formatDate(start), toDate: formatDate(now) };
}

export function buildDashboardQueryParams(filters) {
  const { fromDate, toDate } = resolveDashboardDateRange(filters);
  const params = new URLSearchParams({
    fromDate,
    toDate,
    location: filters?.location || "All",
    tl: filters?.tl || "All",
  });
  if (filters?.callType && filters.callType !== "All") {
    params.set("callType", filters.callType.toLowerCase());
  }
  if (filters?.agent && filters.agent !== "All") {
    params.set("agent", filters.agent);
  }
  return params.toString();
}

/** Append shared report filters to URLSearchParams. */
export function appendReportFilters(params, filters = {}) {
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.location && filters.location !== "All") params.set("location", filters.location);
  const supervisor = filters.supervisor ?? filters.tl;
  if (supervisor && supervisor !== "All") params.set("supervisor", supervisor);
  if (filters.callType && filters.callType !== "All") {
    params.set("callType", filters.callType.toLowerCase());
  }
  if (filters.agent && filters.agent !== "All") params.set("agent", filters.agent);
  return params;
}

export const DEFAULT_DASHBOARD_FILTERS = {
  location: "All",
  tl: "All",
  callType: "All",
  agent: "All",
  dateRange: "1 Month",
  customFromDate: null,
  customToDate: null,
};

/** Build API-ready filters from hero UI state (includes resolved dates + tl/supervisor aliases). */
export function buildResolvedFilters({
  dateRange = "1 Month",
  customFromDate = null,
  customToDate = null,
  location = "All",
  tl = "All",
  supervisor,
  callType = "All",
  agent = "All",
} = {}) {
  const { fromDate, toDate } = resolveDashboardDateRange({
    dateRange,
    customFromDate,
    customToDate,
  });
  const lead = supervisor ?? tl ?? "All";
  return {
    fromDate,
    toDate,
    location,
    tl: lead,
    supervisor: lead,
    callType,
    agent,
    dateRange,
    customFromDate,
    customToDate,
  };
}

export function isDefaultDashboardFilters(filters) {
  const f = filters || {};
  return (
    (f.location || "All") === "All"
    && (f.tl || "All") === "All"
    && (f.callType || "All") === "All"
    && (f.agent || "All") === "All"
    && (f.dateRange || "1 Month") === "1 Month"
    && !f.customFromDate
    && !f.customToDate
  );
}

export function validateFilterDateRange({
  dateRange,
  customFromDate,
  customToDate,
  maxRangeDays = null,
} = {}) {
  if (dateRange === "Custom") {
    if (!customFromDate || !customToDate) {
      return { ok: false, error: "Please select both From and To dates for a custom range." };
    }
    if (customToDate < customFromDate) {
      return { ok: false, error: "To Date must be after From Date." };
    }
  }
  const { fromDate, toDate } = resolveDashboardDateRange({
    dateRange,
    customFromDate,
    customToDate,
  });
  if (maxRangeDays != null) {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const days = Math.ceil(Math.abs(to - from) / (1000 * 60 * 60 * 24));
    if (days > maxRangeDays) {
      return { ok: false, error: `Date range cannot exceed ${maxRangeDays} days. Please select a shorter period.` };
    }
  }
  return { ok: true, fromDate, toDate };
}
