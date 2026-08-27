/**
 * Report + dashboard route handlers (Sprint 3.1 — extracted from server.js).
 */
module.exports = function registerReportRoutes(router, deps, H) {
  const { sql, connectToDatabase, sqlConnect, writeLog, getISTTimeString } = deps;
  H.initReportHelpers(deps);
  const {
    markStaleProcessingAsFailed,
    mapRecentActivityRow,
    parseRecentActivityFilterParams,
    bindRecentActivityFilters,
    buildRecentActivityFilteredQuery,
    parseDashboardFilterParams,
    bindDashboardFilters,
    dashboardAudioUploadExtraFilters,
    dashboardConsolidatedExtraFilters,
    dashboardUploadDateClause,
    dashboardInclusiveDateClause,
    consolidatedReportExtraFilters,
    consolidatedReportDateBetween,
    consolidatedReportTodayClause,
    bindReportFilters,
    runMetricsOverviewQuery,
    emptyWeekdayMaps,
    WEEKDAY_LABELS,
    queryTopScorerForWeek,
    buildPerformanceComparisonPeriodCte,
    aggregateCustomerSentimentSummary,
    intelDateClause,
  } = H;
  const { collectionsWhere } = require("../services/collectionsReportScope");
  const { isMissingDbObjectError } = require("../projectPaths");

/**
 * API 10.34.32 - GET /api/recent-activity
 * Retrieves recent audio processing activity
 */
router.get("/api/recent-activity", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { limit } = req.query;
  const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

  try {
    const filterParams = parseRecentActivityFilterParams(req.query);
    const pool = await sqlConnect();
    await markStaleProcessingAsFailed(pool);

    let query = buildRecentActivityFilteredQuery(rowLimit, filterParams, { withAuditJoin: true });
    let request = bindRecentActivityFilters(pool.request(), filterParams);

    let result;
    try {
      result = await request.query(query);
    } catch (auditJoinErr) {
      if (!isMissingDbObjectError(auditJoinErr)) throw auditJoinErr;
      query = buildRecentActivityFilteredQuery(rowLimit, filterParams, { withAuditJoin: false });
      request = bindRecentActivityFilters(pool.request(), filterParams);
      result = await request.query(query);
    }
    const data = result.recordset.map(mapRecentActivityRow);

    return res.status(200).json({ success: true, data, total: data.length });

  } catch (error) {
    if (error.message && error.message.includes("Invalid")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});


/**
 * API 10.28.265 - GET /api/recent-activity-full
 * Retrieves detailed recent call activity
 */
router.get("/api/recent-activity-full", async (req, res) => {
  try {
    const params = parseDashboardFilterParams(req.query);
    const pool = await sqlConnect();
    await markStaleProcessingAsFailed(pool);

    const query = `
      SELECT 
        AU.AudioFileName AS FileName,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd HH:mm:ss') AS UploadDate,
        AU.ProcessStatus,
        APR.Status AS AIStatus,
        APR.TranscribeOutput,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd') AS ProcessDate,
        COALESCE(ADS.AgentName, AU.SelectedAgent, 'Unknown') AS AgentName,
        COALESCE(ADS.AudioDuration, '00:00:00') AS AudioDuration,
        COALESCE(ADS.AudioLanguage, 'Unknown') AS AudioLanguage,
        AgentTable.agent_id AS AgentID,
        AgentTable.agent_location AS Location,
        AU.CallType AS CallType,
        COALESCE(ADS.Overall_Scoring, '') AS Overall_Scoring
      FROM AudioUploads AU
      LEFT JOIN AI_Processing_Result APR
        ON AU.AudioFileName = APR.AudioFileName
      LEFT JOIN AI_Details_Scoring ADS
        ON AU.AudioFileName = ADS.AudioFileName
      LEFT JOIN [dbo].[Agents] AgentTable
        ON LOWER(COALESCE(ADS.AgentName, AU.SelectedAgent)) = LOWER(AgentTable.agent_name)
      WHERE CAST(AU.UploadDate AS DATE) BETWEEN @fromDate AND @toDate
      ${dashboardAudioUploadExtraFilters(params, "AU")}
      ORDER BY AU.UploadDate DESC, AU.UploadID DESC;
    `;

    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const data = result.recordset.map((row) => {
      const mapped = mapRecentActivityRow(row);
      return {
        ...row,
        Status: mapped.Status,
        FailureStage: mapped.FailureStage,
        FailureReason: mapped.FailureReason,
      };
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.message && error.message.includes("Invalid date")) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Error fetching full recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error fetching full recent activity." });
  }
});

/**
 * API 10.28.266 - GET /api/script-compliance/:audioFileName
 * Retrieves script compliance data for an audio file
 */

/* 10.6 Analytics APIs */
/**
 * API 10.46.44 - GET /api/calls-processed-7days
 * Retrieves calls processed in the last 7 days
 */
router.get('/api/calls-processed-7days', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().execute('dbo.FetchCallsProcessed7Days');
    const labels = result.recordset.map(row => row.Date);
    const values = result.recordset.map(row => row.ProcessedCalls);
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/calls-processed-7days:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.47.45 - GET /api/agent-wise-ai-scoring
 * Retrieves AI scoring by agent
 */
router.get('/api/agent-wise-ai-scoring', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const extra = dashboardConsolidatedExtraFilters(params);
    const dateClause = `CAST(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate`;

    const queries = [
      `
        SELECT TOP 12 COALESCE(AgentName, 'Unknown') AS agentName,
               AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE ${dateClause}
          AND AI_Overall_Scoring IS NOT NULL
          AND TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2)) > 0
          ${extra}
        GROUP BY AgentName
        ORDER BY avgScore DESC
      `,
      `
        SELECT TOP 12 COALESCE(ADS.AgentName, AU.SelectedAgent) AS agentName,
               AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM dbo.AI_Details_Scoring ADS
        INNER JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
        WHERE CAST(COALESCE(AU.SelectedCallDate, CAST(AU.UploadDate AS DATE)) AS DATE) BETWEEN @fromDate AND @toDate
          AND ADS.Overall_Scoring IS NOT NULL
          AND TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) > 0
          ${dashboardAudioUploadExtraFilters(params, "AU")}
        GROUP BY COALESCE(ADS.AgentName, AU.SelectedAgent)
        ORDER BY avgScore DESC
      `,
    ];

    for (const query of queries) {
      try {
        const result = await bindDashboardFilters(pool.request(), params).query(query);
        if (result.recordset.length > 0) {
          return res.json({
            success: true,
            agentLabels: result.recordset.map((row) => row.agentName),
            agentScores: result.recordset.map((row) => Number(row.avgScore) || 0),
          });
        }
      } catch (err) {
        if (!isMissingDbObjectError(err)) throw err;
      }
    }

    return res.json({ success: true, agentLabels: [], agentScores: [] });
  } catch (err) {
    console.error("Error in /api/agent-wise-ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.48.46 - GET /api/analytics-overview
 * Retrieves analytics overview for a specified period
 */
router.get('/api/analytics-overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Days', sql.Int, days)
      .execute('dbo.FetchAnalyticsOverview');
    if (!result.recordset.length) {
      return res.json({ success: true, totalFiles: 0, totalLanguages: 0, toneAnalysisStatus: 'In Progress' });
    }
    return res.json({ success: true, ...result.recordset[0] });
  } catch (err) {
    console.error("Error in /api/analytics-overview:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.49.47 - GET /api/tone-analysis
 * Retrieves sample tone analysis distribution
 */
router.get('/api/tone-analysis', async (req, res) => {
  try {
    const sampleDistribution = { positive: 25, neutral: 50, negative: 25 };
    return res.json({ success: true, distribution: sampleDistribution });
  } catch (err) {
    console.error("Error in /api/tone-analysis:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.50.48 - GET /api/ai-scoring
 * Retrieves AI scoring for a specified range
 */
router.get('/api/ai-scoring', async (req, res) => {
  try {
    const range = parseInt(req.query.range) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Range', sql.Int, range)
      .execute('dbo.FetchAIScoring');
    const labels = result.recordset.map(row => row.Date);
    const scores = result.recordset.map(row => row.AvgAIScore);
    return res.json({ success: true, labels, scores });
  } catch (err) {
    console.error("Error in /api/ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.51.49 - GET /api/metrics-overview
 * Retrieves overview metrics for call analysis
 */
router.get("/api/metrics-overview", async (req, res) => {
  const { location, tl, fromDate, toDate, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();

    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
    }

    const parsedFromDate = new Date(fromDate);
    const parsedToDate = new Date(toDate);
    const currentDate = new Date();

    if (isNaN(parsedFromDate) || isNaN(parsedToDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
    }

    if (parsedToDate < parsedFromDate) {
      return res.status(400).json({ success: false, message: "toDate must be on or after fromDate." });
    }

    const effectiveToDate = parsedToDate > currentDate ? currentDate : parsedToDate;
    const effectiveFromDate = parsedFromDate;
    const fromDateStr = effectiveFromDate.toISOString().split("T")[0];
    const toDateStr = effectiveToDate.toISOString().split("T")[0];

    let useFallback = false;
    let currentData;
    try {
      currentData = await runMetricsOverviewQuery(
        pool,
        { fromDate: fromDateStr, toDate: toDateStr, location, tl, callType, agent },
        false
      );
    } catch (consolidatedErr) {
      if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
        throw consolidatedErr;
      }
      useFallback = true;
      currentData = await runMetricsOverviewQuery(
        pool,
        { fromDate: fromDateStr, toDate: toDateStr, location, tl, callType, agent },
        true
      );
    }

    const daysDiff = (effectiveToDate - effectiveFromDate) / (1000 * 60 * 60 * 24);
    const prevStartDate = new Date(effectiveFromDate);
    const prevEndDate = new Date(effectiveToDate);
    prevStartDate.setDate(prevStartDate.getDate() - daysDiff - 1);
    prevEndDate.setDate(prevEndDate.getDate() - daysDiff - 1);
    const prevFromStr = prevStartDate.toISOString().split("T")[0];
    const prevToStr = prevEndDate.toISOString().split("T")[0];

    let prevData;
    if (useFallback) {
      prevData = await runMetricsOverviewQuery(
        pool,
        { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
        true
      );
    } else {
      try {
        prevData = await runMetricsOverviewQuery(
          pool,
          { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
          false
        );
      } catch (consolidatedErr) {
        if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
          throw consolidatedErr;
        }
        prevData = await runMetricsOverviewQuery(
          pool,
          { fromDate: prevFromStr, toDate: prevToStr, location, tl, callType, agent },
          true
        );
      }
    }

    return res.status(200).json({
      success: true,
      totalCallsProcessed: currentData.totalCallsProcessed,
      successCount: currentData.successCount,
      failedCount: currentData.failedCount,
      avgAiScoring: currentData.avgAiScoring || 0,
      avgManualScoring: currentData.avgManualScoring || 0,
      aht: currentData.aht || 0,
      prevPeriodData: {
        totalCallsProcessed: prevData.totalCallsProcessed,
        successCount: prevData.successCount,
        failedCount: prevData.failedCount,
        avgAiScoring: prevData.avgAiScoring || 0,
        avgManualScoring: prevData.avgManualScoring || 0,
        aht: prevData.aht || 0
      }
    });
  } catch (error) {
    console.error("Error in /api/metrics-overview:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

/**
 * API 10.52.50 - GET /api/tone-analysis-7days
 * Retrieves tone analysis for the last 7 days
 */
router.get("/api/tone-analysis-7days", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT APR.ToneAnalysis
      FROM AI_Processing_Result APR
      INNER JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE ${dashboardInclusiveDateClause("AU")}
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    let sumPos = 0, sumNeu = 0, sumNeg = 0;
    for (const row of result.recordset) {
      const raw = row.ToneAnalysis || "";
      if (raw.includes("Positive")) sumPos++;
      else if (raw.includes("Negative")) sumNeg++;
      else sumNeu++;
    }
    return res.json({
      success: true,
      labels: ["Positive", "Neutral", "Negative"],
      values: [sumPos, sumNeu, sumNeg],
    });
  } catch (err) {
    console.error("Error in /api/tone-analysis-7days:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.53.51 - GET /api/daily-call-duration-current-week
 * Retrieves daily call duration for the current week
 */
router.get("/api/daily-call-duration-current-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName, APR.AudioDuration
      FROM AI_Processing_Result APR
      JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE AU.UploadDate >= DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()), 0)
        AND AU.UploadDate < DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()) + 1, 0)
    `;
    const result = await pool.request().query(query);
    let dayMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    function toMinutes(hhmmss) {
      if (!hhmmss) return 0;
      const parts = hhmmss.split(":");
      if (parts.length !== 3) return 0;
      let h = parseInt(parts[0]) || 0;
      let m = parseInt(parts[1]) || 0;
      let s = parseInt(parts[2]) || 0;
      return h * 60 + m + s / 60;
    }
    for (const row of result.recordset) {
      const day = row.DayName;
      dayMap[day] = (dayMap[day] || 0) + toMinutes(row.AudioDuration);
    }
    const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const values = labels.map(d => Math.round(dayMap[d] || 0));
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/daily-call-duration-current-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.52 - GET /api/inbound-outbound-week
 * Retrieves inbound and outbound call counts for the current week
 */
router.get("/api/inbound-outbound-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName, AU.CallType
      FROM AudioUploads AU
      WHERE ${dashboardInclusiveDateClause("AU")}
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const { inboundMap, outboundMap } = emptyWeekdayMaps();
    for (const row of result.recordset) {
      const d = row.DayName;
      const ct = String(row.CallType || "").toLowerCase().trim();
      if (ct.includes("inbound")) inboundMap[d] = (inboundMap[d] || 0) + 1;
      else if (ct.includes("outbound")) outboundMap[d] = (outboundMap[d] || 0) + 1;
    }
    const inbound = WEEKDAY_LABELS.map((d) => inboundMap[d]);
    const outbound = WEEKDAY_LABELS.map((d) => outboundMap[d]);
    return res.json({ success: true, labels: WEEKDAY_LABELS, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/inbound-outbound-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.53 - GET /api/daily-duration-inbound-outbound-week
 * Daily call duration (mins) split by inbound vs outbound for current week
 */
router.get("/api/daily-duration-inbound-outbound-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName,
             LOWER(LTRIM(RTRIM(AU.CallType))) AS CallType,
             APR.AudioDuration
      FROM AI_Processing_Result APR
      JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE ${dashboardInclusiveDateClause("AU")}
        ${dashboardAudioUploadExtraFilters(params, "AU")}
    `;
    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const { inboundMap, outboundMap } = emptyWeekdayMaps();

    function toMinutes(hhmmss) {
      if (!hhmmss) return 0;
      const parts = String(hhmmss).split(":");
      if (parts.length !== 3) return 0;
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      const s = parseInt(parts[2], 10) || 0;
      return h * 60 + m + s / 60;
    }

    for (const row of result.recordset) {
      const day = row.DayName;
      const mins = toMinutes(row.AudioDuration);
      const ct = String(row.CallType || "").toLowerCase().trim();
      if (ct.includes("inbound")) inboundMap[day] = (inboundMap[day] || 0) + mins;
      else if (ct.includes("outbound")) outboundMap[day] = (outboundMap[day] || 0) + mins;
    }

    const inbound = WEEKDAY_LABELS.map((d) => Math.round(inboundMap[d] || 0));
    const outbound = WEEKDAY_LABELS.map((d) => Math.round(outboundMap[d] || 0));
    return res.json({ success: true, labels: WEEKDAY_LABELS, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/daily-duration-inbound-outbound-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.54 - GET /api/top-scorer-agents-week
 * Top AI scoring agent for inbound and outbound (filtered date range)
 */
router.get("/api/top-scorer-agents-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    const [inbound, outbound] = await Promise.all([
      queryTopScorerForWeek(pool, "inbound", params),
      queryTopScorerForWeek(pool, "outbound", params),
    ]);

    return res.json({ success: true, inbound, outbound, fromDate: params.fromDateStr, toDate: params.toDateStr });
  } catch (err) {
    console.error("Error in /api/top-scorer-agents-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});
/**
 * API 10.5.01 - GET /api/reports/inbound-calls-monthly
 * Retrieves monthly inbound call statistics for the last 12 months
 */
router.get("/api/reports/inbound-calls-monthly", async (req, res) => {
  const { year } = req.query;
  const targetYear = year || new Date().getFullYear();
  
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("year", sql.Int, targetYear)
      .query(`
        SELECT 
          FORMAT(SelectedCallDate, 'MMM') AS month,
          MONTH(SelectedCallDate) AS monthNumber,
          COUNT(*) AS callCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE CallType = 'inbound' 
          AND YEAR(SelectedCallDate) = @year
          AND Status = 'Success'
        GROUP BY MONTH(SelectedCallDate), FORMAT(SelectedCallDate, 'MMM')
        ORDER BY monthNumber
      `);
    
    writeLog(`[${getISTTimeString()}] Inbound calls monthly data fetched for year ${targetYear}`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching inbound calls monthly: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching inbound calls data." });
  }
});

/**
 * API 10.5.02 - GET /api/reports/outbound-calls-weekly
 * Retrieves weekly outbound call statistics for the last 8 weeks
 */
router.get("/api/reports/outbound-calls-weekly", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query(`
        SELECT 
          CONCAT('Week ', weekNumber) AS week,
          weekNumber,
          callCount
        FROM (
          SELECT 
            DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS weekNumber,
            YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS callYear,
            COUNT(*) AS callCount
          FROM [dbo].[Consolidated_Audio_Analysis]
          WHERE CallType = 'outbound' 
            AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(WEEK, -8, GETDATE())
            AND Status = 'Success'
          GROUP BY
            DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))),
            YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)))
        ) weekly
        ORDER BY callYear DESC, weekNumber DESC
      `);
    
    writeLog(`[${getISTTimeString()}] Outbound calls weekly data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching outbound calls weekly: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching outbound calls data." });
  }
});

/**
 * API 10.5.03 - GET /api/reports/call-resolution-status
 * Retrieves call resolution status distribution
 */
router.get("/api/reports/call-resolution-status", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AI_Resolution_Status, 'Unknown') AS resolutionStatus,
        COUNT(*) AS count
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }

    query += consolidatedReportExtraFilters({ location, supervisor, callType, agent });
    bindReportFilters(request, { location, supervisor, callType, agent });
    
    query += ` GROUP BY AI_Resolution_Status ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Call resolution status data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call resolution status: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching resolution status data." });
  }
});

/**
 * API 10.5.04 - GET /api/reports/agent-performance-metrics
 * Retrieves agent performance metrics with AI scoring
 */
router.get("/api/reports/agent-performance-metrics", async (req, res) => {
  const { location, supervisor, limit, fromDate, toDate, callType, agent } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT TOP ${limit || 10}
        AgentName,
        AgentLocation,
        AgentSupervisor,
        COUNT(*) AS totalCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgAIScore,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS avgManualScore,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS avgEmpathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS avgQueryHandling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS avgAdherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS avgResolution
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();

    if (fromDate && toDate) {
      query += ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    query += consolidatedReportExtraFilters({ location, supervisor, callType, agent });
    bindReportFilters(request, { location, supervisor, callType, agent });
    
    query += ` 
      GROUP BY AgentName, AgentLocation, AgentSupervisor
      ORDER BY avgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Agent performance metrics fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching agent performance metrics: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching agent performance data." });
  }
});

/**
 * API 10.5.05 - GET /api/reports/call-distribution-by-day
 * Retrieves call distribution by day of the week
 */
router.get("/api/reports/call-distribution-by-day", async (req, res) => {
  const { weeks } = req.query;
  const weeksBack = weeks || 4;
  
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("weeksBack", sql.Int, weeksBack)
      .query(`
        SELECT 
          DATENAME(WEEKDAY, SelectedCallDate) AS dayName,
          DATEPART(WEEKDAY, SelectedCallDate) AS dayNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE SelectedCallDate >= DATEADD(WEEK, -@weeksBack, GETDATE())
          AND Status = 'Success'
        GROUP BY DATENAME(WEEKDAY, SelectedCallDate), DATEPART(WEEKDAY, SelectedCallDate)
        ORDER BY dayNumber
      `);
    
    writeLog(`[${getISTTimeString()}] Call distribution by day fetched for ${weeksBack} weeks`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call distribution by day: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call distribution data." });
  }
});

/**
 * API 10.5.06 - GET /api/reports/agent-handling-summary
 * Retrieves comprehensive agent handling summary for the table
 */
router.get("/api/reports/agent-handling-summary", async (req, res) => {
  const { location, supervisor, fromDate, toDate } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AgentName AS agent,
        AgentLocation,
        AgentSupervisor,
        COUNT(*) AS totalCalls,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes' THEN 1 ELSE 0 END) AS callsWithHold,
        CASE WHEN COUNT(*) > 0
          THEN CAST(
            SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
            AS DECIMAL(10,1))
          ELSE 0 END AS holdRatePct,
        CAST(AVG(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes'
                  AND TRY_CAST(AI_Hold_Total_Sec AS FLOAT) > 0
                 THEN TRY_CAST(AI_Hold_Total_Sec AS FLOAT) END) AS DECIMAL(10,1)) AS avgHoldSec,
        CAST(SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes'
                  THEN TRY_CAST(AI_Hold_Total_Sec AS FLOAT) ELSE 0 END) AS DECIMAL(12,1)) AS totalHoldSec,
        FORMAT(
          DATEADD(SECOND, 
            AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))), 
            0
          ), 
          'mm:ss'
        ) + ' min' AS avgHandlingTime,
        CAST(AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS DECIMAL(10,1)) AS avgAIScore,
        CAST(AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS DECIMAL(10,1)) AS avgManualScore,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS resolutionRate
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY AgentName, AgentLocation, AgentSupervisor
      ORDER BY avgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    // Format the satisfaction rate as percentage
    const formattedData = result.recordset.map(row => ({
      ...row,
      satisfaction: `${Math.round(row.resolutionRate)}%`
    }));
    
    writeLog(`[${getISTTimeString()}] Agent handling summary fetched`);
    return res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching agent handling summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching agent summary data." });
  }
});

/**
 * API 10.5.07 - GET /api/reports/call-volume-trends
 * Retrieves call volume trends over time with comparison
 */
router.get("/api/reports/call-volume-trends", async (req, res) => {
  const { period, callType } = req.query;
  const periodDays = period === 'weekly' ? 7 : period === 'monthly' ? 30 : 90;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS date,
        COUNT(*) AS totalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE SelectedCallDate >= DATEADD(DAY, -@periodDays, GETDATE())
        AND Status = 'Success'
    `;
    
    const request = pool.request().input("periodDays", sql.Int, periodDays);
    
    if (callType && callType !== 'all') {
      query += ` AND CallType = @callType`;
      request.input("callType", sql.NVarChar, callType);
    }
    
    query += ` 
      GROUP BY FORMAT(SelectedCallDate, 'yyyy-MM-dd')
      ORDER BY date DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Call volume trends fetched for ${periodDays} days`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching call volume trends: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call volume trends." });
  }
});

/**
 * API 10.5.08 - GET /api/reports/language-distribution
 * Retrieves call distribution by language
 */
router.get("/api/reports/language-distribution", async (req, res) => {
  const { fromDate, toDate } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AudioLanguage, 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    query += ` GROUP BY AudioLanguage ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Language distribution data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching language distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language distribution data." });
  }
});

/**
 * API 10.5.09 - POST /api/reports/download-inbound
 * Generates and downloads inbound calls report in CSV format
 */
router.post("/api/reports/download-inbound", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AudioFileName,
        AgentName,
        AgentLocation,
        AgentSupervisor,
        SelectedCallDate,
        AudioDuration,
        AudioLanguage,
        AI_Overall_Scoring,
        Manual_Overall_Scoring,
        AI_Resolution_Status,
        AI_Call_Type,
        AI_Feedback
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CallType = 'inbound' 
        AND Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` ORDER BY SelectedCallDate DESC`;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inbound_calls_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Inbound calls report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading inbound report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating inbound report." });
  }
});

/**
 * API 10.5.10 - POST /api/reports/download-outbound
 * Generates and downloads outbound calls report in CSV format
 */
router.post("/api/reports/download-outbound", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AudioFileName,
        AgentName,
        AgentLocation,
        AgentSupervisor,
        SelectedCallDate,
        AudioDuration,
        AudioLanguage,
        AI_Overall_Scoring,
        Manual_Overall_Scoring,
        AI_Resolution_Status,
        AI_Call_Type,
        AI_Lead_Classification,
        AI_Feedback
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CallType = 'outbound' 
        AND Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` ORDER BY SelectedCallDate DESC`;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="outbound_calls_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Outbound calls report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading outbound report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating outbound report." });
  }
});

/**
 * API 10.5.11 - POST /api/reports/download-agentwise
 * Generates and downloads agent-wise performance report in CSV format
 */
router.post("/api/reports/download-agentwise", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.body;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        AgentName,
        AgentID,
        AgentLocation,
        AgentSupervisor,
        AgentManager,
        COUNT(*) AS TotalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS InboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS OutboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS AvgAIScore,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS AvgManualScore,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS AvgEmpathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS AvgQueryHandling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS AvgAdherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS AvgResolution,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS ResolutionRate,
        AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) AS AvgHandlingTimeSeconds
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success' 
        AND AgentName IS NOT NULL
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY AgentName, AgentID, AgentLocation, AgentSupervisor, AgentManager
      ORDER BY AvgAIScore DESC
    `;
    
    const result = await request.query(query);
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="agentwise_performance_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Agent-wise performance report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading agent-wise report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating agent-wise report." });
  }
});

/**
 * API 10.5.12 - POST /api/reports/download-callwise
 * Generates and downloads detailed call-wise report in CSV format
 */
router.post("/api/reports/download-callwise", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType } = req.body;
  
  try {
    const pool = await connectToDatabase();
    const mode = String(req.body.mode || "");
    const isCollectionsDump = mode === "collections";

    let result;
    if (isCollectionsDump) {
      const request = pool.request();
      const extra = [];
      if (location && location !== "All") {
        extra.push(" AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))");
        request.input("location", sql.NVarChar, location);
      }
      if (supervisor && supervisor !== "All") {
        extra.push(" AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))");
        request.input("supervisor", sql.NVarChar, supervisor);
      }
      if (callType && callType !== "all") {
        extra.push(" AND CallType = @callType");
        request.input("callType", sql.NVarChar, callType);
      }
      const hasRange = !!(fromDate && toDate);
      if (hasRange) {
        request.input("fromDate", sql.Date, fromDate);
        request.input("toDate", sql.Date, toDate);
      }
      const query = `
        SELECT
          AudioFileName, CallType, AgentName, AgentID, AgentLocation, AgentSupervisor,
          SelectedCallDate, UploadDate, AudioLanguage, AudioDuration,
          AI_Coll_Score, AI_Coll_Campaign, AI_Coll_Disposition,
          AI_Coll_Fatal_Triggered, AI_Coll_Fatal_Reason,
          AI_Red_Alert, AI_ZTP_Violation,
          AI_PTP_Present, AI_PTP_Genuineness, AI_PTP_Date, AI_PTP_Amount,
          AI_Summary
        FROM [dbo].[Consolidated_Audio_Analysis]
        ${collectionsWhere({ hasRange, extraFilters: extra.join("") })}
        ORDER BY COALESCE(UploadDate, SelectedCallDate) DESC
      `;
      result = await request.query(query);
    } else {
      let query = `
        SELECT 
          AudioFileName,
          CallType,
          AgentName,
          AgentID,
          AgentLocation,
          AgentSupervisor,
          SelectedCallDate,
          UploadDate,
          AudioLanguage,
          AudioDuration,
          AudioWPM,
          AI_Overall_Scoring,
          Manual_Overall_Scoring,
          AI_Opening_Speech,
          AI_Empathy,
          AI_Query_Handling,
          AI_Adherence_to_Protocol,
          AI_Resolution_Assurance,
          AI_Query_Resolution,
          AI_Polite_Tone,
          AI_Authentication_Verification,
          AI_Escalation_Handling,
          AI_Closing_Speech,
          AI_Rude_Behavior,
          AI_Call_Type,
          AI_Lead_Classification,
          AI_Resolution_Status,
          AI_Feedback,
          Manual_Opening_Speech,
          Manual_Empathy,
          Manual_Query_Handling,
          Manual_Adherence_to_Protocol,
          Manual_Resolution_Assurance,
          Manual_Query_Resolution,
          Manual_Polite_Tone,
          Manual_Authentication_Verification,
          Manual_Escalation_Handling,
          Manual_Closing_Speech,
          Manual_Rude_Behavior,
          Manual_Call_Type,
          Manual_Lead_Classification,
          Manual_Resolution_Status,
          Manual_Feedback,
          ManualScoredByUserID,
          AI_Hold_Detected,
          AI_Hold_Count,
          AI_Hold_Total_Sec,
          AI_Hold_Longest_Sec
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;

      const request = pool.request();

      if (fromDate && toDate) {
        query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
        request.input("fromDate", sql.Date, fromDate);
        request.input("toDate", sql.Date, toDate);
      }

      if (location && location !== 'All') {
        query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
        request.input("location", sql.NVarChar, location);
      }

      if (supervisor && supervisor !== 'All') {
        query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
        request.input("supervisor", sql.NVarChar, supervisor);
      }

      if (callType && callType !== 'all') {
        query += ` AND CallType = @callType`;
        request.input("callType", sql.NVarChar, callType);
      }

      query += ` ORDER BY SelectedCallDate DESC`;

      result = await request.query(query);
    }
    
    // Convert to CSV format
    const csvHeaders = Object.keys(result.recordset[0] || {}).join(',');
    const csvRows = result.recordset.map(row => 
      Object.values(row).map(value => 
        typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
      ).join(',')
    );
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="callwise_detailed_report_${new Date().toISOString().split('T')[0]}.csv"`);
    
    writeLog(`[${getISTTimeString()}] Call-wise detailed report downloaded, ${result.recordset.length} records`);
    return res.status(200).send(csvContent);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error downloading call-wise report: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error generating call-wise report." });
  }
});

/**
 * ENHANCED API ENDPOINTS FOR CALL CENTER ANALYTICS
 * Missing filters and optimizations for your Report Dashboard
 */

// ===== 1. ENHANCED CALL VOLUME TRENDS API =====
/**
 * API 10.5.13 - Enhanced Call Volume Trends with Location/Supervisor Filters
 * Your current fetchInboundData() and fetchOutboundData() need this
 */
router.get("/api/reports/call-volume-trends-enhanced", async (req, res) => {
  const { period, callType, fromDate, toDate, location, supervisor } = req.query;
  const periodDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : period === 'monthly' ? 30 : 90;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        CASE 
          WHEN @period = 'daily' THEN FORMAT(SelectedCallDate, 'yyyy-MM-dd')
          WHEN @period = 'weekly' THEN CONCAT('Week ', DATEPART(WEEK, SelectedCallDate))
          ELSE FORMAT(SelectedCallDate, 'yyyy-MM')
        END AS dateLabel,
        FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS date,
        COUNT(*) AS totalCalls,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCalls,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCalls,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request()
      .input("period", sql.NVarChar, period)
      .input("periodDays", sql.Int, periodDays);
    
    // Add date filters
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -@periodDays, GETDATE())`;
    }
    
    // Add location filter (MISSING in original)
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    // Add supervisor filter (MISSING in original)
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    // Add call type filter
    if (callType && callType !== 'all') {
      query += ` AND CallType = @callType`;
      request.input("callType", sql.NVarChar, callType);
    }
    
    query += ` 
      GROUP BY 
        CASE 
          WHEN @period = 'daily' THEN FORMAT(SelectedCallDate, 'yyyy-MM-dd')
          WHEN @period = 'weekly' THEN CONCAT('Week ', DATEPART(WEEK, SelectedCallDate))
          ELSE FORMAT(SelectedCallDate, 'yyyy-MM')
        END,
        FORMAT(SelectedCallDate, 'yyyy-MM-dd')
      ORDER BY date DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced call volume trends fetched: ${result.recordset.length} records`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced call volume trends: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call volume trends." });
  }
});

// ===== 2. ENHANCED CALL DISTRIBUTION WITH FILTERS =====
/**
 * API 10.5.14 - Enhanced Call Distribution with Period Support (Daily/Weekly/Monthly)
 * Supports period-based grouping for smart chart adaptation
 */
router.get("/api/reports/call-distribution-enhanced", async (req, res) => {
  const { period, weeks, location, supervisor, fromDate, toDate } = req.query;
  const weeksBack = weeks || 4;
  
  try {
    const pool = await connectToDatabase();
    let query, orderBy, groupBy;
    
    // Determine query structure based on period
    if (period === 'daily') {
      // Daily breakdown - show each day
      query = `
        SELECT 
          FORMAT(SelectedCallDate, 'yyyy-MM-dd') AS dateLabel,
          FORMAT(SelectedCallDate, 'MMM dd') AS dayName,
          SelectedCallDate AS sortDate,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY SelectedCallDate, FORMAT(SelectedCallDate, 'yyyy-MM-dd'), FORMAT(SelectedCallDate, 'MMM dd')`;
      orderBy = ` ORDER BY sortDate`;
      
    } else if (period === 'weekly') {
      // Weekly breakdown - show each week
      query = `
        SELECT 
          CONCAT('Week ', DATEPART(WEEK, SelectedCallDate)) AS weekLabel,
          CONCAT('Week of ', FORMAT(DATEADD(DAY, 1-DATEPART(WEEKDAY, SelectedCallDate), SelectedCallDate), 'MMM dd')) AS dateLabel,
          DATEPART(WEEK, SelectedCallDate) AS weekNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY DATEPART(WEEK, SelectedCallDate), DATEPART(YEAR, SelectedCallDate)`;
      orderBy = ` ORDER BY DATEPART(YEAR, SelectedCallDate), DATEPART(WEEK, SelectedCallDate)`;
      
    } else if (period === 'monthly') {
      // Monthly breakdown - show each month
      query = `
        SELECT 
          FORMAT(SelectedCallDate, 'MMM yyyy') AS monthLabel,
          FORMAT(SelectedCallDate, 'yyyy-MM') AS dateLabel,
          YEAR(SelectedCallDate) AS year,
          MONTH(SelectedCallDate) AS month,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY YEAR(SelectedCallDate), MONTH(SelectedCallDate), FORMAT(SelectedCallDate, 'MMM yyyy'), FORMAT(SelectedCallDate, 'yyyy-MM')`;
      orderBy = ` ORDER BY year, month`;
      
    } else {
      // Default: Day of week breakdown (backward compatibility)
      query = `
        SELECT 
          DATENAME(WEEKDAY, SelectedCallDate) AS dayName,
          DATEPART(WEEKDAY, SelectedCallDate) AS dayNumber,
          COUNT(*) AS callCount,
          AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
          COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
          COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success'
      `;
      groupBy = ` GROUP BY DATENAME(WEEKDAY, SelectedCallDate), DATEPART(WEEKDAY, SelectedCallDate)`;
      orderBy = ` ORDER BY dayNumber`;
    }
    
    const request = pool.request().input("weeksBack", sql.Int, weeksBack);
    
    // Date range logic
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(WEEK, -@weeksBack, GETDATE())`;
    }
    
    // Location filter
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    // Supervisor filter
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    // Complete the query
    query += groupBy + orderBy;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced call distribution fetched with period: ${period || 'default'}`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced call distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call distribution data." });
  }
});

// ===== 3. MISSING HOURLY BREAKDOWN API =====
/**
 * API 10.5.15 - Hourly Call Distribution (for short date ranges)
 * Your smart adaptation needs this for daily/hourly views
 */
router.get("/api/reports/call-distribution-hourly", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        DATEPART(HOUR, UploadDate) AS hour,
        CONCAT(DATEPART(HOUR, UploadDate), ':00') AS hourLabel,
        COUNT(*) AS callCount,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate = CAST(GETDATE() AS DATE)`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY DATEPART(HOUR, UploadDate)
      ORDER BY hour
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Hourly call distribution fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching hourly distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching hourly data." });
  }
});

// ===== 4. PERFORMANCE COMPARISON API =====
/**
 * API 10.5.16 - Performance Comparison Between Periods
 * For showing growth trends in your dashboard
 */
router.get("/api/reports/performance-comparison", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  const filterParams = { location, supervisor, callType, agent };

  try {
    const pool = await connectToDatabase();

    const currentPeriodDays = Math.ceil((new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24));
    const previousFromDate = new Date(fromDate);
    previousFromDate.setDate(previousFromDate.getDate() - currentPeriodDays);
    const previousToDate = new Date(fromDate);
    previousToDate.setDate(previousToDate.getDate() - 1);

    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate)
      .input("prevFromDate", sql.Date, previousFromDate.toISOString().split("T")[0])
      .input("prevToDate", sql.Date, previousToDate.toISOString().split("T")[0]);

    bindReportFilters(request, filterParams);

    const query = `
      WITH ${buildPerformanceComparisonPeriodCte("CurrentPeriod", "@fromDate", "@toDate", filterParams)},
      ${buildPerformanceComparisonPeriodCte("PreviousPeriod", "@prevFromDate", "@prevToDate", filterParams)}
      SELECT
        cp.totalCalls AS currentCalls,
        pp.totalCalls AS previousCalls,
        CASE
          WHEN pp.totalCalls > 0 THEN ((cp.totalCalls - pp.totalCalls) * 100.0 / pp.totalCalls)
          ELSE 0
        END AS callsGrowth,
        cp.avgScore AS currentScore,
        pp.avgScore AS previousScore,
        CASE
          WHEN pp.avgScore > 0 THEN (cp.avgScore - pp.avgScore)
          ELSE 0
        END AS scoreGrowth,
        cp.resolutionRate AS currentResolution,
        pp.resolutionRate AS previousResolution,
        CASE
          WHEN pp.resolutionRate > 0 THEN (cp.resolutionRate - pp.resolutionRate)
          ELSE 0
        END AS resolutionGrowth
      FROM CurrentPeriod cp
      CROSS JOIN PreviousPeriod pp
    `;

    const result = await request.query(query);

    writeLog(`[${getISTTimeString()}] Performance comparison data fetched`);
    return res.status(200).json({ success: true, data: result.recordset[0] || {} });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching performance comparison: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching comparison data." });
  }
});

// ===== 5. REAL-TIME METRICS API =====
/**
 * API 10.5.17 - Real-time Dashboard Metrics
 * For the hero stats section in your dashboard
 */
router.get("/api/reports/realtime-metrics", async (req, res) => {
  const { location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    
    let query = `
      SELECT 
        COUNT(*) AS totalCallsToday,
        COUNT(DISTINCT AgentName) AS activeAgents,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScoreToday,
        COUNT(CASE WHEN AI_Resolution_Status = 'Resolved' THEN 1 END) * 100.0 / COUNT(*) AS resolutionRateToday,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundToday,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundToday,
        COUNT(CASE WHEN SelectedCallDate = CAST(GETDATE() AS DATE) THEN 1 END) AS callsProcessedToday
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND ${consolidatedReportTodayClause()}
    `;
    
    const request = pool.request();
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Real-time metrics fetched`);
    return res.status(200).json({ success: true, data: result.recordset[0] || {} });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching real-time metrics: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching real-time metrics." });
  }
});

// ===== 6. ENHANCED LANGUAGE DISTRIBUTION WITH FILTERS =====
/**
 * API 10.5.18 - Enhanced Language Distribution with Location/Supervisor Filters
 */
router.get("/api/reports/language-distribution-enhanced", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(AudioLanguage, 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore,
        COUNT(CASE WHEN CallType = 'inbound' THEN 1 END) AS inboundCount,
        COUNT(CASE WHEN CallType = 'outbound' THEN 1 END) AS outboundCount
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` GROUP BY AudioLanguage ORDER BY count DESC`;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Enhanced language distribution data fetched`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching enhanced language distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language distribution data." });
  }
});


/**
 * API 10.5.19 - GET /api/reports/locations
 * Retrieves distinct locations from Consolidated_Audio_Analysis
 */
router.get("/api/reports/locations", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DISTINCT LTRIM(RTRIM(agent_location)) AS location
      FROM [dbo].[Agents]
      WHERE agent_location IS NOT NULL AND LTRIM(RTRIM(agent_location)) != ''
      ORDER BY location
    `;
    const result = await pool.request().query(query);
    
    const locations = result.recordset.map(row => row.location);
    writeLog(`[${getISTTimeString()}] Fetched ${locations.length} distinct locations`);
    return res.status(200).json({ success: true, data: locations });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching locations: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching locations." });
  }
});

/**
 * API 10.5.20 - GET /api/reports/supervisors
 * Retrieves distinct supervisors from Consolidated_Audio_Analysis
 */
router.get("/api/reports/supervisors", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DISTINCT LTRIM(RTRIM(supervisor)) AS supervisor
      FROM [dbo].[Agents]
      WHERE supervisor IS NOT NULL AND LTRIM(RTRIM(supervisor)) != ''
      ORDER BY supervisor
    `;
    const result = await pool.request().query(query);
    
    const supervisors = result.recordset.map(row => row.supervisor);
    writeLog(`[${getISTTimeString()}] Fetched ${supervisors.length} distinct supervisors`);
    return res.status(200).json({ success: true, data: supervisors });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching supervisors: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching supervisors." });
  }
});

/**
 * API 10.5.21 - GET /api/check-login-availability
 * Checks if a new login is allowed based on the license's user limit and active sessions
 */

/**
 * API 10.5.22 - GET /api/reports/language-preferences
 * Retrieves language distribution as preferences with counts
 */
router.get("/api/reports/language-preferences", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        COALESCE(NULLIF(TRIM(AudioLanguage), ''), 'Unknown') AS language,
        COUNT(*) AS count,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
    `;
    
    const request = pool.request();
    
    if (fromDate && toDate) {
      query += ` AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    } else {
      query += ` AND SelectedCallDate >= DATEADD(DAY, -30, GETDATE())`;
    }
    
    if (location && location !== 'All') {
      query += ` AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@supervisor))`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY COALESCE(NULLIF(TRIM(AudioLanguage), ''), 'Unknown')
      ORDER BY count DESC
    `;
    
    const result = await request.query(query);
    
    writeLog(`[${getISTTimeString()}] Language preferences data fetched: ${result.recordset.length} languages`);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching language preferences: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching language preferences." });
  }
});

/**
 * API 10.5.23 - GET /api/reports/call-volume-by-time (FIXED - Column Alias Issue)
 * Retrieves call volume distribution by time periods
 */
router.get("/api/reports/call-volume-by-time", async (req, res) => {
  const { fromDate, toDate, location, supervisor } = req.query;
  
  try {
    const pool = await connectToDatabase();
    
    let query = `
      SELECT 
        TimePeriodCalculated AS timePeriod,
        COUNT(*) AS callCount,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM (
        SELECT 
          CASE 
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 6 AND 11 THEN 'Morning'
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 12 AND 17 THEN 'Afternoon'
            WHEN DATEPART(HOUR, UploadDate) BETWEEN 18 AND 23 THEN 'Evening'
            ELSE 'Night'
          END AS TimePeriodCalculated,
          AI_Overall_Scoring,
          UploadDate,
          AgentLocation,
          AgentSupervisor
        FROM [dbo].[Consolidated_Audio_Analysis]
        WHERE Status = 'Success' 
          AND UploadDate IS NOT NULL
      ) AS TimeData
      WHERE 1=1
    `;
    
    const request = pool.request();
    
    // Add filters to the outer query
    if (fromDate && toDate) {
      query += ` AND CAST(UploadDate AS DATE) BETWEEN @fromDate AND @toDate`;
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
    }
    
    if (location && location !== 'All') {
      query += ` AND AgentLocation = @location`;
      request.input("location", sql.NVarChar, location);
    }
    
    if (supervisor && supervisor !== 'All') {
      query += ` AND AgentSupervisor = @supervisor`;
      request.input("supervisor", sql.NVarChar, supervisor);
    }
    
    query += ` 
      GROUP BY TimePeriodCalculated
      HAVING COUNT(*) > 0
      ORDER BY 
        CASE TimePeriodCalculated
          WHEN 'Morning' THEN 1
          WHEN 'Afternoon' THEN 2
          WHEN 'Evening' THEN 3
          ELSE 4
        END
    `;
    
    console.log(`[${getISTTimeString()}] Executing call volume query with subquery approach`);
    
    const result = await request.query(query);
    
    console.log(`[${getISTTimeString()}] Call volume result:`, result.recordset);
    
    // Always return data structure, even if empty
    let responseData = result.recordset;
    
    // If no data found, return default structure with zero counts
    if (responseData.length === 0) {
      responseData = [
        { timePeriod: 'Morning', callCount: 0, avgScore: 0 },
        { timePeriod: 'Afternoon', callCount: 0, avgScore: 0 },
        { timePeriod: 'Evening', callCount: 0, avgScore: 0 }
      ];
    }
    
    writeLog(`[${getISTTimeString()}] Call volume by time data fetched: ${result.recordset.length} periods`);
    
    return res.status(200).json({ 
      success: true, 
      data: responseData,
      debug: {
        originalCount: result.recordset.length,
        filters: { fromDate, toDate, location, supervisor },
        hasData: result.recordset.length > 0
      }
    });
    
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching call volume by time:`, error);
    writeLog(`[${getISTTimeString()}] Error fetching call volume by time: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: "Server error: " + error.message 
    });
  }
});

/**
 * API — GET /api/reports/rubric-comparison
 * Average AI vs Manual scores across quality dimensions.
 */
router.get("/api/reports/rubric-comparison", async (req, res) => {
  const { fromDate, toDate, location, supervisor, callType, agent } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
  }
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, callType, agent };
    let query = `
      SELECT
        AVG(TRY_CAST(AI_Opening_Speech AS DECIMAL(10,2))) AS ai_opening,
        AVG(TRY_CAST(Manual_Opening_Speech AS DECIMAL(10,2))) AS manual_opening,
        AVG(TRY_CAST(AI_Empathy AS DECIMAL(10,2))) AS ai_empathy,
        AVG(TRY_CAST(Manual_Empathy AS DECIMAL(10,2))) AS manual_empathy,
        AVG(TRY_CAST(AI_Query_Handling AS DECIMAL(10,2))) AS ai_query_handling,
        AVG(TRY_CAST(Manual_Query_Handling AS DECIMAL(10,2))) AS manual_query_handling,
        AVG(TRY_CAST(AI_Adherence_to_Protocol AS DECIMAL(10,2))) AS ai_adherence,
        AVG(TRY_CAST(Manual_Adherence_to_Protocol AS DECIMAL(10,2))) AS manual_adherence,
        AVG(TRY_CAST(AI_Resolution_Assurance AS DECIMAL(10,2))) AS ai_resolution_assurance,
        AVG(TRY_CAST(Manual_Resolution_Assurance AS DECIMAL(10,2))) AS manual_resolution_assurance,
        AVG(TRY_CAST(AI_Query_Resolution AS DECIMAL(10,2))) AS ai_query_resolution,
        AVG(TRY_CAST(Manual_Query_Resolution AS DECIMAL(10,2))) AS manual_query_resolution,
        AVG(TRY_CAST(AI_Polite_Tone AS DECIMAL(10,2))) AS ai_polite_tone,
        AVG(TRY_CAST(Manual_Polite_Tone AS DECIMAL(10,2))) AS manual_polite_tone,
        AVG(TRY_CAST(AI_Closing_Speech AS DECIMAL(10,2))) AS ai_closing,
        AVG(TRY_CAST(Manual_Closing_Speech AS DECIMAL(10,2))) AS manual_closing,
        AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2))) AS ai_overall,
        AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2))) AS manual_overall
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}
    `;
    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate);
    query += consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);
    const result = await request.query(query);
    const row = result.recordset[0] || {};
    const dimensions = [
      { dimension: "Opening", ai: row.ai_opening, manual: row.manual_opening },
      { dimension: "Empathy", ai: row.ai_empathy, manual: row.manual_empathy },
      { dimension: "Query handling", ai: row.ai_query_handling, manual: row.manual_query_handling },
      { dimension: "Protocol adherence", ai: row.ai_adherence, manual: row.manual_adherence },
      { dimension: "Resolution assurance", ai: row.ai_resolution_assurance, manual: row.manual_resolution_assurance },
      { dimension: "Query resolution", ai: row.ai_query_resolution, manual: row.manual_query_resolution },
      { dimension: "Polite tone", ai: row.ai_polite_tone, manual: row.manual_polite_tone },
      { dimension: "Closing", ai: row.ai_closing, manual: row.manual_closing },
      { dimension: "Overall", ai: row.ai_overall, manual: row.manual_overall },
    ].map((d) => ({
      ...d,
      ai: d.ai != null ? Math.round(Number(d.ai) * 10) / 10 : null,
      manual: d.manual != null ? Math.round(Number(d.manual) * 10) / 10 : null,
    }));
    return res.status(200).json({ success: true, data: dimensions });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching rubric comparison: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching rubric comparison." });
  }
});

/**
 * API — GET /api/reports/tone-sentiment-summary
 * Customer tone distribution — Positive / Neutral / Negative per call.
 */
router.get("/api/reports/tone-sentiment-summary", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const params = parseDashboardFilterParams(req.query);
    // Match /api/metrics-overview success definition + dashboard date/filters on AudioUploads.
    let query = `
      SELECT CAA.Sentiment
      FROM [dbo].[AudioUploads] AU
      INNER JOIN [dbo].[AI_Processing_Result] APR ON AU.AudioFileName = APR.AudioFileName
      INNER JOIN [dbo].[Consolidated_Audio_Analysis] CAA ON AU.AudioFileName = CAA.AudioFileName
      WHERE ${dashboardInclusiveDateClause("AU")}
        AND LOWER(COALESCE(APR.Status, '')) = 'success'
        AND COALESCE(APR.TranscribeOutput, '') NOT LIKE '%MVP Phase 1 stub%'
        AND NULLIF(LTRIM(RTRIM(CAA.Sentiment)), '') IS NOT NULL
    `;
    query += dashboardAudioUploadExtraFilters(params, "AU");

    const result = await bindDashboardFilters(pool.request(), params).query(query);
    const summary = aggregateCustomerSentimentSummary(result.recordset || []);

    return res.status(200).json({
      success: true,
      data: summary.data,
      meta: { totalCalls: summary.totalCalls },
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching tone-sentiment summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching sentiment summary." });
  }
});

/**
 * API — GET /api/reports/lead-classification
 * Outbound lead classification breakdown.
 */
router.get("/api/reports/lead-classification", async (req, res) => {
  const { fromDate, toDate, location, supervisor, agent } = req.query;
  if (!fromDate || !toDate) {
    return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
  }
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, agent };
    let query = `
      SELECT
        COALESCE(NULLIF(LTRIM(RTRIM(AI_Lead_Classification)), ''), 'Unclassified') AS label,
        COUNT(*) AS count
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE Status = 'Success'
        AND LOWER(LTRIM(RTRIM(CallType))) = 'outbound'
        AND ${consolidatedReportDateBetween('@fromDate', '@toDate')}
    `;
    const request = pool.request()
      .input("fromDate", sql.Date, fromDate)
      .input("toDate", sql.Date, toDate);
    query += consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);
    query += ` GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Lead_Classification)), ''), 'Unclassified') ORDER BY count DESC`;
    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching lead classification: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching lead classification." });
  }
});
/**
 * GET /api/reports/query-type-distribution
 * Counts of calls per primary customer query category.
 */
router.get("/api/reports/query-type-distribution", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    let query = `
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(caa.AI_Primary_Query_Type)), ''), 'Unclassified') AS label,
             COUNT(*) AS count,
             MAX(qc.Color) AS color
      FROM [dbo].[Consolidated_Audio_Analysis] caa
      LEFT JOIN [dbo].[AI_Query_Categories] qc ON qc.Name = caa.AI_Primary_Query_Type
      WHERE caa.Status = 'Success'
    `;
    query += intelDateClause(request, fromDate, toDate);
    query += consolidatedReportExtraFilters(params, "caa");
    bindReportFilters(request, params);
    query += ` GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(caa.AI_Primary_Query_Type)), ''), 'Unclassified') ORDER BY count DESC`;
    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: [] });
    }
    writeLog(`[${getISTTimeString()}] Error fetching query-type distribution: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching query-type distribution." });
  }
});

