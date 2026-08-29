function collectionsDateClause({ hasRange, fromParam = "@fromDate", toParam = "@toDate" }) {
  if (hasRange) {
    return `(
        (UploadDate IS NOT NULL
          AND UploadDate >= ${fromParam}
          AND UploadDate < DATEADD(DAY, 1, ${toParam}))
        OR (UploadDate IS NULL
          AND SelectedCallDate >= ${fromParam}
          AND SelectedCallDate < DATEADD(DAY, 1, ${toParam}))
      )`;
  }
  return "COALESCE(UploadDate, SelectedCallDate) >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))";
}

function collectionsWhere({ hasRange, extraFilters = "" }) {
  return `WHERE AI_Coll_Score IS NOT NULL AND ${collectionsDateClause({ hasRange })}${extraFilters}`;
}

/** Select + group-by expression for the collections-scoped AudioLanguage mix.
 *  Mirrors the disposition/campaign mix shape so mapMix() can consume it. */
function collectionsLanguageMixSelect() {
  return `COALESCE(NULLIF(LTRIM(RTRIM(AudioLanguage)), ''), 'Unknown') AS name, COUNT(*) AS count`;
}

function collectionsAuditCoverageQuery(whereSql) {
  return `
    SELECT
      SUM(CASE WHEN CA.AuditID IS NULL THEN 1 ELSE 0 END) AS aiOnly,
      SUM(CASE WHEN CA.AuditID IS NOT NULL THEN 1 ELSE 0 END) AS manualReviewed,
      AVG(CASE WHEN CA.AuditID IS NOT NULL THEN CAST(scoped.AI_Coll_Score AS FLOAT) END) AS avgAi,
      AVG(CASE WHEN CA.AuditID IS NOT NULL THEN CAST(CA.OverallManualScore AS FLOAT) END) AS avgManual
    FROM (
      SELECT AudioFileName, AI_Coll_Score
      FROM Consolidated_Audio_Analysis
      ${whereSql}
    ) scoped
    LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = scoped.AudioFileName
  `;
}

module.exports = {
  collectionsDateClause,
  collectionsWhere,
  collectionsLanguageMixSelect,
  collectionsAuditCoverageQuery,
};
