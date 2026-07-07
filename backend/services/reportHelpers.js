/**
 * Report/dashboard SQL helpers (Sprint 3.1 — extracted from server.js).
 */
const sql = require("../sqlClient");
const { isMissingDbObjectError } = require("../projectPaths");

let writeLog = (msg) => console.log(msg);
let getISTTimeString = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

function initReportHelpers(deps = {}) {
  if (deps.writeLog) writeLog = deps.writeLog;
  if (deps.getISTTimeString) getISTTimeString = deps.getISTTimeString;
}

function normalizeDisplayStatus(processStatus, aiStatus, transcribeOutput) {
  const ps = (processStatus || "").toLowerCase();
  const as = (aiStatus || "").toLowerCase();
  const isStub =
    (transcribeOutput || "").includes("MVP Phase 1 stub") ||
    as.includes("stub") ||
    ps.includes("stub");

  if (ps.includes("error") || ps.includes("failed") || as === "fail" || as === "failed") {
    return "Failed";
  }
  if (as === "success" && !isStub) {
    return "Success";
  }
  if (as === "transcribed" || ps === "transcribed") {
    return "Transcribed";
  }
  if (
    ps === "pending" ||
    ps === "in progress" ||
    ps === "scoring" ||
    ps === "enriching" ||
    as === "in progress" ||
    as === "processing"
  ) {
    return "In Progress";
  }
  if (ps.includes("ai process complete") && as === "success") {
    return "Success";
  }
  if (isStub || as === "uploaded" || ps === "uploaded") {
    return "Uploaded";
  }
  if (ps.includes("complete") && !as) {
    return "Failed";
  }
  return aiStatus || processStatus || "Uploaded";
}

function buildAudioProgressPayload(processStatus, aiStatus, displayStatus, dbStage, dbProgress, dbMessage) {
  if (dbStage && typeof dbProgress === "number") {
    return {
      stage: dbStage,
      progress: Math.max(0, Math.min(100, dbProgress)),
      message: dbMessage || "Processing in progress.",
    };
  }

  const merged = `${displayStatus || ""} ${processStatus || ""} ${aiStatus || ""}`.toLowerCase();
  let stage = "uploaded";
  let progress = 20;
  let message = "Audio received by backend.";

  if (merged.includes("fail") || merged.includes("error")) {
    stage = "failed";
    progress = 100;
    message = "Backend reported a processing failure.";
  } else if (merged.includes("success") || merged.includes("ai process complete")) {
    stage = "complete";
    progress = 100;
    message = "AI analysis completed successfully.";
  } else if (merged.includes("enriching")) {
    stage = "enriching";
    progress = 88;
    message = "Tone, sentiment, and script compliance analysis.";
  } else if (merged.includes("scoring")) {
    stage = "scoring";
    progress = 72;
    message = "AI quality scoring on English transcript.";
  } else if (merged.includes("translating")) {
    stage = "translating";
    progress = 50;
    message = "Translating Hindi transcript to English.";
  } else if (merged.includes("transcribed")) {
    stage = "transcribed";
    progress = 70;
    message = "Transcript is ready; waiting for scoring or final report.";
  } else if (merged.includes("diar") || merged.includes("speaker")) {
    stage = "diarizing";
    progress = 55;
    message = "Speaker diarization is running.";
  } else if (merged.includes("transcrib") || merged.includes("processing") || merged.includes("in progress")) {
    stage = "transcribing";
    progress = 35;
    message = "Speech-to-text processing is running.";
  } else if (merged.includes("pending")) {
    stage = "queued";
    progress = 8;
    message = "Audio is queued for the processing worker.";
  }

  return { stage, progress, message };
}

function buildProcessingSubtasks(stage, overallPercent, includeTranslate = true) {
  const stages = [
    { key: "upload", label: "Upload" },
    { key: "transcribe", label: "Transcription" },
    { key: "translate", label: "Translation" },
    { key: "scoring", label: "AI Scoring" },
    { key: "enrichment", label: "Enrichment" },
    { key: "complete", label: "Report" },
  ].filter((s) => includeTranslate || s.key !== "translate");

  const stageToKey = {
    uploaded: "upload",
    upload: "upload",
    queued: "upload",
    transcribing: "transcribe",
    diarizing: "transcribe",
    translating: "translate",
    transcribed: "scoring",
    scoring: "scoring",
    enriching: "enrichment",
    complete: "complete",
    failed: "complete",
  };
  const currentKey = stageToKey[(stage || "").toLowerCase()] || "upload";
  const currentIndex = stages.findIndex((s) => s.key === currentKey);

  return stages.map((item, idx) => {
    if (idx < currentIndex) {
      return { ...item, percent: 100, status: "done" };
    }
    if (idx === currentIndex) {
      return { ...item, percent: overallPercent, status: "active" };
    }
    return { ...item, percent: 0, status: "pending" };
  });
}

