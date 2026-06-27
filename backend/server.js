/*****************************************************
 * File: server.js
 * Purpose: Node.js + Express server for AI-powered call analysis
 * Enhanced: Complete API endpoints preserved and reorganized,
 *           robust logging with daily log rotation and unique
 *           API call IDs, and full WebSocket integration for
 *           real-time log broadcast and chat handling.
 * Author: Suvadip Panja
 * Creation Date: May 23, 2025
 * Modified Date: June 05, 2025
 * Compliance: ISO 27001 (Secure configuration management)
 *****************************************************/

/* ===================== 1) Required Dependencies ===================== */
// Load environment variables and required Node.js modules
require('dotenv').config(); // Loads variables from .env file
const express = require("express");
const bodyParser = require("body-parser");
const sql = require("./sqlClient");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const http = require("http");
const WebSocket = require("ws");
const si = require('systeminformation');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit'); // For rate limiting
const validator = require('validator'); // For input sanitization
const crypto = require("crypto");
const os = require("os");
const { spawn } = require("child_process");
const jwt = require('jsonwebtoken');
const cache = require('memory-cache');
const NodeCache = require('node-cache');

// Import custom project modules
const uploadHandler = require("./uploadHandler");
const agentRoutes = require("./agentController");
const { createAutoUploadRouter } = require("./routes/autoUploadRoutes");
const { createAuditRouter } = require("./routes/auditRoutes");
const {
  createBankSettingsRouter,
  createBankSettingsInternalRouter,
} = require("./routes/bankSettingsRoutes");
const { createQueryCategoryRouter } = require("./routes/queryCategoryRoutes");
const autoUploadService = require("./services/autoUploadService");
const { logCallEvent, ensureSchema: ensureCallProcessingLogSchema } = require("./services/callProcessingLog");
const { runDatabaseMigrations } = require("./services/dbMigrate");
const { fetchUserForLogin, getLoginIdForSession, resolveSessionUserId } = require("./authHelper");
const { resolveAgentIdentity, assertSelfOrElevated, resolveBriefingOwnerUsernames } = require("./agentHelper");
const { resolveProjectPath, isMissingDbObjectError } = require("./projectPaths");

// Get the host MAC address from environment variable
const hostMac = process.env.HOST_MAC;

if (hostMac) {
  console.log("🔐 Host MAC Address received from environment:", hostMac);
} else {
  console.warn("⚠️ HOST_MAC not set in environment. Backend may not be fully configured.");
}

const SECURITY_ANSWER_SALT_ROUNDS = 10;

function normalizeSecurityAnswer(answer) {
  return String(answer || "").trim().toLowerCase();
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

async function hashSecurityAnswer(answer) {
  return bcrypt.hash(normalizeSecurityAnswer(answer), SECURITY_ANSWER_SALT_ROUNDS);
}

async function verifySecurityAnswer(plainAnswer, storedValue) {
  const normalized = normalizeSecurityAnswer(plainAnswer);
  const stored = String(storedValue || "");
  if (!stored) return { match: false, needsMigration: false };
  if (isBcryptHash(stored)) {
    return { match: await bcrypt.compare(normalized, stored), needsMigration: false };
  }
  const match = stored.toLowerCase() === normalized;
  return { match, needsMigration: match };
}

async function checkSecurityAnswer(pool, user, plainAnswer) {
  const { match, needsMigration } = await verifySecurityAnswer(plainAnswer, user.SecurityQuestionAnswer);
  if (!match) return false;
  if (needsMigration) {
    const hashed = await hashSecurityAnswer(plainAnswer);
    await pool.request()
      .input("answer", sql.NVarChar, hashed)
      .input("username", sql.NVarChar, user.Username)
      .query("UPDATE dbo.Users SET SecurityQuestionAnswer = @answer WHERE LOWER(Username) = LOWER(@username)");
  }
  return true;
}

/* ===================== 2) Global Variables ===================== */
function getISTTimeString() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** Convert tone_distribution proportions (0–1) to legacy frame counts for charts. */
function normalizeToneDistribution(dist) {
  if (!dist) return { High: 0, Medium: 0, Low: 0 };
  let high = Number(dist.High ?? 0);
  let medium = Number(dist.Medium ?? 0);
  let low = Number(dist.Low ?? 0);
  const total = high + medium + low;
  if (total > 0 && total <= 1.01) {
    const scale = 350;
    high *= scale;
    medium *= scale;
    low *= scale;
  }
  return { High: high, Medium: medium, Low: low };
}

function normalizeToneResults(results) {
  if (!results || typeof results !== "object") return results;
  for (const role of ["Agent", "Customer"]) {
    const segments = results[role];
    if (!segments || typeof segments !== "object") continue;
    for (const key of Object.keys(segments)) {
      const seg = segments[key];
      if (seg?.tone_distribution) {
        seg.tone_distribution = normalizeToneDistribution(seg.tone_distribution);
      }
    }
  }
  return results;
}

/** Map DB rows to UI status — Success only for real AI, not MVP stub or upload-only. */
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
    'Feedback': record[`${prefix}_Feedback`],
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

  const dateClause = `CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN ${fromParam} AND ${toParam}`;

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

// Override console.log globally to use IST
const originalConsoleLog = console.log;
console.log = (...args) => {
  originalConsoleLog(`[${getISTTimeString()}]`, ...args);
};

// Define global variables used throughout the application
const PORT = parseInt(process.env.PORT); // Server port from .env
let websocketServer = null; // WebSocket server instance
global.licensePayload = null; // Cache for license payload
global.secretKey = process.env.LICENSE_SECRET_KEY; // License secret key
global.isLicenseExpired = false; // License expiration flag

/* ===================== 3) Database Configuration & Helpers ===================== */
// Database configuration and connection helpers (moved here to fix initialization error)
const config = {
  server: process.env.DB_SERVER, // Database server
  port: parseInt(process.env.DB_PORT), // Database port
  database: process.env.DB_DATABASE, // Database name
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // Encryption setting
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true', // Trust server certificate
  },
  // Production connection pool tuning. mssql caches a single global pool for
  // this config, so every sql.connect(config) call reuses these limits.
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
  },
  requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '30000', 10),
};

if (process.env.DB_USE_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} else {
  config.user = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

// Connect to SQL Server (alternative connection method)
const sqlConnect = async () => {
  try {
    return await sql.connect(config);
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
};

// Primary database connection function
const connectToDatabase = async () => {
  try {
    return await sql.connect(config);
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
};

/** Ensure Locations + AppSettings tables exist (auto-bootstrap if migration not run). */
let adminSchemaEnsured = false;
async function ensureAdminSchema() {
  if (adminSchemaEnsured) return;
  const pool = await connectToDatabase();
  await pool.request().query(`
    IF OBJECT_ID('dbo.Locations', 'U') IS NULL
    CREATE TABLE dbo.Locations (
      LocationID   INT IDENTITY(1,1) PRIMARY KEY,
      LocationName NVARCHAR(200) NOT NULL UNIQUE,
      IsActive     BIT NOT NULL DEFAULT 1,
      CreatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
      UpdatedAt    DATETIME NULL
    );
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.AppSettings (
        SettingID    INT IDENTITY(1,1) PRIMARY KEY,
        SettingKey   NVARCHAR(100) NOT NULL UNIQUE,
        SettingValue NVARCHAR(MAX) NULL,
        UpdatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy    NVARCHAR(100) NULL
      );
      INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES
        ('app_name', 'AI-Powered Call Analysis'),
        ('app_logo_url', ''),
        ('backup_path', '');
    END
  `);
  try {
    await pool.request().query(`
      INSERT INTO dbo.Locations (LocationName)
      SELECT DISTINCT LTRIM(RTRIM(agent_location))
      FROM dbo.Agents
      WHERE agent_location IS NOT NULL AND LTRIM(RTRIM(agent_location)) <> ''
        AND LTRIM(RTRIM(agent_location)) NOT IN (SELECT LocationName FROM dbo.Locations);
    `);
  } catch (_) { /* Agents table may be empty */ }
  adminSchemaEnsured = true;
}

/* ===================== 4) Robust Logging System ===================== */
// Setup for robust logging with daily rotation and WebSocket broadcasting
const logDir = resolveProjectPath(process.env.DETAILS_LOG_DIR || '/app/logs/details');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("[INFO] Log directory initialized at", logDir);
}

// Get log file path for the current day (YYYY-MM-DD.log)
function getLogFilePath() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const istDate = formatter.format(date); // Safe call to format(date)
  return path.join(logDir, `${istDate}.log`);
}


// Write log message to the current day's log file
function writeLog(message) {
  const logFilePath = getLogFilePath();
  fs.appendFile(logFilePath, message + "\n", (err) => {
    if (err) {
      console.error("Error writing log:", err);
    }
  });
}

// Counter for unique API call IDs
let logCounter = 0;

// Middleware to log API requests and responses
// Keys that must never be written to logs or broadcast over WebSocket.
const SENSITIVE_KEYS = new Set([
  "password", "newpassword", "oldpassword", "confirmpassword",
  "token", "sessiontoken", "secretkey", "questionanswer",
  "securityquestionanswer", "authorization",
]);

// Routes whose request/response payloads are too sensitive to log verbatim.
const SENSITIVE_URL_RE = /\/api\/(login|login-security|reset-password|temp-super-admin-login|user\/.*\/password|get-security-question-type|verify-license|upload-license)/i;

function redactSensitive(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSensitive);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      out[k] = redactSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function robustLogger(req, res, next) {
  logCounter++;
  const uniqueId = logCounter;
  const startTime = new Date();
  const caller = req.body.username || req.query.username || "Unknown";
  const isSensitive = SENSITIVE_URL_RE.test(req.originalUrl);

  const originalSend = res.send;
  res.send = function (data) {
    originalSend.apply(res, arguments);
    const endTime = new Date();
    const duration = endTime - startTime;
    const logData = {
      id: uniqueId,
      timestamp: startTime.toISOString(),
      method: req.method,
      url: req.originalUrl,
      user: caller,
      requestBody: isSensitive ? "[REDACTED]" : redactSensitive(req.body),
      responseStatus: res.statusCode,
      responseData: isSensitive ? "[REDACTED]" : data,
      duration: duration + "ms"
    };
    const logMessage = JSON.stringify(logData);
    writeLog(logMessage);

    // Never broadcast sensitive auth payloads to WebSocket log subscribers.
    if (websocketServer && !isSensitive) {
      websocketServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(logMessage);
        }
      });
    }
  };
  next();
}

/* ===================== 5) License Management Helpers ===================== */
// Helper functions for license validation
function getServerMacAddress() {
  // First, check if HOST_MAC environment variable is set and use it as primary source
  if (hostMac && hostMac.trim() !== "") {
    console.log("Using HOST_MAC from environment variable:", hostMac);
    return hostMac.toUpperCase();
  }

  // Fallback to system network interfaces if HOST_MAC is not available
  console.log("HOST_MAC not found in environment, retrieving from system interfaces");
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        return details.mac.toUpperCase();
      }
    }
  }
  throw new Error("No valid MAC address found from system interfaces and HOST_MAC environment variable is not set.");
}

function getServerMacAddresses() {
  const macAddresses = [];

  // First, check if HOST_MAC environment variable is set and use it as primary source
  if (hostMac && hostMac.trim() !== "") {
    console.log("Using HOST_MAC from environment variable:", hostMac);
    macAddresses.push(hostMac.toUpperCase());
    return macAddresses;
  }

  // Fallback to system network interfaces if HOST_MAC is not available
  console.log("HOST_MAC not found in environment, retrieving from system interfaces");
  const interfaces = os.networkInterfaces();

  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        macAddresses.push(details.mac.toUpperCase());
      }
    }
  }

  if (macAddresses.length === 0) {
    throw new Error("No valid MAC addresses found from system interfaces and HOST_MAC environment variable is not set.");
  }

  return macAddresses;
}

async function decodeLicense(licenseKey, secretKey) {
  try {
    const licenseStr = Buffer.from(licenseKey, "base64").toString();
    const license = JSON.parse(licenseStr);
    const { appId, nonce, aad, ciphertext } = license;

    const keyMaterial = crypto.pbkdf2Sync(secretKey, appId, 100000, 32, "sha256");
    const decodedNonce = Buffer.from(nonce, "base64");
    const decodedCiphertextWithTag = Buffer.from(ciphertext, "base64");

    const authTagLength = 16;
    if (decodedCiphertextWithTag.length < authTagLength) {
      throw new Error("Ciphertext is too short to contain an auth tag");
    }
    const ciphertextLength = decodedCiphertextWithTag.length - authTagLength;
    const actualCiphertext = decodedCiphertextWithTag.slice(0, ciphertextLength);
    const authTag = decodedCiphertextWithTag.slice(ciphertextLength);

    const decodedAad = Buffer.from(aad, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial, decodedNonce);
    decipher.setAuthTag(authTag);
    decipher.setAAD(decodedAad);

    let decrypted = decipher.update(actualCiphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const decryptedStr = decrypted.toString();
    
    console.log("License decoded successfully");
    return JSON.parse(decryptedStr);
  } catch (error) {
    console.error(`[${getISTTimeString()}] Decryption error: ${error.message}`);
    throw new Error("Invalid or tampered license key: " + error.message);
  }
}

/* ===================== 6) License Management Initialization ===================== */
// Load and validate license on server startup
const loadLicenseOnStartup = async () => {
  const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH);
  const secretKey = process.env.LICENSE_SECRET_KEY;

  try {
    const licenseDir = path.dirname(licenseFilePath);
    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true });
      writeLog(`[${getISTTimeString()}] Created license directory: ${licenseDir}`);
    }

    if (!fs.existsSync(licenseFilePath)) {
      writeLog(`[${getISTTimeString()}] No license file found`);
      return;
    }

    const licenseKey = fs.readFileSync(licenseFilePath, 'utf8').trim();
    if (!licenseKey) {
      writeLog(`[${getISTTimeString()}] License file is empty`);
      return;
    }

    const pool = await connectToDatabase();
    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return;
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return;
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] Invalid MAC address`);
      console.log("License validation failed: MAC address mismatch");
      return;
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License not yet valid`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return;
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License out of date range`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      global.isLicenseExpired = true;
      return;
    }

    await pool.request()
      .query("UPDATE Licenses SET IsActive = 0 WHERE IsActive = 1");

    await pool.request()
      .input("LicenseKey", sql.NVarChar, licenseKey)
      .input("UploadedBy", sql.NVarChar, "System (Startup)")
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO Licenses (LicenseKey, UploadedBy, CreatedAt, IsActive)
        VALUES (@LicenseKey, @UploadedBy, @CreatedAt, 1);
      `);

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    global.isLicenseExpired = false;
    global.licensePayload = payload;

    const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
  } catch (error) {
    writeLog(`[${getISTTimeString()}] ${error.message}`);
    console.log("License validation failed: ${error.message}");
  }
};

// Initialize license on startup
(async () => {
  await loadLicenseOnStartup();
})();

/* ===================== 7) Express App & Middleware Setup ===================== */
const app = express();

// Create HTTP server
const server = http.createServer(app);

const helmet = require("helmet");
app.use(helmet({
  // API serves JSON + static assets cross-origin (frontend on a different port).
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS allowlist: comma-separated origins in CORS_ORIGIN (no wildcard).
// Dev: http://localhost:3000  |  Prod: https://your-domain.com (see .env.example).
const corsAllowlist = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin / tools (no Origin header) and any allowlisted origin.
    if (!origin || corsAllowlist.length === 0 || corsAllowlist.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Callback-Secret']
}));

app.use(robustLogger);

/* ===================== 7.5) Authentication gate ===================== */
const { authGate } = require("./middleware/auth");
app.use("/api", authGate(sqlConnect, sql));

/* ===================== 8) File Storage & Upload Setup ===================== */
const uploadDirectory = process.env.AUDIO_UPLOAD_DIR;
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
  console.log("[INFO] Upload directory initialized.");
}
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDirectory); },
  filename: (req, file, cb) => { cb(null, Date.now() + "-" + file.originalname); }
});

// Audio upload validation: cap size and restrict to known audio container types
// to prevent arbitrary/executable file uploads.
const MAX_AUDIO_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const ALLOWED_AUDIO_EXTENSIONS = new Set([
  ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".flac", ".aac",
  ".wma", ".opus", ".amr", ".mp4", ".weba", ".webm",
]);
function audioFileFilter(_req, file, cb) {
  const ext = (path.extname(file.originalname) || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const extOk = ALLOWED_AUDIO_EXTENSIONS.has(ext);
  // Many recorders send audio/* or a generic octet-stream for .wav files.
  const mimeOk =
    mime.startsWith("audio/") ||
    mime === "application/octet-stream" ||
    mime === "video/mp4" ||
    mime === "video/webm";
  if (extOk && mimeOk) return cb(null, true);
  return cb(new Error("Invalid file type. Allowed audio formats: wav, mp3, m4a, ogg, flac, aac, wma, opus, amr."));
}
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: MAX_AUDIO_UPLOAD_BYTES },
  fileFilter: audioFileFilter,
});

// Runs multer for the audio upload and converts validation/size errors into
// clean 400 responses instead of a generic 500.
function handleAudioUpload(req, res, next) {
  uploadAudio.single("audioFile")(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "Audio file is too large (max 200 MB)."
        : (err.message || "Invalid audio upload.");
      return res.status(400).json({ success: false, message });
    }
    return next();
  });
}

// Resolve a writable storage directory from env (absolute or relative to this file).
function resolveStorageDir(envValue, defaultRelativeDir) {
  const raw = (envValue || "").trim();
  const dir = raw
    ? (path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(__dirname, raw))
    : path.resolve(__dirname, defaultRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findProfilePictureFile(username) {
  if (!username) return null;
  const fileExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];
  const uname = String(username).trim();
  const unameLower = uname.toLowerCase();

  for (const ext of fileExts) {
    const exact = path.join(profilePicsDir, `${uname}${ext}`);
    if (fs.existsSync(exact)) return exact;
  }

  try {
    const files = fs.readdirSync(profilePicsDir);
    for (const file of files) {
      const ext = path.extname(file);
      if (!fileExts.includes(ext.toLowerCase())) continue;
      const base = file.slice(0, -ext.length);
      if (base.includes("_")) continue; // archived copy from a prior upload
      if (base.toLowerCase() === unameLower) {
        return path.join(profilePicsDir, file);
      }
    }
  } catch {
    return null;
  }
  return null;
}

// In section 8) File Storage & Upload Setup
const profilePicsDir = resolveStorageDir(
  process.env.PROFILE_PICS_DIR,
  "assets/profile_pictures",
);
try {
  const probe = path.join(profilePicsDir, ".write_probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  console.log(`[INFO] Profile pictures directory (persistent): ${profilePicsDir}`);
} catch (err) {
  console.error(
    `[WARN] Profile pictures directory is not writable (${profilePicsDir}): ${err.message}`,
  );
}
const storageProfilePic = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, profilePicsDir); },
  filename: (req, file, cb) => {
    const username = req.params.username;
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${username}${ext}`); // New file saved as username.ext
  }
});
const uploadProfilePic = multer({ storage: storageProfilePic });

const brandingDir = resolveStorageDir(process.env.BRANDING_DIR, "uploads/branding");
const storageAppLogo = multer.diskStorage({
  destination: (_req, _file, cb) => { cb(null, brandingDir); },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".png").toLowerCase();
    try {
      const existing = fs.readdirSync(brandingDir).filter((f) => f.startsWith("app-logo"));
      for (const old of existing) {
        fs.unlinkSync(path.join(brandingDir, old));
      }
    } catch (_) { /* ignore cleanup errors */ }
    cb(null, `app-logo${ext}`);
  },
});
const uploadAppLogo = multer({
  storage: storageAppLogo,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPG, GIF, WEBP, or SVG images are allowed."));
  },
});

function resolveBrandingLogoFile() {
  try {
    const files = fs.readdirSync(brandingDir).filter((f) => f.startsWith("app-logo"));
    return files.length ? path.join(brandingDir, files[0]) : null;
  } catch {
    return null;
  }
}

function publicLogoUrl(req) {
  if (resolveBrandingLogoFile()) {
    return `${req.protocol}://${req.get("host")}/api/branding/logo`;
  }
  return "";
}

/* ===================== 9) Mounting Other router ===================== */
app.use("/api", agentRoutes);

/* ===================== 10) API Endpoints ===================== */
/* 10.1 License Management APIs */
// APIs for managing licenses, including validation, upload, and deletion
/**
 * API 10.1.01 - POST /api/verify-license
 * Verifies an active license key against system parameters
 */
app.post("/api/verify-license", async (req, res) => {
  // The license secret is held server-side only (LICENSE_SECRET_KEY). The client
  // no longer supplies it; we validate the installed license using the env secret.
  const secretKey = global.secretKey;
  if (!secretKey) {
    writeLog(`[${getISTTimeString()}] License validation failed: LICENSE_SECRET_KEY not configured on server`);
    return res.status(500).json({ success: false, message: "License is not configured on the server." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT TOP 1 LicenseKey, EndDate FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");
    if (!result.recordset.length) {
      writeLog(`[${getISTTimeString()}] License validation failed: No active license found`);
      return res.status(404).json({ success: false, message: "No active license found." });
    }

    const licenseKey = result.recordset[0].LicenseKey;
    const endDate = new Date(result.recordset[0].EndDate);
    const now = new Date();

    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License validation failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      global.isLicenseExpired = true;
      return res.status(403).json({ success: false, message: `License expired on ${endDate.toLocaleDateString()}.` });
    }

    global.isLicenseExpired = false;

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License validation failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License validation failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License validation failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address." });
    }

    const startDate = new Date(payload.startDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License validation failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is not yet valid." });
    }

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;

    global.licensePayload = payload;

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, warning });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License validation error: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error during license validation: " + error.message });
  }
});

/**
 * API 10.2.02 - GET /api/license-status
 * Retrieves the status of the active license
 */
app.get("/api/license-status", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const licenseResult = await pool.request()
      .query("SELECT TOP 1 EndDate FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License status check failed: No active license found`);
      return res.status(404).json({ success: false, message: "No active license found." });
    }

    const endDate = new Date(licenseResult.recordset[0].EndDate);
    const now = new Date();
    const timeDiff = endDate - now;
    const daysUntilExpiration = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    const isExpired = now > endDate;
    if (isExpired) {
      writeLog(`[${getISTTimeString()}] License status: Expired on ${endDate.toISOString()}`);
    } else if (daysUntilExpiration <= 7) {
      writeLog(`[${getISTTimeString()}] License status: Nearing expiration (${daysUntilExpiration} days remaining)`);
    }

    return res.status(200).json({
      success: true,
      isExpired,
      daysUntilExpiration,
      endDate: endDate.toISOString()
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License status check error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking license status: " + error.message });
  }
});

/**
 * API 10.4.03 - POST /api/upload-license
 * Uploads a new license key (Super Admin only)
 */
app.post("/api/upload-license", async (req, res) => {
  const { username, licenseKey } = req.body;

  if (!username || !licenseKey) {
    writeLog(`[${getISTTimeString()}] License upload failed: Missing username or licenseKey`);
    return res.status(400).json({ success: false, message: "Username and license key are required." });
  }

  // License secret is server-side only (LICENSE_SECRET_KEY); never supplied by the client.
  const secretKey = global.secretKey;
  if (!secretKey) {
    writeLog(`[${getISTTimeString()}] License upload failed: LICENSE_SECRET_KEY not configured on server`);
    return res.status(500).json({ success: false, message: "License is not configured on the server." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License upload failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License upload failed: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can upload licenses." });
    }

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License upload failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature in new license." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License upload failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License upload failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address in new license." });
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License upload failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "New license is not yet valid." });
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License upload failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      return res.status(401).json({ success: false, message: "New license is expired." });
    }

    await pool.request()
      .query("UPDATE Licenses SET IsActive = 0 WHERE IsActive = 1");

    await pool.request()
      .input("LicenseKey", sql.NVarChar, licenseKey)
      .input("UploadedBy", sql.NVarChar, username)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO Licenses (LicenseKey, UploadedBy, CreatedAt, IsActive)
        VALUES (@LicenseKey, @UploadedBy, @CreatedAt, 1);
      `);

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH || "./license/license.lic");
    try {
      const licenseDir = path.dirname(licenseFilePath);
      if (!fs.existsSync(licenseDir)) {
        fs.mkdirSync(licenseDir, { recursive: true });
        writeLog(`[${getISTTimeString()}] Created license directory: ${licenseDir}`);
      }
      fs.writeFileSync(licenseFilePath, licenseKey);
      writeLog(`[${getISTTimeString()}] License key written to file: ${licenseFilePath}`);
    } catch (fileError) {
      writeLog(`[${getISTTimeString()}] Failed to write license key to file ${licenseFilePath}: ${fileError.message}`);
      return res.status(500).json({ success: false, message: `Failed to write license key to file: ${fileError.message}` });
    }

    global.licensePayload = payload;

    writeLog(`[${getISTTimeString()}] License uploaded successfully by ${username}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, message: "License uploaded successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License upload error for user ${username}: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error during license upload: " + error.message });
  }
});

/**
 * API 10.6.04 - POST /api/delete-license
 * Deletes a license (Super Admin only)
 */
