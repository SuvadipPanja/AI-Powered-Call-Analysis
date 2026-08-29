/**
 * Pure selector that normalizes the /api/collections/dashboard `languageMix`
 * rows into the breakdown consumed by <LanguageMixCard />. Self-contained
 * (buckets tail rows into "Other languages") so the card does not need to
 * import anything from CollectionsDashboardSection (avoids a circular import
 * once the host wires the card in).
 *
 * @param {Array<{ name?: string, count?: number }>} items
 * @param {{ maxRows?: number }} [opts]
 * @returns {{ rows: Array<{ name: string, count: number, percent: number }>, total: number, hasData: boolean, missing: boolean }}
 */
export function buildLanguageMixBreakdown(items, { maxRows = 8 } = {}) {
  const missing = !Array.isArray(items);
  const list = missing ? [] : items;
  const normalized = list
    .map((row) => ({
      name: String(row?.name ?? "").trim() || "Unknown",
      count: Number(row?.count) || 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  const total = normalized.reduce((sum, row) => sum + row.count, 0);
  const hasData = total > 0;

  let normalizedCapped = normalized;
  if (normalized.length > maxRows) {
    const visible = normalized.slice(0, maxRows - 1);
    const otherCount = normalized
      .slice(maxRows - 1)
      .reduce((sum, row) => sum + row.count, 0);
    normalizedCapped = [...visible, { name: "Other languages", count: otherCount }];
  }

  const rows = normalizedCapped.map((row) => ({
    name: row.name,
    count: row.count,
    percent: total > 0 ? Math.round((row.count / total) * 100) : 0,
  }));

  return { rows, total, hasData, missing };
}