function resolveDisplayAiStatus(processStatus, aiStatus, stage, displayStatus) {
  const ai = (aiStatus || "").trim();
  if (ai && !/^not started$/i.test(ai)) return ai;

  const merged = `${displayStatus || ""} ${processStatus || ""} ${stage || ""}`.toLowerCase();
  const engineRunning =
    ["transcribing", "diarizing", "transcribed", "scoring"].includes(stage) ||
    merged.includes("in progress") ||
    merged.includes("transcrib") ||
    merged.includes("processing") ||
    merged.includes("scoring") ||
    merged.includes("enriching") ||
    merged.includes("diar");

  if (engineRunning) return "Started";
  if (merged.includes("pending") || merged.includes("uploaded") || merged.includes("queued")) return "Waiting";
  return "Not started";
}

const PROCESS_STAGE_LABELS = {
  queued: "Queue",
  uploaded: "Upload",
  transcribing: "Transcription",
  diarizing: "Diarization",
  transcribed: "Scoring",
  scoring: "AI scoring",
  failed: "Processing",
};

function extractFailureDetails(processStatus) {
  const ps = (processStatus || "").trim();
  if (/^failed:/i.test(ps)) {
    const reason = ps.replace(/^failed:\s*/i, "").trim();
    const stage = reason.replace(/\s*timeout$/i, "").trim() || "Unknown";
    return { failureStage: stage, failureReason: reason || ps };
  }
  if (/error/i.test(ps)) {
    return { failureStage: "Error", failureReason: ps };
  }
  return { failureStage: null, failureReason: null };
}

const RUBRIC_NUMERIC_FIELDS = [
  'Overall Scoring', 'Opening Speech', 'Empathy', 'Query Handling', 'Adherence to Protocol',
  'Resolution Assurance', 'Query Resolution', 'Polite Tone', 'Authentication Verification',
  'Escalation Handling', 'Closing Speech',
];

/** Legacy AI rows store rubric dimensions as 0-10; UI/charts expect 0-100. */
function scaleRubricPercent(val) {
  if (val == null || val === '') return val;
  const n = parseFloat(String(val).replace('%', ''));
  if (Number.isNaN(n)) return val;
  if (n <= 0) return val;
  if (n <= 10) return Math.round(n * 10 * 10) / 10;
  return n;
}