app.post("/api/delete-license", async (req, res) => {
  const { username, licenseKey } = req.body;

  if (!username || !licenseKey) {
    writeLog(`[${getISTTimeString()}] License deletion failed: Missing username or licenseKey`);
    return res.status(400).json({ success: false, message: "Username and license key are required." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License deletion failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License deletion failed: User ${username} is not a Super Admin (AccountType: ${userType})`);
      return res.status(403).json({ success: false, message: "Only Super Admins can delete licenses." });
    }
    writeLog(`[${getISTTimeString()}] User ${username} verified as Super Admin for license deletion`);

    const licenseResult = await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`SELECT IsActive FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License deletion failed: License ${licenseKey} not found`);
      return res.status(404).json({ success: false, message: "License not found." });
    }

    const isActive = licenseResult.recordset[0].IsActive;

    await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`DELETE FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (isActive) {
      const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH || "./license/license.lic");
      try {
        if (fs.existsSync(licenseFilePath)) {
          fs.writeFileSync(licenseFilePath, '');
          writeLog(`[${getISTTimeString()}] Cleared license file: ${licenseFilePath}`);
        }
      } catch (fileError) {
        writeLog(`[${getISTTimeString()}] Failed to clear license file ${licenseFilePath}: ${fileError.message}`);
        return res.status(500).json({ success: false, message: `Failed to clear license file: ${fileError.message}` });
      }

      global.licensePayload = null;
      global.isLicenseExpired = false;
      writeLog(`[${getISTTimeString()}] Reset global license state after deleting active license ${licenseKey}`);
    }

    writeLog(`[${getISTTimeString()}] License ${licenseKey} deleted successfully by ${username}`);
    return res.status(200).json({ success: true, message: "License deleted successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License deletion error for user ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during license deletion: " + error.message });
  }
});

/**
 * API 10.7.05 - POST /api/license-details
 * Retrieves details of a specific license (Super Admin only)
 */
app.post("/api/license-details", async (req, res) => {
  const { username, licenseKey } = req.body;

  if (!username || !licenseKey) {
    writeLog(`[${getISTTimeString()}] License details fetch failed: Missing username or licenseKey`);
    return res.status(400).json({ success: false, message: "Username and license key are required." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License details fetch failed: User ${username} is not a Super Admin (AccountType: ${userType})`);
      return res.status(403).json({ success: false, message: "Only Super Admins can view license details." });
    }
    writeLog(`[${getISTTimeString()}] User ${username} verified as Super Admin for license details`);

    const licenseResult = await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`SELECT LicenseKey, EndDate, IsActive FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License not found`);
      return res.status(404).json({ success: false, message: "License not found." });
    }

    const license = licenseResult.recordset[0];
    const payload = await decodeLicense(licenseKey, global.secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address." });
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is not yet valid." });
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is expired." });
    }

    const licenseDetails = {
      licenseKey: license.LicenseKey,
      startDate: payload.startDate,
      endDate: payload.endDate,
      users: payload.users,
      macAddress: payload.macAddress,
      applicationId: payload.appId,
      isActive: license.IsActive,
      signature: payload.signature,
    };

    writeLog(`[${getISTTimeString()}] License details fetched successfully by ${username}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, license: licenseDetails });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License details fetch error for user ${username}: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error fetching license details: " + error.message });
  }
});

/**
 * API 10.8.06 - GET /api/license-history
 * Retrieves license upload history for a user (Super Admin only)
 */
app.get('/api/license-history', async (req, res) => {
  const { username } = req.query;

  if (!username) {
    writeLog(`[${getISTTimeString()}] License History: Username not provided`);
    return res.status(400).json({ success: false, message: 'Username is required' });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE Username = @username');

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License History: User ${username} not found`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (userResult.recordset[0].AccountType !== 'Super Admin') {
      writeLog(`[${getISTTimeString()}] License History: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: 'Access denied: Super Admin only' });
    }

    const result = await pool.request()
      .query('SELECT * FROM Licenses ORDER BY CreatedAt DESC');

    writeLog(`[${getISTTimeString()}] License History: Fetched for ${username}, Count: ${result.recordset.length}`);
    res.status(200).json({ success: true, licenses: result.recordset });
  } catch (err) {
    writeLog(`[${getISTTimeString()}] License History: Error for ${username}: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/* 10.2 User Management APIs */
// APIs for user registration, authentication, and profile management
/**
 * API 10.9.07 - POST /register
 * Registers a new user
 */
// SECURITY: This legacy endpoint stored plaintext passwords and had no auth.
// It has been disabled. User creation now goes through the authenticated,
// bcrypt-hashed POST /api/user route (Create User page).
app.post("/register", (req, res) => {
  writeLog(`[${getISTTimeString()}] Rejected call to deprecated /register endpoint`);
  return res.status(410).json({
    success: false,
    message: "This endpoint has been removed. Use the Create User page (POST /api/user).",
  });
});

/**
 * API 10.10.08 - POST /api/login
 * Authenticates a user and creates a session
 */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    console.log("Missing credentials in /api/login: ${JSON.stringify({ username })}");
    return res.status(400).json({ success: false, message: "Username and password required." });
  }

  try {
    console.log("Login attempt for user: ${username}");

    const pool = await connectToDatabase();
    const queryResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT Password, AccountType FROM dbo.Users WHERE Username = @username`);

    if (queryResult.recordset.length === 0) {
      console.log("User not found: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const user = queryResult.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      console.log("Invalid password for user: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    if (global.licensePayload) {
      const maxUsers = global.licensePayload.users;
      const activeSessions = await pool.request()
        .query("SELECT COUNT(*) AS count FROM ActiveSessions WHERE IsActive = 1");
      const activeCount = activeSessions.recordset[0].count;
      if (activeCount >= maxUsers) {
        writeLog(`[${getISTTimeString()}] Login failed: Maximum login count (${maxUsers}) reached for ${username}`);
        return res.status(403).json({ success: false, message: "Maximum login count reached." });
      }
    } else {
      writeLog(`[${getISTTimeString()}] Login warning: No license payload found for ${username}`);
    }

    const userType = user.AccountType || "Agent";
    const insertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const logId = insertLog.recordset[0].LogID;

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive)
        VALUES (@Username, @LogID, @LoginTime, 1);
      `);

    console.log("Login successful for user: ${username}, LogID: ${logId}");
    return res.status(200).json({ success: true, message: "Login successful.", userType, logId });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/login: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.11.09 - POST /api/login-security
 * Authenticates a user with security question verification
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset is sensitive; cap attempts harder than login.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many password reset attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Uploads are expensive; rate-limit per window.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many uploads. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/login-security", loginLimiter, async (req, res) => {
  const { userId, password, questionType, questionAnswer } = req.body;
  if (!userId || !password || !questionType || !questionAnswer) {
    writeLog(`[${getISTTimeString()}] Login failed: Missing fields for UserID ${userId}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }
  try {
    const pool = await sqlConnect();
    const user = await fetchUserForLogin(pool, userId);
    if (!user) {
      writeLog(`[${getISTTimeString()}] Login failed: User ${userId} not found`);
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      writeLog(`[${getISTTimeString()}] Login failed: Invalid password for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }
    if (!user.SecurityQuestionType || !user.SecurityQuestionAnswer
        || user.SecurityQuestionType !== questionType) {
      writeLog(`[${getISTTimeString()}] Login failed: Security question mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const answerOk = await checkSecurityAnswer(pool, user, questionAnswer);
    if (!answerOk) {
      writeLog(`[${getISTTimeString()}] Login failed: Security answer mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const username = user.Username;
    const sessionUserId = getLoginIdForSession(user);
    const userType = user.AccountType || "Agent";
    const insertLog = await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO UserSessionLog (UserID, Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@UserID, @Username, @UserType, @LoginTime);
      `);
    const logId = insertLog.recordset[0].LogID;
    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (UserID, Username, LogID, LoginTime, IsActive, Token)
        VALUES (@UserID, @Username, @LogID, @LoginTime, 1, @Token);
      `);
    writeLog(`[${getISTTimeString()}] Login successful for UserID ${sessionUserId}, Username: ${username}, LogID: ${logId}`);
    return res.status(200).json({
      success: true,
      userId: sessionUserId,
      username,
      userType,
      logId,
      token: sessionToken,
    });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/login-security: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Login error for UserID ${userId}: ${error.message}`);
    if (error.message.includes("connect") || error.message.includes("timeout")) {
      return res.status(503).json({ success: false, message: "Unable to connect to the server. Please check your network." });
    }
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

/**
 * API 10.68.660 - POST /api/logout-track
 * Tracks user logout and marks session as inactive
 */
app.post("/api/logout-track", async (req, res) => {
  const { userId, logId, token } = req.body;
  if (!userId || !logId || !token) {
    console.log(`[${getISTTimeString()}] Missing fields in /api/logout-track: ${JSON.stringify({ userId, logId, token })}`);
    return res.status(400).json({ success: false, message: "UserID, LogID, and token are required." });
  }
  try {
    const pool = await sqlConnect();
    console.log(`[${getISTTimeString()}] Attempting to logout UserID: ${userId}, LogID: ${logId}`);
    const logoutTime = new Date();
    const result = await pool.request()
      .input("UserID", sql.NVarChar, userId)
      .input("LogID", sql.Int, logId)
      .input("Token", sql.NVarChar, token)
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE UserID = @UserID 
          AND LogID = @LogID 
          AND Token = @Token;
      `);
    await pool.request()
      .input("LogID", sql.Int, logId)
      .input("LogoutTime", sql.DateTime, logoutTime)
      .query(`
        UPDATE UserSessionLog
        SET LogoutTime = @LogoutTime
        WHERE LogID = @LogID AND LogoutTime IS NULL;
      `);
    if (result.rowsAffected[0] === 0) {
      console.warn(`[${getISTTimeString()}] No session found or already inactive for UserID: ${userId}, LogID: ${logId}`);
      // Verify if the session exists and update if necessary
      const verifyResult = await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("LogID", sql.Int, logId)
        .input("Token", sql.NVarChar, token)
        .query(`
          SELECT IsActive FROM ActiveSessions 
          WHERE UserID = @UserID AND LogID = @LogID AND Token = @Token
        `);
      if (verifyResult.recordset.length > 0) {
        if (verifyResult.recordset[0].IsActive === 0) {
          console.log(`[${getISTTimeString()}] Session already marked inactive for UserID: ${userId}, LogID: ${logId}`);
          return res.status(200).json({ success: true, message: "Session already inactive." });
        } else {
          console.warn(`[${getISTTimeString()}] Session found but not updated, forcing update for UserID: ${userId}, LogID: ${logId}`);
          await pool.request()
            .input("UserID", sql.NVarChar, userId)
            .input("LogID", sql.Int, logId)
            .input("Token", sql.NVarChar, token)
            .query(`
              UPDATE ActiveSessions
              SET IsActive = 0
              WHERE UserID = @UserID 
                AND LogID = @LogID 
                AND Token = @Token;
            `);
          return res.status(200).json({ success: true, message: "Logout forced successfully." });
        }
      }
      return res.status(404).json({ success: false, message: "No session found to logout." });
    }
    console.log(`[${getISTTimeString()}] Logout successful for UserID: ${userId}, LogID: ${logId}`);
    return res.status(200).json({ success: true, message: "Logout successful." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/logout-track: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Logout error for UserID ${userId}, LogID ${logId}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during logout." });
  }
});

/**
 * API 10.72.701 - GET /api/user/:username
 * Retrieves user details
 */
app.get("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    if (!assertSelfOrElevated(req, username)) {
      return res.status(403).json({ success: false, message: "You can only view your own profile." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`
        SELECT U.Username, U.Email, U.AccountType,
               U.SecurityQuestionType,
               U.CreatedBy, U.CreationDate,
               (SELECT MAX(LoginTime) FROM dbo.UserSessionLog WHERE Username = U.Username) AS LastLoginTime
        FROM dbo.Users AS U
        WHERE LOWER(U.Username) = LOWER(@username)
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const userRow = result.recordset[0];
    return res.status(200).json({
      success: true,
      user: {
        Username: userRow.Username || "",
        Email: userRow.Email || "Not Provided",
        AccountType: userRow.AccountType || "Standard",
        SecurityQuestionType: userRow.SecurityQuestionType || "Not Set",
        CreatedBy: userRow.CreatedBy || "N/A",
        CreationDate: userRow.CreationDate || null,
        LastLoginTime: userRow.LastLoginTime || null
      }
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.75.732 - PUT /api/user/:username/security-question
 * Updates a user's security question
 */
app.put("/api/user/:username/security-question", async (req, res) => {
  const { username } = req.params;
  const { question, answer } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ success: false, message: "Security question and answer are required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "You can only update your own security question." });
  }
  try {
    const pool = await connectToDatabase();
    const userCheck = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const hashedAnswer = await hashSecurityAnswer(answer);
    await pool.request()
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, hashedAnswer)
      .input("username", sql.NVarChar, username)
      .query(`
        UPDATE dbo.Users
        SET SecurityQuestionType = @question,
            SecurityQuestionAnswer = @answer
        WHERE LOWER(Username) = LOWER(@username)
      `);
    return res.status(200).json({ success: true, message: "Security question updated successfully." });
  } catch (error) {
    console.error("Error updating security question:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.80.783 - PUT /api/user/:username/email
 * Updates a user's email
 */
app.put("/api/user/:username/email", async (req, res) => {
  const { username } = req.params;
  const { email } = req.body;
  if (!email) {
    return res.status(400).send({ success: false, message: "Email is required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).send({ success: false, message: "You can only update your own email." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("newEmail", sql.NVarChar, email)
      .input("username", sql.NVarChar, username)
      .query("UPDATE Users SET Email = @newEmail WHERE Username = @username");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).send({ success: false, message: "User not found." });
    }
    return res.status(200).send({ success: true, message: "Email updated successfully." });
  } catch (error) {
    console.error("Update email error:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.16.14 - PUT /api/user/:username/password
 * Updates a user's password
 */
app.put("/api/user/:username/password", async (req, res) => {
  const { username } = req.params;
  const { oldPassword, newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).send({ success: false, message: "New password is required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).send({ success: false, message: "New password must be at least 8 characters long." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).send({ success: false, message: "You can only change your own password." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username, Password FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");

    if (userResult.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "User not found." });
    }

    const userRow = userResult.recordset[0];
    if (oldPassword) {
      const passwordMatch = await bcrypt.compare(oldPassword, userRow.Password);
      if (!passwordMatch) {
        return res.status(401).send({ success: false, message: "Current password is incorrect." });
      }
    } else if (req.user?.accountType === "Agent") {
      return res.status(400).send({ success: false, message: "Current password is required." });
    }

    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    await pool.request()
      .input("newPassword", sql.NVarChar, newPasswordHash)
      .input("username", sql.NVarChar, username)
      .query("UPDATE dbo.Users SET Password = @newPassword WHERE LOWER(Username) = LOWER(@username)");

    return res.status(200).send({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in PUT /api/user/${username}/password: ${error.message}`);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.16.14.1 - API - GET /api/user/:userId
 * Fetches user details by UserID for handleTempLogin
 */
app.get("/api/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sqlConnect();
    const result = await pool.request()
      .input("userId", sql.NVarChar, userId)
      .query(`SELECT Username, AccountType FROM dbo.Users WHERE UserID = @userId`);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.status(200).json({ success: true, user: result.recordset[0] });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching user data:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});


/**
 * API 10.9.07 - POST /api/user
 * Purpose: Registers a new user with hashed password and security question.
 * Compliance: ISO 27001 (Secure user registration)
 */
app.post("/api/user", async (req, res) => {
  const { userId, username, password, email, userType, SecurityQuestionType, SecurityQuestionAnswer, createdBy } = req.body;
  const loginId = String(userId || "").trim();
  const creator = String(createdBy || req.user?.username || "").trim();
  const validRoles = ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor", "Agent", "IT"];
  if (!loginId || !username || !password || !email || !userType || !SecurityQuestionType || !SecurityQuestionAnswer || !creator) {
    writeLog(`[${getISTTimeString()}] User registration failed: Missing required fields for login ID ${loginId || 'N/A'}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }
  if (!validRoles.includes(userType)) {
    return res.status(400).json({ success: false, message: `Invalid user type. Must be one of: ${validRoles.join(", ")}` });
  }
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can create users."))) return;
    const pool = await connectToDatabase();
    const userCheck = await pool.request()
      .input("loginId", sql.NVarChar, loginId)
      .query(`
        SELECT UserID FROM dbo.Users
        WHERE LoginAlias = @loginId COLLATE SQL_Latin1_General_CP1_CI_AS
      `);
    if (userCheck.recordset.length > 0) {
      writeLog(`[${getISTTimeString()}] User registration failed: Login ID ${loginId} already exists`);
      return res.status(400).json({ success: false, message: "UserID already exists." });
    }
    const usernameCheck = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE Username = @username");
    if (usernameCheck.recordset.length > 0) {
      writeLog(`[${getISTTimeString()}] User registration failed: Username ${username} already exists`);
      return res.status(400).json({ success: false, message: "Username already exists." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const securityAnswerHash = await hashSecurityAnswer(SecurityQuestionAnswer);

    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, passwordHash)
      .input("email", sql.NVarChar, email)
      .input("userType", sql.NVarChar, userType)
      .input("securityQuestionType", sql.NVarChar, SecurityQuestionType)
      .input("securityQuestionAnswer", sql.NVarChar, securityAnswerHash)
      .input("createdBy", sql.NVarChar, creator)
      .input("creationDate", sql.DateTime, new Date())
      .input("loginAlias", sql.NVarChar, loginId)
      .query(`
        INSERT INTO Users (Username, Password, Email, AccountType, SecurityQuestionType, SecurityQuestionAnswer, CreatedBy, CreationDate, LoginAlias)
        VALUES (@username, @password, @email, @userType, @securityQuestionType, @securityQuestionAnswer, @createdBy, @creationDate, @loginAlias)
      `);
    writeLog(`[${getISTTimeString()}] User registered successfully: LoginAlias ${loginId}, Username ${username}`);
    res.status(201).json({ success: true, message: "User registered successfully." });
  } catch (error) {
    console.error("Registration error:", error);
    writeLog(`[${getISTTimeString()}] Registration error for login ID ${loginId || 'N/A'}: ${error.message}`);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.070 - POST /api/reset-password
 * Resets a user's password with security question verification
 */
app.post("/api/reset-password", passwordResetLimiter, async (req, res) => {
  const { username, email, securityQuestion, securityAnswer, newPassword } = req.body;

  if (!username || !email || !securityQuestion || !securityAnswer || !newPassword) {
    console.log("Missing fields in /api/reset-password: ${JSON.stringify({ username, email, securityQuestion, securityAnswer })}");
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  const sanitizedUsername = username.trim();
  const sanitizedEmail = email.trim();
  const sanitizedQuestion = securityQuestion.trim();
  const sanitizedAnswer = securityAnswer.trim();
  const sanitizedPassword = newPassword.trim();

  if (sanitizedPassword.length < 8) {
    console.log("Password too short for user: ${sanitizedUsername}");
    return res.status(400).json({ success: false, message: "New password must be at least 8 characters long." });
  }

  try {
    console.log("Password reset attempt for user: ${sanitizedUsername}");

    const pool = await connectToDatabase();

    const userResult = await pool.request()
      .input("username", sql.NVarChar, sanitizedUsername)
      .input("email", sql.NVarChar, sanitizedEmail)
      .input("securityQuestion", sql.NVarChar, sanitizedQuestion)
      .query(`
        SELECT * FROM dbo.Users 
        WHERE Username = @username 
        AND Email = @email 
        AND SecurityQuestionType = @securityQuestion
      `);

    if (userResult.recordset.length === 0) {
      console.log("No matching user found for: ${sanitizedUsername}, email: ${sanitizedEmail}");
      return res.status(404).json({ 
        success: false, 
        message: "No user found with the provided details or incorrect security answer." 
      });
    }

    const userRow = userResult.recordset[0];
    const answerOk = await checkSecurityAnswer(pool, userRow, sanitizedAnswer);
    if (!answerOk) {
      console.log("Incorrect security answer for user: ${sanitizedUsername}");
      return res.status(404).json({
        success: false,
        message: "No user found with the provided details or incorrect security answer.",
      });
    }

    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(sanitizedPassword, saltRounds);

    await pool.request()
      .input("newPassword", sql.NVarChar, hashedNewPassword)
      .input("username", sql.NVarChar, sanitizedUsername)
      .query("UPDATE dbo.Users SET Password = @newPassword WHERE Username = @username");

    writeLog(`Password reset for user: ${sanitizedUsername} at ${getISTTimeString()}`);

    console.log("Password reset successful for user: ${sanitizedUsername}");

    return res.status(200).json({ success: true, message: "Password reset successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Reset password error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during password reset." });
  }
});

/**
 * API 10.9.071 - POST /api/get-username
 * Retrieves username by email and government ID
 */
app.post("/api/get-username", async (req, res) => {
  const { email, govID } = req.body;
  if (!email || !govID) {
    return res.status(400).send({ success: false, message: "Email and Government ID are required." });
  }
  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("email", sql.NVarChar, email)
      .input("govID", sql.NVarChar, govID)
      .query("SELECT Username FROM Users WHERE Email = @email AND GovID = @govID");
    if (userResult.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "No user found with the provided details." });
    }
    const username = userResult.recordset[0].Username;
    return res.status(200).send({ success: true, username });
  } catch (error) {
    console.error("Fetch username error:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.072 - POST /api/get-security-question-type
 * Fetches security question type by username
 */
app.post("/api/get-security-question-type", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }

  const sanitizedUsername = username.trim();

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, sanitizedUsername)
      .query("SELECT SecurityQuestionType FROM dbo.Users WHERE Username = @username");

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const securityQuestionType = result.recordset[0].SecurityQuestionType;
    if (!securityQuestionType) {
      return res.status(404).json({ success: false, message: "Security question not set for this user." });
    }

    return res.status(200).json({ success: true, securityQuestionType });
  } catch (error) {
    console.error("Error fetching security question:", error);
    return res.status(500).json({ success: false, message: "Server error fetching security question." });
  }
});

/**
 * API 10.12.90 - POST /api/temp-super-admin-login
 * Authenticates a Super Admin with security question verification for emergency login
 */
app.post("/api/temp-super-admin-login", loginLimiter, async (req, res) => {
  const { userId, password, questionType, questionAnswer } = req.body;
  if (!userId || !password || !questionType || !questionAnswer) {
    writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Missing fields for UserID ${userId}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  try {
    const pool = await sqlConnect();
    console.log(`[${getISTTimeString()}] Checking temp Super Admin login for UserID: ${userId}`);
    const user = await fetchUserForLogin(pool, userId);

    if (!user) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: User ${userId} not found`);
      return res.status(401).json({ success: false, message: "Invalid UserID or credentials." });
    }
    console.log(`[${getISTTimeString()}] Verifying password for UserID: ${userId}`);
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Invalid password for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid UserID or password." });
    }

    console.log(`[${getISTTimeString()}] Verifying security question for UserID: ${userId}, Question: ${questionType}, Answer: ${questionAnswer}`);
    if (!user.SecurityQuestionType || !user.SecurityQuestionAnswer
        || user.SecurityQuestionType !== questionType) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Security question mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const answerOk = await checkSecurityAnswer(pool, user, questionAnswer);
    if (!answerOk) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Security answer mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }

    if (user.AccountType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: User ${userId} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can use emergency login." });
    }

    const username = user.Username;
    const sessionUserId = getLoginIdForSession(user);
    const userType = user.AccountType;
    const insertLog = await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO UserSessionLog (UserID, Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@UserID, @Username, @UserType, @LoginTime);
      `);
    const logId = insertLog.recordset[0].LogID;
    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (UserID, Username, LogID, LoginTime, IsActive, Token)
        VALUES (@UserID, @Username, @LogID, @LoginTime, 1, @Token);
      `);

    writeLog(`[${getISTTimeString()}] Temp Super Admin login successful for UserID ${sessionUserId}, Username: ${username}, LogID: ${logId}`);
    return res.status(200).json({ success: true, username, userType, logId, sessionToken });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/temp-super-admin-login: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Temp Super Admin login error for UserID ${userId}: ${error.message}`);
    if (error.message.includes('connect') || error.message.includes('timeout')) {
      return res.status(503).json({ success: false, message: "Unable to connect to the server. Please check your network." });
    }
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

/**
 * API 10.1.01 - GET /api/users/list
 * Purpose: Retrieves a list of all users.
 * Compliance: ISO 27001 (Secure data retrieval)
 */
app.get('/api/users/list', async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can list users."))) return;
    const pool = await sql.connect(config);
    const result = await pool.request()
      .query(`
        SELECT 
          UserID,
          Username,
          Email,
          AccountType,
          SecurityQuestionType,
          CreatedBy,
          CreationDate
        FROM dbo.Users
        ORDER BY CreationDate DESC
      `);

    if (result.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] No users found`);
      return res.status(404).json({ success: false, message: 'No users found.' });
    }

    writeLog(`[${getISTTimeString()}] Successfully fetched ${result.recordset.length} users`);
    return res.status(200).json({ success: true, users: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching users: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error fetching users: ' + error.message });
  }
});

/**
 * API 10.9.075 - GET /api/users/search
 * Searches users by username
 */
app.get("/api/users/search", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can search users."))) return;
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, message: "Query parameter 'q' is required." });
    }

    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('query', `%${q}%`)
      .query(`
        SELECT 
          UserID,
          Username,
          Email,
          AccountType,
          SecurityQuestionType,
          CreatedBy,
          CreationDate
        FROM dbo.Users
        WHERE Username LIKE @query
        ORDER BY Username
      `);
    return res.status(200).json({ success: true, users: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in GET /api/users/search: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.076 - DELETE /api/user/:username
 * Deletes a user
 */
app.delete("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can delete users."))) return;
    const pool = await connectToDatabase();
    const checkResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    if (!checkResult.recordset.length) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    await pool.request()
      .input("username", sql.NVarChar, username)
      .query("DELETE FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    return res.status(200).json({ success: true, message: `User '${username}' deleted successfully.` });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting user." });
  }
});

/* 10.3 Session Management APIs */
/**
 * API 10.25.23 - POST /api/verify-session
 * Verifies an active user session
 */
app.post("/api/verify-session", async (req, res) => {
  const { username, token } = req.body;
  if (!username || !token) {
    return res.status(400).json({ success: false, message: "Username and token are required." });
  }

  try {
    const pool = await connectToDatabase();
    const sessionResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, token)
      .query("SELECT * FROM ActiveSessions WHERE Username = @username AND Token = @token AND IsActive = 1");

    if (sessionResult.recordset.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    return res.status(200).json({ success: true, message: "Session verified." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error verifying session." });
  }
});

/**
 * API 10.26.24 - POST /api/refresh-session
 * Refreshes a Super Admin's session
 */
app.post("/api/refresh-session", async (req, res) => {
  const { username, currentToken } = req.body;
  if (!username || !currentToken) {
    writeLog(`[${getISTTimeString()}] Refresh session failed: Missing username or currentToken`);
    return res.status(400).json({ success: false, message: "Username and current token are required." });
  }

  try {
    const pool = await connectToDatabase();

    const sessionResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, currentToken)
      .query("SELECT LogID FROM ActiveSessions WHERE Username = @username AND Token = @token AND IsActive = 1");

    if (sessionResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Refresh session failed: Invalid or expired session for ${username}`);
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    const logId = sessionResult.recordset[0].LogID;

    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, currentToken)
      .query("UPDATE ActiveSessions SET IsActive = 0 WHERE Username = @username AND Token = @token AND IsActive = 1");

    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0 || userResult.recordset[0].AccountType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] Refresh session failed: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can refresh sessions." });
    }

    const newInsertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, "Super Admin")
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const newLogId = newInsertLog.recordset[0].LogID;

    const newSessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, newLogId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, newSessionToken)
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive, Token)
        VALUES (@Username, @LogID, @LoginTime, 1, @Token);
      `);

    writeLog(`[${getISTTimeString()}] Session refreshed for ${username}: Old LogID ${logId}, New LogID ${newLogId}`);
    return res.status(200).json({ success: true, sessionToken: newSessionToken });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Refresh session error for ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error refreshing session." });
  }
});

/**
 * API 10.27.25 - POST /api/invalidate-session
 * Invalidates a user session
 */
app.post("/api/invalidate-session", async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const { username, token } = JSON.parse(body);
      if (!username || !token) {
        writeLog(`[${getISTTimeString()}] Invalidate session failed: Missing username or token`);
        return res.status(400).json({ success: false, message: "Username and token are required." });
      }

      const pool = await connectToDatabase();
      const result = await pool.request()
        .input("username", sql.NVarChar, username)
        .input("token", sql.NVarChar, token)
        .query("UPDATE ActiveSessions SET IsActive = 0 WHERE Username = @username AND Token = @token AND IsActive = 1");

      if (result.rowsAffected[0] === 0) {
        writeLog(`[${getISTTimeString()}] Invalidate session failed: No active session found for ${username}`);
        return res.status(404).json({ success: false, message: "No active session found." });
      }

      writeLog(`[${getISTTimeString()}] Session invalidated for ${username}`);
      return res.status(200).json({ success: true, message: "Session invalidated." });
    } catch (error) {
      writeLog(`[${getISTTimeString()}] Invalidate session error: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error invalidating session." });
    }
  });
});

/* Session Cleanup Job */
// Periodically clears stale sessions older than 24 hours
setInterval(async () => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE LoginTime < DATEADD(HOUR, -24, GETDATE());
      `);
    if (result.rowsAffected[0] > 0) {
      writeLog(`[${getISTTimeString()}] Cleared ${result.rowsAffected[0]} stale sessions older than 24 hours.`);
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error clearing stale sessions: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Error clearing stale sessions: ${error.message}`);
  }
}, 60 * 60 * 1000); // Run every hour

/* Stale audio processing cleanup — mark >1h in-progress calls as failed */
setInterval(async () => {
  try {
    const pool = await connectToDatabase();
    const marked = await markStaleProcessingAsFailed(pool);
    if (marked > 0) {
      writeLog(`[${getISTTimeString()}] Marked ${marked} stale audio job(s) as failed (>1 hour).`);
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error marking stale audio jobs: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Error marking stale audio jobs: ${error.message}`);
  }
}, 10 * 60 * 1000);

/* 10.4 Audio Processing APIs */
// APIs for handling audio file uploads and processing

/**
 * POST /api/internal/transcription-callback
 * Cloud GPU callback when Jarvis orchestrator cannot reach SQL Server (DB_ENABLED=false).
 */
app.post("/api/internal/transcription-callback", async (req, res) => {
  const expectedSecret = process.env.CALLBACK_SECRET;
  const providedSecret = req.headers["x-callback-secret"];

  if (!expectedSecret || providedSecret !== expectedSecret) {
    writeLog(`[${getISTTimeString()}] Transcription callback rejected: invalid secret`);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const {
    audioFile,
    type,
    processStatus,
    stage,
    progress,
    message,
    language,
    transcript,
    translateOutput,
    duration,
    diarizationStatus,
    scoringRaw,
    scores,
    summary,
    sentiment,
    scriptCompliance,
    toneAnalysis,
    processingSeconds,
    error,
  } = req.body || {};

  if (!audioFile) {
    return res.status(400).json({ success: false, message: "Missing audioFile" });
  }

  try {
    const pool = await connectToDatabase();

    if (type === "status" || type === "failed") {
      const reqStage = (stage || "").trim();
      const reqProgress = typeof progress === "number" ? progress : null;
      const reqMessage = (message || "").trim();
      const reqLanguage = (language || "").trim();

      if (reqStage && reqProgress != null && reqMessage) {
        await pool.request()
          .input("status", sql.NVarChar, processStatus)
          .input("stage", sql.NVarChar, reqStage.slice(0, 50))
          .input("pct", sql.Int, Math.max(0, Math.min(100, reqProgress)))
          .input("msg", sql.NVarChar, reqMessage.slice(0, 500))
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AudioUploads
            SET ProcessStatus = @status,
                ProcessStage = @stage,
                ProcessProgress = @pct,
                ProcessMessage = @msg
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("status", sql.NVarChar, processStatus)
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AudioUploads
            SET ProcessStatus = @status
            WHERE AudioFileName = @fileName
          `);
      }

      if (reqLanguage) {
        const countResult = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
        const exists = countResult.recordset[0].cnt > 0;
        if (exists) {
          await pool.request()
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE AI_Processing_Result
              SET OriginalLanguage = @language, AudioLanguage = @language
              WHERE AudioFileName = @fileName
            `);
        } else {
          await pool.request()
            .input("fileName", sql.NVarChar, audioFile)
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .query(`
              INSERT INTO AI_Processing_Result (
                AudioFileName, OriginalLanguage, AudioLanguage, Status, Timestamp
              )
              VALUES (@fileName, @language, @language, 'Processing', GETDATE())
            `);
        }
      }

      if (type === "status") {
        await logCallEvent(pool, {
          audioFile,
          stage: stage || "status",
          message: message || processStatus || "Processing update",
          level: "INFO",
        });
      }

      if (type === "failed") {
        await logCallEvent(pool, {
          audioFile,
          stage: stage || "failed",
          message: message || processStatus || "Processing failed",
          level: "ERROR",
          detail: error ? String(error) : (message || null),
        });
      }
    }

    if (type === "language") {
      const reqLanguage = (language || "").trim();
      if (reqLanguage) {
        const countResult = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
        const exists = countResult.recordset[0].cnt > 0;
        if (exists) {
          await pool.request()
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE AI_Processing_Result
              SET OriginalLanguage = @language, AudioLanguage = @language
              WHERE AudioFileName = @fileName
            `);
        } else {
          await pool.request()
            .input("fileName", sql.NVarChar, audioFile)
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .query(`
              INSERT INTO AI_Processing_Result (
                AudioFileName, OriginalLanguage, AudioLanguage, Status, Timestamp
              )
              VALUES (@fileName, @language, @language, 'Processing', GETDATE())
            `);
        }
      }
    }

    if (type === "result") {
      const countResult = await pool.request()
        .input("fileName", sql.NVarChar, audioFile)
        .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
      const exists = countResult.recordset[0].cnt > 0;

      if (exists) {
        await pool.request()
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AI_Processing_Result
            SET TranscribeOutput = @transcript, TranslateOutput = @transcript,
                AudioLanguage = @language, OriginalLanguage = @language,
                AudioDuration = @duration,
                AudioDiarization = @diarization, AIScoring = NULL,
                Sentiment = NULL, Status = 'Transcribed', Timestamp = GETDATE()
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .query(`
            INSERT INTO AI_Processing_Result (
              AudioFileName, TranscribeOutput, TranslateOutput,
              AudioLanguage, AudioDuration, AudioDiarization,
              Status, Timestamp
            )
            VALUES (
              @fileName, @transcript, @transcript,
              @language, @duration, @diarization,
              'Transcribed', GETDATE()
            )
          `);
      }

      await pool.request()
        .input("status", sql.NVarChar, processStatus || "Transcribed")
        .input("fileName", sql.NVarChar, audioFile)
        .query(`
          UPDATE AudioUploads
          SET ProcessStatus = @status
          WHERE AudioFileName = @fileName
        `);

      await logCallEvent(pool, {
        audioFile,
        stage: "transcription",
        message: "Transcription result stored",
        level: "INFO",
      });
    }

    if (type === "scoring") {
      const englishText = translateOutput || transcript || "";
      const scoringJson = scoringRaw || (scores ? JSON.stringify(scores) : null);
      const sentimentJson = sentiment ? JSON.stringify(sentiment) : null;
      const toneJson = toneAnalysis ? JSON.stringify(toneAnalysis) : null;
      const wpm = computeWPM(englishText, duration);
      const procTime = processingSeconds != null ? `${Math.round(processingSeconds)}s` : null;

      const countResult = await pool.request()
        .input("fileName", sql.NVarChar, audioFile)
        .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");

      if (countResult.recordset[0].cnt > 0) {
        await pool.request()
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("scoring", sql.NVarChar(sql.MAX), scoringJson)
          .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
          .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
          .input("compliance", sql.NVarChar, scriptCompliance || null)
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AI_Processing_Result
            SET TranscribeOutput = @transcript, TranslateOutput = @translateOutput,
                AudioLanguage = @language, OriginalLanguage = @language, AudioDuration = @duration,
                AudioDiarization = @diarization, AIScoring = @scoring,
                Sentiment = @sentimentJ, ToneAnalysis = @toneJ,
                ScriptCompliance = @compliance,
                Status = 'Success', Timestamp = GETDATE()
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("scoring", sql.NVarChar(sql.MAX), scoringJson)
          .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
          .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
          .input("compliance", sql.NVarChar, scriptCompliance || null)
          .query(`
            INSERT INTO AI_Processing_Result (
              AudioFileName, TranscribeOutput, TranslateOutput,
              AudioLanguage, AudioDuration, AudioDiarization,
              AIScoring, Sentiment, ToneAnalysis, ScriptCompliance,
              Status, Timestamp
            )
            VALUES (
              @fileName, @transcript, @translateOutput,
              @language, @duration, @diarization,
              @scoring, @sentimentJ, @toneJ, @compliance,
              'Success', GETDATE()
            )
          `);
      }

      try {
        const caaCheck = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT UploadID FROM Consolidated_Audio_Analysis WHERE AudioFileName = @fileName");
        if (caaCheck.recordset.length > 0) {
          // Phase 2d intelligence fields (sent merged into `scores` by the orchestrator).
          const s = scores || {};
          const numOrNull = (v) => (v == null || v === "" || isNaN(parseFloat(v)) ? null : parseFloat(v));
          let secondaryJson = "[]";
          try {
            const sec = Array.isArray(s.Secondary_Query_Types) ? s.Secondary_Query_Types : [];
            secondaryJson = JSON.stringify(sec);
          } catch (_) { secondaryJson = "[]"; }

          await pool.request()
            .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
            .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
            .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
            .input("compliance", sql.NVarChar, scriptCompliance || null)
            .input("summaryText", sql.NVarChar(sql.MAX), summary || null)
            .input("language", sql.NVarChar, language)
            .input("duration", sql.NVarChar, duration)
            .input("wpm", sql.Float, wpm)
            .input("procTime", sql.NVarChar, procTime)
            .input("primaryQuery", sql.NVarChar, (s.Primary_Query_Type || "Other/General Info").toString().slice(0, 100))
            .input("secondaryQuery", sql.NVarChar(sql.MAX), secondaryJson)
            .input("escRequested", sql.NVarChar, (s.Escalation_Requested || "No").toString().slice(0, 10))
            .input("escActioned", sql.NVarChar, (s.Escalation_Actioned || "N/A").toString().slice(0, 10))
            .input("escCategory", sql.NVarChar, (s.Escalation_Category || "None").toString().slice(0, 50))
            .input("csatTransferred", sql.NVarChar, (s.CSAT_Transferred || "No").toString().slice(0, 10))
            .input("isLoan", sql.NVarChar, (s.Loan_Is_Loan_Call || "No").toString().slice(0, 10))
            .input("loanType", sql.NVarChar, (s.Loan_Type || "None").toString().slice(0, 50))
            .input("loanInterest", sql.NVarChar, (s.Loan_Interest || "None").toString().slice(0, 20))
            .input("emiAfford", sql.NVarChar, (s.EMI_Affordability || "Not Discussed").toString().slice(0, 20))
            .input("emiAmount", sql.Float, numOrNull(s.EMI_Amount))
            .input("loanAmount", sql.Float, numOrNull(s.Loan_Amount))
            .input("agentConvinced", sql.NVarChar, (s.Agent_Convinced || "N/A").toString().slice(0, 20))
            .input("successProb", sql.Float, numOrNull(s.Loan_Success_Probability) || 0)
            .input("intelSummary", sql.NVarChar(sql.MAX), (s.Intelligence_Summary || "").toString().slice(0, 4000))
            .input("intelBlob", sql.NVarChar(sql.MAX), JSON.stringify({
              Primary_Query_Type: s.Primary_Query_Type, Secondary_Query_Types: s.Secondary_Query_Types,
              Escalation_Requested: s.Escalation_Requested, Escalation_Actioned: s.Escalation_Actioned,
              Escalation_Category: s.Escalation_Category, CSAT_Transferred: s.CSAT_Transferred,
              Loan_Is_Loan_Call: s.Loan_Is_Loan_Call,
              Loan_Type: s.Loan_Type, Loan_Interest: s.Loan_Interest, EMI_Affordability: s.EMI_Affordability,
              EMI_Amount: s.EMI_Amount, Loan_Amount: s.Loan_Amount, Agent_Convinced: s.Agent_Convinced,
              Loan_Success_Probability: s.Loan_Success_Probability, Intelligence_Summary: s.Intelligence_Summary,
            }))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE Consolidated_Audio_Analysis
              SET TranslateOutput = @translateOutput, ToneAnalysis = @toneJ,
                  Sentiment = @sentimentJ, ScriptCompliance = @compliance,
                  AI_Summary = @summaryText, AudioLanguage = @language,
                  AudioDuration = @duration, AudioWPM = @wpm,
                  TotalDurationOfAIProcessing = @procTime, Status = 'Success',
                  AI_Primary_Query_Type = @primaryQuery,
                  AI_Secondary_Query_Types = @secondaryQuery,
                  AI_Escalation_Requested = @escRequested,
                  AI_Escalation_Actioned = @escActioned,
                  AI_Escalation_Category = @escCategory,
                  AI_CSAT_Transferred = @csatTransferred,
                  AI_Loan_Is_Loan_Call = @isLoan,
                  AI_Loan_Type = @loanType,
                  AI_Loan_Interest = @loanInterest,
                  AI_EMI_Affordability = @emiAfford,
                  AI_EMI_Amount = @emiAmount,
                  AI_Loan_Amount = @loanAmount,
                  AI_Agent_Convinced = @agentConvinced,
                  AI_Loan_Success_Probability = @successProb,
                  AI_Intelligence_Summary = @intelSummary,
                  AI_Call_Intelligence = @intelBlob
              WHERE AudioFileName = @fileName
            `);
        }
      } catch (_) { }

      await pool.request()
        .input("status", sql.NVarChar, processStatus || "AI Process Complete")
        .input("fileName", sql.NVarChar, audioFile)
        .query(`
          UPDATE AudioUploads SET ProcessStatus = @status WHERE AudioFileName = @fileName
        `);

      await logCallEvent(pool, {
        audioFile,
        stage: "scoring",
        message: "Scoring result stored",
        level: "INFO",
      });
    }

    writeLog(
      `[${getISTTimeString()}] Transcription callback OK: ${audioFile} (${type})` +
      (error ? ` error=${String(error).slice(0, 120)}` : "")
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    writeLog(`[${getISTTimeString()}] Transcription callback failed for ${audioFile}: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * API 10.28.26 - POST /upload-audio
 * Uploads an audio file for analysis
 */
app.post("/upload-audio", authGate(sqlConnect, sql), uploadLimiter, handleAudioUpload, (req, res) => {
  uploadHandler.handleFileUpload(req, res, config);
});

async function ensureAudioUploadProgressColumns(pool) {
  const statements = [
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessStage')
      ALTER TABLE dbo.AudioUploads ADD ProcessStage NVARCHAR(50) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessProgress')
      ALTER TABLE dbo.AudioUploads ADD ProcessProgress INT NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessMessage')
      ALTER TABLE dbo.AudioUploads ADD ProcessMessage NVARCHAR(500) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ASREngine')
      ALTER TABLE dbo.AI_Processing_Result ADD ASREngine NVARCHAR(200) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ScoringModel')
      ALTER TABLE dbo.AI_Processing_Result ADD ScoringModel NVARCHAR(100) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'TranslationModel')
      ALTER TABLE dbo.AI_Processing_Result ADD TranslationModel NVARCHAR(100) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'OriginalLanguage')
      ALTER TABLE dbo.AI_Processing_Result ADD OriginalLanguage NVARCHAR(50) NULL;`,
  ];
  for (const sqlText of statements) {
    await pool.request().query(sqlText);
  }
}

/**
 * API 10.29.27 - GET /api/audio-status/:audioFileName
 * Retrieves the processing status of an audio file
 */
app.get('/api/audio-status/:audioFileName', async (req, res) => {
  const audioFileName = decodeURIComponent(req.params.audioFileName);
  try {
    const pool = await connectToDatabase();
    await ensureAudioUploadProgressColumns(pool);
    await markStaleProcessingAsFailed(pool, audioFileName);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT
          AU.ProcessStatus,
          AU.ProcessStage,
          AU.ProcessProgress,
          AU.ProcessMessage,
          APR.Status AS AIStatus,
          APR.TranscribeOutput,
          COALESCE(APR.OriginalLanguage, APR.AudioLanguage) AS OriginalLanguage
        FROM AudioUploads AU
        LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.AudioFileName = @audioFileName
      `);
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: "Audio file not found." });
    }
    const row = result.recordset[0];
    const status = normalizeDisplayStatus(
      row.ProcessStatus,
      row.AIStatus,
      row.TranscribeOutput
    );
    const progress = buildAudioProgressPayload(
      row.ProcessStatus,
      row.AIStatus,
      status,
      row.ProcessStage,
      row.ProcessProgress,
      row.ProcessMessage
    );
    const displayAiStatus = resolveDisplayAiStatus(
      row.ProcessStatus,
      row.AIStatus,
      progress.stage,
      status
    );
    const { failureStage, failureReason } = extractFailureDetails(row.ProcessStatus);
    const includeTranslate = !row.OriginalLanguage
      || !/english/i.test(row.OriginalLanguage || "");
    const subtasks = buildProcessingSubtasks(progress.stage, progress.progress, includeTranslate);

    return res.status(200).json({
      success: true,
      status,
      processStatus: row.ProcessStatus,
      aiStatus: row.AIStatus || null,
      displayAiStatus,
      stage: progress.stage,
      progress: progress.progress,
      message: failureReason || progress.message,
      subtasks,
      failureStage,
      failureReason,
      originalLanguage: row.OriginalLanguage || null,
      hasTranscript: Boolean(row.TranscribeOutput),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching audio status:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.30.28 - GET /api/latest-audio
 * Retrieves details of the most recently uploaded audio file
 */
app.get('/api/latest-audio', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT TOP 1 AudioFileName, UploadID, ProcessStatus 
      FROM AudioUploads 
      ORDER BY UploadDate DESC
    `;
    const result = await pool.request().query(query);
    if (result.recordset.length > 0) {
      return res.status(200).send({ success: true, data: result.recordset[0] });
    } else {
      return res.status(404).send({ success: false, message: "No audio files found." });
    }
  } catch (error) {
    console.error("Error fetching latest audio:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * Parse duration value to total seconds.
 * Accepts "HH:MM:SS", "MM:SS", or plain numeric seconds.
 */
function parseHHMMSSToSeconds(hhmmss) {
  if (hhmmss == null || hhmmss === '') return 0;
  const str = String(hhmmss).trim();
  if (!isNaN(str) && str !== '') return Math.max(0, parseFloat(str));
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Strip Qwen3 / vLLM thinking blocks from LLM-generated transcript text.
 */
function stripLlmThinking(text) {
  if (!text) return '';
  return String(text)
    .replace(/<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*?<\s*\/\s*(?:think|redacted_reasoning|reasoning)\s*>/gi, '')
    .replace(/<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*$/gi, '')
    .trim();
}

/**
 * Count words in a diarized transcript, stripping timestamp/speaker prefixes and LLM meta.
 */
function countTranscriptWords(text) {
  if (!text) return 0;
  let cleaned = stripLlmThinking(text);
  const diarizedLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:/.test(l));
  if (diarizedLines.length > 0) {
    cleaned = diarizedLines.join('\n');
  }
  cleaned = cleaned.replace(/^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]*\)\s*:\s*/gm, '');
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Compute WPM from transcript text and duration string.
 */
function computeWPM(transcript, durationStr) {
  const totalSec = parseHHMMSSToSeconds(durationStr);
  if (totalSec <= 0) return null;
  const words = countTranscriptWords(transcript);
  if (words <= 0) return null;
  return Math.round((words / (totalSec / 60.0)) * 100) / 100;
}

/**
 * API 10.31.29 - GET /api/audio-details/:audioFileName
 * Retrieves details of a specific audio file
 */
app.get('/api/audio-details/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    let consolidatedRow = null;
    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AudioFileName, CallType, AgentName, AgentID, AgentSupervisor, AgentManager, AgentAuditor,
                 UploadDate, Status, AudioLanguage, AudioDuration, TotalDurationOfAIProcessing,
                 AudioWPM, AgentLocation, TranslateOutput
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        consolidatedRow = result.recordset[0];
      }
    } catch (consolidatedErr) {
      if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
        throw consolidatedErr;
      }
    }

    if (consolidatedRow) {
      if (consolidatedRow.AudioWPM == null) {
        let transcript = consolidatedRow.TranslateOutput;
        let duration = consolidatedRow.AudioDuration;

        if (!transcript || !duration) {
          try {
            const aprResult = await pool.request()
              .input('fn', sql.NVarChar, filename)
              .query(`
                SELECT COALESCE(NULLIF(TranslateOutput, ''), TranscribeOutput) AS TranslateOutput,
                       AudioDuration
                FROM AI_Processing_Result
                WHERE AudioFileName = @fn
              `);
            if (aprResult.recordset.length > 0) {
              if (!transcript) transcript = aprResult.recordset[0].TranslateOutput;
              if (!duration) duration = aprResult.recordset[0].AudioDuration;
            }
          } catch (_) { /* AI_Processing_Result might not exist */ }
        }

        if (transcript && duration) {
          consolidatedRow.AudioWPM = computeWPM(transcript, duration);
          if (consolidatedRow.AudioWPM != null) {
            pool.request()
              .input('wpm', sql.Float, consolidatedRow.AudioWPM)
              .input('fn', sql.NVarChar, filename)
              .query('UPDATE Consolidated_Audio_Analysis SET AudioWPM = @wpm WHERE AudioFileName = @fn')
              .catch(() => {});
          }
        }
      }
      delete consolidatedRow.TranslateOutput;
      return res.status(200).json({ success: true, audioDetails: consolidatedRow });
    }

    const fallback = await pool.request()
      .input('filename', sql.NVarChar, filename)
      .query(`
        SELECT
          AU.AudioFileName,
          AU.CallType,
          AU.SelectedAgent AS AgentName,
          NULL AS AgentID,
          NULL AS AgentSupervisor,
          NULL AS AgentManager,
          NULL AS AgentAuditor,
          AU.UploadDate,
          COALESCE(APR.Status, AU.ProcessStatus) AS Status,
          COALESCE(APR.AudioLanguage, 'Unknown') AS AudioLanguage,
          COALESCE(APR.AudioDuration, '00:00:00') AS AudioDuration,
          NULL AS TotalDurationOfAIProcessing,
          NULL AS AudioWPM,
          NULL AS AgentLocation,
          APR.TranslateOutput
        FROM AudioUploads AU
        LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.AudioFileName = @filename
      `);
    if (fallback.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Audio file not found.' });
    }
    const row = fallback.recordset[0];
    if (row.AudioWPM == null && row.AudioDuration && row.TranslateOutput) {
      row.AudioWPM = computeWPM(row.TranslateOutput, row.AudioDuration);
    }
    if (row.AudioWPM == null && row.AudioDuration) {
      try {
        const trResult = await pool.request()
          .input('fn', sql.NVarChar, filename)
          .query(`
            SELECT COALESCE(NULLIF(TranslateOutput, ''), TranscribeOutput) AS TranslateOutput
            FROM AI_Processing_Result
            WHERE AudioFileName = @fn
          `);
        if (trResult.recordset.length > 0 && trResult.recordset[0].TranslateOutput) {
          row.AudioWPM = computeWPM(trResult.recordset[0].TranslateOutput, row.AudioDuration);
        }
      } catch (_) { }
    }
    delete row.TranslateOutput;
    res.status(200).json({ success: true, audioDetails: row });
  } catch (error) {
    console.error('Error fetching audio details:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * POST /api/backfill-wpm
 * Backfills AudioWPM for Consolidated_Audio_Analysis rows where it is NULL.
 */
app.post('/api/backfill-wpm', async (req, res) => {
  try {
    const pool = await sqlConnect();
    let updated = 0;

    const rows = await pool.request().query(`
      SELECT CAA.AudioFileName, CAA.AudioDuration,
             COALESCE(NULLIF(CAA.TranslateOutput, ''),
                      NULLIF(APR.TranslateOutput, ''),
                      APR.TranscribeOutput) AS TranslateText
      FROM Consolidated_Audio_Analysis CAA
      LEFT JOIN AI_Processing_Result APR ON CAA.AudioFileName = APR.AudioFileName
      WHERE CAA.AudioWPM IS NULL
        AND CAA.AudioDuration IS NOT NULL
        AND (CAA.TranslateOutput IS NOT NULL OR APR.TranslateOutput IS NOT NULL
             OR APR.TranscribeOutput IS NOT NULL)
    `);

    for (const row of rows.recordset) {
      const wpm = computeWPM(row.TranslateText, row.AudioDuration);
      if (wpm != null) {
        await pool.request()
          .input('wpm', sql.Float, wpm)
          .input('fn', sql.NVarChar, row.AudioFileName)
          .query('UPDATE Consolidated_Audio_Analysis SET AudioWPM = @wpm WHERE AudioFileName = @fn');
        updated++;
      }
    }

    res.status(200).json({ success: true, message: `Backfilled WPM for ${updated} records.`, updated });
  } catch (error) {
    console.error('Error backfilling WPM:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.32.30 - GET /audio/:filename
 * Serves an audio file
 */
app.get("/audio/:filename", (req, res) => {
  const { filename } = req.params;
  const audioFilePath = path.join(uploadDirectory, filename);
  if (fs.existsSync(audioFilePath)) {
    return res.sendFile(audioFilePath);
  } else {
    return res.status(404).send("Audio file not found.");
  }
});

/**
 * API - POST /api/download-secure-audio
 * Creates a password-protected ZIP containing the audio file and metadata.csv,
 * then streams it back as a download. Requires authenticated session.
 */
app.post("/api/download-secure-audio", async (req, res) => {
  // archiver v8 broke the plugin API; resolve archiver v7 bundled with archiver-zip-encrypted
  const archiverPath = require.resolve("archiver", { paths: [require.resolve("archiver-zip-encrypted")] });
  const archiver = require(archiverPath);
  const ZipEncrypted = require("archiver-zip-encrypted");
  archiver.registerFormat("zip-encrypted", ZipEncrypted);
  const { stringify } = require("csv-stringify/sync");

  const { filename, password } = req.body || {};
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ success: false, message: "Filename is required." });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
  }

  const safeFilename = path.basename(filename);
  const audioFilePath = path.join(uploadDirectory, safeFilename);
  if (!fs.existsSync(audioFilePath)) {
    return res.status(404).json({ success: false, message: "Audio file not found on server." });
  }

  try {
    const pool = await sqlConnect();

    let meta = {};
    try {
      const result = await pool.request()
        .input("fn", sql.NVarChar, safeFilename)
        .query(`
          SELECT AudioFileName, CallType, AgentName, AgentID, AgentSupervisor, AgentManager,
                 UploadDate, Status, AudioLanguage, AudioDuration, TotalDurationOfAIProcessing,
                 AudioWPM, AgentLocation, AI_Overall_Scoring, Manual_Overall_Scoring,
                 AI_Script_Compliance
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @fn
        `);
      if (result.recordset.length > 0) meta = result.recordset[0];
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) throw consolidatedErr;
    }

    if (!meta.AudioFileName) {
      try {
        const fb = await pool.request()
          .input("fn", sql.NVarChar, safeFilename)
          .query(`
            SELECT AU.AudioFileName, AU.CallType, AU.SelectedAgent AS AgentName,
                   AU.UploadDate, COALESCE(APR.Status, AU.ProcessStatus) AS Status,
                   COALESCE(APR.AudioLanguage, 'Unknown') AS AudioLanguage,
                   COALESCE(APR.AudioDuration, '00:00:00') AS AudioDuration
            FROM AudioUploads AU
            LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
            WHERE AU.AudioFileName = @fn
          `);
        if (fb.recordset.length > 0) meta = fb.recordset[0];
      } catch (_) { /* table may not exist */ }
    }

    const csvRows = [{
      FileName: meta.AudioFileName || safeFilename,
      UploadDate: meta.UploadDate ? new Date(meta.UploadDate).toISOString() : "",
      AgentName: meta.AgentName || "",
      AgentID: meta.AgentID || "",
      AgentSupervisor: meta.AgentSupervisor || "",
      AgentManager: meta.AgentManager || "",
      CallType: meta.CallType || "",
      Language: meta.AudioLanguage || "",
      Duration: meta.AudioDuration || "",
      SpeechRateWPM: meta.AudioWPM != null ? String(meta.AudioWPM) : "",
      AIScore: meta.AI_Overall_Scoring != null ? String(meta.AI_Overall_Scoring) : "",
      ManualScore: meta.Manual_Overall_Scoring != null ? String(meta.Manual_Overall_Scoring) : "",
      Compliance: meta.AI_Script_Compliance != null ? String(meta.AI_Script_Compliance) : "",
      Status: meta.Status || "",
      AgentLocation: meta.AgentLocation || "",
      AIProcessingDuration: meta.TotalDurationOfAIProcessing || "",
      ExportedAt: new Date().toISOString(),
      ExportedBy: req.user ? req.user.username : "unknown",
    }];
    const csvContent = stringify(csvRows, { header: true });

    const zipName = safeFilename.replace(/\.[^.]+$/, "") + "_secure.zip";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver.create("zip-encrypted", {
      zlib: { level: 9 },
      encryptionMethod: "aes256",
      password: password,
    });

    archive.on("error", (err) => {
      console.error("[download-secure-audio] Archiver error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "ZIP creation failed." });
      }
    });

    archive.pipe(res);
    archive.file(audioFilePath, { name: safeFilename });
    archive.append(Buffer.from(csvContent, "utf-8"), { name: "metadata.csv" });
    await archive.finalize();
  } catch (error) {
    console.error("[download-secure-audio] Server error:", error.message, error.stack);
    if (!res.headersSent) {
      const detail = error.message || "Unknown error";
      res.status(500).json({ success: false, message: `Secure download failed: ${detail}` });
    }
  }
});

/**
 * API 10.33.31 - GET /api/translate-output/:audioFileName
 * Retrieves original + translated transcription for an audio file.
 *
 * Schema note: the original-language transcription (TranscribeOutput) and the
 * OriginalLanguage live ONLY in AI_Processing_Result. Consolidated_Audio_Analysis
 * holds just TranslateOutput + AudioLanguage. AI_Processing_Result is a superset
 * (every consolidated row has a matching APR row), so we drive from APR and LEFT
 * JOIN CAA to prefer the consolidated translation when present.
 */
app.get('/api/translate-output/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT
            COALESCE(NULLIF(CAA.TranslateOutput, ''), APR.TranslateOutput, '') AS TranslateOutput,
            COALESCE(APR.TranscribeOutput, '') AS TranscribeOutput,
            COALESCE(NULLIF(APR.OriginalLanguage, ''), NULLIF(APR.AudioLanguage, ''), 'Hindi') AS OriginalLanguage
          FROM AI_Processing_Result APR
          LEFT JOIN Consolidated_Audio_Analysis CAA ON CAA.AudioFileName = APR.AudioFileName
          WHERE APR.AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        const row = result.recordset[0];
        return res.status(200).json({
          success: true,
          transcribeOutput: row.TranscribeOutput || '',
          translateOutput: row.TranslateOutput || '',
          originalLanguage: row.OriginalLanguage || 'Hindi',
        });
      }
    } catch (aprErr) {
      if (!String(aprErr.message).includes("AI_Processing_Result")) {
        throw aprErr;
      }
    }

    // Last-resort fallback: consolidated table only (translation, no original).
    const fallback = await pool.request()
      .input('filename', sql.NVarChar, filename)
      .query(`
        SELECT TranslateOutput, AudioLanguage
        FROM Consolidated_Audio_Analysis
        WHERE AudioFileName = @filename
      `);
    if (fallback.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Transcription not found.' });
    }
    const row = fallback.recordset[0];
    res.status(200).json({
      success: true,
      transcribeOutput: '',
      translateOutput: row.TranslateOutput || '',
      originalLanguage: row.AudioLanguage || 'Hindi',
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.34.32 - GET /api/recent-activity
 * Retrieves recent audio processing activity
 */
app.get("/api/recent-activity", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { limit } = req.query;
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  try {
    const filterParams = parseRecentActivityFilterParams(req.query);
    const pool = await sqlConnect();
    await markStaleProcessingAsFailed(pool);

    let query = buildRecentActivityFilteredQuery(rowLimit, filterParams, { withAuditJoin: true });
    let request = bindRecentActivityFilters(pool.request(), filterParams);

    let result;
    try {
      result = await request.query(query);
    } catch (auditJoinErr) {
      if (!isMissingDbObjectError(auditJoinErr)) throw auditJoinErr;
      query = buildRecentActivityFilteredQuery(rowLimit, filterParams, { withAuditJoin: false });
      request = bindRecentActivityFilters(pool.request(), filterParams);
      result = await request.query(query);
    }
    const data = result.recordset.map(mapRecentActivityRow);

    return res.status(200).json({ success: true, data, total: data.length });

  } catch (error) {
    if (error.message && error.message.includes("Invalid")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.35.33 - GET /api/tone-analysis/:audioFileName
 * Retrieves tone analysis for a specific audio file
 */
app.get('/api/tone-analysis/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ToneAnalysis
          FROM Consolidated_Audio_Analysis
          WHERE LOWER(AudioFileName) = LOWER(@filename)
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        toneAnalysis: {
          status: 'pending',
          results: {
            Agent: {},
            Customer: {},
            Overall_Tone: { Agent: 'N/A', Customer: 'N/A' },
          },
        },
      });
    }
    if (result.recordset.length === 0) {
      console.warn(`[Tone Analysis] No record found for filename: ${filename}`);
      return res.status(404).json({ success: false, message: 'Tone analysis not found.' });
    }

    const rawToneAnalysis = result.recordset[0].ToneAnalysis;
    //console.log(`[Tone Analysis] Raw string data for ${req.params.filename}:`, rawToneAnalysis);

    // Clean and convert single-quoted string to double-quoted JSON
    let cleanedData = rawToneAnalysis;
    if (typeof cleanedData === 'string') {
      cleanedData = cleanedData.trim();
      // Replace single quotes with double quotes, ensuring valid JSON
      cleanedData = cleanedData.replace(/'/g, '"');
      // Handle nested single quotes within values (e.g., 'Medium' -> "Medium")
      cleanedData = cleanedData.replace(/": '(.*?)'/g, '": "$1"');
      //console.log(`[Tone Analysis] Cleaned data for ${req.params.filename}:`, cleanedData);

      try {
        cleanedData = JSON.parse(cleanedData);
      } catch (parseError) {
        console.error(`[Tone Analysis] Parsing error for ${req.params.filename}:`, parseError.message, 'Cleaned data:', cleanedData);
        return res.status(500).json({ success: false, message: 'Invalid tone analysis data format after cleaning.' });
      }
    } else if (!cleanedData) {
      console.warn(`[Tone Analysis] NULL or undefined data for ${req.params.filename}`);
      cleanedData = {};
    }

    // Ensure the expected structure
    const toneAnalysis = {
      status: cleanedData.status || 'success',
      results: normalizeToneResults(
        cleanedData.results || {
          Agent: cleanedData.Agent || {},
          Customer: cleanedData.Customer || {},
          Overall_Tone: cleanedData.Overall_Tone || { Agent: 'N/A', Customer: 'N/A' },
        }
      ),
    };
    if (!toneAnalysis.results.Overall_Tone) {
      toneAnalysis.results.Overall_Tone = cleanedData.Overall_Tone || { Agent: 'N/A', Customer: 'N/A' };
    }
    if (cleanedData.taboo_analysis && typeof cleanedData.taboo_analysis === 'object') {
      toneAnalysis.taboo_analysis = cleanedData.taboo_analysis;
    }

    res.status(200).json({ success: true, toneAnalysis });
  } catch (error) {
    console.error('Error fetching tone analysis:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.36.34 - GET /api/audio-upload-details/:audioFileName
 * Retrieves upload details for a specific audio file
 */
app.get("/api/audio-upload-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioFileName, SelectedAgent AS AgentName, CallType,
               CONVERT(VARCHAR(10), UploadDate, 120) AS UploadDate,
               ProcessStatus AS Status
        FROM dbo.AudioUploads
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Audio file details not found." });
    }
    return res.status(200).json({ success: true, audioUploadDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching audio upload details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.260 - GET /api/ai-processing-details/:audioFileName
 * Retrieves AI processing details for a specific audio file
 */
app.get("/api/ai-processing-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioLanguage, AudioDuration, TranscribeOutput,
               TranslateOutput, ToneAnalysis, Sentiment
        FROM dbo.AI_Processing_Result
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "AI processing details not found." });
    }
    return res.status(200).json({ success: true, aiProcessingDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching AI processing details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.261 - GET /api/custom-scoring-details/:audioFileName
 * Retrieves custom scoring details for an audio file (excluding summary)
 */
app.get('/api/custom-scoring-details/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AIScoring, AI_Opening_Speech, AI_Empathy, AI_Query_Handling, AI_Adherence_to_Protocol,
                 AI_Resolution_Assurance, AI_Query_Resolution, AI_Polite_Tone, AI_Authentication_Verification,
                 AI_Escalation_Handling, AI_Closing_Speech, AI_Rude_Behavior, AI_Overall_Scoring,
                 AI_Call_Type, AI_Lead_Classification, AI_Resolution_Status, AI_Feedback,
                 ManualScoring, Manual_Opening_Speech, Manual_Empathy, Manual_Query_Handling,
                 Manual_Adherence_to_Protocol, Manual_Resolution_Assurance, Manual_Query_Resolution,
                 Manual_Polite_Tone, Manual_Authentication_Verification, Manual_Escalation_Handling,
                 Manual_Closing_Speech, Manual_Rude_Behavior, Manual_Overall_Scoring,
                 Manual_Call_Type, Manual_Lead_Classification, Manual_Resolution_Status, Manual_Feedback
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        aiScoring: {},
        manualScoring: {},
        message: 'Scoring will be available after Phase 2b is enabled.',
      });
    }
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Scoring data not found.' });
    }
    const record = result.recordset[0];
    res.status(200).json({
      success: true,
      aiScoring: mapScoringFields(record, 'AI'),
      manualScoring: mapScoringFields(record, 'Manual'),
    });
  } catch (error) {
    console.error('Error fetching scoring details:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.28.262 - GET /api/summary/:audioFileName
 * Retrieves summary for an audio file
 */
app.get('/api/summary/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AI_Summary
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        return res.status(200).json({
          success: true,
          summary: result.recordset[0].AI_Summary || '',
        });
      }
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
    }

    res.status(200).json({
      success: true,
      summary: 'AI summary will be available after Phase 2b scoring is enabled.',
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * Ensures a Consolidated_Audio_Analysis row exists (creates stub from AudioUploads if needed).
 */
async function ensureConsolidatedAudioRow(pool, filename) {
  const existing = await pool.request()
    .input("filename", sql.NVarChar, filename)
    .query(`SELECT AudioFileName FROM Consolidated_Audio_Analysis WHERE AudioFileName = @filename`);

  if (existing.recordset.length > 0) {
    return true;
  }

  const upload = await pool.request()
    .input("filename", sql.NVarChar, filename)
    .query(`
      SELECT UploadDate, SelectedAgent, SelectedCallDate, CallType
      FROM AudioUploads
      WHERE AudioFileName = @filename
    `);

  if (upload.recordset.length === 0) {
    return false;
  }

  const row = upload.recordset[0];
  await pool.request()
    .input("filename", sql.NVarChar, filename)
    .input("uploadDate", sql.DateTime, row.UploadDate || new Date())
    .input("agentName", sql.NVarChar, row.SelectedAgent || "Unknown")
    .input("callDate", sql.Date, row.SelectedCallDate || null)
    .input("callType", sql.NVarChar, row.CallType || "inbound")
    .query(`
      INSERT INTO Consolidated_Audio_Analysis (
        UploadDate, AudioFileName, AgentName, SelectedCallDate, CallType, Status
      )
      VALUES (@uploadDate, @filename, @agentName, @callDate, @callType, 'Uploaded')
    `);
  return true;
}

/**
 * API 10.92.90 - POST /api/manual-scoring/:filename
 * Updates manual scoring for a specific audio file, including the username of the scorer
 */
app.post("/api/manual-scoring/:filename", async (req, res) => {
  const { filename } = req.params;
  const { manualScores } = req.body;

  if (!filename || !manualScores) {
    writeLog(`[${getISTTimeString()}] Manual scoring update failed: Missing filename or manualScores`);
    return res.status(400).json({ success: false, message: "Filename and manual scores are required." });
  }

  const {
    Opening_Speech,
    Empathy,
    Query_Handling,
    Adherence_to_Protocol,
    Resolution_Assurance,
    Query_Resolution,
    Polite_Tone,
    Authentication_Verification,
    Escalation_Handling,
    Closing_Speech,
    Rude_Behavior,
    Call_Type,
    Lead_Classification,
    Resolution_Status,
    Feedback,
    Overall_Scoring,
    ManualScoredByUserID: username // Renamed to username for clarity
  } = manualScores;

  if (!username || typeof username !== 'string' || username.trim() === '') {
    writeLog(`[${getISTTimeString()}] Manual scoring update failed: Invalid or missing username`);
    return res.status(400).json({ success: false, message: "Valid username is required for scoring." });
  }

  try {
    const pool = await connectToDatabase();

    // Validate username exists in Users table
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username.trim())
      .query(`SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)`);
    
    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Manual scoring update failed: Username ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const audioResult = await pool.request()
      .input("filename", sql.NVarChar, filename)
      .query(`SELECT AudioFileName FROM Consolidated_Audio_Analysis WHERE AudioFileName = @filename`);
    
    if (audioResult.recordset.length === 0) {
      const created = await ensureConsolidatedAudioRow(pool, filename);
      if (!created) {
        writeLog(`[${getISTTimeString()}] Manual scoring update failed: Audio file ${filename} not found`);
        return res.status(404).json({ success: false, message: "Audio file not found." });
      }
    }

    const safeParseFloat = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = parseFloat(value);
      return !isNaN(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
    };

    const parsedScores = {
      Opening_Speech: safeParseFloat(Opening_Speech),
      Empathy: safeParseFloat(Empathy),
      Query_Handling: safeParseFloat(Query_Handling),
      Adherence_to_Protocol: safeParseFloat(Adherence_to_Protocol),
      Resolution_Assurance: safeParseFloat(Resolution_Assurance),
      Query_Resolution: safeParseFloat(Query_Resolution),
      Polite_Tone: safeParseFloat(Polite_Tone),
      Authentication_Verification: safeParseFloat(Authentication_Verification),
      Escalation_Handling: safeParseFloat(Escalation_Handling),
      Closing_Speech: safeParseFloat(Closing_Speech),
    };

    const numericVals = Object.values(parsedScores).filter(v => v !== null);
    const computedOverall = numericVals.length > 0
      ? parseFloat((numericVals.reduce((s, v) => s + v, 0) / numericVals.length).toFixed(2))
      : safeParseFloat(Overall_Scoring);

    await pool.request()
      .input("filename", sql.NVarChar, filename)
      .input("Opening_Speech", sql.Float, parsedScores.Opening_Speech)
      .input("Empathy", sql.Float, parsedScores.Empathy)
      .input("Query_Handling", sql.Float, parsedScores.Query_Handling)
      .input("Adherence_to_Protocol", sql.Float, parsedScores.Adherence_to_Protocol)
      .input("Resolution_Assurance", sql.Float, parsedScores.Resolution_Assurance)
      .input("Query_Resolution", sql.Float, parsedScores.Query_Resolution)
      .input("Polite_Tone", sql.Float, parsedScores.Polite_Tone)
      .input("Authentication_Verification", sql.Float, parsedScores.Authentication_Verification)
      .input("Escalation_Handling", sql.Float, parsedScores.Escalation_Handling)
      .input("Closing_Speech", sql.Float, parsedScores.Closing_Speech)
      .input("Rude_Behavior", sql.NVarChar, Rude_Behavior || null)
      .input("Call_Type", sql.NVarChar, Call_Type || null)
      .input("Lead_Classification", sql.NVarChar, Lead_Classification || null)
      .input("Resolution_Status", sql.NVarChar, Resolution_Status || null)
      .input("Feedback", sql.NVarChar, Feedback || null)
      .input("Overall_Scoring", sql.Float, computedOverall)
      .input("ManualScoredByUserID", sql.NVarChar(100), username.trim())
      .query(`
        UPDATE Consolidated_Audio_Analysis
        SET
          Manual_Opening_Speech = @Opening_Speech,
          Manual_Empathy = @Empathy,
          Manual_Query_Handling = @Query_Handling,
          Manual_Adherence_to_Protocol = @Adherence_to_Protocol,
          Manual_Resolution_Assurance = @Resolution_Assurance,
          Manual_Query_Resolution = @Query_Resolution,
          Manual_Polite_Tone = @Polite_Tone,
          Manual_Authentication_Verification = @Authentication_Verification,
          Manual_Escalation_Handling = @Escalation_Handling,
          Manual_Closing_Speech = @Closing_Speech,
          Manual_Rude_Behavior = @Rude_Behavior,
          Manual_Call_Type = @Call_Type,
          Manual_Lead_Classification = @Lead_Classification,
          Manual_Resolution_Status = @Resolution_Status,
          Manual_Feedback = @Feedback,
          Manual_Overall_Scoring = @Overall_Scoring,
          ManualScoring = 1,
          ManualScoredByUserID = @ManualScoredByUserID
        WHERE AudioFileName = @filename
      `);

    writeLog(`[${getISTTimeString()}] Manual scoring updated successfully for ${filename} by username ${username}`);
    return res.status(200).json({ success: true, message: "Manual scoring updated successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Manual scoring update error for ${filename}: ${error.message}`);
    console.error(`[${getISTTimeString()}] Manual scoring update error:`, error);
    return res.status(500).json({ success: false, message: "Server error updating manual scoring: " + error.message });
  }
});

/**
 * API 10.92.90 - GET /api/sentiment/:filename
 * Retrieves per-utterance sentiment analysis data for a specific audio file
 * Compliance: ISO 27001 (Secure data handling, logging)
 */
app.get("/api/sentiment/:filename", async (req, res) => {
  const { filename } = req.params;

  // Input validation
  if (!filename || !validator.isAlphanumeric(filename, undefined, { ignore: "-_." })) {
    writeLog(`[${getISTTimeString()}] Sentiment fetch failed: Invalid filename ${filename}`);
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  try {
    const pool = await sqlConnect();
    let result;
    try {
      result = await pool.request()
        .input("filename", sql.NVarChar, filename)
        .query(`
          SELECT Sentiment
          FROM [call_analysis_db].[dbo].[Consolidated_Audio_Analysis]
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({ success: true, sentiment: [] });
    }

    if (result.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Sentiment fetch failed: No sentiment data found for ${filename}`);
      return res.status(404).json({ success: false, message: "No sentiment data found for this audio file" });
    }

    let sentimentData = result.recordset[0].Sentiment;

    // Handle NULL or empty values
    if (!sentimentData || sentimentData.trim() === "") {
      sentimentData = "[]"; // Default to empty array
    }

    // Attempt to parse JSON, fallback to empty array on error
    try {
      sentimentData = JSON.parse(sentimentData);
      if (!Array.isArray(sentimentData)) {
        throw new Error("Sentiment data is not an array");
      }
    } catch (parseError) {
      console.error(`[${getISTTimeString()}] Invalid JSON in Sentiment column for ${filename}:`, sentimentData, parseError.message);
      writeLog(`[${getISTTimeString()}] Sentiment fetch error for ${filename}: Invalid JSON - ${parseError.message}, Raw Data: ${sentimentData}`);
      sentimentData = []; // Fallback to empty array
    }

    writeLog(`[${getISTTimeString()}] Sentiment data fetched successfully for ${filename}, Count: ${sentimentData.length}`);
    return res.status(200).json({ success: true, sentiment: sentimentData });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching sentiment data for ${filename}:`, error.message);
    writeLog(`[${getISTTimeString()}] Sentiment fetch error for ${filename}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching sentiment data" });
  }
});

/**
 * API 10.28.265 - GET /api/recent-activity-full
 * Retrieves detailed recent call activity
 */
app.get("/api/recent-activity-full", async (req, res) => {
  try {
    const params = parseDashboardFilterParams(req.query);
    const pool = await sqlConnect();
    await markStaleProcessingAsFailed(pool);

    const query = `
      SELECT 
        AU.AudioFileName AS FileName,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd HH:mm:ss') AS UploadDate,
        AU.ProcessStatus,
        APR.Status AS AIStatus,
        APR.TranscribeOutput,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd') AS ProcessDate,
        COALESCE(ADS.AgentName, AU.SelectedAgent, 'Unknown') AS AgentName,
        COALESCE(ADS.AudioDuration, '00:00:00') AS AudioDuration,
        COALESCE(ADS.AudioLanguage, 'Unknown') AS AudioLanguage,
        AgentTable.agent_id AS AgentID,
        AgentTable.agent_location AS Location,
        AU.CallType AS CallType,
        COALESCE(ADS.Overall_Scoring, '') AS Overall_Scoring
      FROM AudioUploads AU
      LEFT JOIN AI_Processing_Result APR
        ON AU.AudioFileName = APR.AudioFileName
      LEFT JOIN AI_Details_Scoring ADS
        ON AU.AudioFileName = ADS.AudioFileName
      LEFT JOIN [dbo].[Agents] AgentTable
        ON LOWER(COALESCE(ADS.AgentName, AU.SelectedAgent)) = LOWER(AgentTable.agent_name)
      WHERE CAST(AU.UploadDate AS DATE) BETWEEN @fromDate AND @toDate
      ${dashboardAudioUploadExtraFilters(params, "AU")}
      ORDER BY AU.UploadDate DESC, AU.UploadID DESC;
    `;

    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const data = result.recordset.map((row) => {
      const mapped = mapRecentActivityRow(row);
      return {
        ...row,
        Status: mapped.Status,
        FailureStage: mapped.FailureStage,
        FailureReason: mapped.FailureReason,
      };
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.message && error.message.includes("Invalid date")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error fetching full recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error fetching full recent activity." });
  }
});

/**
 * API 10.28.266 - GET /api/script-compliance/:audioFileName
 * Retrieves script compliance data for an audio file
 */
app.get('/api/script-compliance/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ScriptCompliance
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        scriptCompliance: 'Script compliance will be available after Phase 2b is enabled.',
      });
    }
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Script compliance data not found.' });
    }
    res.status(200).json({ success: true, scriptCompliance: result.recordset[0].ScriptCompliance });
  } catch (error) {
    console.error('Error fetching script compliance:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* 10.5 Profile Picture APIs */
/**
 * API 10.44.42 - POST /api/user/:username/profile-picture
 * Uploads a user's profile picture
 */
app.post("/api/user/:username/profile-picture", uploadProfilePic.single("profilePic"), async (req, res) => {
  const username = req.params.username;
  if (!req.file) {
    writeLog(`[${getISTTimeString()}] Profile picture upload failed: No file uploaded for ${username}`);
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }

  try {
    // Rename the old profile picture with current date
    const oldFilePattern = path.join(profilePicsDir, `${username}.*`);
    const oldFiles = fs.readdirSync(profilePicsDir).filter(file => file.startsWith(username) && file !== req.file.filename);
    if (oldFiles.length > 0) {
      const oldFile = oldFiles[0];
      const oldExt = path.extname(oldFile);
      const newOldFileName = `${username}_${new Date().toISOString().replace(/[:.]/g, '-')}${oldExt}`;
      fs.renameSync(path.join(profilePicsDir, oldFile), path.join(profilePicsDir, newOldFileName));
      writeLog(`[${getISTTimeString()}] Renamed old profile picture ${oldFile} to ${newOldFileName} for ${username}`);
    }

    // Return success with the new file URL
    const newFileUrl = `${req.protocol}://${req.get("host")}/api/user/${username}/profile-picture`;
    writeLog(`[${getISTTimeString()}] Profile picture uploaded successfully for ${username}`);
    return res.status(200).json({ success: true, message: "Profile picture updated!", url: newFileUrl });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error uploading profile picture for ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Failed to upload profile picture." });
  }
});

/**
 * API 10.45.43 - GET /api/user/:username/profile-picture
 * Retrieves a user's profile picture
 */
app.get("/api/user/:username/profile-picture", (req, res) => {
  const username = req.params.username;
  const filePath = findProfilePictureFile(username);

  if (!filePath) {
    return res.status(404).json({ success: false, message: "Profile picture not found." });
  }

  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(filePath);
});

/* 10.6 Analytics APIs */
/**
 * API 10.46.44 - GET /api/calls-processed-7days
 * Retrieves calls processed in the last 7 days
 */
app.get('/api/calls-processed-7days', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().execute('dbo.FetchCallsProcessed7Days');
    const labels = result.recordset.map(row => row.Date);
    const values = result.recordset.map(row => row.ProcessedCalls);
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/calls-processed-7days:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.47.45 - GET /api/agent-wise-ai-scoring
 * Retrieves AI scoring by agent
 */
app.get('/api/agent-wise-ai-scoring', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const extra = dashboardConsolidatedExtraFilters(params);
    const dateClause = `CAST(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate`;

    const queries = [
      `
        SELECT TOP 12 COALESCE(AgentName, 'Unknown') AS agentName,
               AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE ${dateClause}
          AND AI_Overall_Scoring IS NOT NULL
          AND TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2)) > 0
          ${extra}
        GROUP BY AgentName
        ORDER BY avgScore DESC
      `,
      `
        SELECT TOP 12 COALESCE(ADS.AgentName, AU.SelectedAgent) AS agentName,
               AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM dbo.AI_Details_Scoring ADS
        INNER JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
        WHERE CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
          AND ADS.Overall_Scoring IS NOT NULL
          AND TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) > 0
          ${dashboardAudioUploadExtraFilters(params, "AU")}
        GROUP BY COALESCE(ADS.AgentName, AU.SelectedAgent)
        ORDER BY avgScore DESC
      `,
    ];

    for (const query of queries) {
      try {
        const result = await bindDashboardFilters(pool.request(), params).query(query);
        if (result.recordset.length > 0) {
          return res.json({
            success: true,
            agentLabels: result.recordset.map((row) => row.agentName),
            agentScores: result.recordset.map((row) => Number(row.avgScore) || 0),
          });
        }
      } catch (err) {
        if (!isMissingDbObjectError(err)) throw err;
      }
    }

    return res.json({ success: true, agentLabels: [], agentScores: [] });
  } catch (err) {
    console.error("Error in /api/agent-wise-ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.48.46 - GET /api/analytics-overview
 * Retrieves analytics overview for a specified period
 */
app.get('/api/analytics-overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Days', sql.Int, days)
      .execute('dbo.FetchAnalyticsOverview');
    if (!result.recordset.length) {
      return res.json({ success: true, totalFiles: 0, totalLanguages: 0, toneAnalysisStatus: 'In Progress' });
    }
    return res.json({ success: true, ...result.recordset[0] });
  } catch (err) {
    console.error("Error in /api/analytics-overview:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.49.47 - GET /api/tone-analysis
 * Retrieves sample tone analysis distribution
 */
app.get('/api/tone-analysis', async (req, res) => {
  try {
    const sampleDistribution = { positive: 25, neutral: 50, negative: 25 };
    return res.json({ success: true, distribution: sampleDistribution });
  } catch (err) {
    console.error("Error in /api/tone-analysis:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.50.48 - GET /api/ai-scoring
 * Retrieves AI scoring for a specified range
 */
app.get('/api/ai-scoring', async (req, res) => {
  try {
    const range = parseInt(req.query.range) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Range', sql.Int, range)
      .execute('dbo.FetchAIScoring');
    const labels = result.recordset.map(row => row.Date);
    const scores = result.recordset.map(row => row.AvgAIScore);
    return res.json({ success: true, labels, scores });
  } catch (err) {
    console.error("Error in /api/ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.51.49 - GET /api/metrics-overview
 * Retrieves overview metrics for call analysis
 */
app.get("/api/metrics-overview", async (req, res) => {
  const { location, tl, fromDate, toDate, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();

    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
    }

    const parsedFromDate = new Date(fromDate);
    const parsedToDate = new Date(toDate);
    const currentDate = new Date();

    if (isNaN(parsedFromDate) || isNaN(parsedToDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
    }

    if (parsedToDate < parsedFromDate) {
      return res.status(400).json({ success: false, message: "toDate must be on or after fromDate." });
    }

    const effectiveToDate = parsedToDate > currentDate ? currentDate : parsedToDate;
    const effectiveFromDate = parsedFromDate;
    const fromDateStr = effectiveFromDate.toISOString().split("T")[0];
    const toDateStr = effectiveToDate.toISOString().split("T")[0];

    let useFallback = false;
    let currentData;
    try {
      currentData = await runMetricsOverviewQuery(
        pool,
        { fromDate: fromDateStr, toDate: toDateStr, location, tl, callType, agent },
        false
      );
    } catch (consolidatedErr) {
      if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
        throw consolidatedErr;
      }
      useFallback = true;
      currentData = await runMetricsOverviewQuery(
        pool,
        { fromDate: fromDateStr, toDate: toDateStr, location, tl, callType, agent },
        true
      );
    }

    const daysDiff = (effectiveToDate - effectiveFromDate) / (1000 * 60 * 60 * 24);
    const prevStartDate = new Date(effectiveFromDate);
    const prevEndDate = new Date(effectiveToDate);
    prevStartDate.setDate(prevStartDate.getDate() - daysDiff - 1);
    prevEndDate.setDate(prevEndDate.getDate() - daysDiff - 1);
    const prevFromStr = prevStartDate.toISOString().split("T")[0];
    const prevToStr = prevEndDate.toISOString().split("T")[0];

    let prevData;
    if (useFallback) {
      prevData = await runMetricsOverviewQuery(
        pool,
        { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
        true
      );
    } else {
      try {
        prevData = await runMetricsOverviewQuery(
          pool,
          { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
          false
        );
      } catch (consolidatedErr) {
        if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
          throw consolidatedErr;
        }
        prevData = await runMetricsOverviewQuery(
          pool,
          { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
          true
        );
      }
    }

    return res.status(200).json({
      success: true,
      totalCallsProcessed: currentData.totalCallsProcessed,
      successCount: currentData.successCount,
      failedCount: currentData.failedCount,
      avgAiScoring: currentData.avgAiScoring || 0,
      avgManualScoring: currentData.avgManualScoring || 0,
      aht: currentData.aht || 0,
      prevPeriodData: {
        totalCallsProcessed: prevData.totalCallsProcessed,
        successCount: prevData.successCount,
        failedCount: prevData.failedCount,
        avgAiScoring: prevData.avgAiScoring || 0,
        avgManualScoring: prevData.avgManualScoring || 0,
        aht: prevData.aht || 0
      }
    });
  } catch (error) {
    console.error("Error in /api/metrics-overview:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

/**
 * API 10.52.50 - GET /api/tone-analysis-7days
 * Retrieves tone analysis for the last 7 days
 */
app.get("/api/tone-analysis-7days", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT APR.ToneAnalysis
      FROM AI_Processing_Result APR
      INNER JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    let sumPos = 0, sumNeu = 0, sumNeg = 0;
    for (const row of result.recordset) {
      const raw = row.ToneAnalysis || "";
      if (raw.includes("Positive")) sumPos++;
      else if (raw.includes("Negative")) sumNeg++;
      else sumNeu++;
    }
    return res.json({
      success: true,
      labels: ["Positive", "Neutral", "Negative"],
      values: [sumPos, sumNeu, sumNeg],
    });
  } catch (err) {
    console.error("Error in /api/tone-analysis-7days:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.53.51 - GET /api/daily-call-duration-current-week
 * Retrieves daily call duration for the current week
 */
app.get("/api/daily-call-duration-current-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName, APR.AudioDuration
      FROM AI_Processing_Result APR
      JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE AU.UploadDate >= DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()), 0)
        AND AU.UploadDate < DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()) + 1, 0)
    `;
    const result = await pool.request().query(query);
    let dayMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    function toMinutes(hhmmss) {
      if (!hhmmss) return 0;
      const parts = hhmmss.split(":");
      if (parts.length !== 3) return 0;
      let h = parseInt(parts[0]) || 0;
      let m = parseInt(parts[1]) || 0;
      let s = parseInt(parts[2]) || 0;
      return h * 60 + m + s / 60;
    }
    for (const row of result.recordset) {
      const day = row.DayName;
      dayMap[day] = (dayMap[day] || 0) + toMinutes(row.AudioDuration);
    }
    const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const values = labels.map(d => Math.round(dayMap[d] || 0));
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/daily-call-duration-current-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.52 - GET /api/inbound-outbound-week
 * Retrieves inbound and outbound call counts for the current week
 */
app.get("/api/inbound-outbound-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName, AU.CallType
      FROM AudioUploads AU
      WHERE CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const { inboundMap, outboundMap } = emptyWeekdayMaps();
    for (const row of result.recordset) {
      const d = row.DayName;
      const ct = (row.CallType || "").toLowerCase();
      if (ct === "inbound") inboundMap[d] = (inboundMap[d] || 0) + 1;
      else if (ct === "outbound") outboundMap[d] = (outboundMap[d] || 0) + 1;
    }
    const inbound = WEEKDAY_LABELS.map((d) => inboundMap[d]);
    const outbound = WEEKDAY_LABELS.map((d) => outboundMap[d]);
    return res.json({ success: true, labels: WEEKDAY_LABELS, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/inbound-outbound-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.53 - GET /api/daily-duration-inbound-outbound-week
 * Daily call duration (mins) split by inbound vs outbound for current week
 */
app.get("/api/daily-duration-inbound-outbound-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName,
             LOWER(LTRIM(RTRIM(AU.CallType))) AS CallType,
             APR.AudioDuration
      FROM AI_Processing_Result APR
      JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const { inboundMap, outboundMap } = emptyWeekdayMaps();

    function toMinutes(hhmmss) {
      if (!hhmmss) return 0;
      const parts = String(hhmmss).split(":");
      if (parts.length !== 3) return 0;
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      const s = parseInt(parts[2], 10) || 0;
      return h * 60 + m + s / 60;
    }

    for (const row of result.recordset) {
      const day = row.DayName;
      const mins = toMinutes(row.AudioDuration);
      const ct = (row.CallType || "").toLowerCase();
      if (ct === "inbound") inboundMap[day] = (inboundMap[day] || 0) + mins;
      else if (ct === "outbound") outboundMap[day] = (outboundMap[day] || 0) + mins;
    }

    const inbound = WEEKDAY_LABELS.map((d) => Math.round(inboundMap[d] || 0));
    const outbound = WEEKDAY_LABELS.map((d) => Math.round(outboundMap[d] || 0));
    return res.json({ success: true, labels: WEEKDAY_LABELS, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/daily-duration-inbound-outbound-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.54 - GET /api/top-scorer-agents-week
 * Top AI scoring agent for inbound and outbound (filtered date range)
 */
async function queryTopScorerForWeek(pool, callType, params) {
  const dateClause = "CAST(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate";
  const uploadDateClause = "CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate";
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

app.get("/api/top-scorer-agents-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const [inbound, outbound] = await Promise.all([
      queryTopScorerForWeek(pool, "inbound", params),
      queryTopScorerForWeek(pool, "outbound", params),
    ]);

    return res.json({ success: true, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/top-scorer-agents-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/* 10.7 Agent Dashboard APIs */
/**
 * API 10.55.53 - GET /api/agent-profile
 * Retrieves an agent's profile information
 */
app.get("/api/agent-profile", async (req, res) => {
  const username = req.query.username || req.user?.username;
  if (!username) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, username);
    if (!identity) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const userResult = await pool.request()
      .input("username", sql.NVarChar, identity.loginUsername)
      .query(`SELECT Username, Email, AccountType FROM dbo.Users WHERE Username = @username`);
    const userRow = userResult.recordset[0] || { Username: identity.loginUsername, Email: identity.agentEmail };
    let agentRow = null;
    if (identity.hasAgentRecord) {
      const agentResult = await pool.request()
        .input("agentName", sql.NVarChar, identity.agentName)
        .query(`
          SELECT agent_id, agent_name, agent_email, agent_mobile,
                 agent_type, agent_creation_date, agent_location,
                 supervisor, manager, auditor, notes
          FROM dbo.Agents
          WHERE agent_name = @agentName
        `);
      agentRow = agentResult.recordset[0] || null;
    }
    return res.status(200).json({
      success: true,
      user: userRow,
      agent: agentRow,
      identity,
    });
  } catch (error) {
    console.error("Error in /api/agent-profile:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.56.54 - GET /api/agent-stats
 * Retrieves an agent's performance statistics
 */
app.get("/api/agent-stats", async (req, res) => {
  const { agentName } = req.query;
  if (!agentName) {
    return res.status(400).json({ success: false, message: "Missing 'agentName' query param." });
  }
  try {
    const pool = await connectToDatabase();
    const inboundQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS inboundScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.CallType = 'inbound' AND APR.AIScoring IS NOT NULL
      `);
    const inboundScore = inboundQ.recordset[0].inboundScore || 0;
    const outboundQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS outboundScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.CallType = 'outbound' AND APR.AIScoring IS NOT NULL
      `);
    const outboundScore = outboundQ.recordset[0].outboundScore || 0;
    const calls1DayQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls1Day
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -1, GETDATE())
      `);
    const calls1Day = calls1DayQ.recordset[0].calls1Day;
    const calls7DaysQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls7Days
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -7, GETDATE())
      `);
    const calls7Days = calls7DaysQ.recordset[0].calls7Days;
    const calls30DaysQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls30Days
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -30, GETDATE())
      `);
    const calls30Days = calls30DaysQ.recordset[0].calls30Days;
    const monthlyScoreQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS monthlyScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.UploadDate >= DATEADD(DAY, -30, GETDATE()) AND APR.AIScoring IS NOT NULL
      `);
    const monthlyScore = monthlyScoreQ.recordset[0].monthlyScore || 0;
    return res.status(200).json({
      success: true,
      inboundScore: parseFloat(inboundScore.toFixed(2)),
      outboundScore: parseFloat(outboundScore.toFixed(2)),
      calls1Day,
      calls7Days,
      calls30Days,
      monthlyScore: parseFloat(monthlyScore.toFixed(2))
    });
  } catch (error) {
    console.error("Error in /api/agent-stats:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.57.55 - GET /api/agent-calls
 * Retrieves an agent's call history
 */
app.get("/api/agent-calls", async (req, res) => {
  const { agentName } = req.query;
  if (!agentName) {
    return res.status(400).json({ success: false, message: "Missing 'agentName' query param." });
  }
  try {
    const pool = await connectToDatabase();
    const callsResult = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT UploadID, UploadDate, AudioFileName, CallType, ProcessStatus
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName
        ORDER BY UploadDate DESC
      `);
    return res.status(200).json({ success: true, calls: callsResult.recordset });
  } catch (error) {
    console.error("Error in /api/agent-calls:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.58.56 - GET /api/agent/dashboard
 * Retrieves detailed dashboard data for an agent
 */
app.get("/api/agent/dashboard", async (req, res) => {
  const requestedUser = req.query.username || req.user?.username;
  if (!requestedUser) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  if (!assertSelfOrElevated(req, requestedUser)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, requestedUser);
    if (!identity) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const agentName = identity.agentName;
    const todayStr = new Date().toISOString().split("T")[0];

    const lastDayQuery = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT MAX(CallDate) AS LastWorkingDay, COUNT(*) AS TotalCallsAllTime
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName);
      `);
    const lastDayRow = lastDayQuery.recordset[0] || {};
    const lastWorkingDay = lastDayRow.LastWorkingDay || null;
    const totalCallsAllTime = lastDayRow.TotalCallsAllTime || 0;

    let totalCallsLastDay = 0;
    let ahtMinutesForLastDay = 0;
    let lowestScoringFeedbackLastDay = null;

    if (lastWorkingDay) {
      const dateOnly = lastWorkingDay.toISOString().split("T")[0];
      const ahtRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .input("dateOnly", sql.VarChar, dateOnly)
        .query(`
          SELECT COUNT(*) AS CallCountLastDay,
                 AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) AS AvgSec
          FROM dbo.AI_Details_Scoring
          WHERE LOWER(AgentName) = LOWER(@agentName)
            AND CONVERT(VARCHAR(10), CallDate, 120) = @dateOnly;
        `);
      const ahtRow = ahtRes.recordset[0] || {};
      totalCallsLastDay = ahtRow.CallCountLastDay || 0;
      const avgSec = ahtRow.AvgSec || 0;
      ahtMinutesForLastDay = Math.round(avgSec / 60);

      const feedbackRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .input("dateOnly", sql.VarChar, dateOnly)
        .query(`
          SELECT TOP 1 Feedback
          FROM dbo.AI_Details_Scoring
          WHERE LOWER(AgentName) = LOWER(@agentName)
            AND Feedback IS NOT NULL AND LTRIM(RTRIM(Feedback)) <> ''
            AND CONVERT(VARCHAR(10), CallDate, 120) = @dateOnly
          ORDER BY TRY_CAST(Overall_Scoring AS DECIMAL(10,2)) ASC;
        `);
      if (feedbackRes.recordset.length > 0) {
        lowestScoringFeedbackLastDay = feedbackRes.recordset[0].Feedback;
      }
    }

    const todayRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .input("todayStr", sql.VarChar, todayStr)
      .query(`
        SELECT COUNT(*) AS callsToday,
               AVG(TRY_CAST(Overall_Scoring AS DECIMAL(10,2))) AS avgScoreToday
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName)
          AND CONVERT(VARCHAR(10), CallDate, 120) = @todayStr;
      `);
    const todayRow = todayRes.recordset[0] || {};
    const callsToday = todayRow.callsToday || 0;
    const avgScoreToday = todayRow.avgScoreToday
      ? parseFloat(Number(todayRow.avgScoreToday).toFixed(1))
      : null;

    const scoringRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT FORMAT(CallDate, 'yyyy-MM-dd') AS dateStr,
               AVG(TRY_CAST(Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName)
        GROUP BY FORMAT(CallDate, 'yyyy-MM-dd')
        ORDER BY dateStr;
      `);
    const overallScoring = scoringRes.recordset.map((r) => ({
      dateStr: r.dateStr,
      avgScore: r.avgScore || 0,
    }));

    const kpiRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT 'Empathy' AS name, AVG(TRY_CAST(Empathy AS DECIMAL(10,2))) AS value
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'Adherence', AVG(TRY_CAST(Adherence_to_Protocol AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'QueryHandling', AVG(TRY_CAST(Query_Handling AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'Resolution', AVG(TRY_CAST(Resolution_Assurance AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName);
      `);
    const kpiMetrics = kpiRes.recordset
      .filter((r) => r.value != null)
      .map((r) => ({
        name: r.name,
        value: parseFloat(Number(r.value).toFixed(1)),
      }));

    let csat = { transferred: 0, total: 0 };
    try {
      const csatRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .query(`
          SELECT
            SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_CSAT_Transferred))) = 'yes' THEN 1 ELSE 0 END) AS transferred,
            COUNT(*) AS total
          FROM dbo.Consolidated_Audio_Analysis
          WHERE Status = 'Success' AND LOWER(AgentName) = LOWER(@agentName);
        `);
      const csatRow = csatRes.recordset[0] || {};
      csat = { transferred: csatRow.transferred || 0, total: csatRow.total || 0 };
    } catch (csatErr) {
      if (!isMissingDbObjectError(csatErr)) throw csatErr;
    }

    const buildAgentRecentCallsQuery = ({ withCallAudits = true } = {}) => {
      const auditJoin = withCallAudits
        ? " LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = ADS.AudioFileName"
        : "";
      const manualScoreExpr = withCallAudits
        ? "COALESCE(TRY_CAST(CA.OverallManualScore AS DECIMAL(10,2)), 0)"
        : "CAST(0 AS DECIMAL(10,2))";
      const hasAuditExpr = withCallAudits
        ? "CASE WHEN CA.AuditID IS NOT NULL THEN 1 ELSE 0 END"
        : "0";
      const auditorNameExpr = withCallAudits
        ? "CA.AuditorUsername"
        : "CAST(NULL AS NVARCHAR(100))";
      return `
        SELECT TOP 8
          ADS.CallDate,
          DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, ADS.AudioDuration)) AS durationSec,
          TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) AS overallScoring,
          ADS.Call_Type,
          ADS.Feedback,
          AU.UploadID AS callId,
          ${manualScoreExpr} AS manualScore,
          ${hasAuditExpr} AS hasManualAudit,
          ${auditorNameExpr} AS auditorName
        FROM dbo.AI_Details_Scoring ADS
        LEFT JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
        ${auditJoin}
        WHERE LOWER(ADS.AgentName) = LOWER(@agentName)
        ORDER BY ADS.CallDate DESC;
      `;
    };

    const recentCallsRequest = pool.request().input("agentName", sql.NVarChar, agentName);
    let recentCallsRes;
    try {
      recentCallsRes = await recentCallsRequest.query(buildAgentRecentCallsQuery({ withCallAudits: true }));
    } catch (auditErr) {
      if (!isMissingDbObjectError(auditErr)) throw auditErr;
      recentCallsRes = await recentCallsRequest.query(buildAgentRecentCallsQuery({ withCallAudits: false }));
    }
    const callHistory = recentCallsRes.recordset.map((row) => ({
      callDateTime: row.CallDate,
      durationSec: row.durationSec || 0,
      overallScoring: row.overallScoring || 0,
      callType: row.Call_Type || "N/A",
      feedback: row.Feedback || "",
      callId: row.callId ?? null,
      manualScore: row.manualScore != null ? parseFloat(Number(row.manualScore).toFixed(1)) : null,
      hasManualAudit: row.hasManualAudit === 1 || row.hasManualAudit === true,
      auditorName: row.auditorName || null,
    }));

    return res.status(200).json({
      success: true,
      identity,
      lastWorkingDay,
      totalCallsAllTime,
      totalCallsLastDay,
      callsToday,
      avgScoreToday,
      ahtMinutesForLastDay,
      overallScoring,
      kpiMetrics,
      csat,
      lowestScoringFeedback: lowestScoringFeedbackLastDay,
      callHistory,
    });
  } catch (err) {
    console.error("Error fetching agent dashboard data:", err);
    return res.status(500).json({ success: false, message: "Server error fetching agent dashboard data." });
  }
});

/* 10.8 Briefing APIs */
/**
 * API 10.59.57 - POST /api/upload-briefing
 * Uploads a briefing for a user
 */
app.post('/api/upload-briefing', async (req, res) => {
  const { username, content, teamLeaderUsername } = req.body;
  const uploader = req.user?.username || username;
  if (!uploader || !content) {
    return res.status(400).json({ success: false, message: "Username and content are required." });
  }
  try {
    const pool = await connectToDatabase();
    const ownerUsernames = await resolveBriefingOwnerUsernames(
      pool,
      uploader,
      teamLeaderUsername
    );
    if (ownerUsernames.length === 0) {
      return res.status(400).json({ success: false, message: "Unable to resolve team leader for briefing." });
    }

    for (const owner of ownerUsernames) {
      await pool.request()
        .input('username', sql.NVarChar, owner)
        .input('content', sql.NVarChar(sql.MAX), content)
        .query(`
          INSERT INTO dbo.briefing (username, upload_date, upload_time, briefing_content, created_at)
          VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @content, GETDATE())
        `);
    }
    res.status(200).json({ success: true, message: "Briefing uploaded successfully." });
  } catch (error) {
    console.error("Error uploading briefing:", error);
    res.status(500).json({ success: false, message: "Error uploading briefing." });
  }
});

/**
 * API 10.60.58 - GET /api/briefing/today-latest
 * Retrieves the latest briefing for an agent's supervisor
 */
app.get("/api/briefing/today-latest", async (req, res) => {
  const agentUsername = req.query.agentUsername || req.user?.username;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }
  if (!assertSelfOrElevated(req, agentUsername)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, agentUsername);
    if (!identity) {
      return res.status(200).json({ success: true, briefing: "No briefing available.", empty: true });
    }

    let supervisor = identity.supervisor;
    if (!supervisor) {
      return res.status(200).json({
        success: true,
        briefing: "No supervisor assigned — briefing will appear here once your team lead publishes one.",
        empty: true,
      });
    }

    const result = await pool.request()
      .input("supervisor", sql.NVarChar, supervisor)
      .query(`
        SELECT TOP 1 briefing_content
        FROM dbo.briefing
        WHERE LOWER(username) = LOWER(@supervisor)
          AND CAST(upload_date AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY created_at DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, briefing: "No briefing available for today.", empty: true });
    }
    return res.status(200).json({
      success: true,
      briefing: result.recordset[0].briefing_content || "No briefing available.",
      empty: !result.recordset[0].briefing_content,
    });
  } catch (error) {
    console.error("Error fetching latest briefing:", error);
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({
        success: true,
        briefing: "Briefing is not configured yet. Contact your team lead.",
        empty: true,
      });
    }
    return res.status(500).json({ success: false, message: "Server error fetching briefing." });
  }
});

/* 10.9 Knowledge Test APIs */
/**
 * API 10.61.59 - POST /api/upload-knowledge-test
 * Uploads knowledge test questions
 */
app.post("/api/upload-knowledge-test", async (req, res) => {
  const { username, questions, createdAt } = req.body;
  if (!username || !questions || !Array.isArray(questions) || questions.length < 1) {
    return res.status(400).json({ success: false, message: "Username and at least one question are required." });
  }
  const invalid = questions.some(
    (q) => !q?.question?.trim() || !Array.isArray(q.options) || q.options.some((o) => !String(o || "").trim()) || !q?.correctAnswer?.trim()
  );
  if (invalid) {
    return res.status(400).json({ success: false, message: "Each question must include text, four options, and a correct answer." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("questions", sql.NVarChar(sql.MAX), JSON.stringify(questions))
      .input("createdAt", sql.DateTime, new Date(createdAt))
      .query(`
        INSERT INTO dbo.KnowledgeTestQuestions (TeamLeaderUsername, UploadDate, UploadTime, CreatedAt, Questions)
        VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @createdAt, @questions)
      `);
    return res.status(200).json({ success: true, message: "Knowledge Test questions uploaded successfully." });
  } catch (error) {
    console.error("Error uploading Knowledge Test questions:", error);
    return res.status(500).json({ success: false, message: "Server error uploading Knowledge Test questions." });
  }
});

/**
 * API 10.62.60 - GET /api/knowledge-test-latest
 * Retrieves the latest knowledge test questions for an agent's supervisor
 */
app.get("/api/knowledge-test-latest", async (req, res) => {
  const agentUsername = req.query.agentUsername || req.user?.username;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }
  if (!assertSelfOrElevated(req, agentUsername)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, agentUsername);
    if (!identity) {
      return res.status(200).json({ success: true, questions: [] });
    }

    const supervisor = identity.supervisor;
    if (!supervisor) {
      return res.status(200).json({ success: true, questions: [] });
    }

    const result = await pool.request()
      .input("supervisor", sql.NVarChar, supervisor)
      .query(`
        SELECT TOP 1 Questions
        FROM dbo.KnowledgeTestQuestions
        WHERE LOWER(TeamLeaderUsername) = LOWER(@supervisor)
          AND CreatedAt <= GETDATE()
        ORDER BY CreatedAt DESC
      `);
    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, questions: [] });
    }
    let questions;
    try {
      questions = JSON.parse(result.recordset[0].Questions);
    } catch (error) {
      console.error("Error parsing Knowledge Test questions JSON:", error);
      return res.status(500).json({ success: false, message: "Error parsing Knowledge Test questions." });
    }
    return res.status(200).json({ success: true, questions });
  } catch (error) {
    console.error("Error fetching Knowledge Test questions:", error);
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, questions: [] });
    }
    return res.status(500).json({ success: false, message: "Server error fetching Knowledge Test questions." });
  }
});

