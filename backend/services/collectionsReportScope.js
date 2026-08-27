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

module.exports = { collectionsDateClause, collectionsWhere };