/** Normalize AI/manual feedback stored as JSON or Python-style list strings. */
function formatScoringFeedback(val) {
  if (val == null || val === '') return val;
  if (Array.isArray(val)) return val.filter(Boolean).map(String).join(' ');
  const s = String(val).trim();
  if (!s) return s;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String).join(' ');
    if (typeof parsed === 'string') return parsed;
  } catch { /* fall through */ }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return '';
    return inner
      .split(/',\s*'|",\s*"/)
      .map((part) => part.replace(/^['"]|['"]$/g, '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return s;
}

/** Dashboard charts/KPIs filter on upload date so recently ingested calls appear in range. */
function dashboardUploadDateClause(alias = 'AU') {
  return `CAST(${alias}.UploadDate AS DATE) BETWEEN @fromDate AND @toDate`;
}

/** Match calls when either upload date or call date falls in the selected period. */
function dashboardInclusiveDateClause(alias = 'AU') {
  return `(
    CAST(${alias}.UploadDate AS DATE) BETWEEN @fromDate AND @toDate
    OR CAST(COALESCE(${alias}.SelectedCallDate, CAST(${alias}.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
  )`;
}

function dashboardConsolidatedDateClause() {
  return 'CAST(COALESCE(UploadDate, SelectedCallDate) AS DATE) BETWEEN @fromDate AND @toDate';
}

/** Consolidated table date filter — matches upload date OR call date (reports page). */
function consolidatedReportDateBetween(fromParam, toParam, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `CAST(COALESCE(${prefix}UploadDate, ${prefix}SelectedCallDate) AS DATE) BETWEEN ${fromParam} AND ${toParam}`;
}

function consolidatedReportTodayClause(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `CAST(COALESCE(${prefix}UploadDate, ${prefix}SelectedCallDate) AS DATE) = CAST(GETDATE() AS DATE)`;
}

function manualScoringFromCallAudit(audit, scoreRows = []) {
  if (!audit && (!scoreRows || scoreRows.length === 0)) return null;
  const scoring = {};
  for (const s of scoreRows) {
    if (s.ParameterName != null && s.ManualScore != null) {
      scoring[s.ParameterName] = scaleRubricPercent(s.ManualScore);
    }
  }
  if (audit?.OverallManualScore != null) {
    scoring['Overall Scoring'] = scaleRubricPercent(audit.OverallManualScore);
  } else if (scoring['Overall Scoring'] == null) {
    const individualFields = RUBRIC_NUMERIC_FIELDS.filter((k) => k !== 'Overall Scoring');
    const vals = individualFields
      .map((k) => scoring[k])
      .filter((v) => v != null && v !== '' && !Number.isNaN(parseFloat(v)));
    if (vals.length > 0) {
      scoring['Overall Scoring'] = parseFloat((vals.reduce((sum, v) => sum + parseFloat(v), 0) / vals.length).toFixed(2));
    }
  }
  if (audit?.OverallComments) {
    scoring.Feedback = audit.OverallComments;
  }
  return scoring;
}

function mergeManualScoringFromConsolidated(consolidatedManual, auditManual) {
  if (!auditManual || !Object.keys(auditManual).some((k) => auditManual[k] != null && String(auditManual[k]).trim() !== '')) {
    return consolidatedManual;
  }
  const merged = { ...(consolidatedManual || {}) };
  for (const [key, value] of Object.entries(auditManual)) {
    if (value != null && String(value).trim() !== '') merged[key] = value;
  }
  return merged;
}

function mapScoringFields(record, prefix) {
  const scoring = {
    'Overall Scoring': record[`${prefix}_Overall_Scoring`],
    'Opening Speech': record[`${prefix}_Opening_Speech`],
    'Empathy': record[`${prefix}_Empathy`],
    'Query Handling': record[`${prefix}_Query_Handling`],
    'Adherence to Protocol': record[`${prefix}_Adherence_to_Protocol`],
    'Resolution Assurance': record[`${prefix}_Resolution_Assurance`],
    'Query Resolution': record[`${prefix}_Query_Resolution`],
    'Polite Tone': record[`${prefix}_Polite_Tone`],
    'Authentication Verification': record[`${prefix}_Authentication_Verification`],
    'Escalation Handling': record[`${prefix}_Escalation_Handling`],
    'Closing Speech': record[`${prefix}_Closing_Speech`],
    'Rude Behavior': record[`${prefix}_Rude_Behavior`],
    'Call Type': record[`${prefix}_Call_Type`],
    'Lead Classification': record[`${prefix}_Lead_Classification`],
    'Resolution Status': record[`${prefix}_Resolution_Status`],
    'Feedback': formatScoringFeedback(record[`${prefix}_Feedback`]),
  };
  RUBRIC_NUMERIC_FIELDS.forEach((key) => {
    scoring[key] = scaleRubricPercent(scoring[key]);
  });
  if (scoring['Overall Scoring'] == null) {
    const individualFields = RUBRIC_NUMERIC_FIELDS.filter(k => k !== 'Overall Scoring');
    const vals = individualFields.map(k => scoring[k]).filter(v => v != null && v !== '' && !isNaN(parseFloat(v)));
    if (vals.length > 0) {
      scoring['Overall Scoring'] = parseFloat((vals.reduce((s, v) => s + parseFloat(v), 0) / vals.length).toFixed(2));
    }
  }
  return scoring;
}

function isTerminalProcessingStatus(processStatus, aiStatus) {
  const ps = (processStatus || "").toLowerCase();
  const as = (aiStatus || "").toLowerCase();
  if (ps.includes("fail") || ps.includes("error") || as === "fail" || as === "failed") return true;
  if (as === "success") return true;
  return false;
}

function isActiveProcessingStatus(processStatus, aiStatus) {
  if (isTerminalProcessingStatus(processStatus, aiStatus)) return false;
  const ps = (processStatus || "").toLowerCase();
  const as = (aiStatus || "").toLowerCase();
  return (
    ps === "pending" ||
    ps === "in progress" ||
    ps === "transcribed" ||
    ps === "scoring" ||
    ps === "enriching" ||
    ps === "processing" ||
    as === "in progress" ||
    as === "processing" ||
    as === "transcribed"
  );
}

async function markStaleProcessingAsFailed(pool, audioFileName = null) {
  const request = pool.request();
  let fileFilter = "";
  if (audioFileName) {
    request.input("audioFileName", sql.NVarChar, audioFileName);
    fileFilter = " AND AU.AudioFileName = @audioFileName";
  }

  const staleResult = await request.query(`
    SELECT
      AU.AudioFileName,
      AU.ProcessStatus,
      AU.UploadDate,
      APR.Status AS AIStatus,
      APR.TranscribeOutput
    FROM AudioUploads AU
    LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
    WHERE AU.UploadDate < DATEADD(HOUR, -1, GETDATE())${fileFilter}
  `);

  let marked = 0;
  for (const row of staleResult.recordset) {
    if (!isActiveProcessingStatus(row.ProcessStatus, row.AIStatus)) continue;

    const displayStatus = normalizeDisplayStatus(
      row.ProcessStatus,
      row.AIStatus,
      row.TranscribeOutput
    );
    const progress = buildAudioProgressPayload(
      row.ProcessStatus,
      row.AIStatus,
      displayStatus
    );
    const stageLabel = PROCESS_STAGE_LABELS[progress.stage] || progress.stage || "Processing";
    const failStatus = `Failed: ${stageLabel} timeout`.slice(0, 50);

    await pool.request()
      .input("status", sql.NVarChar, failStatus)
      .input("fileName", sql.NVarChar, row.AudioFileName)
      .query(`
        UPDATE AudioUploads
        SET ProcessStatus = @status
        WHERE AudioFileName = @fileName
      `);

    await pool.request()
      .input("fileName", sql.NVarChar, row.AudioFileName)
      .query(`
        IF EXISTS (SELECT 1 FROM AI_Processing_Result WHERE AudioFileName = @fileName)
        BEGIN
          UPDATE AI_Processing_Result
          SET Status = 'Failed', Timestamp = GETDATE()
          WHERE AudioFileName = @fileName
            AND LOWER(COALESCE(Status, '')) NOT IN ('success', 'failed', 'fail')
        END
      `);

    marked += 1;
    writeLog(
      `[${getISTTimeString()}] Marked stale processing as failed: ${row.AudioFileName} (${failStatus})`
    );
  }
  return marked;
}

function mapRecentActivityRow(row) {
  const status = normalizeDisplayStatus(row.ProcessStatus, row.AIStatus, row.TranscribeOutput);
  const { failureStage, failureReason } = extractFailureDetails(row.ProcessStatus);
  const hasAudit = row.AuditID != null && row.AuditID !== "";
  return {
    FileName: row.FileName,
    UploadDate: row.UploadDate,
    Status: status,
    FailureStage: failureStage,
    FailureReason: failureReason,
    HasManualAudit: hasAudit,
    AuditorUsername: hasAudit ? (row.AuditorUsername || null) : null,
    AuditorRole: hasAudit ? (row.AuditorRole || null) : null,
    AuditedAt: hasAudit ? (row.AuditedAt || null) : null,
  };
}

function buildRecentActivityQuery(rowLimit, { withAuditJoin = true } = {}) {
  const auditSelect = withAuditJoin
    ? `,
        CA.AuditID,
        CA.AuditorUsername,
        CA.AuditorRole,
        FORMAT(COALESCE(CA.UpdatedAt, CA.CreatedAt), 'yyyy-MM-dd HH:mm:ss') AS AuditedAt`
    : "";
  const auditJoin = withAuditJoin
    ? " LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = AU.AudioFileName"
    : "";
  return `
      SELECT TOP (${rowLimit})
        AU.AudioFileName AS FileName,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd HH:mm:ss') AS UploadDate,
        AU.ProcessStatus,
        APR.Status AS AIStatus,
        APR.TranscribeOutput${auditSelect}
      FROM AudioUploads AU
      LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName${auditJoin}
    `;
}

/** Parse optional search/filter params for GET /api/recent-activity. */
function parseRecentActivityFilterParams(query = {}) {
  const fileName = String(query.q || query.fileName || "").trim();
  const date = String(query.date || "").trim();
  const agent = String(query.agent || "All").trim();
  const supervisor = String(query.supervisor || query.tl || "All").trim();
  const auditor = String(query.auditor || "All").trim();
  const fromDate = query.fromDate ? String(query.fromDate).trim() : "";
  const toDate = query.toDate ? String(query.toDate).trim() : "";

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }
  if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new Error("Invalid fromDate format. Use YYYY-MM-DD.");
  }
  if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error("Invalid toDate format. Use YYYY-MM-DD.");
  }

  return { fileName, date, agent, supervisor, auditor, fromDate, toDate };
}

