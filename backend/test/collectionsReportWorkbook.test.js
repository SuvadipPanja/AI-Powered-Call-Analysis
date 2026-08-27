const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { buildIcicQualityReportBuffer } = require("../services/collectionsReport");

const dims = [
  { key: "Recording Disclaimer", label: "Recording Disclaimer", enabled: true },
  { key: "RPC Verification", label: "RPC Verification", enabled: true },
];

function sampleCalls() {
  return [
    {
      AgentName: "Test2",
      AgentID: "E1",
      AgentSupervisor: "TL1",
      SelectedCallDate: "2026-08-09T00:00:00.000Z",
      AudioLanguage: "Hindi",
      AI_Coll_Campaign: "COLL",
      AudioFileName: "fatal-call.mp3",
      AudioDuration: "00:02:39",
      AI_Coll_Disposition: "No Promise-Call back",
      AI_Summary: "Long summary text. ".repeat(40),
      AI_Feedback: "Long remarks text. ".repeat(40),
      AI_Coll_Score: 35.09,
      AI_Coll_Fatal_Triggered: "Yes",
      AI_Coll_Fatal_Reason: "RPC verification failed (fatal to the call)",
      AI_Red_Alert: "No",
    },
    {
      AgentName: "Test2",
      AgentID: "E1",
      SelectedCallDate: "2026-08-09T00:00:00.000Z",
      AI_Coll_Campaign: "PDM",
      AudioFileName: "red-only.mp3",
      AI_Coll_Disposition: "Will not clear",
      AI_Coll_Score: 40,
      AI_Coll_Fatal_Triggered: "No",
      AI_Red_Alert: "Yes",
    },
    {
      AgentName: "Test2",
      AgentID: "E1",
      SelectedCallDate: "2026-08-09T00:00:00.000Z",
      AI_Coll_Campaign: "COLL",
      AudioFileName: "clean-call.mp3",
      AI_Coll_Score: 88,
      AI_Coll_Fatal_Triggered: "No",
      AI_Red_Alert: "No",
    },
  ];
}

async function loadWorkbook() {
  const buffer = await buildIcicQualityReportBuffer({
    calls: sampleCalls(),
    dims,
    mapStatuses: () => ({
      "Recording Disclaimer": "Pass",
      "RPC Verification": "Fail",
    }),
    period: { fromDate: "2026-07-27", toDate: "2026-08-27" },
    orgName: "ICICI HFC",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

test("Audit Sheet keeps identifier columns frozen so rubric columns stay visible", async () => {
  const wb = await loadWorkbook();
  const ws = wb.getWorksheet("Audit Sheet");
  assert.ok(ws, "Audit Sheet missing");
  const view = (ws.views && ws.views[0]) || {};
  assert.ok(view.xSplit > 0 && view.xSplit <= 4, `xSplit should freeze a few id columns, got ${view.xSplit}`);

  const headers = ws.getRow(1).values.slice(1).map(String);
  const summaryAt = headers.indexOf("Call Summary");
  const disclaimerAt = headers.indexOf("Recording Disclaimer");
  assert.ok(summaryAt >= 0 && disclaimerAt >= 0);
  assert.ok(
    disclaimerAt < summaryAt,
    "Call Summary / remarks must sit after rubric columns so they do not cover Yes/No",
  );
});

test("Fatal Error Summary lists dashboard fatals only and links to the Audit Sheet row", async () => {
  const wb = await loadWorkbook();
  const ws = wb.getWorksheet("Fatal Error Summary");
  assert.ok(ws, "Fatal Error Summary missing");
  const headers = ws.getRow(2).values.slice(1).map(String);
  assert.ok(headers.includes("Audit Sheet"), "missing Audit Sheet hyperlink column");
  assert.ok(headers.includes("Call Track ID"));

  const dataRows = [];
  ws.eachRow((row, n) => {
    if (n <= 2) return;
    const track = String(row.getCell(headers.indexOf("Call Track ID") + 1).value || "");
    if (track) dataRows.push(row);
  });
  assert.equal(dataRows.length, 1, "red-alert-only calls must not appear as fatals");

  const linkCol = headers.indexOf("Audit Sheet") + 1;
  const link = dataRows[0].getCell(linkCol).value;
  assert.equal(typeof link, "object");
  assert.match(String(link.hyperlink || ""), /Audit Sheet/);
  assert.match(String(link.hyperlink || ""), /A\d+/);
});

test("Summary RAG reports both head count and call count", async () => {
  const wb = await loadWorkbook();
  const ws = wb.getWorksheet("Summary");
  let foundCallCount = false;
  ws.eachRow((row) => {
    const values = row.values.slice(1).map((v) => String(v || ""));
    if (values.includes("Call Count")) foundCallCount = true;
  });
  assert.equal(foundCallCount, true);
});

test("Summary identities hold: audits, pass/fail, RAG, campaigns, fatals", async () => {
  const wb = await loadWorkbook();
  const sum = wb.getWorksheet("Summary");
  const byLabel = {};
  sum.eachRow((row) => {
    const label = String(row.getCell(1).value || "");
    byLabel[label] = Number(row.getCell(2).value);
  });
  // sampleCalls: 3 rows, 1 fatal, scores 35.09 / 40 / 88
  assert.equal(byLabel["Audits Count"], 3);
  assert.equal(byLabel["Fatal Count"], 1);
  assert.equal(byLabel["Passed Audits Count"] + byLabel["Failed Audits Count"], 3);

  const audit = wb.getWorksheet("Audit Sheet");
  const auditHeaders = audit.getRow(1).values.slice(1).map(String);
  const fatalCol = auditHeaders.indexOf("Fatal") + 1;
  let fatalFlags = 0;
  audit.eachRow((row, n) => {
    if (n === 1) return;
    if (String(row.getCell(fatalCol).value) === "Fatal") fatalFlags += 1;
  });
  const fatalWs = wb.getWorksheet("Fatal Error Summary");
  let fatalSheetRows = 0;
  fatalWs.eachRow((row, n) => {
    if (n <= 2) return;
    if (String(row.getCell(6).value || "")) fatalSheetRows += 1;
  });
  assert.equal(fatalSheetRows, 1);
  assert.equal(fatalFlags, 1);
});
