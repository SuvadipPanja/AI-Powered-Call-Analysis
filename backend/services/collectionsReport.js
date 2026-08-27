/**
 * ICICI HFC — Collections Quality (AQM) formatted report builder.
 *
 * Produces a multi-sheet .xlsx that mirrors the client's own "Quality Report"
 * workbook (Summary / Associate Wise Performance / Pareto Analysis / Fatal Error
 * Summary / Audit Sheet) but populated from THIS system's AI-scored collections
 * calls. It is fully tenant-scoped: the caller only ever passes collections rows
 * (AI_Coll_Score IS NOT NULL), so a banking install can never produce this file.
 *
 * The per-call "Audit Sheet" and the "Pareto Analysis" are rubric-driven: one
 * Yes/No/NA column per ENABLED audit-rubric dimension. When the ICIC profile is
 * expanded to the full parameter set, the columns grow automatically — no code
 * change here.
 */
const ExcelJS = require("exceljs");
const { classifyPtpQuality } = require("./ptpQuality");

// ---- palette (matches the client's blue-header look) ----------------------
const HEADER_FILL = "FF1F4E79"; // dark blue
const SUBHEAD_FILL = "FF2E75B6"; // medium blue
const BAND_FILL = "FFDDEBF7"; // light blue band
const RED_FILL = "FFF4CCCC";
const AMBER_FILL = "FFFFF2CC";
const GREEN_FILL = "FFE2EFDA";

const RED_MAX = 80; // < 80  => Red
const AMBER_MAX = 85; // 80–84.99 => Amber ; >=85 => Green

function num(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace("%", ""));
  return Number.isNaN(n) ? null : n;
}

function frac(pct) {
  const n = num(pct);
  return n == null ? null : Math.round((n / 100) * 10000) / 10000;
}

function grade(scorePct) {
  const n = num(scorePct);
  if (n == null) return "";
  if (n < RED_MAX) return "R";
  if (n < AMBER_MAX) return "A";
  return "G";
}

function gradeFill(scorePct) {
  const g = grade(scorePct);
  if (g === "R") return RED_FILL;
  if (g === "A") return AMBER_FILL;
  if (g === "G") return GREEN_FILL;
  return null;
}

function ynFromStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "pass") return "Yes";
  if (s === "fail") return "No";
  if (s === "na" || s === "n/a" || s === "not applicable") return "NA";
  return "";
}