/**
 * API 10.63.61 - POST /api/submit-knowledge-test
 * Submits knowledge test answers
 */
app.post("/api/submit-knowledge-test", async (req, res) => {
  const { username, answers, createdAt } = req.body;
  if (!username || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: "Username and answers are required." });
  }
  try {
    const pool = await sql.connect(config);
    const latestQuestionsResult = await pool.request()
      .query(`
        SELECT TOP 1 Questions
        FROM dbo.KnowledgeTestQuestions
        WHERE CreatedAt <= GETDATE()
        ORDER BY CreatedAt DESC
      `);
    if (latestQuestionsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No Knowledge Test questions found." });
    }
    let questions;
    try {
      questions = JSON.parse(latestQuestionsResult.recordset[0].Questions);
    } catch (error) {
      console.error("Error parsing Knowledge Test questions JSON:", error);
      return res.status(500).json({ success: false, message: "Error parsing Knowledge Test questions." });
    }
    let correctAnswers = 0;
    answers.forEach((answer, index) => {
      if (answer.selectedAnswer === questions[index].correctAnswer) {
        correctAnswers++;
      }
    });
    const wrongAnswers = answers.length - correctAnswers;
    const totalScore = correctAnswers;
    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("answers", sql.NVarChar(sql.MAX), JSON.stringify(answers))
      .input("correctAnswers", sql.Int, correctAnswers)
      .input("wrongAnswers", sql.Int, wrongAnswers)
      .input("totalScore", sql.Int, totalScore)
      .input("createdAt", sql.DateTime, new Date(createdAt))
      .query(`
        INSERT INTO dbo.KnowledgeTestResults (Username, TestDate, TestTime, Answers, CorrectAnswers, WrongAnswers, TotalScore, CreatedAt)
        VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @answers, @correctAnswers, @wrongAnswers, @totalScore, @createdAt)
      `);
    return res.status(200).json({
      success: true,
      message: "Knowledge Test submitted successfully.",
      correctAnswers,
      wrongAnswers,
      totalScore
    });
  } catch (error) {
    console.error("Error submitting Knowledge Test answers:", error);
    return res.status(500).json({ success: false, message: "Server error submitting Knowledge Test answers." });
  }
});