/**
 * GET /api/reports/escalation-summary
 * Escalation counts: requested, actioned vs not, and breakdown by category.
 */
router.get("/api/reports/escalation-summary", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    const dateClause = intelDateClause(request, fromDate, toDate);
    const extra = consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);

    const baseWhere = ` FROM [dbo].[Consolidated_Audio_Analysis] WHERE Status = 'Success'` + dateClause + extra;

    const query = `
      SELECT
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes' THEN 1 ELSE 0 END) AS requested,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes'
                  AND LOWER(LTRIM(RTRIM(AI_Escalation_Actioned))) = 'yes' THEN 1 ELSE 0 END) AS actioned,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Escalation_Requested))) = 'yes'
                  AND LOWER(LTRIM(RTRIM(AI_Escalation_Actioned))) <> 'yes' THEN 1 ELSE 0 END) AS notActioned,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_CSAT_Transferred))) = 'yes' THEN 1 ELSE 0 END) AS csatTransferred,
        COUNT(*) AS total
      ${baseWhere};
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Escalation_Category)), ''), 'None') AS label, COUNT(*) AS count
      ${baseWhere}
        AND LOWER(LTRIM(RTRIM(AI_Escalation_Category))) <> 'none'
        AND AI_Escalation_Category IS NOT NULL
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Escalation_Category)), ''), 'None')
      ORDER BY count DESC;
    `;
    const result = await request.query(query);
    const totals = (result.recordsets[0] && result.recordsets[0][0]) || { requested: 0, actioned: 0, notActioned: 0, csatTransferred: 0, total: 0 };
    const byCategory = result.recordsets[1] || [];
    return res.status(200).json({ success: true, data: { totals, byCategory } });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: { totals: { requested: 0, actioned: 0, notActioned: 0, csatTransferred: 0, total: 0 }, byCategory: [] } });
    }
    writeLog(`[${getISTTimeString()}] Error fetching escalation summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching escalation summary." });
  }
});

/**
 * GET /api/reports/loan-leads
 * Loan/lead funnel: counts by loan type & interest, EMI affordability, avg
 * success probability and total committed loan/EMI amounts.
 */
router.get("/api/reports/loan-leads", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    const dateClause = intelDateClause(request, fromDate, toDate);
    const extra = consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);

    const loanWhere = ` FROM [dbo].[Consolidated_Audio_Analysis] WHERE Status = 'Success'`
      + dateClause + extra
      + ` AND LOWER(LTRIM(RTRIM(AI_Loan_Is_Loan_Call))) = 'yes'`;

    const query = `
      SELECT
        COUNT(*) AS loanCalls,
        AVG(TRY_CAST(AI_Loan_Success_Probability AS DECIMAL(10,2))) AS avgSuccessProbability,
        SUM(TRY_CAST(AI_EMI_Amount AS DECIMAL(18,2))) AS totalEmiAmount,
        SUM(TRY_CAST(AI_Loan_Amount AS DECIMAL(18,2))) AS totalLoanAmount,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_EMI_Affordability))) = 'yes' THEN 1 ELSE 0 END) AS emiAffordableYes,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_EMI_Affordability))) = 'no' THEN 1 ELSE 0 END) AS emiAffordableNo,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'high' THEN 1 ELSE 0 END) AS interestHigh,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'medium' THEN 1 ELSE 0 END) AS interestMedium,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Loan_Interest))) = 'low' THEN 1 ELSE 0 END) AS interestLow
      ${loanWhere};
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Loan_Type)), ''), 'Other Loan') AS label, COUNT(*) AS count,
             AVG(TRY_CAST(AI_Loan_Success_Probability AS DECIMAL(10,2))) AS avgProbability
      ${loanWhere}
        AND LOWER(LTRIM(RTRIM(AI_Loan_Type))) <> 'none'
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Loan_Type)), ''), 'Other Loan')
      ORDER BY count DESC;
    `;
    const result = await request.query(query);
    const totals = (result.recordsets[0] && result.recordsets[0][0]) || {};
    const byLoanType = result.recordsets[1] || [];
    return res.status(200).json({ success: true, data: { totals, byLoanType } });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, data: { totals: {}, byLoanType: [] } });
    }
    writeLog(`[${getISTTimeString()}] Error fetching loan leads: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching loan leads." });
  }
});