function callDate(row) {
  const d = row.SelectedCallDate || row.UploadDate;
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Calendar parts from UTC so a SQL DATE at midnight does not shift in IST. */
function calendarDay(dt) {
  if (!dt) return null;
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekOfMonth(dt) {
  const parts = calendarDay(dt);
  if (!parts) return null;
  return Math.min(5, Math.ceil(parts.d / 7));
}

function fmtDate(dt) {
  const parts = calendarDay(dt);
  if (!parts) return "";
  return `${String(parts.d).padStart(2, "0")}/${String(parts.m).padStart(2, "0")}/${parts.y}`;
}

function isFatalCall(row) {
  return /^(yes|true|1)$/i.test(String(row?.AI_Coll_Fatal_Triggered || ""));
}

function isRedAlert(row) {
  return /^(yes|true|1)$/i.test(String(row?.AI_Red_Alert || ""));
}

function avg(nums) {
  const clean = nums.filter((n) => n != null && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

// ---- cell styling helpers -------------------------------------------------
function setFill(cell, argb) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function headerRow(ws, values, { fill = HEADER_FILL, from = 1 } = {}) {
  const row = ws.addRow([]);
  values.forEach((v, i) => {
    const cell = row.getCell(from + i);
    cell.value = v;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    setFill(cell, fill);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
  row.height = 26;
  return row;
}

function thinBorder() {
  const s = { style: "thin", color: { argb: "FFBFBFBF" } };
  return { top: s, left: s, bottom: s, right: s };
}

function titleCell(ws, text, span, { fill = SUBHEAD_FILL } = {}) {
  const row = ws.addRow([text]);
  const r = row.number;
  ws.mergeCells(r, 1, r, span);
  const cell = row.getCell(1);
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  setFill(cell, fill);
  cell.alignment = { vertical: "middle", horizontal: "left" };
  row.height = 24;
  return row;
}

function pct2(cell) {
  cell.numFmt = "0.00%";
}

// ===========================================================================
// SHEET 1 — Summary
// ===========================================================================
function buildSummarySheet(wb, calls, meta) {
  const ws = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
  });
  ws.getColumn(1).width = 30;
  for (let c = 2; c <= 8; c += 1) ws.getColumn(c).width = 15;

  titleCell(ws, `ICICI HFC — Collections Quality Summary  (${meta.periodLabel})`, 8, { fill: HEADER_FILL });
  ws.addRow([]);

  // ---- Audit summary: entities x [Total, Week 1..5] ----
  const weeks = [1, 2, 3, 4, 5].filter((w) => calls.some((r) => weekOfMonth(callDate(r)) === w));
  const cols = ["Total", ...weeks.map((w) => `Week ${w}`)];
  const subsetFor = (w) => (w === "Total" ? calls : calls.filter((r) => weekOfMonth(callDate(r)) === Number(String(w).replace("Week ", ""))));

  headerRow(ws, ["Entities", ...cols]);

  const distinctAgents = (rows) => new Set(rows.map((r) => (r.AgentName || "").trim()).filter(Boolean)).size;
  const fatalCount = (rows) => rows.filter(isFatalCall).length;
  const passedCount = (rows) => rows.filter((r) => { const n = num(r.AI_Coll_Score); return n != null && n >= RED_MAX && !isFatalCall(r); }).length;
  const qScore = (rows) => frac(avg(rows.map((r) => num(r.AI_Coll_Score))) ?? null);
  const nonFatalScore = (rows) => frac(avg(rows.filter((r) => !isFatalCall(r)).map((r) => num(r.AI_Coll_Score))) ?? null);

  const entityRows = [
    ["Head Count", (r) => distinctAgents(r)],
    ["Audits Count", (r) => r.length],
    ["Quality Score", (r) => qScore(r), "pct"],
    ["Non Fatal Score", (r) => nonFatalScore(r), "pct"],
    ["Fatal Count", (r) => fatalCount(r)],
    ["Passed (score ≥80, not fatal)", (r) => passedCount(r)],
    ["Failed (fatal or score <80)", (r) => r.length - passedCount(r)],
  ];
  for (const [label, fn, kind] of entityRows) {
    const row = ws.addRow([label]);
    row.getCell(1).font = { bold: true, size: 10 };
    setFill(row.getCell(1), BAND_FILL);
    row.getCell(1).border = thinBorder();
    cols.forEach((c, i) => {
      const cell = row.getCell(2 + i);
      cell.value = fn(subsetFor(c));
      if (kind === "pct") pct2(cell);
      cell.alignment = { horizontal: "center" };
      cell.border = thinBorder();
    });
  }
  ws.addRow([]);

  // ---- TL Wise ----
  addGroupTable(ws, "TL Wise Quality Performance", calls, (r) => (r.AgentSupervisor || "").trim() || "—");
  ws.addRow([]);
  // ---- Campaign Wise ----
  addGroupTable(ws, "Campaign Wise Quality Performance", calls, (r) => (r.AI_Coll_Campaign || "").trim() || "—", "Campaign Name");
  ws.addRow([]);
  // ---- RAG Wise ----
  buildRagBlock(ws, calls);

  return ws;
}

function addGroupTable(ws, title, calls, keyFn, firstCol = "TL Name") {
  titleCell(ws, title, 5);
  headerRow(ws, [firstCol, "Head Count", "Audit Count", "Quality Score", "Fatal Count"]);
  const groups = new Map();
  for (const r of calls) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, rows] of entries) {
    const hc = new Set(rows.map((r) => (r.AgentName || "").trim()).filter(Boolean)).size;
    const fatal = rows.filter(isFatalCall).length;
    const qs = frac(avg(rows.map((r) => num(r.AI_Coll_Score))) ?? null);
    const row = ws.addRow([k, hc, rows.length, qs, fatal]);
    row.getCell(4).numFmt = "0.00%";
    const qsPct = avg(rows.map((r) => num(r.AI_Coll_Score)));
    const f = gradeFill(qsPct);
    if (f) setFill(row.getCell(4), f);
    row.eachCell((c) => { c.border = thinBorder(); c.alignment = { horizontal: "center" }; });
    row.getCell(1).alignment = { horizontal: "left" };
  }
}

function buildRagBlock(ws, calls) {
  titleCell(ws, "RAG Wise Quality Performance", 4);
  headerRow(ws, ["Grade", "Criteria", "HC Count", "Call Count"]);
  // HC = agent average (official workbook). Call Count = per-call RAG (dashboard).
  const byAgent = new Map();
  let redCalls = 0, amberCalls = 0, greenCalls = 0;
  for (const r of calls) {
    const a = (r.AgentName || "").trim();
    if (a) {
      if (!byAgent.has(a)) byAgent.set(a, []);
      byAgent.get(a).push(num(r.AI_Coll_Score));
    }
    const g = grade(r.AI_Coll_Score);
    if (g === "R") redCalls += 1;
    else if (g === "A") amberCalls += 1;
    else if (g === "G") greenCalls += 1;
  }
  let red = 0, amber = 0, green = 0;
  for (const [, scores] of byAgent) {
    const g = grade(avg(scores));
    if (g === "R") red += 1; else if (g === "A") amber += 1; else if (g === "G") green += 1;
  }
  const rows = [
    ["Red", "<80.00%", red, redCalls, RED_FILL],
    ["Amber", "80.00% - 84.99%", amber, amberCalls, AMBER_FILL],
    ["Green", ">=85.00%", green, greenCalls, GREEN_FILL],
  ];
  for (const [g, crit, hc, callsInGrade, fill] of rows) {
    const row = ws.addRow([g, crit, hc, callsInGrade]);
    setFill(row.getCell(1), fill);
    row.eachCell((c) => { c.border = thinBorder(); c.alignment = { horizontal: "center" }; });
  }
}

// ===========================================================================
// SHEET 2 — Associate Wise Performance
// ===========================================================================
function buildAssociateSheet(wb, calls) {
  const ws = wb.addWorksheet("Associate Wise Performance", { views: [{ showGridLines: false }] });
  [6, 14, 26, 22, 12, 12, 12, 10, 12, 14, 8, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  titleCell(ws, "Associate Wise Quality Performance", 12, { fill: HEADER_FILL });
  headerRow(ws, [
    "Sr. No.", "Emp ID", "Associate Name", "TL Name",
    "Audit Count", "Fatal Count", "Red Alert", "PTP", "Strong PTP",
    "Quality Score", "Grade", "Weeks",
  ]);

  const byAgent = new Map();
  for (const r of calls) {
    const key = (r.AgentName || "").trim() || "—";
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key).push(r);
  }
  const entries = [...byAgent.entries()].sort((a, b) => (avg(b[1].map((r) => num(r.AI_Coll_Score))) ?? 0) - (avg(a[1].map((r) => num(r.AI_Coll_Score))) ?? 0));
  let sr = 1;
  for (const [name, rows] of entries) {
    const empId = (rows.find((r) => r.AgentID)?.AgentID) || "";
    const tl = (rows.find((r) => r.AgentSupervisor)?.AgentSupervisor) || "";
    const fatal = rows.filter(isFatalCall).length;
    const red = rows.filter(isRedAlert).length;
    const ptp = rows.filter((r) => classifyPtpQuality({
      present: r.AI_PTP_Present,
      genuineness: r.AI_PTP_Genuineness,
    })).length;
    const strong = rows.filter((r) => classifyPtpQuality({
      present: r.AI_PTP_Present,
      genuineness: r.AI_PTP_Genuineness,
    }) === "strong").length;
    const scorePct = avg(rows.map((r) => num(r.AI_Coll_Score)));
    const weeks = new Set(rows.map((r) => weekOfMonth(callDate(r))).filter(Boolean)).size;
    const row = ws.addRow([
      sr, empId, name, tl, rows.length, fatal, red, ptp, strong,
      frac(scorePct), grade(scorePct), weeks,
    ]);
    row.getCell(10).numFmt = "0.00%";
    const f = gradeFill(scorePct);
    if (f) { setFill(row.getCell(10), f); setFill(row.getCell(11), f); }
    row.eachCell((c) => { c.border = thinBorder(); c.alignment = { horizontal: "center" }; });
    row.getCell(3).alignment = { horizontal: "left" };
    row.getCell(4).alignment = { horizontal: "left" };
    sr += 1;
  }
  ws.views = [{ state: "frozen", ySplit: 2, showGridLines: false }];
  return ws;
}

// ===========================================================================
// SHEET 3 — Pareto Analysis (defects per rubric dimension)
// ===========================================================================
function buildParetoSheet(wb, calls, dims, statusesByCall) {
  const ws = wb.addWorksheet("Pareto Analysis", { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 40;
  [14, 12, 14].forEach((w, i) => { ws.getColumn(i + 2).width = w; });

  titleCell(ws, "Pareto Analysis — Defect Parameters", 4, { fill: HEADER_FILL });
  headerRow(ws, ["Defect Parameter", "Defect Count", "Defect %", "Cumulative %"]);

  const defects = dims.map((d) => {
    let count = 0;
    for (let i = 0; i < calls.length; i += 1) {
      if (ynFromStatus(statusesByCall[i][d.key]) === "No") count += 1;
    }
    return { label: d.label || d.key, count };
  }).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);

  const total = defects.reduce((a, b) => a + b.count, 0) || 1;
  let cum = 0;
  for (const d of defects) {
    cum += d.count;
    const row = ws.addRow([d.label, d.count, d.count / total, cum / total]);
    row.getCell(3).numFmt = "0.00%";
    row.getCell(4).numFmt = "0.00%";
    row.eachCell((c) => { c.border = thinBorder(); c.alignment = { horizontal: "center" }; });
    row.getCell(1).alignment = { horizontal: "left" };
  }
  if (defects.length) {
    const tr = ws.addRow(["Over All", total, 1, ""]);
    tr.getCell(3).numFmt = "0.00%";
    tr.eachCell((c) => { c.border = thinBorder(); c.font = { bold: true }; c.alignment = { horizontal: "center" }; });
    tr.getCell(1).alignment = { horizontal: "left" };
  } else {
    ws.addRow(["No defects recorded in this period.", "", "", ""]);
  }
  return ws;
}

// ===========================================================================
// SHEET 4 — Fatal Error Summary
// ===========================================================================
function buildFatalSheet(wb, calls) {
  const ws = wb.addWorksheet("Fatal Error Summary", { views: [{ showGridLines: false }] });
  [22, 42, 10, 18, 12, 22, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  titleCell(ws, "Fatal Error Summary", 7, { fill: HEADER_FILL });
  headerRow(ws, ["Disposition", "Reason", "Week", "Agent Name", "Call Date", "Call Track ID", "Audit Sheet"]);

  // Same rule as the dashboard Fatal KPI — red-alert-only rows stay on Audit Sheet.
  const fatals = [];
  calls.forEach((r, index) => {
    if (isFatalCall(r)) fatals.push({ r, index });
  });
  if (!fatals.length) {
    ws.addRow(["No fatal calls in this period.", "", "", "", "", "", ""]);
    return ws;
  }
  for (const { r, index } of fatals) {
    const dt = callDate(r);
    const auditRow = index + 2; // Audit Sheet: row 1 headers, data from row 2
    const track = (r.AudioFileName || "").trim();
    const row = ws.addRow([
      (r.AI_Coll_Disposition || "").trim() || "—",
      (r.AI_Coll_Fatal_Reason || "").trim() || "—",
      dt ? `Week ${weekOfMonth(dt)}` : "",
      (r.AgentName || "").trim() || "—",
      fmtDate(dt),
      track,
      {
        text: "Open in Audit Sheet",
        hyperlink: `#'Audit Sheet'!A${auditRow}`,
        tooltip: track || `Audit Sheet row ${auditRow}`,
      },
    ]);
    row.eachCell((c) => { c.border = thinBorder(); c.alignment = { vertical: "top", wrapText: true }; });
    row.getCell(7).alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    row.getCell(7).font = { color: { argb: "FF0563C1" }, underline: true, size: 10 };
    setFill(row.getCell(1), RED_FILL);
  }
  ws.views = [{ state: "frozen", ySplit: 2, showGridLines: false }];
  return ws;
}

// ===========================================================================
// SHEET 5 — Audit Sheet (per-call, rubric-driven Yes/No/NA)
// ===========================================================================
const LEAD_COLS = [
  ["Sr. No.", 6],
  ["E-Code", 12],
  ["Agent Name", 18],
  ["TL Name", 16],
  ["QA Name", 14],
  ["Week", 8],
  ["Call Date", 12],
  ["Language", 10],
  ["Campaign", 10],
  ["Call Track ID", 22],
  ["Call Duration", 12],
  ["Disposition", 20],
];
const NOTE_COLS = [
  ["Call Summary", 36],
  ["AOI / Remarks", 36],
];

function buildAuditSheet(wb, calls, dims, statusesByCall) {
  const ws = wb.addWorksheet("Audit Sheet", { views: [{ showGridLines: false }] });

  const leadHeaders = LEAD_COLS.map(([h]) => h);
  const dimHeaders = dims.map((d) => d.label || d.key);
  const tailHeaders = ["Sum of Yes", "Sum of NA", "Sum of No", "Quality Score", "Fatal", "Red Alert"];
  const noteHeaders = NOTE_COLS.map(([h]) => h);
  const allHeaders = [...leadHeaders, ...dimHeaders, ...tailHeaders, ...noteHeaders];

  LEAD_COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  for (let i = 0; i < dimHeaders.length; i += 1) ws.getColumn(leadHeaders.length + 1 + i).width = 14;
  for (let i = 0; i < tailHeaders.length; i += 1) {
    ws.getColumn(leadHeaders.length + dimHeaders.length + 1 + i).width = 12;
  }
  NOTE_COLS.forEach(([, w], i) => {
    ws.getColumn(leadHeaders.length + dimHeaders.length + tailHeaders.length + 1 + i).width = w;
  });

  headerRow(ws, allHeaders);

  const noteStart = leadHeaders.length + dimHeaders.length + tailHeaders.length + 1;

  let sr = 1;
  for (let i = 0; i < calls.length; i += 1) {
    const r = calls[i];
    const dt = callDate(r);
    const statuses = statusesByCall[i] || {};
    const dimValues = dims.map((d) => ynFromStatus(statuses[d.key]));
    const yes = dimValues.filter((v) => v === "Yes").length;
    const na = dimValues.filter((v) => v === "NA").length;
    const no = dimValues.filter((v) => v === "No").length;
    const fatal = isFatalCall(r);
    const red = isRedAlert(r);

    const lead = [
      sr,
      (r.AgentID || "").toString(),
      (r.AgentName || "").trim(),
      (r.AgentSupervisor || "").trim(),
      (r.AgentAuditor || "").trim(),
      dt ? `Week ${weekOfMonth(dt)}` : "",
      fmtDate(dt),
      (r.AudioLanguage || "").trim(),
      (r.AI_Coll_Campaign || "").trim(),
      (r.AudioFileName || "").trim(),
      (r.AudioDuration || "").trim(),
      (r.AI_Coll_Disposition || "").trim(),
    ];
    const tail = [yes, na, no, frac(r.AI_Coll_Score), fatal ? "Fatal" : "", red ? "Red" : ""];
    const notes = [(r.AI_Summary || "").trim(), (r.AI_Feedback || "").trim()];
    const row = ws.addRow([...lead, ...dimValues, ...tail, ...notes]);

    dimValues.forEach((v, di) => {
      const cell = row.getCell(leadHeaders.length + 1 + di);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (v === "No") setFill(cell, RED_FILL);
      else if (v === "NA") setFill(cell, AMBER_FILL);
      else if (v === "Yes") setFill(cell, GREEN_FILL);
    });
    const qCell = row.getCell(leadHeaders.length + dimHeaders.length + 4);
    qCell.numFmt = "0.00%";
    const f = gradeFill(r.AI_Coll_Score);
    if (f) setFill(qCell, f);
    if (fatal) setFill(row.getCell(leadHeaders.length + dimHeaders.length + 5), RED_FILL);
    if (red) setFill(row.getCell(leadHeaders.length + dimHeaders.length + 6), RED_FILL);

    row.eachCell((c) => { c.border = thinBorder(); if (!c.alignment) c.alignment = { vertical: "middle" }; });
    row.getCell(noteStart).alignment = { vertical: "top", wrapText: true };
    row.getCell(noteStart + 1).alignment = { vertical: "top", wrapText: true };
    row.height = 22;
    sr += 1;
  }
  // Freeze Sr / E-Code / Agent only — freezing all meta columns (including
  // 40-wide summary text) stacked the rubric columns off-screen.
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1, showGridLines: false }];
  return ws;
}

// ===========================================================================
// Public API
// ===========================================================================
/**
 * @param {object} opts
 * @param {object[]} opts.calls        Consolidated rows (collections-scored).
 * @param {object[]} opts.dims         Enabled rubric dimensions [{key,label,...}].
 * @param {function} opts.mapStatuses  (row) => { <dimKey>: 'Pass'|'Fail'|'NA' }.
 * @param {object}   opts.period       { fromDate, toDate }.
 * @param {string}   opts.orgName
 * @returns {Promise<Buffer>}
 */
async function buildIcicQualityReportBuffer({ calls, dims, mapStatuses, period, orgName }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = orgName || "Collections AQM";
  wb.created = new Date();

  const rows = Array.isArray(calls) ? calls : [];
  const enabledDims = (dims || []).filter((d) => d.enabled !== false);
  const statusesByCall = rows.map((r) => {
    try { return mapStatuses(r) || {}; } catch { return {}; }
  });

  const periodLabel = period && period.fromDate && period.toDate
    ? `${period.fromDate} to ${period.toDate}`
    : "All available";
  const meta = { periodLabel };

  buildSummarySheet(wb, rows, meta);
  buildAssociateSheet(wb, rows);
  buildParetoSheet(wb, rows, enabledDims, statusesByCall);
  buildFatalSheet(wb, rows);
  buildAuditSheet(wb, rows, enabledDims, statusesByCall);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildIcicQualityReportBuffer };
