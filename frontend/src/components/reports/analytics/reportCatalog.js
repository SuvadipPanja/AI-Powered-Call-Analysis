import { downloadCollectionsQualityReport, exportReportCsv, getCollectionsAgentPerformance, getEscalationSummary, getHoldSummary, getLoanLeads, getQueryTypeDistribution } from "../../../services/reportsService";
import { exportTeamAudits } from "../../../services/uploadService";
import { parseCsvText, recordsFromObjects } from "../../../utils/reportPreviewParse";
import { resolveDashboardDateRange } from "../../../utils/dashboardFilters";
import { qualityWorkbookCacheKey, takeQualityWorkbookWork } from "../../../utils/qualityWorkbookCache";

const QUALITY_SHEETS = [
  "Summary",
  "Associate Wise Performance",
  "Pareto Analysis",
  "Fatal Error Summary",
  "Audit Sheet",
];

export function qualityReportFilename(fromDate, toDate) {
  const stamp = fromDate && toDate
    ? `${fromDate}_to_${toDate}`
    : new Date().toISOString().slice(0, 10);
  return `ICICI_HFC_Quality_Report_${stamp}.xlsx`;
}

export function qualityReportQuery(filters) {
  const resolved = filters?.fromDate && filters?.toDate
    ? { fromDate: filters.fromDate, toDate: filters.toDate }
    : resolveDashboardDateRange(filters || {});
  const params = {};
  if (resolved.fromDate) params.fromDate = resolved.fromDate;
  if (resolved.toDate) params.toDate = resolved.toDate;
  if (filters?.location && filters.location !== "All") params.location = filters.location;
  const tl = filters?.tl || filters?.supervisor;
  if (tl && tl !== "All") params.tl = tl;
  if (filters?.agent && filters.agent !== "All") params.agent = filters.agent;
  if (filters?.callType && filters.callType !== "All") params.callType = filters.callType;
  return params;
}

function auditQuery(filters) {
  const params = new URLSearchParams();
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.location && filters.location !== "All") params.set("location", filters.location);
  if (filters.supervisor && filters.supervisor !== "All") params.set("supervisor", filters.supervisor);
  return params;
}

function reportQuery(filters) {
  const params = {};
  if (filters.fromDate) params.fromDate = filters.fromDate;
  if (filters.toDate) params.toDate = filters.toDate;
  if (filters.location && filters.location !== "All") params.location = filters.location;
  if (filters.supervisor && filters.supervisor !== "All") params.supervisor = filters.supervisor;
  if (filters.agent && filters.agent !== "All") params.agent = filters.agent;
  return params;
}

async function previewFromCsvBlob(blob) {
  const text = await blob.text();
  const parsed = parseCsvText(text);
  return { ...parsed, rawBlob: blob, rawKind: "csv" };
}

export function previewQualityWorkbook(filters) {
  const params = qualityReportQuery(filters);
  return {
    columns: ["Sheet"],
    rows: QUALITY_SHEETS.map((name) => ({ Sheet: name })),
    sheetNames: QUALITY_SHEETS,
    officialFilename: qualityReportFilename(params.fromDate, params.toDate),
    keepOriginal: true,
    formats: ["xlsx"],
    deferOfficialDownload: true,
  };
}

export async function downloadOfficialQualityWorkbook(filters, username) {
  const params = qualityReportQuery(filters);
  const filename = qualityReportFilename(params.fromDate, params.toDate);
  const key = qualityWorkbookCacheKey(username, params);
  const result = await takeQualityWorkbookWork(key, () => downloadCollectionsQualityReport(params));
  return { blob: result.blob, filename, fromCache: result.cached };
}

export async function fetchCallwise(filters, buildBulkExportBody, { collections = false } = {}) {
  return previewFromCsvBlob(await exportReportCsv("/api/reports/download-callwise", {
    ...buildBulkExportBody("all"),
    callType: "all",
    ...(collections ? { mode: "collections" } : {}),
  }));
}

export async function fetchInbound(filters, buildBulkExportBody) {
  return previewFromCsvBlob(await exportReportCsv("/api/reports/download-inbound", buildBulkExportBody()));
}

export async function fetchOutbound(filters, buildBulkExportBody) {
  return previewFromCsvBlob(await exportReportCsv("/api/reports/download-outbound", buildBulkExportBody()));
}

export async function fetchAgentwise(filters, buildBulkExportBody) {
  return previewFromCsvBlob(await exportReportCsv("/api/reports/download-agentwise", buildBulkExportBody()));
}

export async function fetchAuditSheet(filters) {
  return previewFromCsvBlob(await exportTeamAudits(auditQuery(filters).toString()));
}