/**
 * GET /api/reports/hold-summary
 * Agent hold-time KPIs: calls with hold, total/avg/longest duration, episode counts.
 */
router.get("/api/reports/hold-summary", async (req, res) => {
  const { fromDate, toDate, location, supervisor, tl, callType, agent } = req.query;
  try {
    const pool = await connectToDatabase();
    const params = { location, supervisor, tl, callType, agent };
    const request = pool.request();
    const dateClause = intelDateClause(request, fromDate, toDate);
    const extra = consolidatedReportExtraFilters(params);
    bindReportFilters(request, params);

    const baseWhere = ` FROM [dbo].[Consolidated_Audio_Analysis] WHERE Status = 'Success'` + dateClause + extra;

    const query = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes' THEN 1 ELSE 0 END) AS withHold,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes'
                  THEN TRY_CAST(AI_Hold_Count AS INT) ELSE 0 END) AS totalHoldEvents,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes'
                  THEN TRY_CAST(AI_Hold_Total_Sec AS FLOAT) ELSE 0 END) AS totalHoldSec,
        AVG(CASE WHEN LOWER(LTRIM(RTRIM(AI_Hold_Detected))) = 'yes'
                  AND TRY_CAST(AI_Hold_Total_Sec AS FLOAT) > 0
                 THEN TRY_CAST(AI_Hold_Total_Sec AS FLOAT) END) AS avgHoldSec,
        MAX(TRY_CAST(AI_Hold_Longest_Sec AS FLOAT)) AS longestHoldSec
      ${baseWhere};
    `;
    const result = await request.query(query);
    const totals = (result.recordset && result.recordset[0]) || {
      total: 0, withHold: 0, totalHoldEvents: 0, totalHoldSec: 0, avgHoldSec: 0, longestHoldSec: 0,
    };
    return res.status(200).json({ success: true, data: { totals } });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({
        success: true,
        data: {
          totals: { total: 0, withHold: 0, totalHoldEvents: 0, totalHoldSec: 0, avgHoldSec: 0, longestHoldSec: 0 },
        },
      });
    }
    writeLog(`[${getISTTimeString()}] Error fetching hold summary: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching hold summary." });
  }
});
};
