import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Convert Chart.js data object to tabular rows. */
export function chartDataToRows(chartData) {
  if (!chartData?.labels?.length) return { columns: [], rows: [] };
  const columns = ["Period", ...chartData.datasets.map((ds, i) => ds.label || `Series ${i + 1}`)];
  const rows = chartData.labels.map((label, idx) => {
    const row = { Period: label };
    chartData.datasets.forEach((ds, i) => {
      row[ds.label || `Series ${i + 1}`] = ds.data[idx] ?? "";
    });
    return row;
  });
  return { columns, rows };
}

export function tableToRows(columns, rows) {
  return {
    columns: columns.map((c) => (typeof c === "string" ? c : c.key)),
    rows: rows.map((row) => {
      const out = {};
      columns.forEach((col) => {
        const key = typeof col === "string" ? col : col.key;
        const label = typeof col === "string" ? col : col.label;
        out[label] = row[key] ?? row[label] ?? "";
      });
      return out;
    }),
  };
}

export function downloadCsv(filename, columns, rows) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsv(row[col])).join(",")).join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export async function downloadExcel(filename, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  sheet.addRow(columns);
  rows.forEach((row) => sheet.addRow(columns.map((col) => row[col] ?? "")));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`
  );
}

function getChartCanvas(chartRef) {
  const chart = chartRef?.current;
  if (!chart) return null;
  if (typeof chart.toBase64Image === "function") return chart.toBase64Image("image/png", 1);
  if (chart.canvas) return chart.canvas.toDataURL("image/png", 1);
  return null;
}

export function downloadChartPng(chartRef, filename) {
  const dataUrl = getChartCanvas(chartRef);
  if (!dataUrl) throw new Error("Chart not ready for export.");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.click();
}

export function downloadChartPdf(chartRef, filename, title = "Report chart") {
  const dataUrl = getChartCanvas(chartRef);
  if (!dataUrl) throw new Error("Chart not ready for export.");
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(14);
  pdf.text(title, 40, 36);
  pdf.addImage(dataUrl, "PNG", 40, 52, pageW - 80, pageH - 90);
  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

export async function downloadBackendCsv(apiBaseUrl, endpoint, body, filename) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Export failed");
  const blob = await response.blob();
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export function buildExportFilename(slug, fromDate, toDate) {
  const stamp = new Date().toISOString().slice(0, 10);
  const range = fromDate && toDate ? `_${fromDate}_to_${toDate}` : "";
  return `${slug}${range}_${stamp}`;
}