function recentActivityWhereConditions(params, { withAuditJoin = true } = {}) {
  const parts = [];
  if (params.fileName) {
    parts.push("AU.AudioFileName LIKE @fileName");
  }
  if (params.date) {
    parts.push("CONVERT(VARCHAR(10), AU.UploadDate, 120) = @date");
  }
  if (params.fromDate && params.toDate) {
    parts.push("AU.UploadDate BETWEEN @startOfDay AND @endOfDay");
  }
  if (params.agent && params.agent !== "All") {
    parts.push("TRIM(LOWER(AU.SelectedAgent)) = TRIM(LOWER(@agent))");
  }
  if (params.supervisor && params.supervisor !== "All") {
    parts.push(
      "EXISTS (SELECT 1 FROM Agents AG2 WHERE AG2.agent_name = AU.SelectedAgent AND TRIM(LOWER(AG2.supervisor)) = TRIM(LOWER(@supervisor)))"
    );
  }
  if (params.auditor && params.auditor !== "All") {
    if (withAuditJoin) {
      parts.push(
        "(TRIM(LOWER(CA.AuditorUsername)) = TRIM(LOWER(@auditor)) OR EXISTS (SELECT 1 FROM Agents AG3 WHERE AG3.agent_name = AU.SelectedAgent AND TRIM(LOWER(AG3.auditor)) = TRIM(LOWER(@auditor))))"
      );
    } else {
      parts.push(
        "EXISTS (SELECT 1 FROM Agents AG3 WHERE AG3.agent_name = AU.SelectedAgent AND TRIM(LOWER(AG3.auditor)) = TRIM(LOWER(@auditor)))"
      );
    }
  }
  return parts;
}