/**
 * API 10.63.62 - GET /api/knowledge-test-result-today
 * Retrieves the knowledge test result for the current day for a specific agent
 */
app.get("/api/knowledge-test-result-today", async (req, res) => {
  const username = req.query.username || req.user?.username;
  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, username);
    const lookupName = identity?.loginUsername || username;
    const result = await pool.request()
      .input("username", sql.NVarChar, lookupName)
      .query(`
        SELECT TOP 1 *
        FROM dbo.KnowledgeTestResults
        WHERE LOWER(Username) = LOWER(@username)
          AND CAST(TestDate AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY CreatedAt DESC
      `);
    if (result.recordset.length > 0) {
      const { Answers, CorrectAnswers, WrongAnswers, TotalScore } = result.recordset[0];
      return res.status(200).json({
        success: true,
        hasSubmitted: true,
        correctAnswers: CorrectAnswers,
        wrongAnswers: WrongAnswers,
        totalScore: TotalScore,
        answers: JSON.parse(Answers),
      });
    }
    return res.status(200).json({ success: true, hasSubmitted: false });
  } catch (error) {
    console.error("Error fetching knowledge test result:", error);
    return res.status(500).json({ success: false, message: "Server error fetching knowledge test result." });
  }
});


/**
 * API 10.92.91 - GET /api/system-monitor/health
 * Health check endpoint for monitoring system
 */
