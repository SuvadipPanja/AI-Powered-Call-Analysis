export const PREVIEW_ROW_LIMIT = 40;

export function exportFilename(slug, fromDate, toDate) {
  const stamp = new Date().toISOString().slice(0, 10);
  const range = fromDate && toDate ? `_${fromDate}_to_${toDate}` : "";
  return `${slug}${range}_${stamp}`;
}

export function recordsFromObjects(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const columnSet = new Set();
  list.forEach((row) => Object.keys(row).forEach((key) => columnSet.add(key)));
  const columns = [...columnSet];
  const normalized = list.map((row) => {
    const out = {};
    columns.forEach((col) => {
      const value = row[col];
      out[col] = value == null ? "" : String(value);
    });
    return out;
  });
  return { columns, rows: normalized };
}

export function parseCsvText(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  if (!raw.trim() || /^no .*data/i.test(raw.trim())) {
    return { columns: [], rows: [] };
  }
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') {
      current += '"';
      if (inQuotes && raw[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  const splitLine = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    return cells;
  };

  const header = splitLine(lines[0] || "").map((h) => h.trim() || "Column");
  const rows = lines.slice(1).filter((line) => line.trim()).map((line) => {
    const cells = splitLine(line);
    const row = {};
    header.forEach((col, idx) => {
      row[col] = cells[idx] == null ? "" : cells[idx];
    });
    return row;
  });
  return { columns: header, rows };
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