function bindRecentActivityFilters(request, params) {
  if (params.fileName) {
    request.input("fileName", sql.NVarChar, `%${params.fileName}%`);
  }
  if (params.date) {
    request.input("date", sql.VarChar, params.date);
  }
  if (params.fromDate && params.toDate) {
    request.input("startOfDay", sql.DateTime, `${params.fromDate} 00:00:00`);
    request.input("endOfDay", sql.DateTime, `${params.toDate} 23:59:59`);
  }
  if (params.agent && params.agent !== "All") {
    request.input("agent", sql.NVarChar, params.agent);
  }
  if (params.supervisor && params.supervisor !== "All") {
    request.input("supervisor", sql.NVarChar, params.supervisor);
  }
  if (params.auditor && params.auditor !== "All") {
    request.input("auditor", sql.NVarChar, params.auditor);
  }
  return request;
}

function buildRecentActivityFilteredQuery(rowLimit, params, { withAuditJoin = true } = {}) {
  const conditions = recentActivityWhereConditions(params, { withAuditJoin });
  let query = buildRecentActivityQuery(rowLimit, { withAuditJoin });
  if (conditions.length) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += " ORDER BY AU.UploadDate DESC, AU.UploadID DESC;";
  return query;
}

/** Metrics overview SQL — counts all uploads from AudioUploads; averages from Consolidated when available. */
function buildMetricsOverviewQuery({ fromParam, toParam, useFallback, extraConditions }) {
  const where = extraConditions.length
    ? ` AND ${extraConditions.join(" AND ")}`
    : "";

  const dateClause = dashboardInclusiveDateClause('AU').replace(/@fromDate/g, fromParam).replace(/@toDate/g, toParam);

  const successCase = `
    LOWER(COALESCE(APR.Status, '')) = 'success'
    AND COALESCE(APR.TranscribeOutput, '') NOT LIKE '%MVP Phase 1 stub%'
  `;

  const failedCase = useFallback
    ? `
    LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%fail%'
    OR LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%error%'
    OR LOWER(COALESCE(APR.Status, '')) IN ('fail', 'failed')
  `
    : `
    LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%fail%'
    OR LOWER(COALESCE(AU.ProcessStatus, '')) LIKE '%error%'
    OR LOWER(COALESCE(APR.Status, '')) IN ('fail', 'failed')
    OR LOWER(COALESCE(CAA.Status, '')) = 'failed'
  `;

  if (useFallback) {
    return `
      SELECT
        COUNT(*) AS totalCallsProcessed,
        COUNT(CASE WHEN ${successCase} THEN 1 END) AS successCount,
        COUNT(CASE WHEN ${failedCase} THEN 1 END) AS failedCount,
        COALESCE(AVG(TRY_CAST(APR.AIScoring AS DECIMAL(10,2)) / 100.0), 0) AS avgAiScoring,
        COALESCE(AVG(TRY_CAST(APR.ManualScoring AS DECIMAL(10,2)) / 100.0), 0) AS avgManualScoring,
        COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, COALESCE(APR.AudioDuration, '00:00:00')))) / 60.0, 2), 0) AS aht
      FROM AudioUploads AU
      LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
      LEFT JOIN Agents AG ON AU.SelectedAgent = AG.agent_name
      WHERE ${dateClause}${where}
    `;
  }

  return `
    SELECT
      COUNT(*) AS totalCallsProcessed,
      COUNT(CASE WHEN ${successCase} THEN 1 END) AS successCount,
      COUNT(CASE WHEN ${failedCase} THEN 1 END) AS failedCount,
      COALESCE(AVG(TRY_CAST(CAA.AI_Overall_Scoring AS DECIMAL(10,2)) / 100.0), 0) AS avgAiScoring,
      COALESCE(AVG(TRY_CAST(CAA.Manual_Overall_Scoring AS DECIMAL(10,2)) / 100.0), 0) AS avgManualScoring,
      COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, COALESCE(CAA.AudioDuration, APR.AudioDuration, '00:00:00')))) / 60.0, 2), 0) AS aht
    FROM AudioUploads AU
    LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
    LEFT JOIN Consolidated_Audio_Analysis CAA ON AU.AudioFileName = CAA.AudioFileName
    LEFT JOIN Agents AG ON AU.SelectedAgent = AG.agent_name
    WHERE ${dateClause}${where}
  `;
}