export async function fetchEscalations(filters) {
  const result = await getEscalationSummary(reportQuery(filters));
  const totals = result?.data?.totals || result?.totals || {};
  const byCategory = result?.data?.byCategory || result?.byCategory || [];
  const rows = [
    { Metric: "Senior requests", Value: totals.requested ?? totals.total ?? 0 },
    { Metric: "Actioned", Value: totals.actioned ?? 0 },
    { Metric: "Not actioned", Value: totals.notActioned ?? 0 },
    { Metric: "C-SAT transferred", Value: totals.csatTransferred ?? 0 },
    ...byCategory.map((item) => ({ Metric: item.label || item.name, Value: item.count ?? 0 })),
  ];
  return recordsFromObjects(rows);
}

export async function fetchHoldTime(filters) {
  const result = await getHoldSummary(reportQuery(filters));
  const data = result?.data?.totals || result?.data || result || {};
  return recordsFromObjects([{
    TotalHoldSec: data.totalHoldSec ?? data.totalHold ?? "",
    AvgHoldSec: data.avgHoldSec ?? "",
    MaxHoldSec: data.maxHoldSec ?? data.longestHoldSec ?? "",
    CallsWithHold: data.callsWithHold ?? data.withHold ?? "",
  }]);
}

export async function fetchAgentScorecard(filters) {
  const result = await getCollectionsAgentPerformance(reportQuery(filters));
  const agents = result?.agents || [];
  return recordsFromObjects(agents.map((a) => ({
    Agent: a.name,
    EmpId: a.empId,
    TL: a.tl,
    Audits: a.auditCount,
    Quality: a.avgQuality,
    Grade: a.grade,
    PtpRate: a.ptpRate,
    Fatal: a.fatalCount,
    RedAlert: a.redAlertCount,
    TopDisposition: a.topDisposition,
  })));
}

export async function fetchQueryTypes(filters) {
  const result = await getQueryTypeDistribution(reportQuery(filters));
  const rows = result?.data || result?.rows || [];
  return recordsFromObjects(rows.map((item) => ({
    QueryType: item.label || item.name || item.queryType,
    Count: item.count ?? item.value ?? 0,
  })));
}

export async function fetchLoanDetails(filters) {
  const params = new URLSearchParams();
  Object.entries(reportQuery(filters)).forEach(([k, v]) => params.set(k, v));
  const result = await getLoanLeads(params.toString());
  const byType = result?.data?.byLoanType || [];
  const totals = result?.data?.totals || {};
  const rows = [
    { Metric: "Loan calls", Value: totals.loanCalls ?? "" },
    ...byType.map((item) => ({ Metric: item.label, Value: item.count })),
  ];
  return recordsFromObjects(rows);
}

export function listReportCards({ isCollections }) {
  const cards = [
    isCollections && {
      key: "quality",
      title: "Quality workbook",
      format: "XLSX",
      description: "Official ICICI HFC multi-sheet workbook (Summary, Associate Wise, Pareto, Fatal, Audit Sheet).",
      instantPreview: true,
      fetch: (filters) => previewQualityWorkbook(filters),
    },
    {
      key: "callwise",
      title: "Call-wise extract",
      format: "CSV",
      description: isCollections
        ? "One row per collections-scored call: quality, campaign, fatal, PTP, red-alert, and disposition."
        : "One row per processed call, including parameter scores.",
      fetch: (filters, buildBody) => fetchCallwise(filters, buildBody, { collections: isCollections }),
    },
    !isCollections && {
      key: "inbound",
      title: "Inbound extract",
      format: "CSV",
      description: "Inbound calls matching the current filters.",
      fetch: (filters, buildBody) => fetchInbound(filters, buildBody),
    },
    !isCollections && {
      key: "outbound",
      title: "Outbound extract",
      format: "CSV",
      description: "Outbound calls matching the current filters.",
      fetch: (filters, buildBody) => fetchOutbound(filters, buildBody),
    },
    !isCollections && {
      key: "audit",
      title: "Audit sheet",
      format: "CSV",
      description: "Manual audit rows with every parameter score for the selected range.",
      fetch: (filters) => fetchAuditSheet(filters),
    },
    !isCollections && {
      key: "agentwise",
      title: "Agent-wise extract",
      format: "CSV",
      description: "Per-agent scores and handling for the selected range.",
      fetch: (filters, buildBody) => fetchAgentwise(filters, buildBody),
    },
    {
      key: "escalations",
      title: "Escalations",
      format: "CSV",
      description: "Senior requests, actioned, not actioned, and category mix.",
      fetch: (filters) => fetchEscalations(filters),
    },
    {
      key: "hold",
      title: "Hold time",
      format: "CSV",
      description: "Hold totals, averages, and calls with hold in this range.",
      fetch: (filters) => fetchHoldTime(filters),
    },
    !isCollections && {
      key: "query",
      title: "Query types",
      format: "CSV",
      description: "Customer query-type mix for the selected timeline.",
      fetch: (filters) => fetchQueryTypes(filters),
    },
    !isCollections && {
      key: "loan",
      title: "Loan details",
      format: "CSV",
      description: "Loan-lead counts and type mix for the selected range.",
      fetch: (filters) => fetchLoanDetails(filters),
    },
  ];
  return cards.filter(Boolean);
}
