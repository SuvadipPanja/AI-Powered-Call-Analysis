/**
 * Isolated data gathering for the ICICI HFC quality workbook.
 *
 * The reports-wide date helper wraps both date columns in CAST(COALESCE(...)),
 * which is not sargable and forces a full scan of Consolidated_Audio_Analysis
 * across ~90 wide columns (including AI_Summary / AI_Feedback). This module
 * returns the identical row set but expresses the range as plain half-open
 * comparisons, so IX_CAA_UploadDate can be used.
 */

const { collectionsDateClause } = require("./collectionsReportScope");

/** Sargable equivalent of "COALESCE(UploadDate, SelectedCallDate) date-between". */
function qualityWorkbookDateClause() {
  return collectionsDateClause({ hasRange: true });
}

function buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters = '' }) {
  const dateClause = collectionsDateClause({ hasRange });
  return `
        SELECT ${selectCols}
        FROM Consolidated_Audio_Analysis
        WHERE AI_Coll_Score IS NOT NULL AND ${dateClause}${extraFilters}
        ORDER BY COALESCE(UploadDate, SelectedCallDate) DESC
      `;
}

/**
 * Run the workbook SELECT and report how long the database took, so a slow
 * download can be attributed to SQL or to Excel assembly instead of guessed at.
 */
async function fetchQualityWorkbookRows(pool, {
  selectCols,
  hasRange,
  fromDate,
  toDate,
  params,
  extraFilters = '',
  bindReportFilters,
  sqlTypes,
}) {
  const request = pool.request();
  if (hasRange) {
    request.input('fromDate', sqlTypes.Date, fromDate);
    request.input('toDate', sqlTypes.Date, toDate);
  }
  bindReportFilters(request, params);
  const query = buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters });
  const startedAt = Date.now();
  const result = await request.query(query);
  return { rows: result.recordset || [], sqlMs: Date.now() - startedAt };
}

module.exports = {
  qualityWorkbookDateClause,
  buildQualityWorkbookQuery,
  fetchQualityWorkbookRows,
};