function metricsOverviewFilterConditions(location, tl, useFallback, callType, agent) {
  const conditions = [];
  if (location && location !== "All") {
    conditions.push(
      useFallback
        ? "TRIM(LOWER(AG.agent_location)) = TRIM(LOWER(@location))"
        : "TRIM(LOWER(COALESCE(CAA.AgentLocation, AG.agent_location))) = TRIM(LOWER(@location))"
    );
  }
  if (tl && tl !== "All") {
    conditions.push(
      useFallback
        ? "TRIM(LOWER(AG.supervisor)) = TRIM(LOWER(@tl))"
        : "TRIM(LOWER(COALESCE(CAA.AgentSupervisor, AG.supervisor))) = TRIM(LOWER(@tl))"
    );
  }
  if (callType && callType !== "All") {
    conditions.push("LOWER(LTRIM(RTRIM(AU.CallType))) = @callType");
  }
  if (agent && agent !== "All") {
    conditions.push("AU.SelectedAgent = @agent");
  }
  return conditions;
}

/** Parse shared dashboard filter query params (date range, location, team leader). */
function parseDashboardFilterParams(query = {}) {
  const now = new Date();
  let fromDateStr = query.fromDate;
  let toDateStr = query.toDate;

  if (!fromDateStr || !toDateStr) {
    const end = new Date(now);
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    fromDateStr = fromDateStr || start.toISOString().split("T")[0];
    toDateStr = toDateStr || end.toISOString().split("T")[0];
  }

  const parsedFrom = new Date(fromDateStr);
  const parsedTo = new Date(toDateStr);
  if (isNaN(parsedFrom.getTime()) || isNaN(parsedTo.getTime())) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }

  const effectiveTo = parsedTo > now ? now : parsedTo;
  const effectiveFrom = parsedFrom > effectiveTo ? effectiveTo : parsedFrom;

  return {
    fromDateStr: effectiveFrom.toISOString().split("T")[0],
    toDateStr: effectiveTo.toISOString().split("T")[0],
    location: query.location || "All",
    tl: query.tl || query.supervisor || "All",
    callType: query.callType || "All",
    agent: query.agent || "All",
  };
}

function bindDashboardFilters(request, params) {
  request
    .input("fromDate", sql.Date, params.fromDateStr)
    .input("toDate", sql.Date, params.toDateStr);
  if (params.location && params.location !== "All") {
    request.input("location", sql.NVarChar, params.location);
  }
  if (params.tl && params.tl !== "All") {
    request.input("tl", sql.NVarChar, params.tl);
  }
  if (params.callType && params.callType !== "All") {
    request.input("callType", sql.NVarChar, String(params.callType).toLowerCase());
  }
  if (params.agent && params.agent !== "All") {
    request.input("agent", sql.NVarChar, params.agent);
  }
  return request;
}

