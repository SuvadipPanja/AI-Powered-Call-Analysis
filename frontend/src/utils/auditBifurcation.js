import { tenureBand } from "./auditTenure";

function label(value) {
  const text = String(value || "").trim();
  return text || "Unknown";
}

function countBy(rows, nameOf) {
  const map = new Map();
  for (const row of rows) {
    const name = nameOf(row);
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function summarizeAuditQueue(rows = []) {
  return {
    byLanguage: countBy(rows, (row) => label(row.language)),
    byTl: countBy(rows, (row) => label(row.supervisor)),
    byTenure: countBy(rows, (row) => tenureBand(row.agentCreationDate, row.callDate)),
  };
}