app.get('/api/system-monitor/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cache: {
      keys: systemCache.keys().length,
      stats: systemCache.getStats()
    }
  });
});

// Graceful shutdown handler for system monitor cache
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing system monitor cache...');
  systemCache.close();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing system monitor cache...');
  systemCache.close();
});

/* 10.11 AI Chat APIs */ 
 /* API 10.11.1 - POST /api/chat-with-ai
 * Interacts with an AI chat system via a Python script
 */
app.post("/api/chat-with-ai", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    console.error("[API] /api/chat-with-ai: Message is required.");
    return res.status(400).json({ success: false, message: "Message is required." });
  }

  console.log(`[API] /api/chat-with-ai: Received message: "${message}"`);

  try {
    const pythonProcess = spawn("python", ["./ai_chat_llama3.py"]);

    pythonProcess.stdin.write(JSON.stringify({ message }));
    pythonProcess.stdin.end();

    let outputData = "";
    let errorData = "";

    pythonProcess.stdout.on("data", (data) => {
      outputData += data.toString();
      console.log(`[API] /api/chat-with-ai: Python stdout: ${data.toString()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      errorData += data.toString();
      console.error(`[API] /api/chat-with-ai: Python stderr: ${data.toString()}`);
    });

    pythonProcess.on("close", (code) => {
      console.log(`[API] /api/chat-with-ai: Python process exited with code ${code}`);
      if (code !== 0) {
        console.error("[API] /api/chat-with-ai: Python script failed:", errorData);
        return res.status(500).json({ success: false, message: "Error processing AI chat request.", error: errorData });
      }

      try {
        const result = JSON.parse(outputData);
        if (result.error) {
          console.error("[API] /api/chat-with-ai: Python script returned an error:", result.error);
          return res.status(500).json({ success: false, message: result.error });
        }
        console.log(`[API] /api/chat-with-ai: AI response: "${result.response}"`);
        return res.status(200).json({
          success: true,
          response: result.response,
          escalate: result.escalate || false,
        });
      } catch (error) {
        console.error("[API] /api/chat-with-ai: Error parsing AI response:", error);
        return res.status(500).json({ success: false, message: "Error parsing AI response.", error: error.toString() });
      }
    });
  } catch (error) {
    console.error("[API] /api/chat-with-ai: Server error:", error);
    return res.status(500).json({ success: false, message: "Server error during AI chat.", error: error.toString() });
  }
});

/**
 * API 10.65.63 - POST /api/start-ai-chat
 * Starts an AI chat session and logs it
 */
app.post("/api/start-ai-chat", async (req, res) => {
  const { username, entireChat, startTime, isClosed } = req.body;
  if (!username || !startTime) {
    return res.status(400).json({ success: false, message: "Missing username or startTime." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("agentUsername", sql.NVarChar(100), username)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat || "")
      .input("startTime", sql.DateTime, new Date(startTime))
      .input("isClosed", sql.Bit, isClosed ? 1 : 0)
      .query(`
        INSERT INTO [dbo].[ChatWith_AI_Log] (AgentUsername, EntireChat, StartTime, IsClosed)
        OUTPUT INSERTED.LogID
        VALUES (@agentUsername, @entireChat, @startTime, @isClosed)
      `);
    const logId = result.recordset[0].LogID;
    return res.status(200).json({ success: true, logId });
  } catch (error) {
    console.error("[API] /api/start-ai-chat: Error starting AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error starting AI chat log." });
  }
});

/**
 * API 10.66.64 - POST /api/update-ai-chat
 * Updates an AI chat log
 */
app.post("/api/update-ai-chat", async (req, res) => {
  const { logId, entireChat } = req.body;
  if (!logId || !entireChat) {
    return res.status(400).json({ success: false, message: "Missing logId or entireChat." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("logId", sql.Int, logId)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat)
      .query(`
        UPDATE [dbo].[ChatWith_AI_Log]
        SET EntireChat = @entireChat
        WHERE LogID = @logId
      `);
    return res.status(200).json({ success: true, message: "AI chat log updated successfully." });
  } catch (error) {
    console.error("[API] /api/update-ai-chat: Error updating AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error updating AI chat log." });
  }
});

/**
 * API 10.67.65 - POST /api/close-ai-chat
 * Closes an AI chat session and logs it
 */
app.post("/api/close-ai-chat", async (req, res) => {
  const { logId, entireChat, endTime, isClosed } = req.body;
  if (!logId || !entireChat || !endTime) {
    return res.status(400).json({ success: false, message: "Missing logId, entireChat, or endTime." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("logId", sql.Int, logId)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat)
      .input("endTime", sql.DateTime, new Date(endTime))
      .input("isClosed", sql.Bit, isClosed ? 1 : 0)
      .query(`
        UPDATE [dbo].[ChatWith_AI_Log]
        SET EntireChat = @entireChat, EndTime = @endTime, IsClosed = @isClosed
        WHERE LogID = @logId
      `);
    return res.status(200).json({ success: true, message: "AI chat log closed successfully." });
  } catch (error) {
    console.error("[API] /api/close-ai-chat: Error closing AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error closing AI chat log." });
  }
});

/* 10.12 Team Management APIs */
/**
 * API 10.68.66 - GET /api/team-agents/:username
 * Retrieves agents under a team leader
 */
app.get("/api/team-agents/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const pool = await connectToDatabase();
    const userRow = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT TOP 1 AccountType FROM dbo.Users WHERE LOWER(username) = LOWER(@username)`);
    const accountType = userRow.recordset[0]?.AccountType || "";
    const broadAccess = ["Super Admin", "Admin"].includes(accountType);

    const result = await pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .input("broadAccess", sql.Bit, broadAccess ? 1 : 0)
      .query(`
        SELECT 
          A.agent_name AS name, 
          COALESCE(AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))), 0) AS avgScore,
          COUNT(ADS.AudioFileName) AS calls,
          COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, ADS.AudioDuration))) / 60.0, 2), 0) AS aht
        FROM dbo.Agents A
        LEFT JOIN dbo.AI_Details_Scoring ADS
          ON A.agent_name = ADS.AgentName
          AND ADS.UploadDate >= DATEADD(DAY, -7, GETDATE())
        WHERE (@broadAccess = 1 OR LOWER(A.supervisor) = LOWER(@teamLeaderUsername))
        GROUP BY A.agent_name
        ORDER BY A.agent_name
      `);
    return res.status(200).json({ success: true, agents: result.recordset, scope: broadAccess ? "all" : "team" });
  } catch (error) {
    console.error("Error fetching team agents:", error);
    return res.status(500).json({ success: false, message: "Server error fetching team agents." });
  }
});

/**
 * API 10.69.67 - GET /api/audit-queue/:username
 * Retrieves audit queue for a team leader
 */
function buildAuditQueueQuery({ withCallAudits = true } = {}) {
  const auditJoin = withCallAudits
    ? " LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = ADS.AudioFileName"
    : "";
  const manualScoreExpr = withCallAudits
    ? "COALESCE(TRY_CAST(CA.OverallManualScore AS DECIMAL(10,2)), 0)"
    : "CAST(0 AS DECIMAL(10,2))";
  const hasAuditExpr = withCallAudits
    ? "CASE WHEN CA.AuditID IS NOT NULL THEN 1 ELSE 0 END"
    : "0";
  const auditorNameExpr = withCallAudits
    ? "CA.AuditorUsername"
    : "CAST(NULL AS NVARCHAR(100))";

  return `
      SELECT 
        ADS.AudioFileName AS fileName,
        AU.UploadID AS callId,
        A.agent_name AS agentName,
        AU.CallType AS callType,
        COALESCE(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)), 0) AS score,
        ${manualScoreExpr} AS manualScoring,
        ${hasAuditExpr} AS hasManualAudit,
        ${auditorNameExpr} AS auditorName,
        FORMAT(ADS.CallDate, 'yyyy-MM-dd') AS callDate
      FROM dbo.Agents A
      JOIN dbo.AI_Details_Scoring ADS ON A.agent_name = ADS.AgentName
      JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
      ${auditJoin}
      WHERE (@broadAccess = 1 OR LOWER(A.supervisor) = LOWER(@teamLeaderUsername))
        AND CAST(ADS.UploadDate AS DATE) >= COALESCE(CAST(@fromDate AS DATE), DATEADD(DAY, -7, GETDATE()))
        AND CAST(ADS.UploadDate AS DATE) <= COALESCE(CAST(@toDate AS DATE), GETDATE())
        AND (
          (ADS.Rude_Behavior IS NOT NULL AND ADS.Rude_Behavior != '')
          OR TRY_CAST(ADS.Adherence_to_Protocol AS DECIMAL(10,2)) < 5
          OR TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) < 80
        )
    `;
}

app.get("/api/audit-queue/:username", async (req, res) => {
  const { username } = req.params;
  const { agentName, fromDate, toDate } = req.query;

  try {
    const pool = await connectToDatabase();
    const userRow = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT TOP 1 AccountType FROM dbo.Users WHERE LOWER(username) = LOWER(@username)`);
    const accountType = userRow.recordset[0]?.AccountType || "";
    const broadAccess = ["Super Admin", "Admin"].includes(accountType);

    let query = buildAuditQueueQuery({ withCallAudits: true });

    if (agentName) {
      query += ` AND LOWER(A.agent_name) = LOWER(@agentName)`;
    }

    query += ` ORDER BY ADS.Overall_Scoring ASC`;

    const request = pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .input("broadAccess", sql.Bit, broadAccess ? 1 : 0)
      .input("fromDate", sql.Date, fromDate || null)
      .input("toDate", sql.Date, toDate || null);

    if (agentName) {
      request.input("agentName", sql.NVarChar, agentName);
    }

    let result;
    try {
      result = await request.query(query);
    } catch (auditErr) {
      if (!isMissingDbObjectError(auditErr)) throw auditErr;
      query = buildAuditQueueQuery({ withCallAudits: false });
      if (agentName) {
        query += ` AND LOWER(A.agent_name) = LOWER(@agentName)`;
      }
      query += ` ORDER BY ADS.Overall_Scoring ASC`;
      result = await request.query(query);
    }

    return res.status(200).json({ success: true, auditQueue: result.recordset });
  } catch (error) {
    console.error("Error fetching audit queue:", error);
    return res.status(500).json({ success: false, message: "Server error fetching audit queue." });
  }
});

/**
 * API 10.70.68 - GET /api/team-leaders
 * Retrieves list of team leaders, optionally filtered by location
 */
app.get("/api/team-leaders", async (req, res) => {
  const { location } = req.query;
  try {
    const pool = await connectToDatabase();
    let query = "SELECT DISTINCT supervisor AS Username FROM [dbo].[Agents] WHERE supervisor IS NOT NULL";
    const params = {};

    if (location && location !== "All") {
      query += " AND TRIM(LOWER(agent_location)) = TRIM(LOWER(@location))";
      params.location = location;
    }

    query += " ORDER BY supervisor";

    const request = pool.request();
    if (location && location !== "All") {
      request.input("location", sql.NVarChar, location);
    }

    const result = await request.query(query);
    return res.status(200).json({ success: true, teamLeaders: result.recordset.map(row => row.Username) });
  } catch (error) {
    console.error("Error in GET /api/team-leaders:", error);
    return res.status(500).json({ success: false, message: "Server error fetching team leaders." });
  }
});

/**
 * API 10.71.69 - GET /api/locations
 * Retrieves active locations from the managed Locations table (Admin Settings).
 * Falls back to distinct agent_location from Agents table if Locations table doesn't exist yet.
 */
app.get("/api/locations", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    try {
      const result = await pool.request()
        .query("SELECT LocationName FROM dbo.Locations WHERE IsActive = 1 ORDER BY LocationName");
      return res.status(200).json({ success: true, locations: result.recordset.map(row => row.LocationName) });
    } catch {
      const fallback = await pool.request()
        .query("SELECT DISTINCT agent_location AS LocationName FROM [dbo].[Agents] WHERE agent_location IS NOT NULL AND agent_location <> '' ORDER BY agent_location");
      return res.status(200).json({ success: true, locations: fallback.recordset.map(row => row.LocationName) });
    }
  } catch (error) {
    console.error("Error in GET /api/locations:", error);
    return res.status(500).json({ success: false, message: "Server error fetching locations." });
  }
});

/* 10.13 Call Search APIs */
/**
 * API 10.72.70 - GET /api/search-calls
 * Searches calls by caller ID, agent ID, or agent name
 */
app.get("/api/search-calls", async (req, res) => {
  const { callerId, agentId, agentName } = req.query;

  if (!callerId && !agentId && !agentName) {
    return res.status(400).json({ success: false, message: "At least one search parameter (callerId, agentId, or agentName) is required." });
  }

  try {
    const pool = await sqlConnect();
    let query = `
      SELECT 
        APR.AudioFileName AS FileName,
        FORMAT(APR.Timestamp, 'yyyy-MM-dd') AS UploadDate,
        APR.Status,
        FORMAT(APR.Timestamp, 'yyyy-MM-dd') AS ProcessDate,
        ADS.AgentName,
        ADS.AudioDuration,
        ADS.AudioLanguage,
        AgentTable.agent_id AS AgentID,
        AgentTable.agent_location AS Location,
        ADS.Overall_Scoring
      FROM AI_Processing_Result APR
      LEFT JOIN AI_Details_Scoring ADS
        ON APR.AudioFileName = ADS.AudioFileName
      LEFT JOIN [dbo].[Agents] AgentTable
        ON LOWER(ADS.AgentName) = LOWER(AgentTable.agent_name)
      WHERE 1=1
    `;

    const conditions = [];
    const request = pool.request();

    if (callerId) {
      conditions.push(`APR.AudioFileName LIKE @callerId`);
      request.input("callerId", sql.NVarChar, `%${callerId}%`);
    }
    if (agentId) {
      conditions.push(`AgentTable.agent_id LIKE @agentId`);
      request.input("agentId", sql.NVarChar, `%${agentId}%`);
    }
    if (agentName) {
      conditions.push(`ADS.AgentName LIKE @agentName`);
      request.input("agentName", sql.NVarChar, `%${agentName}%`);
    }

    if (conditions.length > 0) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY APR.Timestamp DESC;`;

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("Error searching calls:", error);
    return res.status(500).json({ success: false, message: "Server error searching calls." });
  }
});

/**
 * API 10.73.71 - GET /api/most-recent-call-date
 * Retrieves the most recent call date
 */
app.get("/api/most-recent-call-date", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT MAX(CallDate) AS MostRecentDate FROM [AI_Details_Scoring]");
    const mostRecentDate = result.recordset[0].MostRecentDate;
    if (!mostRecentDate) {
      return res.status(404).json({ success: false, message: "No call data available." });
    }
    return res.status(200).json({ success: true, mostRecentDate: mostRecentDate.toISOString().split("T")[0] });
  } catch (error) {
    console.error("Error in /api/most-recent-call-date:", error);
    return res.status(500).json({ success: false, message: "Server error fetching most recent call date: " + error.message });
  }
});

/**
 * API 10.74.72 - GET /api/earliest-call-date
 * Retrieves the earliest call date
 */
app.get("/api/earliest-call-date", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT MIN(CallDate) AS EarliestDate FROM [AI_Details_Scoring]");
    const earliestDate = result.recordset[0].EarliestDate;
    if (!earliestDate) {
      return res.status(404).json({ success: false, message: "No call data available." });
    }
    return res.status(200).json({ success: true, earliestDate: earliestDate.toISOString().split("T")[0] });
  } catch (error) {
    console.error("Error in /api/earliest-call-date:", error);
    return res.status(500).json({ success: false, message: "Server error fetching earliest call date: " + error.message });
  }
});