function dashboardConsolidatedExtraFilters(params) {
  const parts = [];
  if (params.location && params.location !== "All") {
    parts.push("TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))");
  }
  if (params.tl && params.tl !== "All") {
    parts.push("TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@tl))");
  }
  if (params.callType && params.callType !== "All") {
    parts.push("LOWER(LTRIM(RTRIM(CallType))) = @callType");
  }
  if (params.agent && params.agent !== "All") {
    parts.push("AgentName = @agent");
  }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

function dashboardAudioUploadExtraFilters(params, alias = "AU") {
  const parts = [];
  if (params.location && params.location !== "All") {
    parts.push(`EXISTS (SELECT 1 FROM Agents AG WHERE AG.agent_name = ${alias}.SelectedAgent AND TRIM(LOWER(AG.agent_location)) = TRIM(LOWER(@location)))`);
  }
  if (params.tl && params.tl !== "All") {
    parts.push(`EXISTS (SELECT 1 FROM Agents AG2 WHERE AG2.agent_name = ${alias}.SelectedAgent AND TRIM(LOWER(AG2.supervisor)) = TRIM(LOWER(@tl)))`);
  }
  if (params.callType && params.callType !== "All") {
    parts.push(`LOWER(LTRIM(RTRIM(${alias}.CallType))) = @callType`);
  }
  if (params.agent && params.agent !== "All") {
    parts.push(`${alias}.SelectedAgent = @agent`);
  }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

/** Shared optional filters for consolidated report queries. */
function consolidatedReportExtraFilters(params, alias = "") {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const parts = [];
  if (params.location && params.location !== "All") {
    parts.push(`TRIM(LOWER(${col("AgentLocation")})) = TRIM(LOWER(@location))`);
  }
  const supervisor = params.supervisor || params.tl;
  if (supervisor && supervisor !== "All") {
    parts.push(`TRIM(LOWER(${col("AgentSupervisor")})) = TRIM(LOWER(@supervisor))`);
  }
  if (params.callType && params.callType !== "All") {
    parts.push(`LOWER(LTRIM(RTRIM(${col("CallType")}))) = @callType`);
  }
  if (params.agent && params.agent !== "All") {
    parts.push(`${col("AgentName")} = @agent`);
  }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

function bindReportFilters(request, params = {}) {
  if (params.location && params.location !== "All") {
    request.input("location", sql.NVarChar, params.location);
  }
  const supervisor = params.supervisor || params.tl;
  if (supervisor && supervisor !== "All") {
    request.input("supervisor", sql.NVarChar, supervisor);
  }
  if (params.callType && params.callType !== "All") {
    request.input("callType", sql.NVarChar, String(params.callType).toLowerCase());
  }
  if (params.agent && params.agent !== "All") {
    request.input("agent", sql.NVarChar, params.agent);
  }
  return request;
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function emptyWeekdayMaps() {
  const inboundMap = Object.fromEntries(WEEKDAY_LABELS.map((d) => [d, 0]));
  const outboundMap = Object.fromEntries(WEEKDAY_LABELS.map((d) => [d, 0]));
  return { inboundMap, outboundMap };
}

async function runMetricsOverviewQuery(pool, { fromDate, toDate, location, tl, callType, agent }, useFallback) {
  const conditions = metricsOverviewFilterConditions(location, tl, useFallback, callType, agent);
  const query = buildMetricsOverviewQuery({
    fromParam: "@fromDate",
    toParam: "@toDate",
    useFallback,
    extraConditions: conditions,
  });
  const request = pool.request()
    .input("fromDate", sql.Date, fromDate)
    .input("toDate", sql.Date, toDate);
  if (location && location !== "All") {
    request.input("location", sql.NVarChar, location);
  }
  if (tl && tl !== "All") {
    request.input("tl", sql.NVarChar, tl);
  }
  if (callType && callType !== "All") {
    request.input("callType", sql.NVarChar, String(callType).toLowerCase());
  }
  if (agent && agent !== "All") {
    request.input("agent", sql.NVarChar, agent);
  }
  const result = await request.query(query);
  return result.recordset[0] || {
    totalCallsProcessed: 0,
    successCount: 0,
    failedCount: 0,
    avgAiScoring: 0,
    avgManualScoring: 0,
    aht: 0,
  };
}

async function queryTopScorerForWeek(pool, callType, params) {
  const dateClause = dashboardConsolidatedDateClause();
  const uploadDateClause = dashboardInclusiveDateClause('AU');
  const consolidatedExtra = dashboardConsolidatedExtraFilters(params);
  const uploadExtra = dashboardAudioUploadExtraFilters(params, "AU");

  const mapTopRow = (row) => {
    if (!row) return null;
    const score = row.avgScore != null ? Number(row.avgScore) : 0;
    return {
      agentName: row.agentName || "—",
      avgScore: score <= 1 ? Number((score * 100).toFixed(1)) : Number(score.toFixed(1)),
      callCount: row.callCount || 0,
    };
  };

  const queries = [
    `
      SELECT TOP 1 COALESCE(AgentName, 'Unknown') AS agentName,
             AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
             COUNT(*) AS callCount
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE LOWER(LTRIM(RTRIM(CallType))) = @callType
        AND AI_Overall_Scoring IS NOT NULL
        AND TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2)) > 0
        AND ${dateClause}
        ${consolidatedExtra}
      GROUP BY AgentName
      ORDER BY avgScore DESC
    `,
    `
      SELECT TOP 1 COALESCE(ADS.AgentName, AU.SelectedAgent) AS agentName,
             AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
             COUNT(*) AS callCount
      FROM dbo.AI_Details_Scoring ADS
      INNER JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
      WHERE LOWER(LTRIM(RTRIM(AU.CallType))) = @callType
        AND ADS.Overall_Scoring IS NOT NULL
        AND TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) > 0
        AND ${uploadDateClause}
        ${uploadExtra}
      GROUP BY COALESCE(ADS.AgentName, AU.SelectedAgent)
      ORDER BY avgScore DESC
    `,
    `
      SELECT TOP 1 AU.SelectedAgent AS agentName,
             AVG(CAST(APR.AIScoring AS FLOAT)) AS avgScore,
             COUNT(*) AS callCount
      FROM AudioUploads AU
      JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
      WHERE LOWER(LTRIM(RTRIM(AU.CallType))) = @callType
        AND APR.AIScoring IS NOT NULL
        AND ${uploadDateClause}
        ${uploadExtra}
      GROUP BY AU.SelectedAgent
      ORDER BY avgScore DESC
    `,
  ];

  for (const query of queries) {
    try {
      const result = await bindDashboardFilters(pool.request(), params)
        .input("callType", sql.NVarChar, callType)
        .query(query);
      const mapped = mapTopRow(result.recordset[0]);
      if (mapped && mapped.agentName !== "—" && mapped.callCount > 0) {
        return mapped;
      }
    } catch (err) {
      if (!isMissingDbObjectError(err)) {
        throw err;
      }
    }
  }

  return null;
}

/** Parse AI score from consolidated row or AI_Processing_Result fallback (0–100 scale). */
function consolidatedAiScoreExpr(caaAlias = "CAA", aprAlias = "APR") {
  return `COALESCE(
    TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(CAST(${caaAlias}.AI_Overall_Scoring AS NVARCHAR(50)))), '%', ''), ',', '') AS DECIMAL(10,2)),
    TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(CAST(${aprAlias}.AIScoring AS NVARCHAR(50)))), '%', ''), ',', '') AS DECIMAL(10,2))
  )`;
}

function buildPerformanceComparisonPeriodCte(periodLabel, dateFromParam, dateToParam, filterParams) {
  const scoreExpr = consolidatedAiScoreExpr();
  let sql = `
    ${periodLabel} AS (
      SELECT
        COUNT(*) AS totalCalls,
        COALESCE(AVG(CASE WHEN ${scoreExpr} > 0 THEN ${scoreExpr} END), 0) AS avgScore,
        COUNT(CASE WHEN CAA.AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) AS resolutionRate
      FROM [dbo].[Consolidated_Audio_Analysis] CAA
      LEFT JOIN [dbo].[AI_Processing_Result] APR ON CAA.AudioFileName = APR.AudioFileName
      WHERE CAA.Status = 'Success'
        AND ${consolidatedReportDateBetween(dateFromParam, dateToParam, 'CAA')}
  `;
  sql += consolidatedReportExtraFilters(filterParams, "CAA");
  sql += "\n    )";
  return sql;
}

function classifySentimentPolarity(polarity) {
  const value = Number(polarity);
  if (!Number.isFinite(value)) return "Unknown";
  if (value > 0.3) return "Positive";
  if (value < -0.3) return "Negative";
  return "Neutral";
}

function parseSentimentPayload(raw) {
  if (raw == null || raw === "" || raw === "Fail") return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Bucket each call's customer utterances into Positive / Neutral / Negative. */
function aggregateCustomerSentimentSummary(rows = []) {
  const buckets = { Positive: 0, Neutral: 0, Negative: 0, Unknown: 0 };

  rows.forEach((row) => {
    const parsed = parseSentimentPayload(row.Sentiment);
    if (!parsed?.length) {
      buckets.Unknown += 1;
      return;
    }

    const customerPolarities = parsed
      .filter((entry) => String(entry?.Role || "").toLowerCase() === "customer")
      .map((entry) => Number(entry?.["Sentiment Polarity"]))
      .filter((value) => Number.isFinite(value));

    if (!customerPolarities.length) {
      buckets.Unknown += 1;
      return;
    }

    const average = customerPolarities.reduce((sum, value) => sum + value, 0) / customerPolarities.length;
    const bucket = classifySentimentPolarity(average);
    buckets[bucket] += 1;
  });

  const data = ["Positive", "Neutral", "Negative"]
    .map((label) => ({ label, count: buckets[label] }))
    .filter((item) => item.count > 0);

  if (buckets.Unknown > 0) {
    data.push({ label: "Unknown", count: buckets.Unknown });
  }

  return { data, totalCalls: rows.length };
}

function intelDateClause(request, fromDate, toDate) {
  if (fromDate && toDate) {
    request.input("fromDate", sql.Date, fromDate);
    request.input("toDate", sql.Date, toDate);
    return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) BETWEEN @fromDate AND @toDate`;
  }
  return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(DAY, -30, GETDATE())`;
}

module.exports = {
  initReportHelpers,
  normalizeDisplayStatus,
  buildAudioProgressPayload,
  buildProcessingSubtasks,
  resolveDisplayAiStatus,
  PROCESS_STAGE_LABELS,
  extractFailureDetails,
  mapScoringFields,
  formatScoringFeedback,
  dashboardUploadDateClause,
  dashboardInclusiveDateClause,
  dashboardConsolidatedDateClause,
  consolidatedReportDateBetween,
  consolidatedReportTodayClause,
  manualScoringFromCallAudit,
  mergeManualScoringFromConsolidated,
  isTerminalProcessingStatus,
  isActiveProcessingStatus,
  markStaleProcessingAsFailed,
  mapRecentActivityRow,
  buildRecentActivityQuery,
  parseRecentActivityFilterParams,
  recentActivityWhereConditions,
  bindRecentActivityFilters,
  buildRecentActivityFilteredQuery,
  buildMetricsOverviewQuery,
  metricsOverviewFilterConditions,
  parseDashboardFilterParams,
  bindDashboardFilters,
  dashboardConsolidatedExtraFilters,
  dashboardAudioUploadExtraFilters,
  consolidatedReportExtraFilters,
  bindReportFilters,
  WEEKDAY_LABELS,
  emptyWeekdayMaps,
  runMetricsOverviewQuery,
  queryTopScorerForWeek,
  consolidatedAiScoreExpr,
  buildPerformanceComparisonPeriodCte,
  classifySentimentPolarity,
  parseSentimentPayload,
  aggregateCustomerSentimentSummary,
  intelDateClause,
};
