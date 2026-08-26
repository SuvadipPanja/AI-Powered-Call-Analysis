import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";

export async function workbookToPreview(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { columns: [], rows: [], sheetNames: [] };
  const sheetNames = workbook.worksheets.map((s) => s.name);
  const headerRow = sheet.getRow(1);
  const columns = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    columns.push(String(cell.value == null ? "" : cell.value) || "Column");
  });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item = {};
    columns.forEach((col, idx) => {
      const value = row.getCell(idx + 1).value;
      item[col] = value == null ? "" : String(value.text || value.result || value);
    });
    rows.push(item);
  });
  return { columns, rows, sheetNames };
}

function escapeCsv(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildCsvBlob(columns, rows) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => escapeCsv(row[col])).join(",")).join("\n");
  return new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8;" });
}

export async function buildExcelBlob(columns, rows, sheetName = "Report") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Report");
  sheet.addRow(columns);
  rows.forEach((row) => sheet.addRow(columns.map((col) => row[col] ?? "")));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function buildPdfBlob(columns, rows, title = "Report") {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(13);
  pdf.text(String(title).slice(0, 80), 36, 32);
  pdf.setFontSize(8);
  const usable = pageW - 72;
  const colW = Math.max(48, usable / Math.max(columns.length, 1));
  let y = 52;
  const drawRow = (values, bold) => {
    if (y > pageH - 36) {
      pdf.addPage();
      y = 36;
    }
    if (bold) pdf.setFont(undefined, "bold");
    values.forEach((value, idx) => {
      pdf.text(String(value ?? "").slice(0, 28), 36 + idx * colW, y, { maxWidth: colW - 6 });
    });
    pdf.setFont(undefined, "normal");
    y += 14;
  };
  drawRow(columns, true);
  rows.slice(0, 200).forEach((row) => drawRow(columns.map((col) => row[col]), false));
  return pdf.output("blob");
}