/* 10.14 Knowledge Base APIs */
/**
 * API 10.75.73 - GET /api/reva-knowledge-options
 * Retrieves categorized knowledge entries
 */
app.get("/api/reva-knowledge-options", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT Category, Question, Answer, ModifiedAt
      FROM RevaKnowledgeBase
      WHERE Category IS NOT NULL
      ORDER BY Category, Question
    `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No categorized knowledge entries found in RevaKnowledgeBase." });
    }
    const groupedEntries = result.recordset.reduce((acc, row) => {
      const category = row.Category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        question: row.Question,
        answer: row.Answer,
        modifiedAt: row.ModifiedAt
      });
      return acc;
    }, {});
    return res.status(200).json({ success: true, categories: groupedEntries });
  } catch (error) {
    console.error("[API] /api/reva-knowledge-options: Error fetching knowledge entries from RevaKnowledgeBase:", error);
    writeLog(`Error in /api/reva-knowledge-options: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching knowledge entries from RevaKnowledgeBase." });
  }
});

/**
 * API 10.76.74 - GET /api/reva-knowledge
 * Retrieves knowledge entries for Team Leaders
 */
app.get("/api/reva-knowledge", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT ID, Category, Question, Answer, UpdatedBy, CreatedBy, ModifiedBy, CreatedAt, ModifiedAt
      FROM RevaKnowledgeBase
      WHERE Category IS NOT NULL
      ORDER BY Category, CreatedAt DESC
    `);
    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, categories: {} });
    }
    const groupedEntries = result.recordset.reduce((acc, row) => {
      const category = row.Category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        ID: row.ID,
        question: row.Question,
        answer: row.Answer,
        modifiedBy: row.ModifiedBy,
        modifiedAt: row.ModifiedAt,
      });
      return acc;
    }, {});
    return res.status(200).json({ success: true, categories: groupedEntries });
  } catch (error) {
    console.error("Error fetching Reva Knowledge entries for Team Leader:", error);
    writeLog(`Error in /api/reva-knowledge GET: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching Reva Knowledge entries for Team Leader." });
  }
});

/**
 * API 10.77.75 - POST /api/reva-knowledge
 * Adds a new knowledge entry
 */
app.post("/api/reva-knowledge", async (req, res) => {
  const { question, answer, category, username } = req.body;
  if (!question || !answer || !category || !username) {
    return res.status(400).json({ success: false, message: "Missing required fields: question, answer, category, and username are required." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, answer)
      .input("category", sql.NVarChar, category)
      .input("username", sql.NVarChar, username)
      .input("timestamp", sql.DateTime, new Date())
      .query(`
        INSERT INTO RevaKnowledgeBase (Question, Answer, Category, UpdatedBy, CreatedBy, ModifiedBy, CreatedAt, ModifiedAt)
        VALUES (@question, @answer, @category, @username, @username, @username, @timestamp, @timestamp);
        SELECT SCOPE_IDENTITY() AS ID;
      `);
    const id = result.recordset[0].ID;
    return res.status(201).json({ success: true, message: "Knowledge entry added successfully.", id });
  } catch (error) {
    console.error("Error adding Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge POST: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error adding Reva Knowledge entry." });
  }
});

/**
 * API 10.78.76 - PUT /api/reva-knowledge/:id
 * Updates an existing knowledge entry
 */
app.put("/api/reva-knowledge/:id", async (req, res) => {
  const { id } = req.params;
  const question = req.body.question || req.body.Question;
  const answer = req.body.answer || req.body.Answer;
  const category = req.body.category || req.body.Category;
  const username = req.body.username || req.body.Username;
  if (!question || !answer || !category || !username) {
    return res.status(400).json({ success: false, message: "Missing required fields: question, answer, category, and username are required." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, answer)
      .input("category", sql.NVarChar, category)
      .input("username", sql.NVarChar, username)
      .input("timestamp", sql.DateTime, new Date())
      .query(`
        UPDATE RevaKnowledgeBase
        SET Question = @question,
            Answer = @answer,
            Category = @category,
            UpdatedBy = @username,
            ModifiedBy = @username,
            ModifiedAt = @timestamp
        WHERE ID = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Knowledge entry not found." });
    }
    return res.status(200).json({ success: true, message: "Knowledge entry updated successfully." });
  } catch (error) {
    console.error("Error updating Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge/:id PUT: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error updating Reva Knowledge entry." });
  }
});

/**
 * API 10.79.77 - DELETE /api/reva-knowledge/:id
 * Deletes a knowledge entry
 */
app.delete("/api/reva-knowledge/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM RevaKnowledgeBase
        WHERE ID = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Knowledge entry not found." });
    }
    return res.status(200).json({ success: true, message: "Knowledge entry deleted successfully." });
  } catch (error) {
    console.error("Error deleting Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge/:id DELETE: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error deleting Reva Knowledge entry." });
  }
});

/* 10.15 Agent Controller APIs */
// APIs for managing agents, mounted via agentRoutes and defined here
/**
 * API 10.80.78 - GET /api/agents
 * Fetches all active agents
 */
app.get("/api/agents", async (req, res) => {
  logAgentAction("Fetching all active agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    const recordset = result.recordset.map(agent => ({
      ...agent,
      agent_type: agent.agent_type || null
    }));

    logAgentAction("Successfully fetched all active agents.");
    return res.status(200).json(recordset);
  } catch (error) {
    logAgentAction(`Error fetching all agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch agents" });
  }
});

/**
 * API 10.81.79 - GET /api/agents/inbound
 * Fetches inbound agents
 */
app.get("/api/agents/inbound", async (req, res) => {
  logAgentAction("Fetching inbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Inbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error fetching inbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch inbound agents" });
  }
});

/**
 * API 10.82.80 - GET /api/agents/outbound
 * Fetches outbound agents
 */
app.get("/api/agents/outbound", async (req, res) => {
  logAgentAction("Fetching outbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Outbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error fetching outbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch outbound agents" });
  }
});

/**
 * API 10.83.81 - POST /api/agents
 * Creates a new agent
 */
app.post("/api/agents", async (req, res) => {
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to create agents."))) return;
  logAgentAction("Creating a new agent...");
  const {
    name,
    agentId,
    email,
    mobile,
    supervisor,
    type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  if (!name?.trim() || !agentId?.trim() || !supervisor?.trim() || !type?.trim()) {
    return res.status(400).json({ error: "Name, Agent ID, Type, and Supervisor are required." });
  }

  const cleanEmail = (email || "").trim() || null;
  const cleanMobile = (mobile || "").trim() || null;

  try {
    const pool = await connectToDatabase();

    const dup = await pool.request()
      .input("agent_id", sql.NVarChar, agentId.trim())
      .input("agent_name", sql.NVarChar, name.trim())
      .query(`
        SELECT TOP 1 agent_id, agent_name FROM Agents
        WHERE agent_id = @agent_id OR LOWER(agent_name) = LOWER(@agent_name)
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "An agent with this ID or name already exists." });
    }

    await pool.request()
      .input("agent_id", sql.NVarChar, agentId.trim())
      .input("agent_name", sql.NVarChar, name.trim())
      .input("agent_email", sql.NVarChar, cleanEmail)
      .input("agent_mobile", sql.NVarChar, cleanMobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        INSERT INTO Agents (
          agent_id,
          agent_name,
          agent_email,
          agent_mobile,
          supervisor,
          agent_type,
          manager,
          auditor,
          notes,
          agent_location,
          is_active,
          deactivated_date,
          agent_creation_date
        )
        VALUES (
          @agent_id,
          @agent_name,
          @agent_email,
          @agent_mobile,
          @supervisor,
          @agent_type,
          @manager,
          @auditor,
          @notes,
          @agent_location,
          1,
          NULL,
          GETDATE()
        );
      `);

    logAgentAction("New agent created successfully.");
    return res.status(201).json({ message: "Agent created successfully" });
  } catch (err) {
    logAgentAction(`Error creating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to create agent" });
  }
});

/**
 * API 10.84.82 - PUT /api/agents/:id
 * Updates an existing agent
 */
app.put("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to update agents."))) return;
  logAgentAction(`Updating agent with ID = ${id} ...`);

  const {
    agent_name,
    agent_email,
    agent_mobile,
    supervisor,
    agent_type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  if (!agent_name || !agent_email || !agent_mobile || !supervisor || !agent_type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .input("agent_name", sql.NVarChar, agent_name)
      .input("agent_email", sql.NVarChar, agent_email)
      .input("agent_mobile", sql.NVarChar, agent_mobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, agent_type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        UPDATE Agents
        SET
          agent_name = @agent_name,
          agent_email = @agent_email,
          agent_mobile = @agent_mobile,
          supervisor = @supervisor,
          agent_type = @agent_type,
          manager = @manager,
          auditor = @auditor,
          notes = @notes,
          agent_location = @agent_location
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} updated successfully.`);
      return res.status(200).json({ message: "Agent updated successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAgentAction(`Error updating agent ${id}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update agent" });
  }
});

/**
 * API 10.85.83 - DELETE /api/agents/:id
 * Hard deletes an agent by ID
 */
app.delete("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to delete agents."))) return;
  logAgentAction(`Hard deleting agent ID = ${id} ...`);
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .query(`
        DELETE FROM Agents
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} deleted successfully.`);
      return res.status(200).json({ message: "Agent deleted successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (error) {
    logAgentAction(`Error deleting agent: ${error.message}`);
    return res.status(500).json({ error: "Failed to delete agent" });
  }
});

/**
 * API 10.86.84 - GET /api/agents/search
 * Searches active agents by name or ID
 */
app.get("/api/agents/search", async (req, res) => {
  logAgentAction("Searching agents...");
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Missing search parameter: 'q'" });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("searchTerm", sql.NVarChar, `%${q}%`)
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
          AND (
            agent_name LIKE @searchTerm
            OR agent_id LIKE @searchTerm
          )
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error searching agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to search agents" });
  }
});

/**
 * API 10.87.85 - PUT /api/agents/:id/deactivate
 * Deactivates an agent (soft delete)
 */
app.put("/api/agents/:id/deactivate", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to deactivate agents."))) return;
  logAgentAction(`Deactivating agent ID = ${id} ...`);

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .query(`
        UPDATE Agents
        SET
          is_active = 0,
          deactivated_date = GETDATE()
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} deactivated successfully.`);
      return res.status(200).json({ message: "Agent deactivated" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAgentAction(`Error deactivating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

// Logging utility for agent endpoints
function logAgentAction(message) {
  const timestamp = getISTTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/* ===================== 10.16 RBAC & Admin Settings APIs ===================== */

/**
 * Middleware helper: verifies the caller is Admin or Super Admin by checking
 * the Authorization token against ActiveSessions + Users tables.
 */
async function resolveCallerRole(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (!token) return null;
  try {
    const pool = await connectToDatabase();
    const sess = await pool.request()
      .input("token", sql.NVarChar, token)
      .query(`
        SELECT u.AccountType, u.Username
        FROM ActiveSessions s
        JOIN Users u ON s.Username = u.Username
        WHERE s.Token = @token AND s.IsActive = 1
      `);
    if (sess.recordset.length === 0) return null;
    return sess.recordset[0];
  } catch {
    return null;
  }
}

function isAdminRole(accountType) {
  return ["Super Admin", "Admin"].includes(accountType);
}

/**
 * Resolves the caller's role, preferring req.user (set by authGate) and falling
 * back to a direct token lookup when enforcement is disabled. Returns
 * { username, accountType } or null.
 */
async function getCallerRole(req) {
  if (req.user?.username) {
    return { username: req.user.username, accountType: req.user.accountType || "" };
  }
  const caller = await resolveCallerRole(req);
  return caller ? { username: caller.Username, accountType: caller.AccountType || "" } : null;
}

/**
 * Guard that ensures the caller has one of the allowed roles. Sends a 401/403
 * response and returns null when unauthorized; otherwise returns the caller.
 */
async function requireRoles(req, res, allowedRoles, message) {
  const caller = await getCallerRole(req);
  if (!caller) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return null;
  }
  if (!allowedRoles.includes(caller.accountType)) {
    res.status(403).json({ success: false, message: message || "Insufficient permissions." });
    return null;
  }
  return caller;
}

const ADMIN_ROLES = ["Super Admin", "Admin"];
const AGENT_MANAGER_ROLES = ["Super Admin", "Admin", "Manager"];

/** Uses req.user from authGate (preferred) — avoids a second session lookup. */
function requireAdmin(req, res) {
  if (!req.user?.username || !isAdminRole(req.user.accountType)) {
    res.status(403).json({ success: false, message: "Only Admin/Super Admin can manage locations." });
    return null;
  }
  return req.user;
}

/**
 * API 10.90.01 - PUT /api/user/:username/role
 * Updates a user's AccountType (role)
 */
app.put("/api/user/:username/role", async (req, res) => {
  const { username } = req.params;
  const { role } = req.body;
  const validRoles = ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor", "Agent", "IT"];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can change roles." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("role", sql.NVarChar, role)
      .query("UPDATE dbo.Users SET AccountType = @role WHERE Username = @username");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    writeLog(`[${getISTTimeString()}] Role updated: ${username} -> ${role} by ${caller.Username}`);
    return res.status(200).json({ success: true, message: "Role updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating role:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating role." });
  }
});

/**
 * API 10.90.02 - GET /api/admin/locations
 * Returns all locations from the Locations table (admin-managed)
 */
app.get("/api/admin/locations", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can view locations."))) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT LocationID, LocationName, IsActive, CreatedAt, UpdatedAt FROM dbo.Locations ORDER BY LocationName");
    return res.status(200).json({ success: true, locations: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching admin locations:`, error.message);
    return res.status(500).json({ success: false, message: error.message || "Server error fetching locations." });
  }
});

/**
 * API 10.90.03 - POST /api/admin/locations
 * Creates a new location
 */
app.post("/api/admin/locations", async (req, res) => {
  const { locationName } = req.body;
  if (!locationName || !locationName.trim()) {
    return res.status(400).json({ success: false, message: "Location name is required." });
  }
  try {
    const caller = requireAdmin(req, res);
    if (!caller) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const existing = await pool.request()
      .input("name", sql.NVarChar, locationName.trim())
      .query("SELECT LocationID FROM dbo.Locations WHERE LocationName = @name");
    if (existing.recordset.length > 0) {
      return res.status(400).json({ success: false, message: "Location already exists." });
    }
    await pool.request()
      .input("name", sql.NVarChar, locationName.trim())
      .query("INSERT INTO dbo.Locations (LocationName) VALUES (@name)");
    writeLog(`[${getISTTimeString()}] Location created: ${locationName.trim()} by ${caller.username}`);
    return res.status(201).json({ success: true, message: "Location created." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error creating location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error creating location." });
  }
});

/**
 * API 10.90.04 - PUT /api/admin/locations/:id
 * Updates a location
 */
app.put("/api/admin/locations/:id", async (req, res) => {
  const { id } = req.params;
  const { locationName, isActive } = req.body;
  try {
    if (!requireAdmin(req, res)) return;
    const pool = await connectToDatabase();
    const updates = [];
    const request = pool.request().input("id", sql.Int, parseInt(id, 10));
    if (locationName !== undefined) {
      updates.push("LocationName = @name");
      request.input("name", sql.NVarChar, locationName.trim());
    }
    if (isActive !== undefined) {
      updates.push("IsActive = @active");
      request.input("active", sql.Bit, isActive ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }
    updates.push("UpdatedAt = GETDATE()");
    const result = await request.query(`UPDATE dbo.Locations SET ${updates.join(", ")} WHERE LocationID = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Location not found." });
    }
    return res.status(200).json({ success: true, message: "Location updated." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating location." });
  }
});

/**
 * API 10.90.05 - DELETE /api/admin/locations/:id
 * Deletes a location
 */
app.delete("/api/admin/locations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const caller = requireAdmin(req, res);
    if (!caller) return;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, parseInt(id, 10))
      .query("DELETE FROM dbo.Locations WHERE LocationID = @id");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Location not found." });
    }
    writeLog(`[${getISTTimeString()}] Location deleted: ID ${id} by ${caller.username}`);
    return res.status(200).json({ success: true, message: "Location deleted." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error deleting location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error deleting location." });
  }
});

/**
 * API 10.90.06 - GET /api/admin/settings
 * Returns all application settings
 */
app.get("/api/admin/settings", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can view settings."))) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT SettingKey, SettingValue, UpdatedAt, UpdatedBy FROM dbo.AppSettings");
    const settings = {};
    result.recordset.forEach(row => { settings[row.SettingKey] = row.SettingValue; });
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching settings:`, error.message);
    return res.status(500).json({ success: false, message: "Server error fetching settings." });
  }
});

/**
 * API 10.90.07 - PUT /api/admin/settings
 * Updates application settings (batch key-value pairs)
 */
app.put("/api/admin/settings", async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== "object") {
    return res.status(400).json({ success: false, message: "Settings object is required." });
  }
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can update settings." });
    }
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    for (const [key, value] of Object.entries(settings)) {
      await pool.request()
        .input("key", sql.NVarChar, key)
        .input("value", sql.NVarChar, value || "")
        .input("updatedBy", sql.NVarChar, caller.Username)
        .query(`
          MERGE dbo.AppSettings AS target
          USING (SELECT @key AS SettingKey) AS source
          ON target.SettingKey = source.SettingKey
          WHEN MATCHED THEN UPDATE SET SettingValue = @value, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
          WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@key, @value, @updatedBy);
        `);
    }
    writeLog(`[${getISTTimeString()}] Settings updated by ${caller.Username}: ${Object.keys(settings).join(", ")}`);
    return res.status(200).json({ success: true, message: "Settings updated." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating settings:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating settings." });
  }
});

/**
 * API 10.90.07b - GET /api/public/branding
 * Public app name + logo for login page, favicon, shell (no auth).
 */
app.get("/api/public/branding", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT SettingKey, SettingValue FROM dbo.AppSettings WHERE SettingKey IN ('app_name', 'app_logo_url')");
    const settings = { app_name: "AI-Powered Call Analysis", app_logo_url: "" };
    result.recordset.forEach((row) => { settings[row.SettingKey] = row.SettingValue; });
    const uploaded = publicLogoUrl(req);
    const external = settings.app_logo_url && !settings.app_logo_url.startsWith("/api/branding")
      ? settings.app_logo_url
      : "";
    const logoUrl = uploaded ? `${uploaded}?v=${Date.now()}` : external;
    return res.status(200).json({
      success: true,
      appName: settings.app_name || "AI-Powered Call Analysis",
      logoUrl,
    });
  } catch (error) {
    return res.status(200).json({ success: true, appName: "AI-Powered Call Analysis", logoUrl: "" });
  }
});

/**
 * API 10.90.07c - GET /api/branding/logo
 * Serves uploaded application logo file.
 */
app.get("/api/branding/logo", (req, res) => {
  const filePath = resolveBrandingLogoFile();
  if (!filePath) return res.status(404).json({ success: false, message: "No logo uploaded." });
  res.set("Cache-Control", "no-cache, must-revalidate");
  return res.sendFile(filePath);
});

/**
 * API 10.90.07d - POST /api/admin/logo
 * Upload application logo (Admin/Super Admin).
 */
app.post("/api/admin/logo", uploadAppLogo.single("logo"), async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can upload logo." });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please select an image file." });
    }
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    await pool.request()
      .input("key", sql.NVarChar, "app_logo_url")
      .input("value", sql.NVarChar, "/api/branding/logo")
      .input("updatedBy", sql.NVarChar, caller.Username)
      .query(`
        MERGE dbo.AppSettings AS target
        USING (SELECT @key AS SettingKey) AS source
        ON target.SettingKey = source.SettingKey
        WHEN MATCHED THEN UPDATE SET SettingValue = @value, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
        WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@key, @value, @updatedBy);
      `);
    const logoUrl = `${req.protocol}://${req.get("host")}/api/branding/logo?v=${Date.now()}`;
    writeLog(`[${getISTTimeString()}] App logo uploaded by ${caller.Username}`);
    return res.status(200).json({ success: true, message: "Logo uploaded.", logoUrl });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error uploading logo:`, error.message);
    return res.status(500).json({ success: false, message: error.message || "Server error uploading logo." });
  }
});

/**
 * API 10.90.08 - GET /api/dropdown/managers
 * Returns list of users with Manager role for dropdown population
 */
app.get("/api/dropdown/managers", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Manager' ORDER BY Username");
    return res.status(200).json({ success: true, managers: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching managers:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.09 - GET /api/dropdown/team-leaders
 * Returns list of users with Team Leader role for dropdown population
 */
app.get("/api/dropdown/team-leaders", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Team Leader' ORDER BY Username");
    return res.status(200).json({ success: true, teamLeaders: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching team leaders:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.10 - GET /api/dropdown/auditors
 * Returns list of users with Auditor role for dropdown population
 */
app.get("/api/dropdown/auditors", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Auditor' ORDER BY Username");
    return res.status(200).json({ success: true, auditors: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching auditors:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.11 - GET /api/dropdown/locations
 * Returns active locations from the managed Locations table for dropdown population.
 * Falls back to agent_location from Agents table if Locations table doesn't exist yet.
 */
app.get("/api/dropdown/locations", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    try {
      const result = await pool.request()
        .query("SELECT LocationID, LocationName FROM dbo.Locations WHERE IsActive = 1 ORDER BY LocationName");
      return res.status(200).json({ success: true, locations: result.recordset });
    } catch {
      const fallback = await pool.request()
        .query("SELECT DISTINCT agent_location AS LocationName FROM dbo.Agents WHERE agent_location IS NOT NULL AND agent_location <> '' ORDER BY agent_location");
      return res.status(200).json({ success: true, locations: fallback.recordset });
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching dropdown locations:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.12 - POST /api/admin/backup
 * Triggers a database backup (Super Admin only)
 */
app.post("/api/admin/backup", async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || caller.AccountType !== "Super Admin") {
      return res.status(403).json({ success: false, message: "Only Super Admin can trigger backups." });
    }
    const pool = await connectToDatabase();
    const settingsResult = await pool.request()
      .query("SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = 'backup_path'");
    let backupPath = settingsResult.recordset[0]?.SettingValue || "";
    if (!backupPath) {
      backupPath = "C:\\SQLBackups";
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dbNameResult = await pool.request().query("SELECT DB_NAME() AS dbname");
    const dbName = dbNameResult.recordset[0].dbname;
    const fullPath = `${backupPath}\\${dbName}_${timestamp}.bak`;

    await pool.request()
      .query(`BACKUP DATABASE [${dbName}] TO DISK = '${fullPath}' WITH FORMAT, INIT, NAME = '${dbName} Backup'`);
    writeLog(`[${getISTTimeString()}] Database backup created: ${fullPath} by ${caller.Username}`);
    return res.status(200).json({ success: true, message: `Backup created: ${fullPath}` });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error creating backup:`, error.message);
    return res.status(500).json({ success: false, message: `Backup failed: ${error.message}` });
  }
});

/**
 * API 10.90.13 - GET /api/admin/backup-history
 * Returns recent SQL Server backup history from msdb (Super Admin only)
 */
app.get("/api/admin/backup-history", async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || caller.AccountType !== "Super Admin") {
      return res.status(403).json({ success: false, message: "Only Super Admin can view backup history." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT TOP 20
        bs.database_name,
        bs.backup_start_date AS created_at,
        bs.backup_finish_date AS finished_at,
        CAST(bs.backup_size / 1048576.0 AS DECIMAL(10,2)) AS size_mb,
        bmf.physical_device_name AS path,
        CASE bs.type WHEN 'D' THEN 'Full' WHEN 'I' THEN 'Differential' WHEN 'L' THEN 'Log' ELSE bs.type END AS backup_type
      FROM msdb.dbo.backupset bs
      INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
      WHERE bs.database_name = DB_NAME()
      ORDER BY bs.backup_start_date DESC
    `);
    const backups = (result.recordset || []).map(row => ({
      filename: row.path ? row.path.split('\\').pop() : '',
      path: row.path,
      created_at: row.created_at,
      finished_at: row.finished_at,
      size: row.size_mb ? `${row.size_mb} MB` : '—',
      backup_type: row.backup_type,
      status: 'OK',
    }));
    return res.status(200).json({ success: true, backups });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching backup history:`, error.message);
    return res.status(200).json({ success: true, backups: [] });
  }
});

/* ===================== 10.16b Bank Settings APIs (Super Admin) ===================== */
app.use(
  "/api/admin/bank-settings",
  createBankSettingsRouter({
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
  })
);
app.use(
  "/api/internal/bank-settings",
  createBankSettingsInternalRouter({
    connectToDatabase,
    getISTTimeString,
  })
);

/* ===================== 10.16c Query Category APIs (Admin) ===================== */
app.use(
  "/api/query-categories",
  createQueryCategoryRouter({
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
  })
);

/* ===================== 10.17 Auto Upload APIs (Super Admin) ===================== */
app.use(
  "/api/admin/auto-upload",
  createAutoUploadRouter({
    sql,
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
    config,
  })
);

/* ===================== 10.18 Manual Audit APIs ===================== */
app.use(
  "/api/audits",
  createAuditRouter({
    sql,
    connectToDatabase,
    writeLog,
    getISTTimeString,
  })
);

/**
 * API 10.88.86 - POST /api/update-session-inactive-time
 * Updates the SessionInactiveTime for a user session
 */
app.post("/api/update-session-inactive-time", async (req, res) => {
  let { userId, logId, inactiveTime } = req.body;
  if (!userId || !logId || !inactiveTime) {
    console.log(`[${getISTTimeString()}] Missing fields in /api/update-session-inactive-time: ${JSON.stringify({ userId, logId, inactiveTime })}`);
    return res.status(400).json({ success: false, message: "UserID, logId, and inactiveTime are required." });
  }

  try {
    const pool = await sqlConnect();
    userId = await resolveSessionUserId(pool, userId);
    let result;
    try {
      result = await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("LogID", sql.Int, logId)
        .input("InactiveTime", sql.DateTime, new Date(inactiveTime))
        .query(`
          UPDATE ActiveSessions
          SET SessionInactiveTime = @InactiveTime
          WHERE UserID = @UserID AND LogID = @LogID AND IsActive = 1;
        `);
    } catch (columnErr) {
      if (!isMissingDbObjectError(columnErr)) {
        throw columnErr;
      }
      // No SessionInactiveTime column — treat LoginTime as last-activity heartbeat.
      result = await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("LogID", sql.Int, logId)
        .input("InactiveTime", sql.DateTime, new Date(inactiveTime))
        .query(`
          UPDATE ActiveSessions
          SET LoginTime = @InactiveTime
          WHERE UserID = @UserID AND LogID = @LogID AND IsActive = 1;
        `);
    }

    if (result.rowsAffected[0] === 0) {
      console.log(`[${getISTTimeString()}] No active session found for UserID ${userId}, LogID: ${logId}`);
      return res.status(404).json({ success: false, message: "No active session found." });
    }

    writeLog(`[${getISTTimeString()}] SessionInactiveTime updated for UserID ${userId}, LogID: ${logId} at ${new Date(inactiveTime).toISOString()}`);
    return res.status(200).json({ success: true, message: "SessionInactiveTime updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/update-session-inactive-time: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error updating SessionInactiveTime." });
  }
});

/**
 * API 10.89.87 - POST /api/check-session
 * Checks if a session is still active
 */
app.post("/api/check-session", async (req, res) => {
  let { userId, token } = req.body;
  if (!userId || !token) {
    console.log(`[${getISTTimeString()}] Missing fields in /api/check-session: ${JSON.stringify({ userId, token })}`);
    return res.status(400).json({ success: false, message: "UserID and token are required." });
  }
  try {
    const pool = await sqlConnect();
    console.log(`[${getISTTimeString()}] Checking session for UserID ${userId}`);

    const lookupSession = async (sessionUserId) => {
      try {
        return await pool.request()
          .input("UserID", sql.NVarChar, sessionUserId)
          .input("Token", sql.NVarChar, token)
          .query(`
            SELECT IsActive, SessionInactiveTime, LoginTime
            FROM ActiveSessions
            WHERE UserID = @UserID AND Token = @Token;
          `);
      } catch (columnErr) {
        if (!isMissingDbObjectError(columnErr)) {
          throw columnErr;
        }
        return pool.request()
          .input("UserID", sql.NVarChar, sessionUserId)
          .input("Token", sql.NVarChar, token)
          .query(`
            SELECT IsActive, LoginTime
            FROM ActiveSessions
            WHERE UserID = @UserID AND Token = @Token;
          `);
      }
    };

    let result = await lookupSession(userId);
    if (result.recordset.length === 0) {
      const resolvedUserId = await resolveSessionUserId(pool, userId);
      if (resolvedUserId !== userId) {
        console.log(`[${getISTTimeString()}] Retrying session check with resolved UserID ${resolvedUserId}`);
        result = await lookupSession(resolvedUserId);
        userId = resolvedUserId;
      }
    }
    if (result.recordset.length === 0) {
      console.log(`[${getISTTimeString()}] No session found for UserID ${userId}`);
      return res.status(404).json({ success: false, message: "Session not found." });
    }
    const session = result.recordset[0];
    if (!session.IsActive) {
      console.log(`[${getISTTimeString()}] Session is inactive for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Session is inactive." });
    }
    const now = new Date();
    const inactiveTime = session.SessionInactiveTime
      ? new Date(session.SessionInactiveTime)
      : new Date(session.LoginTime);
    const INACTIVITY_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
    if (inactiveTime && now - inactiveTime >= INACTIVITY_TIMEOUT_MS) {
      console.log(`[${getISTTimeString()}] Session timed out due to inactivity for UserID ${userId}`);
      await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("Token", sql.NVarChar, token)
        .query(`
          UPDATE ActiveSessions
          SET IsActive = 0
          WHERE UserID = @UserID AND Token = @Token;
        `);
      return res.status(401).json({ success: false, message: "Session timed out due to inactivity." });
    }
    console.log(`[${getISTTimeString()}] Session is active for UserID ${userId}`);
    return res.status(200).json({ success: true, message: "Session is active.", userId });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/check-session: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking session." });
  }
});

/**
 * API 10.90.88 - POST /api/check-multiple-sessions
 * Checks if there are multiple active sessions for the same user
 */
app.post("/api/check-multiple-sessions", async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    writeLog(`[${getISTTimeString()}] Missing userId in /api/check-multiple-sessions`);
    return res.status(400).json({ success: false, message: "userId is required." });
  }

  try {
    const pool = await sqlConnect();
    const result = await pool.request()
      .input("UserID", sql.NVarChar, userId)
      .query(`
        SELECT COUNT(*) as activeSessions
        FROM ActiveSessions
        WHERE UserID = @UserID AND IsActive = 1;
      `);

    const activeSessions = result.recordset[0].activeSessions;
    return res.status(200).json({ success: true, activeSessions });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error in /api/check-multiple-sessions: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking multiple sessions." });
  }
});

/**
 * API 10.91.89 - POST /api/invalidate-existing-sessions
 * Invalidates all existing active sessions for a user except the current one
 */
app.post("/api/invalidate-existing-sessions", async (req, res) => {
  const { userId, currentLogId } = req.body;
  if (!userId) {
    writeLog(`[${getISTTimeString()}] Missing userId in /api/invalidate-existing-sessions`);
    return res.status(400).json({ success: false, message: "userId is required." });
  }

  try {
    const pool = await sqlConnect();
    await pool.request()
      .input("UserID", sql.NVarChar, userId)
      .input("CurrentLogID", sql.Int, currentLogId || -1) // -1 if no currentLogId
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE UserID = @UserID AND IsActive = 1 AND LogID != @CurrentLogID;
      `);

    writeLog(`[${getISTTimeString()}] Invalidated existing sessions for UserID ${userId}, excluding LogID ${currentLogId}`);
    return res.status(200).json({ success: true, message: "Existing sessions invalidated." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error in /api/invalidate-existing-sessions: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error invalidating sessions." });
  }
});


/* 10.5 Report Dashboard APIs */
// APIs for fetching comprehensive report data from Consolidated_Audio_Analysis table

/**
 * API 10.5.01 - GET /api/reports/inbound-calls-monthly
 * Retrieves monthly inbound call statistics for the last 12 months
 */
app.get("/api/reports/inbound-calls-monthly", async (req, res) => {
  const { year } = req.query;
  const targetYear = year || new Date().getFullYear();
  
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("year", sql.Int, targetYear)
      .query(`
        SELECT 
          FORMAT(SelectedCallDate, 'MMM') AS month,
          MONTH(SelectedCallDate) AS monthNumber,
          COUNT(*) AS callCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE CallType = 'inbound' 
          AND YEAR(SelectedCallDate) = @year
          AND Status = 'Success'
        GROUP BY MONTH(SelectedCallDate), FORMAT(SelectedCallDate, 'MMM')
        ORDER BY monthNumber
      `);
    
    writeLog(`[${getISTTimeString()}] Inbound calls monthly data fetched for year ${targetYear}`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching inbound calls monthly: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching inbound calls data." });
  }
});

/**
 * API 10.5.02 - GET /api/reports/outbound-calls-weekly
 * Retrieves weekly outbound call statistics for the last 8 weeks
 */
app.get("/api/reports/outbound-calls-weekly", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query(`
        SELECT 
          CONCAT('Week ', weekNumber) AS week,
          weekNumber,
          callCount
        FROM (
          SELECT 
            DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS weekNumber,
            YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS callYear,
            COUNT(*) AS callCount
          FROM [dbo].[Consolidated_Audio_Analysis]
          WHERE CallType = 'outbound' 
            AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(WEEK, -8, GETDATE())
            AND Status = 'Success'
          GROUP BY
            DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))),
            YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)))
        ) weekly
        ORDER BY callYear DESC, weekNumber DESC
      `);
    
    writeLog(`[${getISTTimeString()}] Outbound calls weekly data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching outbound calls weekly: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching outbound calls data." });
  }
});

/**
 * API 10.5.03 - GET /api/reports/call-resolution-status
 * Retrieves call resolution status distribution
 */
app.get("/api/reports/call-resolution-status", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AI_Resolution_Status, 'Unknown') AS resolutionStatus,
        COUNT(*) AS count
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }

    query += consolidatedReportExtraFilters({ location, supervisor, callType, agent });
    bindReportFilters(request, { location, supervisor, callType, agent });
    
    query += ` GROUP BY AI_Resolution_Status ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Call resolution status data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call resolution status: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching resolution status data." });
  }
});

/**
 * API 10.5.04 - GET /api/reports/agent-performance-metrics
 * Retrieves agent performance metrics with AI scoring
 */
app.get("/api/reports/agent-performance-metrics", async (req, res) => {
  const { location, supervisor, limit, fromDate, toDate, callType, agent } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT TOP ${limit || 10}
        AgentName,
        AgentLocation,
        AgentSupervisor,
        COUNT(*) AS totalCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgAIScore,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS avgManualScore,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS avgEmpathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS avgQueryHandling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS avgAdherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS avgResolution
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();

    if (fromDate && toDate) {
      query += ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    query += consolidatedReportExtraFilters({ location, supervisor, callType, agent });
    bindReportFilters(request, { location, supervisor, callType, agent });
    
    query += ` 
      GROUP BY AgentName, AgentLocation, AgentSupervisor
      ORDER BY avgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Agent performance metrics fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching agent performance metrics: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching agent performance data." });
  }
});

/**
 * API 10.5.05 - GET /api/reports/call-distribution-by-day
 * Retrieves call distribution by day of the week
 */
app.get("/api/reports/call-distribution-by-day", async (req, res) => {
  const { weeks } = req.query;
  const weeksBack = weeks || 4;
  
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("weeksBack", sql.Int, weeksBack)
      .query(`
        SELECT 
          DATENAME(WEEKDAY, SelectedCallDate) AS dayName,
          DATEPART(WEEKDAY, SelectedCallDate) AS dayNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE SelectedCallDate >= DATEADD(WEEK, -@weeksBack, GETDATE())
          AND Status = 'Success'
        GROUP BY DATENAME(WEEKDAY, SelectedCallDate), DATEPART(WEEKDAY, SelectedCallDate)
        ORDER BY dayNumber
      `);
    
    writeLog(`[${getISTTimeString()}] Call distribution by day fetched for ${weeksBack} weeks`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call distribution by day: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call distribution data." });
  }
});

/**
 * API 10.5.06 - GET /api/reports/agent-handling-summary
 * Retrieves comprehensive agent handling summary for the table
 */
app.get("/api/reports/agent-handling-summary", async (req, res) => {
  const { location, supervisor, fromDate, toDate } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AgentName AS agent,
        AgentLocation,
        AgentSupervisor,
        COUNT(*) AS totalCalls,
        FORMAT(
          DATEADD(SECOND, 
            AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))), 
            0
          ), 
          'mm:ss'
        ) + ' min' AS avgHandlingTime,
        CAST(AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS DECIMAL(10,1)) AS avgAIScore,
        CAST(AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS DECIMAL(10,1)) AS avgManualScore,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS resolutionRate
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY AgentName, AgentLocation, AgentSupervisor
      ORDER BY avgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    // Format the satisfaction rate as percentage
    const formattedData = result.recordset.map(row => ({
      ...row,
      satisfaction: `${Math.round(row.resolutionRate)}%`
    }));
    
    writeLog(`[${getISTTimeString()}] Agent handling summary fetched`);
    return res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching agent handling summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching agent summary data." });
  }
});

/**
 * API 10.5.07 - GET /api/reports/call-volume-trends
 * Retrieves call volume trends over time with comparison
 */
app.get("/api/reports/call-volume-trends", async (req, res) => {
  const { period, callType } = req.query;
  const periodDays = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 90;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS date,
        COUNT(*) AS totalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE SelectedCallDate >= DATEADD(DAY, -@periodDays, GETDATE())
        AND Status = 'Success'
    `;
    
    const request = pool.request().input("periodDays", sql.Int, periodDays);
    
    if (callType && callType !== 'all') {
      query += ` AND CallType = @callType`;
      request.input("callType", sql.NVarChar, callType);
    }
    
    query += ` 
      GROUP BY FORMAT(SelectedCallDate, 'yyyy-MM-dd')
      ORDER BY date DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Call volume trends fetched for ${periodDays} days`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call volume trends: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call volume trends." });
  }
});

/**
 * API 10.5.08 - GET /api/reports/language-distribution
 * Retrieves call distribution by language
 */
app.get("/api/reports/language-distribution", async (req, res) => {
  const { fromDate, toDate } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AudioLanguage, 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    query += ` GROUP BY AudioLanguage ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Language distribution data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching language distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language distribution data." });
  }
});

/**
 * API 10.5.09 - POST /api/reports/download-inbound
 * Generates and downloads inbound calls report in CSV format
 */
app.post("/api/reports/download-inbound", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AudioFileName,
        AgentName,
        AgentLocation,
        AgentSupervisor,
        SelectedCallDate,
        AudioDuration,
        AudioLanguage,
        AI_Overall_Scoring,
        Manual_Overall_Scoring,
        AI_Resolution_Status,
        AI_Call_Type,
        AI_Feedback
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CallType = 'inbound' 
        AND Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` ORDER BY SelectedCallDate DESC`;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inbound_calls_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Inbound calls report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading inbound report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating inbound report." });
  }
});

/**
 * API 10.5.10 - POST /api/reports/download-outbound
 * Generates and downloads outbound calls report in CSV format
 */
app.post("/api/reports/download-outbound", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AudioFileName,
        AgentName,
        AgentLocation,
        AgentSupervisor,
        SelectedCallDate,
        AudioDuration,
        AudioLanguage,
        AI_Overall_Scoring,
        Manual_Overall_Scoring,
        AI_Resolution_Status,
        AI_Call_Type,
        AI_Lead_Classification,
        AI_Feedback
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CallType = 'outbound' 
        AND Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` ORDER BY SelectedCallDate DESC`;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="outbound_calls_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Outbound calls report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading outbound report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating outbound report." });
  }
});

/**
 * API 10.5.11 - POST /api/reports/download-agentwise
 * Generates and downloads agent-wise performance report in CSV format
 */
app.post("/api/reports/download-agentwise", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AgentName,
        AgentID,
        AgentLocation,
        AgentSupervisor,
        AgentManager,
        COUNT(*) AS TotalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS InboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS OutboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS AvgAIScore,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS AvgManualScore,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS AvgEmpathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS AvgQueryHandling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS AvgAdherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS AvgResolution,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS ResolutionRate,
        AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) AS AvgHandlingTimeSeconds
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY AgentName, AgentID, AgentLocation, AgentSupervisor, AgentManager
      ORDER BY AvgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="agentwise_performance_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Agent-wise performance report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading agent-wise report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating agent-wise report." });
  }
});

/**
 * API 10.5.12 - POST /api/reports/download-callwise
 * Generates and downloads detailed call-wise report in CSV format
 */
app.post("/api/reports/download-callwise", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AudioFileName,
        CallType,
        AgentName,
        AgentID,
        AgentLocation,
        AgentSupervisor,
        SelectedCallDate,
        UploadDate,
        AudioLanguage,
        AudioDuration,
        AudioWPM,
        AI_Overall_Scoring,
        Manual_Overall_Scoring,
        AI_Opening_Speech,
        AI_Empathy,
        AI_Query_Handling,
        AI_Adherence_to_Protocol,
        AI_Resolution_Assurance,
        AI_Query_Resolution,
        AI_Polite_Tone,
        AI_Authentication_Verification,
        AI_Escalation_Handling,
        AI_Closing_Speech,
        AI_Rude_Behavior,
        AI_Call_Type,
        AI_Lead_Classification,
        AI_Resolution_Status,
        AI_Feedback,
        Manual_Opening_Speech,
        Manual_Empathy,
        Manual_Query_Handling,
        Manual_Adherence_to_Protocol,
        Manual_Resolution_Assurance,
        Manual_Query_Resolution,
        Manual_Polite_Tone,
        Manual_Authentication_Verification,
        Manual_Escalation_Handling,
        Manual_Closing_Speech,
        Manual_Rude_Behavior,
        Manual_Call_Type,
        Manual_Lead_Classification,
        Manual_Resolution_Status,
        Manual_Feedback,
        ManualScoredByUserID
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    if (callType && callType !== 'all') {
      query += ` AND CallType = @callType`;
      request.input("callType", sql.NVarChar, callType);
    }
    
    query += ` ORDER BY SelectedCallDate DESC`;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="callwise_detailed_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Call-wise detailed report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading call-wise report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating call-wise report." });
  }
});

/**
 * ENHANCED API ENDPOINTS FOR CALL CENTER ANALYTICS
 * Missing filters and optimizations for your Report Dashboard
 */

// ===== 1. ENHANCED CALL VOLUME TRENDS API =====
/**
 * API 10.5.13 - Enhanced Call Volume Trends with Location/Supervisor Filters
 * Your current fetchInboundData() and fetchOutboundData() need this
 */
app.get("/api/reports/call-volume-trends-enhanced", async (req, res) => {
  const { period, callType, fromDate, toDate, location, supervisor } = req.query;
  const periodDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : period === 'monthly' ? 30 : 90;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        CASE 
          WHEN @period = 'daily' THEN FORMAT(SelectedCallDate, 'yyyy-MM-dd')
          WHEN @period = 'weekly' THEN CONCAT('Week ', DATEPART(WEEK, SelectedCallDate))
          ELSE FORMAT(SelectedCallDate, 'yyyy-MM')
        END AS dateLabel,
        FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS date,
        COUNT(*) AS totalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request()
      .input("period", sql.NVarChar, period)
      .input("periodDays", sql.Int, periodDays);
    
    // Add date filters
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -@periodDays, GETDATE())`;
    }
    
    // Add location filter (MISSING in original)
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    // Add supervisor filter (MISSING in original)
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    // Add call type filter
    if (callType && callType !== 'all') {
      query += ` AND CallType = @callType`;
      request.input("callType", sql.NVarChar, callType);
    }
    
    query += ` 
      GROUP BY 
        CASE 
          WHEN @period = 'daily' THEN FORMAT(SelectedCallDate, 'yyyy-MM-dd')
          WHEN @period = 'weekly' THEN CONCAT('Week ', DATEPART(WEEK, SelectedCallDate))
          ELSE FORMAT(SelectedCallDate, 'yyyy-MM')
        END,
        FORMAT(SelectedCallDate, 'yyyy-MM-dd')
      ORDER BY date DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced call volume trends fetched: ${result.recordset.length} records`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced call volume trends: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call volume trends." });
  }
});

// ===== 2. ENHANCED CALL DISTRIBUTION WITH FILTERS =====
/**
 * API 10.5.14 - Enhanced Call Distribution with Period Support (Daily/Weekly/Monthly)
 * Supports period-based grouping for smart chart adaptation
 */
app.get("/api/reports/call-distribution-enhanced", async (req, res) => {
  const { period, weeks, location, supervisor, fromDate, toDate } = req.query;
  const weeksBack = weeks || 4;
  
  try {
    const pool = await connectToDatabase();
    let query, orderBy, groupBy;
    
    // Determine query structure based on period
    if (period === 'daily') {
      // Daily breakdown - show each day
      query = `
        SELECT 
          FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS dateLabel,
          FORMAT(SelectedCallDate, 'MMM dd') AS dayName,
          SelectedCallDate AS sortDate,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY SelectedCallDate, FORMAT(SelectedCallDate, 'yyyy-MM-dd'), FORMAT(SelectedCallDate, 'MMM dd')`;
      orderBy = ` ORDER BY sortDate`;
      
    } else if (period === 'weekly') {
      // Weekly breakdown - show each week
      query = `
        SELECT 
          CONCAT('Week ', DATEPART(WEEK, SelectedCallDate)) AS weekLabel,
          CONCAT('Week of ', FORMAT(DATEADD(DAY, 1-DATEPART(WEEKDAY, SelectedCallDate), SelectedCallDate), 'MMM dd')) AS dateLabel,
          DATEPART(WEEK, SelectedCallDate) AS weekNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY DATEPART(WEEK, SelectedCallDate), DATEPART(YEAR, SelectedCallDate)`;
      orderBy = ` ORDER BY DATEPART(YEAR, SelectedCallDate), DATEPART(WEEK, SelectedCallDate)`;
      
    } else if (period === 'monthly') {
      // Monthly breakdown - show each month
      query = `
        SELECT 
          FORMAT(SelectedCallDate, 'MMM yyyy') AS monthLabel,
          FORMAT(SelectedCallDate, 'yyyy-MM') AS dateLabel,
          YEAR(SelectedCallDate) AS year,
          MONTH(SelectedCallDate) AS month,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY YEAR(SelectedCallDate), MONTH(SelectedCallDate), FORMAT(SelectedCallDate, 'MMM yyyy'), FORMAT(SelectedCallDate, 'yyyy-MM')`;
      orderBy = ` ORDER BY year, month`;
      
    } else {
      // Default: Day of week breakdown (backward compatibility)
      query = `
        SELECT 
          DATENAME(WEEKDAY, SelectedCallDate) AS dayName,
          DATEPART(WEEKDAY, SelectedCallDate) AS dayNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY DATENAME(WEEKDAY, SelectedCallDate), DATEPART(WEEKDAY, SelectedCallDate)`;
      orderBy = ` ORDER BY dayNumber`;
    }
    
    const request = pool.request().input("weeksBack", sql.Int, weeksBack);
    
    // Date range logic
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(WEEK, -@weeksBack, GETDATE())`;
    }
    
    // Location filter
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    // Supervisor filter
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    // Complete the query
    query += groupBy + orderBy;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced call distribution fetched with period: ${period || 'default'}`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced call distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call distribution data." });
  }
});

// ===== 3. MISSING HOURLY BREAKDOWN API =====
/**
 * API 10.5.15 - Hourly Call Distribution (for short date ranges)
 * Your smart adaptation needs this for daily/hourly views
 */
app.get("/api/reports/call-distribution-hourly", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        DATEPART(HOUR, UploadDate) AS hour,
        CONCAT(DATEPART(HOUR, UploadDate), ':00') AS hourLabel,
        COUNT(*) AS callCount,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate = CAST(GETDATE() AS DATE)`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY DATEPART(HOUR, UploadDate)
      ORDER BY hour
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Hourly call distribution fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching hourly distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching hourly data." });
  }
});

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
        AND CAA.SelectedCallDate BETWEEN ${dateFromParam} AND ${dateToParam}
  `;
  sql += consolidatedReportExtraFilters(filterParams, "CAA");
  sql += "\n    )";
  return sql;
}

// ===== 4. PERFORMANCE COMPARISON API =====
/**
 * API 10.5.16 - Performance Comparison Between Periods
 * For showing growth trends in your dashboard
 */
app.get("/api/reports/performance-comparison", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  const filterParams = { location, supervisor, callType, agent };

  try {
    const pool = await connectToDatabase();

    const currentPeriodDays = Math.ceil((new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24));
    const previousFromDate = new Date(fromDate);
    previousFromDate.setDate(previousFromDate.getDate() - currentPeriodDays);
    const previousToDate = new Date(fromDate);
    previousToDate.setDate(previousToDate.getDate() - 1);

    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate)
      .input("prevFromDate", sql.Date, previousFromDate.toISOString().split("T")[0])
      .input("prevToDate", sql.Date, previousToDate.toISOString().split("T")[0]);

    bindReportFilters(request, filterParams);

    const query = `
      WITH ${buildPerformanceComparisonPeriodCte("CurrentPeriod", "@fromDate", "@toDate", filterParams)},
      ${buildPerformanceComparisonPeriodCte("PreviousPeriod", "@prevFromDate", "@prevToDate", filterParams)}
      SELECT
        cp.totalCalls AS currentCalls,
        pp.totalCalls AS previousCalls,
        CASE
          WHEN pp.totalCalls > 0 THEN ((cp.totalCalls - pp.totalCalls) * 100.0 / pp.totalCalls)
          ELSE 0
        END AS callsGrowth,
        cp.avgScore AS currentScore,
        pp.avgScore AS previousScore,
        CASE
          WHEN pp.avgScore > 0 THEN (cp.avgScore - pp.avgScore)
          ELSE 0
        END AS scoreGrowth,
        cp.resolutionRate AS currentResolution,
        pp.resolutionRate AS previousResolution,
        CASE
          WHEN pp.resolutionRate > 0 THEN (cp.resolutionRate - pp.resolutionRate)
          ELSE 0
        END AS resolutionGrowth
      FROM CurrentPeriod cp
      CROSS JOIN PreviousPeriod pp
    `;

    const result = await request.query(query);

    writeLog(`[${getISTTimeString()}] Performance comparison data fetched`);
    return res.status(200).json({ success: true, data: result.recordset[0] || {} });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching performance comparison: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching comparison data." });
  }
});

// ===== 5. REAL-TIME METRICS API =====
/**
 * API 10.5.17 - Real-time Dashboard Metrics
 * For the hero stats section in your dashboard
 */
app.get("/api/reports/realtime-metrics", async (req, res) => {
  const { location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    
    let query = `
      SELECT 
        COUNT(*) AS totalCallsToday,
        COUNT(DISTINCT AgentName) AS activeAgents,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScoreToday,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS resolutionRateToday,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundToday,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundToday,
        COUNT(CASE WHEN SelectedCallDate = CAST(GETDATE() AS DATE) THEN 1 END) AS callsProcessedToday
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND SelectedCallDate >= CAST(GETDATE() AS DATE)
    `;
    
    const request = pool.request();
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Real-time metrics fetched`);
    return res.status(200).json({ success: true, data: result.recordset[0] || {} });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching real-time metrics: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching real-time metrics." });
  }
});

// ===== 6. ENHANCED LANGUAGE DISTRIBUTION WITH FILTERS =====
/**
 * API 10.5.18 - Enhanced Language Distribution with Location/Supervisor Filters
 */
app.get("/api/reports/language-distribution-enhanced", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AudioLanguage, 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` GROUP BY AudioLanguage ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced language distribution data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced language distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language distribution data." });
  }
});


/**
 * API 10.5.19 - GET /api/reports/locations
 * Retrieves distinct locations from Consolidated_Audio_Analysis
 */
app.get("/api/reports/locations", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DISTINCT LTRIM(RTRIM(agent_location)) AS location
      FROM [dbo].[Agents]
      WHERE agent_location IS NOT NULL AND LTRIM(RTRIM(agent_location)) != ''
      ORDER BY location
    `;
    const result = await pool.request().query(query);
    
    const locations = result.recordset.map(row => row.location);
    writeLog(`[${getISTTimeString()}] Fetched ${locations.length} distinct locations`);
    return res.status(200).json({ success: true, data: locations });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching locations: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching locations." });
  }
});

/**
 * API 10.5.20 - GET /api/reports/supervisors
 * Retrieves distinct supervisors from Consolidated_Audio_Analysis
 */
app.get("/api/reports/supervisors", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DISTINCT LTRIM(RTRIM(supervisor)) AS supervisor
      FROM [dbo].[Agents]
      WHERE supervisor IS NOT NULL AND LTRIM(RTRIM(supervisor)) != ''
      ORDER BY supervisor
    `;
    const result = await pool.request().query(query);
    
    const supervisors = result.recordset.map(row => row.supervisor);
    writeLog(`[${getISTTimeString()}] Fetched ${supervisors.length} distinct supervisors`);
    return res.status(200).json({ success: true, data: supervisors });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching supervisors: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching supervisors." });
  }
});

/**
 * API 10.5.21 - GET /api/check-login-availability
 * Checks if a new login is allowed based on the license's user limit and active sessions
 */
app.get("/api/check-login-availability", async (req, res) => {
  try {
    if (!global.licensePayload) {
      writeLog(`[${getISTTimeString()}] Login availability check failed: No license payload found`);
      return res.status(403).json({ success: false, message: "No valid license found." });
    }

    const maxUsers = global.licensePayload.users;
    const pool = await connectToDatabase();
    const activeSessions = await pool.request()
      .query("SELECT COUNT(*) AS count FROM ActiveSessions WHERE IsActive = 1");
    const activeCount = activeSessions.recordset[0].count;

    if (activeCount >= maxUsers) {
      writeLog(`[${getISTTimeString()}] Login availability check failed: Maximum login count (${maxUsers}) reached`);
      return res.status(403).json({ success: false, message: `Maximum login count (${maxUsers}) reached as per the license.` });
    }

    writeLog(`[${getISTTimeString()}] Login availability check passed: ${activeCount}/${maxUsers} active sessions`);
    return res.status(200).json({ success: true, message: "Login allowed.", activeCount, maxUsers });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Login availability check error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking login availability." });
  }
});

/**
 * API 10.6 - GET /api/system-monitor
 * System monitoring endpoint that returns comprehensive system metrics including all network interfaces and GPUs
 */
app.get("/api/system-monitor", async (req, res) => {
  try {
    writeLog(`[${getISTTimeString()}] System monitoring data requested`);
    
    // Get basic system information in parallel for better performance
    const [
      cpuInfo,
      memInfo,
      diskInfo,
      networkStats,
      networkInterfaces,
      gpuInfo,
      osInfo,
      tempInfo
    ] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.networkInterfaces(),
      si.graphics(),
      si.osInfo(),
      si.cpuTemperature().catch(() => null) // CPU temp might not be available on all systems
    ]);

    // Get current CPU load
    const cpuLoad = await si.currentLoad();

    // Process network interfaces - get all physical interfaces
    const allNetworkInterfaces = [];
    const processedIfaces = new Set();
    
    // Combine interface info with stats
    for (const iface of networkInterfaces) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00" && !processedIfaces.has(iface.iface)) {
        processedIfaces.add(iface.iface);
        
        // Find corresponding stats for this interface
        const stats = networkStats.find(stat => stat.iface === iface.iface) || {
          rx_bytes: 0,
          tx_bytes: 0,
          rx_sec: 0,
          tx_sec: 0
        };

        allNetworkInterfaces.push({
          name: iface.iface,
          type: iface.type || 'Unknown',
          speed: iface.speed || 0,
          operstate: iface.operstate || 'unknown',
          mac: iface.mac,
          ip4: iface.ip4 || 'N/A',
          upload: parseFloat((stats.tx_sec / 1024).toFixed(2)), // Convert to KB/s
          download: parseFloat((stats.rx_sec / 1024).toFixed(2)), // Convert to KB/s
          uploadTotal: Math.round(stats.tx_bytes / (1024 * 1024)), // Convert to MB
          downloadTotal: Math.round(stats.rx_bytes / (1024 * 1024)) // Convert to MB
        });
      }
    }

    // Process GPU information - get all detected GPUs
    const allGPUs = [];
    if (gpuInfo && gpuInfo.controllers && gpuInfo.controllers.length > 0) {
      for (let i = 0; i < gpuInfo.controllers.length; i++) {
        const gpu = gpuInfo.controllers[i];
        allGPUs.push({
          id: i,
          model: gpu.model || `GPU ${i}`,
          vendor: gpu.vendor || 'Unknown',
          vram: gpu.vram || 0,
          vramDynamic: gpu.vramDynamic || false,
          subDeviceId: gpu.subDeviceId || null,
          driverVersion: gpu.driverVersion || 'Unknown',
          memoryTotal: gpu.memoryTotal || gpu.vram || 0,
          memoryUsed: gpu.memoryUsed || 0,
          memoryFree: gpu.memoryFree || (gpu.memoryTotal - gpu.memoryUsed) || 0,
          utilizationGpu: gpu.utilizationGpu || 0,
          utilizationMemory: gpu.utilizationMemory || 0,
          temperatureGpu: gpu.temperatureGpu || 0,
          powerDraw: gpu.powerDraw || 0,
          powerLimit: gpu.powerLimit || 0,
          clockCore: gpu.clockCore || 0,
          clockMemory: gpu.clockMemory || 0
        });
      }
    }

    // Calculate total network activity (sum of all interfaces)
    const totalUpload = allNetworkInterfaces.reduce((sum, iface) => sum + iface.upload, 0);
    const totalDownload = allNetworkInterfaces.reduce((sum, iface) => sum + iface.download, 0);

    // Prepare response data
    const systemData = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        cpu: {
          currentLoad: parseFloat(cpuLoad.currentLoad.toFixed(1)),
          model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
          cores: cpuInfo.cores,
          physicalCores: cpuInfo.physicalCores,
          speed: cpuInfo.speed,
          temperature: tempInfo ? tempInfo.main || tempInfo.max || null : null
        },
        memory: {
          used: parseFloat((memInfo.used / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          total: parseFloat((memInfo.total / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          free: parseFloat((memInfo.free / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          usage: parseFloat(((memInfo.used / memInfo.total) * 100).toFixed(1))
        },
        disks: diskInfo.map(disk => ({
          fs: disk.fs,
          type: disk.type,
          size: Math.round(disk.size / (1024 * 1024 * 1024)), // Convert to GB
          used: Math.round(disk.used / (1024 * 1024 * 1024)), // Convert to GB
          use: parseFloat(disk.use.toFixed(1)),
          mount: disk.mount
        })),
        network: {
          // Single network object for backward compatibility
          upload: parseFloat(totalUpload.toFixed(2)),
          download: parseFloat(totalDownload.toFixed(2)),
          // All network interfaces
          interfaces: allNetworkInterfaces
        },
        gpu: allGPUs.length > 0 ? allGPUs : null,
        system: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch,
          uptime: Math.round(osInfo.uptime / 3600) // Convert to hours
        }
      }
    };

    writeLog(`[${getISTTimeString()}] System monitoring data compiled: CPU ${cpuLoad.currentLoad.toFixed(1)}%, Memory ${((memInfo.used / memInfo.total) * 100).toFixed(1)}%, Networks: ${allNetworkInterfaces.length}, GPUs: ${allGPUs.length}`);
    
    return res.status(200).json(systemData);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching system monitoring data: ${error.message}`);
    console.error(`[${getISTTimeString()}] System monitoring error:`, error);
    
    // Return error response
    return res.status(500).json({
      success: false,
      message: "Error fetching system data",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * API 10.5.22 - GET /api/reports/language-preferences
 * Retrieves language distribution as preferences with counts
 */
app.get("/api/reports/language-preferences", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(NULLIF(TRIM(AudioLanguage), ''), 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND SelectedCallDate BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY COALESCE(NULLIF(TRIM(AudioLanguage), ''), 'Unknown')
      ORDER BY count DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Language preferences data fetched: ${result.recordset.length} languages`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching language preferences: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language preferences." });
  }
});

/**
 * API 10.5.23 - GET /api/reports/call-volume-by-time (FIXED - Column Alias Issue)
 * Retrieves call volume distribution by time periods
 */
app.get("/api/reports/call-volume-by-time", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    
    let query = `
      SELECT 
        TimePeriodCalculated AS timePeriod,
        COUNT(*) AS callCount,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM (
        SELECT 
          CASE 
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 6 AND 11 THEN 'Morning'
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 12 AND 17 THEN 'Afternoon'
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 18 AND 23 THEN 'Evening'
            ELSE 'Night'
          END AS TimePeriodCalculated,
          AI_Overall_Scoring,
          UploadDate,
          AgentLocation,
          AgentSupervisor
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success' 
          AND UploadDate IS NOT NULL
      ) AS TimeData
      WHERE 1=1
    `;
    
    const request = pool.request();
    
    // Add filters to the outer query
    if (fromDate && toDate) {
      query += ` AND CAST(UploadDate AS DATE) BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND AgentLocation = @location`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND AgentSupervisor = @supervisor`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY TimePeriodCalculated
      HAVING COUNT(*) > 0
      ORDER BY 
        CASE TimePeriodCalculated
          WHEN 'Morning' THEN 1
          WHEN 'Afternoon' THEN 2
          WHEN 'Evening' THEN 3
          ELSE 4
        END
    `;
    
    console.log(`[${getISTTimeString()}] Executing call volume query with subquery approach`);
    
    const result = await request.query(query);
    
    console.log(`[${getISTTimeString()}] Call volume result:`, result.recordset);
    
    // Always return data structure, even if empty
    let responseData = result.recordset;
    
    // If no data found, return default structure with zero counts
    if (responseData.length === 0) {
      responseData = [
        { timePeriod: 'Morning', callCount: 0, avgScore: 0 },
        { timePeriod: 'Afternoon', callCount: 0, avgScore: 0 },
        { timePeriod: 'Evening', callCount: 0, avgScore: 0 }
      ];
    }
    
    writeLog(`[${getISTTimeString()}] Call volume by time data fetched: ${result.recordset.length} periods`);
    
    return res.status(200).json({ 
      success: true, 
      data: responseData,
      debug: {
        originalCount: result.recordset.length,
        filters: { fromDate, toDate, location, supervisor },
        hasData: result.recordset.length > 0
      }
    });
    
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching call volume by time:`, error);
    writeLog(`[${getISTTimeString()}] Error fetching call volume by time: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: "Server error: " + error.message 
    });
  }
});

/**
 * API — GET /api/reports/rubric-comparison
 * Average AI vs Manual scores across quality dimensions.
 */
app.get("/api/reports/rubric-comparison", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
  }
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, callType, agent };
    let query = `
      SELECT
        AVG(TRY_CAST(AI_Opening_Speech AS DECIMAL(10,2))) AS ai_opening,
        AVG(TRY_CAST(Manual_Opening_Speech AS DECIMAL(10,2))) AS manual_opening,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS ai_empathy,
        AVG(TRY_CAST(Manual_Empathy AS DECIMAL(10,2))) AS manual_empathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS ai_query_handling,
        AVG(TRY_CAST(Manual_Query_Handling AS DECIMAL(10,2))) AS manual_query_handling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS ai_adherence,
        AVG(TRY_CAST(Manual_Adherence_to_Protocol AS DECIMAL(10,2))) AS manual_adherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS ai_resolution_assurance,
        AVG(TRY_CAST(Manual_Resolution_Assurance AS DECIMAL(10,2))) AS manual_resolution_assurance,
        AVG(TRY_CAST(AI_Query_Resolution AS DECIMAL(10,2))) AS ai_query_resolution,
        AVG(TRY_CAST(Manual_Query_Resolution AS DECIMAL(10,2))) AS manual_query_resolution,
        AVG(TRY_CAST(AI_Polite_Tone AS DECIMAL(10,2))) AS ai_polite_tone,
        AVG(TRY_CAST(Manual_Polite_Tone AS DECIMAL(10,2))) AS manual_polite_tone,
        AVG(TRY_CAST(AI_Closing_Speech AS DECIMAL(10,2))) AS ai_closing,
        AVG(TRY_CAST(Manual_Closing_Speech AS DECIMAL(10,2))) AS manual_closing,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS ai_overall,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS manual_overall
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND SelectedCallDate BETWEEN @fromDate AND @toDate
    `;
    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate);
    query += consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);
    const result = await request.query(query);
    const row = result.recordset[0] || {};
    const dimensions = [
      { dimension: "Opening", ai: row.ai_opening, manual: row.manual_opening },
      { dimension: "Empathy", ai: row.ai_empathy, manual: row.manual_empathy },
      { dimension: "Query handling", ai: row.ai_query_handling, manual: row.manual_query_handling },
      { dimension: "Protocol adherence", ai: row.ai_adherence, manual: row.manual_adherence },
      { dimension: "Resolution assurance", ai: row.ai_resolution_assurance, manual: row.manual_resolution_assurance },
      { dimension: "Query resolution", ai: row.ai_query_resolution, manual: row.manual_query_resolution },
      { dimension: "Polite tone", ai: row.ai_polite_tone, manual: row.manual_polite_tone },
      { dimension: "Closing", ai: row.ai_closing, manual: row.manual_closing },
      { dimension: "Overall", ai: row.ai_overall, manual: row.manual_overall },
    ].map((d) => ({
      ...d,
      ai: d.ai != null ? Math.round(Number(d.ai) * 10) / 10 : null,
      manual: d.manual != null ? Math.round(Number(d.manual) * 10) / 10 : null,
    }));
    return res.status(200).json({ success: true, data: dimensions });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching rubric comparison: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching rubric comparison." });
  }
});

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

/**
 * API — GET /api/reports/tone-sentiment-summary
 * Customer tone distribution — Positive / Neutral / Negative per call.
 */
app.get("/api/reports/tone-sentiment-summary", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
  }
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, callType, agent };
    let query = `
      SELECT CAA.Sentiment
      FROM [dbo].[Consolidated_Audio_Analysis] CAA
      WHERE CAA.Status = 'Success'
        AND CAA.SelectedCallDate BETWEEN @fromDate AND @toDate
    `;
    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate);
    query += consolidatedReportExtraFilters(params, "CAA");
    bindReportFilters(request, params);

    const result = await request.query(query);
    const summary = aggregateCustomerSentimentSummary(result.recordset || []);

    return res.status(200).json({
      success: true,
      data: summary.data,
      meta: { totalCalls: summary.totalCalls },
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching tone-sentiment summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching sentiment summary." });
  }
});

/**
 * API — GET /api/reports/lead-classification
 * Outbound lead classification breakdown.
 */
app.get("/api/reports/lead-classification", async (req, res) => {
  const { fromDate, toDate, location, supervisor, agent } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
  }
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, agent };
    let query = `
      SELECT
        COALESCE(NULLIF(LTRIM(RTRIM(AI_Lead_Classification)), ''), 'Unclassified') AS label,
        COUNT(*) AS count
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND LOWER(LTRIM(RTRIM(CallType))) = 'outbound'
        AND SelectedCallDate BETWEEN @fromDate AND @toDate
    `;
    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate);
    query += consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);
    query += ` GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Lead_Classification)), ''), 'Unclassified') ORDER BY count DESC`;
    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching lead classification: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching lead classification." });
  }
});

/* ===================== 10.6) Call Intelligence (Phase 2d) ===================== */

// Shared date-window clause for intelligence aggregations.
function intelDateClause(request, fromDate, toDate) {
  if (fromDate && toDate) {
    request.input("fromDate", sql.Date, fromDate);
    request.input("toDate", sql.Date, toDate);
    return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) BETWEEN @fromDate AND @toDate`;
  }
  return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(DAY, -30, GETDATE())`;
}

/**
 * GET /api/call-intelligence/:filename
 * Per-call intelligence (escalation, query categories, loan/lead) for ResultPage.
 */
app.get("/api/call-intelligence/:filename", async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input("filename", sql.NVarChar, filename)
        .query(`
          SELECT AI_Primary_Query_Type, AI_Secondary_Query_Types,
                 AI_Escalation_Requested, AI_Escalation_Actioned, AI_Escalation_Category,
                 AI_CSAT_Transferred,
                 AI_Loan_Is_Loan_Call, AI_Loan_Type, AI_Loan_Interest, AI_EMI_Affordability,
                 AI_EMI_Amount, AI_Loan_Amount, AI_Agent_Convinced,
                 AI_Loan_Success_Probability, AI_Intelligence_Summary
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (err) {
      if (isMissingDbObjectError(err)) {
        return res.status(200).json({ success: true, intelligence: null, message: "Intelligence not available yet." });
      }
      throw err;
    }
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: "Call not found." });
    }
    const r = result.recordset[0];
    let secondary = [];
    try {
      const parsed = JSON.parse(r.AI_Secondary_Query_Types || "[]");
      if (Array.isArray(parsed)) secondary = parsed;
    } catch (_) { /* ignore malformed json */ }

    return res.status(200).json({
      success: true,
      intelligence: {
        primaryQueryType: r.AI_Primary_Query_Type || "Other/General Info",
        secondaryQueryTypes: secondary,
        escalationRequested: r.AI_Escalation_Requested || "No",
        escalationActioned: r.AI_Escalation_Actioned || "N/A",
        escalationCategory: r.AI_Escalation_Category || "None",
        csatTransferred: r.AI_CSAT_Transferred || "No",
        isLoanCall: r.AI_Loan_Is_Loan_Call || "No",
        loanType: r.AI_Loan_Type || "None",
        customerInterest: r.AI_Loan_Interest || "None",
        emiAffordability: r.AI_EMI_Affordability || "Not Discussed",
        emiAmount: r.AI_EMI_Amount != null ? Number(r.AI_EMI_Amount) : null,
        loanAmount: r.AI_Loan_Amount != null ? Number(r.AI_Loan_Amount) : null,
        agentConvinced: r.AI_Agent_Convinced || "N/A",
        successProbability: r.AI_Loan_Success_Probability != null ? Number(r.AI_Loan_Success_Probability) : 0,
        summary: r.AI_Intelligence_Summary || "",
      },
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call intelligence: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call intelligence." });
  }
});

/**
 * GET /api/reports/query-type-distribution
 * Counts of calls per primary customer query category.
 */
app.get("/api/reports/query-type-distribution", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    let query = `
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(caa.AI_Primary_Query_Type)), ''), 'Unclassified') AS label,
             COUNT(*) AS count,
             MAX(qc.Color) AS color
      FROM [dbo].[Consolidated_Audio_Analysis] caa
      LEFT JOIN [dbo].[AI_Query_Categories] qc ON qc.Name = caa.AI_Primary_Query_Type
      WHERE caa.Status = 'Success'
    `;
    query += intelDateClause(request, fromDate, toDate);
    query += consolidatedReportExtraFilters(params, "caa");
    bindReportFilters(request, params);
    query += ` GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(caa.AI_Primary_Query_Type)), ''), 'Unclassified') ORDER BY count DESC`;
    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: [] });
    }
    writeLog(`[${getISTTimeString()}] Error fetching query-type distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching query-type distribution." });
  }
});

/**
 * GET /api/reports/escalation-summary
 * Escalation counts: requested, actioned vs not, and breakdown by category.
 */
app.get("/api/reports/escalation-summary", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    const dateClause = intelDateClause(request, fromDate, toDate);
    const extra = consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);

    const baseWhere = ` FROM [dbo].[Consolidated_Audio_Analysis] WHERE Status = 'Success'` + dateClause + extra;

    const query = `
      SELECT
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes' THEN 1 ELSE 0 END) AS requested,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes'
                  AND LOWER(LTRIM(RTRIM(AI_Escalation_Actioned))) = 'yes' THEN 1 ELSE 0 END) AS actioned,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes'
                  AND LOWER(LTRIM(RTRIM(AI_Escalation_Actioned))) <> 'yes' THEN 1 ELSE 0 END) AS notActioned,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_CSAT_Transferred))) = 'yes' THEN 1 ELSE 0 END) AS csatTransferred,
        COUNT(*) AS total
      ${baseWhere};
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Escalation_Category)), ''), 'None') AS label, COUNT(*) AS count
      ${baseWhere}
        AND LOWER(LTRIM(RTRIM(AI_Escalation_Category))) <> 'none'
        AND AI_Escalation_Category IS NOT NULL
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Escalation_Category)), ''), 'None')
      ORDER BY count DESC;
    `;
    const result = await request.query(query);
    const totals = (result.recordsets[0] && result.recordsets[0][0]) || { requested: 0, actioned: 0, notActioned: 0, csatTransferred: 0, total: 0 };
    const byCategory = result.recordsets[1] || [];
    return res.status(200).json({ success: true, data: { totals, byCategory } });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: { totals: { requested: 0, actioned: 0, notActioned: 0, csatTransferred: 0, total: 0 }, byCategory: [] } });
    }
    writeLog(`[${getISTTimeString()}] Error fetching escalation summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching escalation summary." });
  }
});

/**
 * GET /api/reports/loan-leads
 * Loan/lead funnel: counts by loan type & interest, EMI affordability, avg
 * success probability and total committed loan/EMI amounts.
 */
app.get("/api/reports/loan-leads", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    const dateClause = intelDateClause(request, fromDate, toDate);
    const extra = consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);

    const loanWhere = ` FROM [dbo].[Consolidated_Audio_Analysis] WHERE Status = 'Success'`
      + dateClause + extra
      + ` AND LOWER(LTRIM(RTRIM(AI_Loan_Is_Loan_Call))) = 'yes'`;

    const query = `
      SELECT
        COUNT(*) AS loanCalls,
        AVG(TRY_CAST(AI_Loan_Success_Probability AS DECIMAL(10,2))) AS avgSuccessProbability,
        SUM(TRY_CAST(AI_EMI_Amount AS DECIMAL(18,2))) AS totalEmiAmount,
        SUM(TRY_CAST(AI_Loan_Amount AS DECIMAL(18,2))) AS totalLoanAmount,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_EMI_Affordability))) = 'yes' THEN 1 ELSE 0 END) AS emiAffordableYes,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_EMI_Affordability))) = 'no' THEN 1 ELSE 0 END) AS emiAffordableNo,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'high' THEN 1 ELSE 0 END) AS interestHigh,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'medium' THEN 1 ELSE 0 END) AS interestMedium,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'low' THEN 1 ELSE 0 END) AS interestLow
      ${loanWhere};
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Loan_Type)), ''), 'Other Loan') AS label, COUNT(*) AS count,
             AVG(TRY_CAST(AI_Loan_Success_Probability AS DECIMAL(10,2))) AS avgProbability
      ${loanWhere}
        AND LOWER(LTRIM(RTRIM(AI_Loan_Type))) <> 'none'
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Loan_Type)), ''), 'Other Loan')
      ORDER BY count DESC;
    `;
    const result = await request.query(query);
    const totals = (result.recordsets[0] && result.recordsets[0][0]) || {};
    const byLoanType = result.recordsets[1] || [];
    return res.status(200).json({ success: true, data: { totals, byLoanType } });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: { totals: {}, byLoanType: [] } });
    }
    writeLog(`[${getISTTimeString()}] Error fetching loan leads: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching loan leads." });
  }
});

/* ===================== 11) WebSocket Integration ===================== */
const wss = new WebSocket.Server({ server });
global.websocketServer = wss;

const clients = new Map();
const chatSessions = new Map();
const activeChats = new Map();
const usernameToUserId = new Map();

// WebSocket auth follows the same toggle as the REST API gate.
const WS_AUTH_ENFORCE = String(process.env.API_AUTH_ENFORCE || "true").toLowerCase() !== "false";

/**
 * Validates a session token against dbo.ActiveSessions and returns the
 * authoritative identity from the DB (never trusting client-supplied values).
 */
async function validateWsSession(token) {
  if (!token) return null;
  try {
    const pool = await sqlConnect();
    const result = await pool.request()
      .input("token", sql.NVarChar, token)
      .query(`
        SELECT TOP 1 s.UserID, s.Username, s.LogID, u.AccountType
        FROM dbo.ActiveSessions s
        LEFT JOIN dbo.Users u ON s.Username = u.Username
        WHERE s.Token = @token AND s.IsActive = 1
      `);
    if (!result.recordset.length) return null;
    const row = result.recordset[0];
    return {
      userId: row.UserID != null ? String(row.UserID) : null,
      username: row.Username,
      userType: row.AccountType || "Agent",
      logId: row.LogID,
    };
  } catch (err) {
    console.error(`[${getISTTimeString()}] [WS] Session validation error: ${err.message}`);
    return null;
  }
}

function broadcastUserList() {
  const supervisors = [];
  clients.forEach((info) => {
    if (info.userType === "Team Leader" || info.userType === "Super Admin") {
      supervisors.push(info.username);
    }
  });
  const userListMessage = { type: "userList", supervisors };
  clients.forEach((_, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(userListMessage));
    }
  });
  //console.log(`[${getISTTimeString()}] [WS] Broadcasted user list:`, supervisors);
}

function broadcastChatMessage(message) {
  const { from, to, text, timestamp, fromType, logId } = message;
  const chatMessage = { type: "chat", from, fromType, to, text, timestamp, logId };
  const sentClients = new Set(); // Track sent clients to avoid duplicates

  if (to === "all" && fromType === "Agent") {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin") &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Sent message to ${clientInfo.userType} ${clientInfo.username} (UserID: ${clientInfo.userId})`);
        sentClients.add(clientWs);
      }
    });
  } else if (to === "all") {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        clientInfo.userType === "Agent" &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Broadcast to agent ${clientInfo.username}`);
        sentClients.add(clientWs);
      }
    });
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.username === from || clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin") &&
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        sentClients.add(clientWs);
      }
    });
  } else {
    // Send to the recipient (to), the sender (from), and all supervisors
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.username === to || // Include the recipient
         clientInfo.username === from || // Include the sender
         clientInfo.userType === "Team Leader" || // Include all Team Leaders
         clientInfo.userType === "Super Admin") && // Include all Super Admins
        !sentClients.has(clientWs)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[${getISTTimeString()}] [WS] Sent message to ${clientInfo.username} (UserID: ${clientInfo.userId})`);
        sentClients.add(clientWs);
      }
    });
  }
}

wss.on("connection", (ws) => {
  //console.log(`[${getISTTimeString()}] [WS] New WebSocket connection established`);

  ws.on("message", async (msg) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(msg);
      //console.log(`[${getISTTimeString()}] [WS] Received raw message:`, msg); // Debug raw input
    } catch (error) {
      console.error(`[${getISTTimeString()}] [WS] Invalid message format:`, error.message);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      return;
    }

    if (parsedMessage.type === "register") {
      let { userId, username, userType, logId } = parsedMessage;
      const sessionToken = parsedMessage.sessionToken || parsedMessage.token;
      //console.log(`[${getISTTimeString()}] [WS] Received register message: ${username}`);

      if (WS_AUTH_ENFORCE) {
        const session = await validateWsSession(sessionToken);
        if (!session) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required. Please log in again." }));
          console.warn(`[${getISTTimeString()}] [WS] Register rejected: invalid or missing session token`);
          return;
        }
        // Trust the DB session, not client-supplied identity fields.
        userId = session.userId;
        username = session.username;
        userType = session.userType;
        logId = session.logId != null ? session.logId : logId;
      }

      if (!userId || !username || !userType || !logId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing registration details" }));
        return;
      }
      let existingClient = null;
      for (const [clientWs, info] of clients) {
        if (info.username === username || info.userId === userId) {
          existingClient = clientWs;
          break;
        }
      }
      if (existingClient) {
        clients.delete(existingClient);
        //console.log(`[${getISTTimeString()}] [WS] Replaced existing connection for ${username}`);
      }
      clients.set(ws, { userId, username, userType, logId });
      usernameToUserId.set(username, userId);
      //console.log(`[${getISTTimeString()}] [WS] Registered ${userType}: ${username}`);
      ws.send(JSON.stringify({ type: "registerAck", message: "Registration successful" })); // Acknowledge registration
      broadcastUserList();
      return;
    }

    if (parsedMessage.type === "chat") {
      const { from, to, text, timestamp, fromType } = parsedMessage;
      console.log(`[${getISTTimeString()}] [WS] Received chat message: from=${from}, to=${to}, text=${text}, fromType=${fromType}`); // Debug received chat
      const senderInfo = clients.get(ws);
      if (!senderInfo) {
        ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
        console.error(`[${getISTTimeString()}] [WS] Chat message failed: Sender not registered`);
        return;
      }
      if (!to || !text || !timestamp) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid chat message data" }));
        console.error(`[${getISTTimeString()}] [WS] Chat message failed: Invalid data`);
        return;
      }

      let session;
      let logId = null;

      if (senderInfo.userType === "Agent" && !chatSessions.has(senderInfo.userId)) {
        const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
        const chatDir = resolveProjectPath(process.env.CHAT_DUMP_DIR);
        if (!fs.existsSync(chatDir)) {
          fs.mkdirSync(chatDir, { recursive: true });
          console.log(`[${getISTTimeString()}] [WS] Chat dump directory created: ${chatDir}`);
        }
        const filePath = path.join(chatDir, `chat_UserID_${senderInfo.userId}_${timestampStr}.txt`);
        chatSessions.set(senderInfo.userId, {
          filePath,
          ws,
          logId: null,
          startTime: null,
          chatContent: "",
        });
        fs.writeFileSync(
          filePath,
          `Chat Session Started: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by UserID ${senderInfo.userId} (Username: ${senderInfo.username})\n`
        );
        console.log(`[${getISTTimeString()}] [WS] Chat session file created for ${senderInfo.userId}: ${filePath}`);

        try {
          const pool = await sqlConnect();
          const result = await pool.request()
            .input("agentUserID", sql.NVarChar, senderInfo.userId)
            .input("agentUsername", sql.NVarChar, senderInfo.username)
            .input("entireChat", sql.NVarChar(sql.MAX), "")
            .input("startTime", sql.DateTime, new Date())
            .input("isClosed", sql.Bit, 0)
            .query(`
              INSERT INTO [dbo].[ChatLog] (AgentUserID, AgentUsername, EntireChat, StartTime, IsClosed)
              OUTPUT INSERTED.LogID
              VALUES (@agentUserID, @agentUsername, @entireChat, @startTime, @isClosed)
            `);
          logId = result.recordset[0].LogID;
          if (!logId) {
            throw new Error("LogID not returned from DB");
          }
          chatSessions.get(senderInfo.userId).logId = logId;
          chatSessions.get(senderInfo.userId).startTime = new Date();
          activeChats.set(senderInfo.userId, {
            logId,
            startTime: new Date(),
          });
          console.log(`[${getISTTimeString()}] [WS] New chat started for ${senderInfo.userId} with LogID: ${logId}`);
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error starting chat log:`, error.message);
          ws.send(JSON.stringify({ type: "error", message: "Failed to start chat session" }));
          chatSessions.delete(senderInfo.userId);
          return;
        }
      }

      if (senderInfo.userType === "Agent") {
        session = chatSessions.get(senderInfo.userId);
        logId = session ? session.logId : null;
      } else if (to !== "all") {
        const toUserId = usernameToUserId.get(to);
        if (toUserId && chatSessions.has(toUserId)) {
          session = chatSessions.get(toUserId);
          logId = session ? session.logId : null;
        }
      }

      if (session) {
        const formattedMessage = `[${new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] ${from} (${senderInfo.userType}): ${text}\n`;
        try {
          fs.appendFileSync(session.filePath, formattedMessage);
          session.chatContent += formattedMessage;
          console.log(`[${getISTTimeString()}] [WS] Chat logged to ${session.filePath}: ${formattedMessage.trim()}`);
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error writing to chat file:`, error.message);
        }

        if (session.logId) {
          try {
            const pool = await sqlConnect();
            await pool.request()
              .input("logId", sql.Int, session.logId)
              .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
              .query(`
                UPDATE [dbo].[ChatLog]
                SET EntireChat = @entireChat
                WHERE LogID = @logId
              `);
            console.log(`[${getISTTimeString()}] [WS] Chat updated in DB for LogID: ${session.logId}`);
          } catch (error) {
            console.error(`[${getISTTimeString()}] [WS] Error updating chat in DB:`, error.message);
          }
        }
      } else if (senderInfo.userType !== "Agent" && to !== "all") {
        console.warn(`[${getISTTimeString()}] [WS] No chat session found for recipient ${to}`);
      }

      broadcastChatMessage({ ...parsedMessage, logId });
      ws.send(JSON.stringify({ type: "chatAck", message: "Message broadcasted", to })); // Acknowledge to sender
      return;
    }

    if (parsedMessage.type === "chatClosed") {
      const senderInfo = clients.get(ws);
      if (!senderInfo || senderInfo.userType !== "Agent") {
        ws.send(JSON.stringify({ type: "error", message: "Only agents can close chats" }));
        console.error(`[${getISTTimeString()}] [WS] Chat closure failed: Sender is not an agent`);
        return;
      }
      const agentUserId = senderInfo.userId;
      const session = chatSessions.get(agentUserId);
      if (session && session.logId) {
        try {
          const pool = await sqlConnect();
          await pool.request()
            .input("logId", sql.Int, session.logId)
            .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
            .input("endTime", sql.DateTime, new Date())
            .input("isClosed", sql.Bit, 1)
            .query(`
              UPDATE [dbo].[ChatLog]
              SET EntireChat = @entireChat, EndTime = @endTime, IsClosed = @isClosed
              WHERE LogID = @logId
            `);
          console.log(`[${getISTTimeString()}] [WS] Chat closed for ${agentUserId} with LogID: ${session.logId}`);
          const closeMessage = {
            type: "chatClosed",
            agentUserId,
            agentUsername: senderInfo.username,
            timestamp: new Date().toISOString(),
            logId: session.logId,
          };
          clients.forEach((clientInfo, clientWs) => {
            if (
              clientWs.readyState === WebSocket.OPEN &&
              clientWs !== ws &&
              (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin")
            ) {
              clientWs.send(JSON.stringify(closeMessage));
              console.log(`[${getISTTimeString()}] [WS] Notified ${clientInfo.userType} ${clientInfo.username} (UserID: ${clientInfo.userId}) of chat closure`);
            }
          });
          activeChats.delete(agentUserId);
          chatSessions.delete(agentUserId);
          broadcastUserList();
        } catch (error) {
          console.error(`[${getISTTimeString()}] [WS] Error closing chat:`, error.message);
          ws.send(JSON.stringify({ type: "error", message: "Failed to close chat" }));
        }
      } else {
        console.log(`[${getISTTimeString()}] [WS] No active chat session found for ${agentUserId}`);
        ws.send(JSON.stringify({ type: "error", message: "No active chat session to close" }));
      }
      return;
    }
  });

  ws.on("close", async () => {
  const clientInfo = clients.get(ws);
  if (clientInfo) {
    console.log(`[${getISTTimeString()}] [WS] ${clientInfo.userType} UserID ${clientInfo.userId} (Username: ${clientInfo.username}) disconnected`);
    if (clientInfo.userType === "Agent" && activeChats.has(clientInfo.userId)) {
      const chatInfo = activeChats.get(clientInfo.userId);
      try {
        const pool = await sqlConnect();
        await pool.request()
          .input("LogID", sql.Int, chatInfo.logId)
          .input("EndTime", sql.DateTime, new Date())
          .input("IsClosed", sql.Bit, 1)
          .query(`
            UPDATE [dbo].[ChatLog]
            SET EndTime = @EndTime, IsClosed = @IsClosed
            WHERE LogID = @LogID
          `);
        console.log(`[${getISTTimeString()}] [WS] Chat closed for UserID ${clientInfo.userId} with LogID: ${chatInfo.logId}`);
        activeChats.delete(clientInfo.userId);
        chatSessions.delete(clientInfo.userId);
      } catch (error) {
        console.error(`[${getISTTimeString()}] [WS] Error closing chat on disconnect:`, error.message);
      }
    }
    usernameToUserId.delete(clientInfo.username);
    clients.delete(ws);
    broadcastUserList();
    console.log(`[${getISTTimeString()}] [WS] Client removed for UserID ${clientInfo.userId}, no session invalidation`);
  }
});

  ws.on("error", (err) => {
    console.error(`[${getISTTimeString()}] [WS] WebSocket error:`, err.message);
  });

  ws.send(JSON.stringify({ message: "Welcome to the real-time chat system." }));
});

wss.on("listening", () => {
  console.log(`[${getISTTimeString()}] [WS] WebSocket server is listening on port ${process.env.PORT}`);
});

/* ===================== 12) Start the Server ===================== */
/**
 * Logs production security warnings for misconfigured secrets / auth toggles.
 */
function logSecurityConfigWarnings() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const authEnforced = String(process.env.API_AUTH_ENFORCE || "true").toLowerCase() !== "false";

  if (!authEnforced) {
    const msg = "[SECURITY] API_AUTH_ENFORCE is FALSE — API authentication is DISABLED. Do not run like this in production.";
    console.warn(msg);
    writeLog(`[${getISTTimeString()}] ${msg}`);
  }

  const requiredInProd = [
    ["ORCHESTRATOR_SECRET", process.env.ORCHESTRATOR_SECRET],
    ["CALLBACK_SECRET", process.env.CALLBACK_SECRET],
    ["LICENSE_SECRET_KEY", process.env.LICENSE_SECRET_KEY],
    ["SERVICE_TOKEN", process.env.SERVICE_TOKEN || process.env.UPLOAD_SERVICE_TOKEN],
  ];
  for (const [name, value] of requiredInProd) {
    if (!value || !String(value).trim()) {
      const level = isProd ? "[SECURITY]" : "[SECURITY-DEV]";
      const msg = `${level} ${name} is not set${isProd ? " — required for production. Pipeline/auth protections may be disabled." : " (ok for dev; required in production)."}`;
      console.warn(msg);
      writeLog(`[${getISTTimeString()}] ${msg}`);
    }
  }
}

server.listen(PORT, async () => {
  logSecurityConfigWarnings();
  try {
    await ensureAdminSchema();
    console.log("[INFO] Admin schema (Locations, AppSettings) verified.");
  } catch (err) {
    console.error("[WARN] Admin schema bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    const mig = await runDatabaseMigrations(pool);
    if (mig.ok) {
      console.log(`[INFO] Database migrations OK: ${(mig.steps || []).join(", ")}`);
    } else {
      console.error("[WARN] Database migrations partial failure:", mig.error);
    }
  } catch (err) {
    console.error("[WARN] Database migration bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    await ensureCallProcessingLogSchema(pool);
    console.log("[INFO] CallProcessingLog schema verified.");
  } catch (err) {
    console.error("[WARN] CallProcessingLog schema bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    const sched = await autoUploadService.initAutoUpload(pool, config);
    if (sched.scheduled) {
      console.log(`[INFO] Auto-upload scheduler active (${sched.expression}, Asia/Kolkata).`);
    } else {
      console.log("[INFO] Auto-upload scheduler not active (disabled or invalid cron).");
    }
  } catch (err) {
    console.error("[WARN] Auto-upload init failed:", err.message);
  }
  console.log(`[INFO] Server is running on http://localhost:${PORT}`);
});