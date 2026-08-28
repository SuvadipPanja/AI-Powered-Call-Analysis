/**
 * Audio result, profile, login availability, system monitor (Sprint 3.1 split).
 */
module.exports = function registerMiscRoutes(router, deps, H) {
  const {
    sql,
    sqlConnect,
    connectToDatabase,
    writeLog,
    getISTTimeString,
    config,
    assertSelfOrElevated,
    uploadProfilePic,
    profilePicsDir,
    findProfilePictureFile,
    normalizeToneResults,
    enrichToneAnalysisPayload,
    validator,
    si,
  } = deps;
  const {
    mapScoringFields, mapCollectionsScoring, COLLECTIONS_AI_COLUMNS, isMissingDbObjectError,
    manualScoringFromCallAudit, mergeManualScoringFromConsolidated,
    consolidatedReportDateBetween, consolidatedReportExtraFilters, bindReportFilters, pickReportFilterParams,
  } = H;
  const fs = require("fs");
  const path = require("path");
  const { toHostMemoryMetrics } = require("../services/hostMemory");
  const { requireRolesOrAccess } = require("../services/buddyPermissions");
  const { getEffectiveRubric } = require("../services/rubricService");
  const { buildIcicQualityReportBuffer } = require("../services/collectionsReport");
  const cacheService = require("../services/cacheService");
  const {
    TTL_SEC: QUALITY_CACHE_TTL_SEC,
    buildQualityCacheKey,
    shouldStoreWorkbook,
    takeQualityBuild,
    rememberQualityBuild,
  } = require("../services/qualityReportCache");
  const { fetchQualityWorkbookRows } = require("../services/qualityWorkbookData");
  const { collectionsDateClause, collectionsLanguageMixSelect } = require("../services/collectionsReportScope");
  const dashboardDrilldown = require("../services/dashboardDrilldown");
  const { ptpQualitySql } = require("../services/ptpQuality");
  const { getUploadQueueMetrics } = require("../services/uploadQueue");
  const {
    ACTIVE_RUN_STATUS,
    resolveCapacityRunStatus,
    resolveCapacityCompletionSeconds,
  } = require("../services/capacityExportHelpers");

  const requireSystemMonitorAccess = requireRolesOrAccess(connectToDatabase, {
    roles: ["Super Admin", "Admin"],
    pages: ["settings.system"],
    message: "Only Admin/Super Admin can view system monitoring.",
  });

  // Collections CRM feed (Phase 5) — disposition/remarks/reason-for-delay ingest.
  const requireCollectionsCrmAccess = requireRolesOrAccess(connectToDatabase, {
    roles: ["Super Admin", "Admin", "Manager"],
    pages: ["settings.system"],
    message: "Only Admin/Super Admin/Manager can feed collections CRM documentation.",
  });

  // Collections aggregate dashboard — any privileged reviewer who can see the
  // dashboard/reports may read the tenant-scoped KPI tiles.
  const requireCollectionsDashboardAccess = requireRolesOrAccess(connectToDatabase, {
    roles: ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor"],
    pages: ["dashboard", "reports"],
    message: "You do not have access to the collections dashboard.",
  });

/**
 * API 10.35.33 - GET /api/tone-analysis/:audioFileName
 * Retrieves tone analysis for a specific audio file
 */
router.get('/api/tone-analysis/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ToneAnalysis
          FROM Consolidated_Audio_Analysis
          WHERE LOWER(AudioFileName) = LOWER(@filename)
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        toneAnalysis: {
          status: 'pending',
          results: {
            Agent: {},
            Customer: {},
            Overall_Tone: { Agent: 'N/A', Customer: 'N/A' },
          },
        },
      });
    }
    if (result.recordset.length === 0) {
      console.warn(`[Tone Analysis] No record found for filename: ${filename}`);
      return res.status(404).json({ success: false, message: 'Tone analysis not found.' });
    }

    const rawToneAnalysis = result.recordset[0].ToneAnalysis;
    //console.log(`[Tone Analysis] Raw string data for ${req.params.filename}:`, rawToneAnalysis);

    // Clean and convert single-quoted string to double-quoted JSON
    let cleanedData = rawToneAnalysis;
    if (typeof cleanedData === 'string') {
      cleanedData = cleanedData.trim();
      // Replace single quotes with double quotes, ensuring valid JSON
      cleanedData = cleanedData.replace(/'/g, '"');
      // Handle nested single quotes within values (e.g., 'Medium' -> "Medium")
      cleanedData = cleanedData.replace(/": '(.*?)'/g, '": "$1"');
      //console.log(`[Tone Analysis] Cleaned data for ${req.params.filename}:`, cleanedData);

      try {
        cleanedData = JSON.parse(cleanedData);
      } catch (parseError) {
        console.error(`[Tone Analysis] Parsing error for ${req.params.filename}:`, parseError.message, 'Cleaned data:', cleanedData);
        return res.status(500).json({ success: false, message: 'Invalid tone analysis data format after cleaning.' });
      }
    } else if (!cleanedData) {
      console.warn(`[Tone Analysis] NULL or undefined data for ${req.params.filename}`);
      cleanedData = {};
    }

    // Preserve emotion fields; add overallEmotion / overallEnergy helpers for UI.
    const toneAnalysis = typeof enrichToneAnalysisPayload === 'function'
      ? enrichToneAnalysisPayload(cleanedData)
      : {
          status: cleanedData.status || 'success',
          results: normalizeToneResults(
            cleanedData.results || {
              Agent: cleanedData.Agent || {},
              Customer: cleanedData.Customer || {},
              Overall_Tone: cleanedData.Overall_Tone || { Agent: 'N/A', Customer: 'N/A' },
            }
          ),
        };

    res.status(200).json({ success: true, toneAnalysis });
  } catch (error) {
    console.error('Error fetching tone analysis:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.36.34 - GET /api/audio-upload-details/:audioFileName
 * Retrieves upload details for a specific audio file
 */
router.get("/api/audio-upload-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioFileName, SelectedAgent AS AgentName, CallType,
               CONVERT(VARCHAR(10), UploadDate, 120) AS UploadDate,
               ProcessStatus AS Status
        FROM dbo.AudioUploads
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Audio file details not found." });
    }
    return res.status(200).json({ success: true, audioUploadDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching audio upload details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.260 - GET /api/ai-processing-details/:audioFileName
 * Retrieves AI processing details for a specific audio file
 */
router.get("/api/ai-processing-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioLanguage, AudioDuration, TranscribeOutput,
               TranslateOutput, ToneAnalysis, Sentiment
        FROM dbo.AI_Processing_Result
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "AI processing details not found." });
    }
    return res.status(200).json({ success: true, aiProcessingDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching AI processing details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.261 - GET /api/custom-scoring-details/:audioFileName
 * Retrieves custom scoring details for an audio file (excluding summary)
 */
router.get('/api/custom-scoring-details/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AIScoring, AI_Opening_Speech, AI_Empathy, AI_Query_Handling, AI_Adherence_to_Protocol,
                 AI_Resolution_Assurance, AI_Query_Resolution, AI_Polite_Tone, AI_Authentication_Verification,
                 AI_Escalation_Handling, AI_Closing_Speech, AI_Rude_Behavior, AI_Overall_Scoring,
                 AI_Call_Type, AI_Lead_Classification, AI_Resolution_Status, AI_Feedback,
                 ManualScoring, Manual_Opening_Speech, Manual_Empathy, Manual_Query_Handling,
                 Manual_Adherence_to_Protocol, Manual_Resolution_Assurance, Manual_Query_Resolution,
                 Manual_Polite_Tone, Manual_Authentication_Verification, Manual_Escalation_Handling,
                 Manual_Closing_Speech, Manual_Rude_Behavior, Manual_Overall_Scoring,
                 Manual_Call_Type, Manual_Lead_Classification, Manual_Resolution_Status, Manual_Feedback
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        aiScoring: {},
        manualScoring: {},
        message: 'Scoring will be available after Phase 2b is enabled.',
      });
    }
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Scoring data not found.' });
    }
    const record = result.recordset[0];
    let manualScoring = mapScoringFields(record, 'Manual');

    try {
      const auditResult = await pool.request()
        .input('fileName', sql.NVarChar, filename)
        .query(`
          SELECT TOP 1 AuditID, OverallManualScore, OverallComments
          FROM dbo.CallAudits
          WHERE AudioFileName = @fileName
          ORDER BY COALESCE(UpdatedAt, CreatedAt) DESC
        `);
      if (auditResult.recordset.length > 0) {
        const audit = auditResult.recordset[0];
        const scoresResult = await pool.request()
          .input('auditId', sql.Int, audit.AuditID)
          .query(`
            SELECT ParameterName, ManualScore
            FROM dbo.CallAuditScores
            WHERE AuditID = @auditId
          `);
        const fromAudit = manualScoringFromCallAudit(audit, scoresResult.recordset || []);
        manualScoring = mergeManualScoringFromConsolidated(manualScoring, fromAudit);
      }
    } catch (auditErr) {
      console.warn('CallAudits merge skipped for custom-scoring-details:', auditErr.message);
    }

    const bankingAiScoring = mapScoringFields(record, 'AI');
    let aiScoring = bankingAiScoring;

    // Collections AQM (ICIC-style) enrichment — best-effort and fully isolated so
    // a banking install (columns absent / no collections row) is never affected.
    let collections = null;
    try {
      const collResult = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ${COLLECTIONS_AI_COLUMNS.map((c) => `[${c}]`).join(', ')}
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
      const mapped = mapCollectionsScoring(collResult.recordset[0]);
      if (mapped) {
        // Collections call: present ONLY the collections dimensions (plus overall,
        // feedback and call type) so empty banking rows never appear on the table.
        aiScoring = {
          'Overall Scoring': bankingAiScoring['Overall Scoring'],
          ...mapped.dims,
          'Call Type': bankingAiScoring['Call Type'],
          Feedback: bankingAiScoring.Feedback,
        };
        collections = { ...mapped.insights, statuses: mapped.statuses };
      }
    } catch (collErr) {
      // Columns not present on this install (pre-collections DB) — skip silently.
      if (!isMissingDbObjectError(collErr)) {
        console.warn('collections scoring enrichment skipped:', collErr.message);
      }
    }

    res.status(200).json({
      success: true,
      aiScoring,
      manualScoring,
      collections,
    });
  } catch (error) {
    console.error('Error fetching scoring details:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * Collections AQM — CRM documentation feed (Phase 5).
 * POST /api/collections/crm-documentation
 * Body: { items: [{ audioFileName, disposition, remarks, reasonForDelay }] }
 *
 * Feeds the two CRM-fed rubric dimensions (Blank Documentation, Reason for Delay)
 * that the AI intentionally scores NA from audio alone. Once fed:
 *   - disposition + remarks present  -> Documentation Pass, else Fail
 *   - reasonForDelay present         -> Reason for Delay Pass, else stays NA
 * and, for NON-fatal calls, the collections weighted overall is recomputed to
 * include the now-fed dimensions (fatal / red-alert calls are left untouched so
 * the auto-zero stands). Fully additive + best-effort: a banking install or a
 * not-yet-migrated DB (columns absent) skips silently and never errors.
 */
router.post('/api/collections/crm-documentation', requireCollectionsCrmAccess, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'items[] is required.' });
  }
  if (items.length > 5000) {
    return res.status(400).json({ success: false, message: 'Too many items (max 5000 per request).' });
  }
  const clip = (v, n) => (v == null ? '' : String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, n).trim());

  let pool;
  try {
    pool = await sqlConnect();
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Database unavailable.' });
  }

  // Rubric weights for the non-fatal overall recompute (fail-open to empty).
  let weightByKey = {};
  try {
    const rubricService = require('../services/rubricService');
    const eff = await rubricService.getEffectiveRubric(pool);
    weightByKey = Object.fromEntries((eff || []).map((d) => [d.key, Number(d.weight) || 0]));
  } catch { /* recompute will be skipped if weights unavailable */ }

  // dim key -> AI column (for weighted recompute).
  const KEY_TO_COL = {
    'Self Introduction': 'AI_Coll_Self_Introduction',
    'Recording Disclaimer': 'AI_Coll_Recording_Disclaimer',
    'RPC Verification': 'AI_Coll_RPC_Verification',
    'Sentiment Analysis': 'AI_Coll_Sentiment_Analysis',
    'Politeness and Empathy': 'AI_Coll_Politeness_Empathy',
    'PTP Success Rate': 'AI_Coll_PTP_Success_Rate',
    'Payment Confirmation': 'AI_Coll_Payment_Confirmation',
    'Negotiation Quality': 'AI_Coll_Negotiation_Quality',
    'Reason for Delay': 'AI_Coll_Reason_For_Delay',
    'Agent Tone and Clarity': 'AI_Coll_Agent_Tone_Clarity',
    'Rude and Unprofessional': 'AI_Coll_Rude_Unprofessional',
    'Telephone Etiquette': 'AI_Coll_Telephone_Etiquette',
    'Unusual Patterns': 'AI_Coll_Unusual_Patterns',
    'Blank Documentation': 'AI_Coll_Blank_Documentation',
  };

  let updated = 0;
  let notFound = 0;
  const errors = [];
  let columnsMissing = false;

  for (const raw of items) {
    const audioFileName = clip(raw?.audioFileName, 400);
    if (!audioFileName) { errors.push('Skipped a row with no audioFileName.'); continue; }
    const disposition = clip(raw?.disposition, 200);
    const remarks = clip(raw?.remarks, 4000);
    const reasonForDelay = clip(raw?.reasonForDelay, 300);

    const complete = disposition !== '' && remarks !== '';
    const docStatus = complete ? 'Pass' : 'Fail';
    const docScore = complete ? 100 : 0;
    const rfdPresent = reasonForDelay !== '';
    const rfdStatus = rfdPresent ? 'Pass' : 'NA';
    const rfdScore = rfdPresent ? 100 : null;

    try {
      const upd = await pool.request()
        .input('fn', sql.NVarChar, audioFileName)
        .input('disp', sql.NVarChar, disposition)
        .input('rem', sql.NVarChar, remarks)
        .input('blank', sql.NVarChar, complete ? 'No' : 'Yes')
        .input('docScore', sql.Float, docScore)
        .input('docStatus', sql.NVarChar, docStatus)
        .input('rfd', sql.NVarChar, reasonForDelay)
        .input('rfdScore', sql.Float, rfdScore)
        .input('rfdStatus', sql.NVarChar, rfdStatus)
        .query(`
          UPDATE Consolidated_Audio_Analysis
          SET AI_Doc_Disposition = @disp,
              AI_Doc_Remarks = @rem,
              AI_Doc_Blank = @blank,
              AI_Coll_Blank_Documentation = @docScore,
              AI_Coll_Blank_Documentation_Status = @docStatus,
              AI_Coll_Reason_For_Delay = @rfdScore,
              AI_Coll_Reason_For_Delay_Status = @rfdStatus,
              AI_PTP_Reason_For_Delay = CASE WHEN @rfd = '' THEN AI_PTP_Reason_For_Delay ELSE @rfd END
          WHERE AudioFileName = @fn
        `);
      if (!upd.rowsAffected || upd.rowsAffected[0] === 0) { notFound += 1; continue; }
      updated += 1;

      // Non-fatal weighted overall recompute (include the now-fed dims).
      if (Object.keys(weightByKey).length > 0) {
        try {
          const cur = await pool.request()
            .input('fn', sql.NVarChar, audioFileName)
            .query(`
              SELECT AI_Coll_Fatal_Triggered, AI_Red_Alert,
                     ${Object.values(KEY_TO_COL).map((c) => `[${c}], [${c}_Status]`).join(', ')}
              FROM Consolidated_Audio_Analysis WHERE AudioFileName = @fn
            `);
          const row = cur.recordset[0];
          const fatal = /^(yes|true|1)$/i.test(String(row?.AI_Coll_Fatal_Triggered || ''));
          const red = /^(yes|true|1)$/i.test(String(row?.AI_Red_Alert || ''));
          if (row && !fatal && !red) {
            let acc = 0;
            let wsum = 0;
            for (const [key, col] of Object.entries(KEY_TO_COL)) {
              const st = String(row[`${col}_Status`] || '').toUpperCase();
              if (st === 'NA') continue;
              const score = row[col];
              if (score == null) continue;
              const w = weightByKey[key] || 0;
              if (w <= 0) continue;
              acc += Math.max(0, Math.min(100, Number(score))) * w;
              wsum += w;
            }
            if (wsum > 0) {
              const overall = Math.round((acc / wsum) * 10) / 10;
              await pool.request()
                .input('fn', sql.NVarChar, audioFileName)
                .input('ov', sql.Float, overall)
                .query(`
                  UPDATE Consolidated_Audio_Analysis
                  SET AI_Coll_Score = @ov, AI_Overall_Scoring = @ov
                  WHERE AudioFileName = @fn
                `);
            }
          }
        } catch (recErr) {
          if (!isMissingDbObjectError(recErr)) console.warn('crm overall recompute skipped:', recErr.message);
        }
      }
    } catch (err) {
      if (isMissingDbObjectError(err)) { columnsMissing = true; break; }
      errors.push(`${audioFileName}: ${err.message}`);
    }
  }

  if (columnsMissing) {
    return res.status(409).json({
      success: false,
      message: 'Collections columns are not present on this database. Activate a collections profile / run migrations first.',
    });
  }

  return res.status(200).json({
    success: true,
    updated,
    notFound,
    errors: errors.slice(0, 50),
  });
});

/**
 * Collections AQM — aggregate dashboard tiles (tenant-scoped).
 * GET /api/collections/dashboard?fromDate=&toDate=&location=&tl=&agent=
 *
 * Aggregates the collections-only signals on Consolidated_Audio_Analysis
 * (rows where AI_Coll_Score IS NOT NULL) into the tiles the ICIC HFC quality
 * report is built around: audited volume, avg quality, fatal / red-alert / ZTP
 * counts, PTP conversion, RAG grade split (R<80 / A 80–84.99 / G>=85) and the
 * disposition + campaign mix. Fully additive + best-effort: a banking install or
 * a not-yet-migrated DB returns an empty (but successful) payload so the frontend
 * simply renders nothing — it never errors and never affects the banking path.
 */
router.get('/api/collections/dashboard', requireCollectionsDashboardAccess, async (req, res) => {
  const empty = {
    success: true,
    available: false,
    kpis: {
      totalAudited: 0, avgQuality: null, fatalCount: 0, redAlertCount: 0,
      ztpCount: 0, ptpCount: 0, ptpStrongCount: 0, ptpWeakCount: 0, ptpRate: null,
      rag: { red: 0, amber: 0, green: 0 },
    },
    dispositionMix: [],
    campaignMix: [],
    languageMix: [],
    drilldowns: {},
  };
  let pool;
  try {
    pool = await sqlConnect();
  } catch (err) {
    return res.status(200).json(empty);
  }

  let { fromDate, toDate } = req.query;
  const hasRange = !!(fromDate && toDate);
  if (!hasRange) {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    fromDate = start.toISOString().slice(0, 10);
    toDate = today.toISOString().slice(0, 10);
  }
  const params = pickReportFilterParams(req.query);
  const dateClause = collectionsDateClause({ hasRange });
  const extra = consolidatedReportExtraFilters(params);
  const where = `WHERE AI_Coll_Score IS NOT NULL AND ${dateClause}${extra}`;

  const buildReq = () => {
    const r = pool.request();
    if (hasRange) {
      r.input('fromDate', sql.Date, fromDate);
      r.input('toDate', sql.Date, toDate);
    }
    bindReportFilters(r, params);
    return r;
  };

  try {
    const kpiRes = await buildReq().query(`
      SELECT
        COUNT(*) AS totalAudited,
        AVG(CAST(AI_Coll_Score AS FLOAT)) AS avgQuality,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(AI_Coll_Fatal_Triggered, '')))) = 'yes' THEN 1 ELSE 0 END) AS fatalCount,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(AI_Red_Alert, '')))) = 'yes' THEN 1 ELSE 0 END) AS redAlertCount,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(AI_ZTP_Violation, '')))) = 'yes' THEN 1 ELSE 0 END) AS ztpCount,
        SUM(CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(AI_PTP_Present, '')))) = 'yes' THEN 1 ELSE 0 END) AS ptpCount,
        SUM(CASE WHEN ${ptpQualitySql("", "strong")} THEN 1 ELSE 0 END) AS ptpStrongCount,
        SUM(CASE WHEN ${ptpQualitySql("", "weak")} THEN 1 ELSE 0 END) AS ptpWeakCount,
        SUM(CASE WHEN AI_Coll_Score >= 85 THEN 1 ELSE 0 END) AS ragGreen,
        SUM(CASE WHEN AI_Coll_Score >= 80 AND AI_Coll_Score < 85 THEN 1 ELSE 0 END) AS ragAmber,
        SUM(CASE WHEN AI_Coll_Score < 80 THEN 1 ELSE 0 END) AS ragRed
      FROM Consolidated_Audio_Analysis
      ${where}
    `);
    const row = kpiRes.recordset[0] || {};
    const total = Number(row.totalAudited) || 0;

    const dispRes = await buildReq().query(`
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Disposition)), ''), 'Unknown') AS name, COUNT(*) AS count
      FROM Consolidated_Audio_Analysis
      ${where}
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Disposition)), ''), 'Unknown')
      ORDER BY count DESC
    `);
    const campRes = await buildReq().query(`
      SELECT COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Campaign)), ''), 'Unknown') AS name, COUNT(*) AS count
      FROM Consolidated_Audio_Analysis
      ${where}
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Campaign)), ''), 'Unknown')
      ORDER BY count DESC
    `);
    const langRes = await buildReq().query(`
      SELECT ${collectionsLanguageMixSelect()}
      FROM Consolidated_Audio_Analysis
      ${where}
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AudioLanguage)), ''), 'Unknown')
      ORDER BY count DESC
    `);

    const mapMix = (rs) => (rs.recordset || [])
      .map((r) => ({ name: (r.name == null || String(r.name).trim() === '') ? 'Unknown' : String(r.name).trim(), count: Number(r.count) || 0 }))
      .filter((r) => r.count > 0);
    const dispositionMix = mapMix(dispRes);
    const campaignMix = mapMix(campRes);
    const tokenBase = {
      filters: { fromDate, toDate, ...params },
      username: req.user.username,
      tenant: await dashboardDrilldown.currentTenantKey(pool),
    };
    const token = (key, expectedCount, value, excludedValues) => dashboardDrilldown.issueToken({
      ...tokenBase,
      kind: 'collections',
      key,
      value,
      excludedValues,
      expectedCount,
    });
    const withTokens = (rows, kind) => {
      if (rows.length <= 8) {
        return rows.map((item) => ({
          ...item,
          drilldownToken: token(kind, item.count, item.name),
        }));
      }
      const visible = rows.slice(0, 7);
      const hidden = rows.slice(7);
      const hiddenCount = hidden.reduce((sum, item) => sum + item.count, 0);
      return [
        ...visible.map((item) => ({
          ...item,
          drilldownToken: token(kind, item.count, item.name),
        })),
        {
          name: 'Other categories',
          count: hiddenCount,
          drilldownToken: token(`${kind}-other`, hiddenCount, null, visible.map((item) => item.name)),
        },
      ];
    };
    const drilldowns = {
      audited: token('audited', total),
      ptp: token('ptp', Number(row.ptpCount) || 0),
      ptpStrong: token("ptp-strong", Number(row.ptpStrongCount) || 0),
      ptpWeak: token("ptp-weak", Number(row.ptpWeakCount) || 0),
      fatal: token('fatal', Number(row.fatalCount) || 0),
      redAlert: token('red-alert', Number(row.redAlertCount) || 0),
      ztp: token('ztp', Number(row.ztpCount) || 0),
      rag: {
        green: token('rag-green', Number(row.ragGreen) || 0),
        amber: token('rag-amber', Number(row.ragAmber) || 0),
        red: token('rag-red', Number(row.ragRed) || 0),
      },
    };

    return res.status(200).json({
      success: true,
      available: total > 0,
      kpis: {
        totalAudited: total,
        avgQuality: row.avgQuality != null ? Math.round(Number(row.avgQuality) * 10) / 10 : null,
        fatalCount: Number(row.fatalCount) || 0,
        redAlertCount: Number(row.redAlertCount) || 0,
        ztpCount: Number(row.ztpCount) || 0,
        ptpCount: Number(row.ptpCount) || 0,
        ptpStrongCount: Number(row.ptpStrongCount) || 0,
        ptpWeakCount: Number(row.ptpWeakCount) || 0,
        ptpRate: total > 0 ? Math.round((Number(row.ptpCount) / total) * 1000) / 10 : null,
        rag: {
          red: Number(row.ragRed) || 0,
          amber: Number(row.ragAmber) || 0,
          green: Number(row.ragGreen) || 0,
        },
      },
      dispositionMix: withTokens(dispositionMix, 'disposition'),
      campaignMix: withTokens(campaignMix, 'campaign'),
      languageMix: mapMix(langRes),
      drilldowns,
    });
  } catch (err) {
    if (isMissingDbObjectError(err)) {
      return res.status(200).json(empty); // columns not migrated / banking install
    }
    console.error('Error in /api/collections/dashboard:', err.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

/**
 * GET /api/collections/quality-report?fromDate=&toDate=&location=&tl=&agent=
 *
 * Streams the ICICI HFC-format multi-sheet quality workbook (.xlsx) built from
 * this system's AI-scored collections calls. Tenant-scoped: only rows where
 * AI_Coll_Score IS NOT NULL are included, so a banking install returns 409
 * (nothing to report) and never leaks another tenant's data. Rubric-driven —
 * the per-call Audit Sheet + Pareto columns follow the active audit rubric.
 */
router.get('/api/collections/quality-report', requireCollectionsDashboardAccess, async (req, res) => {
  const { fromDate, toDate } = req.query;
  const hasRange = !!(fromDate && toDate);
  const params = pickReportFilterParams(req.query);

  const requestStartedAt = Date.now();
  const sendWorkbook = (bytes, cacheStatus) => {
    const stamp = hasRange ? `${fromDate}_to_${toDate}` : new Date().toISOString().slice(0, 10);
    const filename = `ICICI_HFC_Quality_Report_${stamp}.xlsx`;
    const totalMs = Date.now() - requestStartedAt;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('X-Cache', cacheStatus);
    res.setHeader('Server-Timing', `cache;desc="${cacheStatus}", total;dur=${totalMs}`);
    console.info(
      `[quality-report] cache=${cacheStatus} totalMs=${totalMs} bytes=${bytes.length}`,
    );
    return res.status(200).end(bytes);
  };

  // Filter-only key so a HIT returns bytes with no SQL (no COUNT/MAX scan).
  const cacheKey = buildQualityCacheKey({
    role: req.user?.accountType,
    fromDate,
    toDate,
    location: params.location,
    tl: params.tl || params.supervisor,
    agent: params.agent,
    callType: params.callType,
  });

  try {
    const cached = await cacheService.getBuffer(cacheKey);
    if (cached && cached.length) {
      return sendWorkbook(cached, 'HIT');
    }
  } catch {
    /* rebuild */
  }

  const pending = takeQualityBuild(cacheKey);
  if (pending) {
    try {
      return sendWorkbook(await pending, 'HIT');
    } catch (err) {
      if (err && err.statusCode === 409) {
        return res.status(409).json({ success: false, message: err.message });
      }
      console.error('Error in /api/collections/quality-report:', err.message);
      return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
  }

  let pool;
  try {
    pool = await sqlConnect();
  } catch (err) {
    return res.status(503).json({ success: false, message: 'Database unavailable.' });
  }

  const metaCols = [
    'AudioFileName', 'AgentName', 'AgentID', 'AgentLocation', 'AgentSupervisor',
    'AgentManager', 'AgentAuditor', 'SelectedCallDate', 'UploadDate',
    'AudioLanguage', 'AudioDuration', 'CallType', 'AI_Summary', 'AI_Feedback',
  ];
  const selectCols = [...new Set([...metaCols, ...COLLECTIONS_AI_COLUMNS])].join(', ');

  try {
    let dims = [];
    try { dims = (await getEffectiveRubric(pool)).filter((d) => d.enabled !== false); } catch { dims = []; }

    const buildPromise = rememberQualityBuild(cacheKey, (async () => {
      const { rows: calls, sqlMs } = await fetchQualityWorkbookRows(pool, {
        selectCols,
        hasRange,
        fromDate,
        toDate,
        params,
        extraFilters: consolidatedReportExtraFilters(params),
        bindReportFilters,
        sqlTypes: sql,
      });
      if (!calls.length) {
        const empty = new Error('No collections-scored calls found for this period.');
        empty.statusCode = 409;
        throw empty;
      }

      const excelStartedAt = Date.now();
      const buffer = await buildIcicQualityReportBuffer({
        calls,
        dims,
        mapStatuses: (row) => (mapCollectionsScoring(row) || {}).statuses || {},
        period: hasRange ? { fromDate, toDate } : null,
        orgName: 'ICICI HFC',
      });
      const excelMs = Date.now() - excelStartedAt;
      const bytes = Buffer.from(buffer);
      console.info(
        `[quality-report] build rows=${calls.length} sqlMs=${sqlMs} excelMs=${excelMs} bytes=${bytes.length}`,
      );
      if (shouldStoreWorkbook(bytes)) {
        await cacheService.setBuffer(cacheKey, bytes, QUALITY_CACHE_TTL_SEC);
      }
      return bytes;
    })());

    const bytes = await buildPromise;
    return sendWorkbook(bytes, 'MISS');
  } catch (err) {
    if (err && err.statusCode === 409) {
      return res.status(409).json({ success: false, message: err.message });
    }
    if (isMissingDbObjectError(err)) {
      return res.status(409).json({ success: false, message: 'Collections columns not present — activate the collections profile first.' });
    }
    console.error('Error in /api/collections/quality-report:', err.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

/**
 * GET /api/collections/agent-performance?fromDate=&toDate=&location=&tl=&agent=
 *
 * Per-agent collections scorecard (tenant-scoped): audit count, avg quality,
 * RAG grade, PTP conversion, fatal / red-alert counts and top disposition —
 * the "Agent section" the ICIC HFC associate report is built around. Best-effort
 * + additive: a banking install / not-yet-migrated DB returns an empty payload.
 */
router.get('/api/collections/agent-performance', requireCollectionsDashboardAccess, async (req, res) => {
  const empty = { success: true, available: false, agents: [] };
  let pool;
  try {
    pool = await sqlConnect();
  } catch (err) {
    return res.status(200).json(empty);
  }

  const { fromDate, toDate } = req.query;
  const hasRange = !!(fromDate && toDate);
  const params = pickReportFilterParams(req.query);
  const dateClause = collectionsDateClause({ hasRange });
  const extra = consolidatedReportExtraFilters(params);
  const where = `WHERE AI_Coll_Score IS NOT NULL AND ${dateClause}${extra}`;

  const buildReq = () => {
    const r = pool.request();
    if (hasRange) {
      r.input('fromDate', sql.Date, fromDate);
      r.input('toDate', sql.Date, toDate);
    }
    bindReportFilters(r, params);
    return r;
  };

  try {
    const aggRes = await buildReq().query(`
      SELECT
        COALESCE(NULLIF(LTRIM(RTRIM(AgentName)), ''), 'Unknown') AS name,
        MAX(AgentID) AS empId,
        MAX(AgentSupervisor) AS tl,
        COUNT(*) AS auditCount,
        AVG(CAST(AI_Coll_Score AS FLOAT)) AS avgQuality,
        SUM(CASE WHEN AI_Coll_Fatal_Triggered = 'Yes' THEN 1 ELSE 0 END) AS fatalCount,
        SUM(CASE WHEN AI_Red_Alert = 'Yes' THEN 1 ELSE 0 END) AS redAlertCount,
        SUM(CASE WHEN AI_PTP_Present = 'Yes' THEN 1 ELSE 0 END) AS ptpCount
      FROM Consolidated_Audio_Analysis
      ${where}
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AgentName)), ''), 'Unknown')
      ORDER BY avgQuality DESC
    `);

    // Top disposition per agent (separate grouped query, folded in JS).
    const dispRes = await buildReq().query(`
      SELECT
        COALESCE(NULLIF(LTRIM(RTRIM(AgentName)), ''), 'Unknown') AS name,
        COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Disposition)), ''), 'Unknown') AS disposition,
        COUNT(*) AS count
      FROM Consolidated_Audio_Analysis
      ${where}
      GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(AgentName)), ''), 'Unknown'),
               COALESCE(NULLIF(LTRIM(RTRIM(AI_Coll_Disposition)), ''), 'Unknown')
    `);
    const topDispByAgent = {};
    for (const r of dispRes.recordset || []) {
      const cur = topDispByAgent[r.name];
      if (!cur || Number(r.count) > cur.count) topDispByAgent[r.name] = { disposition: r.disposition, count: Number(r.count) };
    }

    const gradeOf = (q) => (q == null ? '' : q < 80 ? 'R' : q < 85 ? 'A' : 'G');
    const agents = (aggRes.recordset || []).map((r) => {
      const auditCount = Number(r.auditCount) || 0;
      const avgQuality = r.avgQuality != null ? Math.round(Number(r.avgQuality) * 10) / 10 : null;
      const ptpCount = Number(r.ptpCount) || 0;
      return {
        name: r.name,
        empId: r.empId != null ? String(r.empId) : '',
        tl: r.tl != null ? String(r.tl) : '',
        auditCount,
        avgQuality,
        grade: gradeOf(avgQuality),
        fatalCount: Number(r.fatalCount) || 0,
        redAlertCount: Number(r.redAlertCount) || 0,
        ptpCount,
        ptpRate: auditCount > 0 ? Math.round((ptpCount / auditCount) * 1000) / 10 : null,
        topDisposition: (topDispByAgent[r.name] && topDispByAgent[r.name].disposition) || '',
      };
    });

    return res.status(200).json({ success: true, available: agents.length > 0, agents });
  } catch (err) {
    if (isMissingDbObjectError(err)) return res.status(200).json(empty);
    console.error('Error in /api/collections/agent-performance:', err.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
});

/**
 * API 10.28.262 - GET /api/summary/:audioFileName
 * Retrieves summary for an audio file
 */
router.get('/api/summary/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AI_Summary
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        return res.status(200).json({
          success: true,
          summary: result.recordset[0].AI_Summary || '',
        });
      }
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
    }

    res.status(200).json({
      success: true,
      summary: 'AI summary will be available after Phase 2b scoring is enabled.',
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * Ensures a Consolidated_Audio_Analysis row exists (creates stub from AudioUploads if needed).
 */
async function ensureConsolidatedAudioRow(pool, filename) {
  const existing = await pool.request()
    .input("filename", sql.NVarChar, filename)
    .query(`SELECT AudioFileName FROM Consolidated_Audio_Analysis WHERE AudioFileName = @filename`);

  if (existing.recordset.length > 0) {
    return true;
  }

  const upload = await pool.request()
    .input("filename", sql.NVarChar, filename)
    .query(`
      SELECT UploadDate, SelectedAgent, SelectedCallDate, CallType
      FROM AudioUploads
      WHERE AudioFileName = @filename
    `);

  if (upload.recordset.length === 0) {
    return false;
  }

  const row = upload.recordset[0];
  await pool.request()
    .input("filename", sql.NVarChar, filename)
    .input("uploadDate", sql.DateTime, row.UploadDate || new Date())
    .input("agentName", sql.NVarChar, row.SelectedAgent || "Unknown")
    .input("callDate", sql.Date, row.SelectedCallDate || null)
    .input("callType", sql.NVarChar, row.CallType || "inbound")
    .query(`
      INSERT INTO Consolidated_Audio_Analysis (
        UploadDate, AudioFileName, AgentName, SelectedCallDate, CallType, Status
      )
      VALUES (@uploadDate, @filename, @agentName, @callDate, @callType, 'Uploaded')
    `);
  return true;
}

/**
 * API 10.92.90 - POST /api/manual-scoring/:filename
 * Updates manual scoring for a specific audio file, including the username of the scorer
 */
router.post("/api/manual-scoring/:filename", async (req, res) => {
  const { filename } = req.params;
  const { manualScores } = req.body;

  if (!filename || !manualScores) {
    writeLog(`[${getISTTimeString()}] Manual scoring update failed: Missing filename or manualScores`);
    return res.status(400).json({ success: false, message: "Filename and manual scores are required." });
  }

  const {
    Opening_Speech,
    Empathy,
    Query_Handling,
    Adherence_to_Protocol,
    Resolution_Assurance,
    Query_Resolution,
    Polite_Tone,
    Authentication_Verification,
    Escalation_Handling,
    Closing_Speech,
    Rude_Behavior,
    Call_Type,
    Lead_Classification,
    Resolution_Status,
    Feedback,
    Overall_Scoring,
    ManualScoredByUserID: username // Renamed to username for clarity
  } = manualScores;

  if (!username || typeof username !== 'string' || username.trim() === '') {
    writeLog(`[${getISTTimeString()}] Manual scoring update failed: Invalid or missing username`);
    return res.status(400).json({ success: false, message: "Valid username is required for scoring." });
  }

  try {
    const pool = await connectToDatabase();

    // Validate username exists in Users table
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username.trim())
      .query(`SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)`);
    
    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Manual scoring update failed: Username ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const audioResult = await pool.request()
      .input("filename", sql.NVarChar, filename)
      .query(`SELECT AudioFileName FROM Consolidated_Audio_Analysis WHERE AudioFileName = @filename`);
    
    if (audioResult.recordset.length === 0) {
      const created = await ensureConsolidatedAudioRow(pool, filename);
      if (!created) {
        writeLog(`[${getISTTimeString()}] Manual scoring update failed: Audio file ${filename} not found`);
        return res.status(404).json({ success: false, message: "Audio file not found." });
      }
    }

    const safeParseFloat = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = parseFloat(value);
      return !isNaN(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
    };

    const parsedScores = {
      Opening_Speech: safeParseFloat(Opening_Speech),
      Empathy: safeParseFloat(Empathy),
      Query_Handling: safeParseFloat(Query_Handling),
      Adherence_to_Protocol: safeParseFloat(Adherence_to_Protocol),
      Resolution_Assurance: safeParseFloat(Resolution_Assurance),
      Query_Resolution: safeParseFloat(Query_Resolution),
      Polite_Tone: safeParseFloat(Polite_Tone),
      Authentication_Verification: safeParseFloat(Authentication_Verification),
      Escalation_Handling: safeParseFloat(Escalation_Handling),
      Closing_Speech: safeParseFloat(Closing_Speech),
    };

    const numericVals = Object.values(parsedScores).filter(v => v !== null);
    const computedOverall = numericVals.length > 0
      ? parseFloat((numericVals.reduce((s, v) => s + v, 0) / numericVals.length).toFixed(2))
      : safeParseFloat(Overall_Scoring);

    await pool.request()
      .input("filename", sql.NVarChar, filename)
      .input("Opening_Speech", sql.Float, parsedScores.Opening_Speech)
      .input("Empathy", sql.Float, parsedScores.Empathy)
      .input("Query_Handling", sql.Float, parsedScores.Query_Handling)
      .input("Adherence_to_Protocol", sql.Float, parsedScores.Adherence_to_Protocol)
      .input("Resolution_Assurance", sql.Float, parsedScores.Resolution_Assurance)
      .input("Query_Resolution", sql.Float, parsedScores.Query_Resolution)
      .input("Polite_Tone", sql.Float, parsedScores.Polite_Tone)
      .input("Authentication_Verification", sql.Float, parsedScores.Authentication_Verification)
      .input("Escalation_Handling", sql.Float, parsedScores.Escalation_Handling)
      .input("Closing_Speech", sql.Float, parsedScores.Closing_Speech)
      .input("Rude_Behavior", sql.NVarChar, Rude_Behavior || null)
      .input("Call_Type", sql.NVarChar, Call_Type || null)
      .input("Lead_Classification", sql.NVarChar, Lead_Classification || null)
      .input("Resolution_Status", sql.NVarChar, Resolution_Status || null)
      .input("Feedback", sql.NVarChar, Feedback || null)
      .input("Overall_Scoring", sql.Float, computedOverall)
      .input("ManualScoredByUserID", sql.NVarChar(100), username.trim())
      .query(`
        UPDATE Consolidated_Audio_Analysis
        SET
          Manual_Opening_Speech = @Opening_Speech,
          Manual_Empathy = @Empathy,
          Manual_Query_Handling = @Query_Handling,
          Manual_Adherence_to_Protocol = @Adherence_to_Protocol,
          Manual_Resolution_Assurance = @Resolution_Assurance,
          Manual_Query_Resolution = @Query_Resolution,
          Manual_Polite_Tone = @Polite_Tone,
          Manual_Authentication_Verification = @Authentication_Verification,
          Manual_Escalation_Handling = @Escalation_Handling,
          Manual_Closing_Speech = @Closing_Speech,
          Manual_Rude_Behavior = @Rude_Behavior,
          Manual_Call_Type = @Call_Type,
          Manual_Lead_Classification = @Lead_Classification,
          Manual_Resolution_Status = @Resolution_Status,
          Manual_Feedback = @Feedback,
          Manual_Overall_Scoring = @Overall_Scoring,
          ManualScoring = 1,
          ManualScoredByUserID = @ManualScoredByUserID
        WHERE AudioFileName = @filename
      `);

    writeLog(`[${getISTTimeString()}] Manual scoring updated successfully for ${filename} by username ${username}`);
    return res.status(200).json({ success: true, message: "Manual scoring updated successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Manual scoring update error for ${filename}: ${error.message}`);
    console.error(`[${getISTTimeString()}] Manual scoring update error:`, error);
    return res.status(500).json({ success: false, message: "Server error updating manual scoring: " + error.message });
  }
});

/**
 * API 10.92.90 - GET /api/sentiment/:filename
 * Retrieves per-utterance sentiment analysis data for a specific audio file
 * Compliance: ISO 27001 (Secure data handling, logging)
 */
router.get("/api/sentiment/:filename", async (req, res) => {
  const { filename } = req.params;

  // Input validation
  if (!filename || !validator.isAlphanumeric(filename, undefined, { ignore: "-_." })) {
    writeLog(`[${getISTTimeString()}] Sentiment fetch failed: Invalid filename ${filename}`);
    return res.status(400).json({ success: false, message: "Invalid filename" });
  }

  try {
    const pool = await sqlConnect();
    let result;
    try {
      result = await pool.request()
        .input("filename", sql.NVarChar, filename)
        .query(`
          SELECT Sentiment
          FROM [call_analysis_db].[dbo].[Consolidated_Audio_Analysis]
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({ success: true, sentiment: [] });
    }

    if (result.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Sentiment fetch failed: No sentiment data found for ${filename}`);
      return res.status(404).json({ success: false, message: "No sentiment data found for this audio file" });
    }

    let sentimentData = result.recordset[0].Sentiment;

    // Handle NULL or empty values
    if (!sentimentData || sentimentData.trim() === "") {
      sentimentData = "[]"; // Default to empty array
    }

    // Attempt to parse JSON, fallback to empty array on error
    try {
      sentimentData = JSON.parse(sentimentData);
      if (!Array.isArray(sentimentData)) {
        throw new Error("Sentiment data is not an array");
      }
    } catch (parseError) {
      console.error(`[${getISTTimeString()}] Invalid JSON in Sentiment column for ${filename}:`, sentimentData, parseError.message);
      writeLog(`[${getISTTimeString()}] Sentiment fetch error for ${filename}: Invalid JSON - ${parseError.message}, Raw Data: ${sentimentData}`);
      sentimentData = []; // Fallback to empty array
    }

    writeLog(`[${getISTTimeString()}] Sentiment data fetched successfully for ${filename}, Count: ${sentimentData.length}`);
    return res.status(200).json({ success: true, sentiment: sentimentData });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching sentiment data for ${filename}:`, error.message);
    writeLog(`[${getISTTimeString()}] Sentiment fetch error for ${filename}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching sentiment data" });
  }
});

router.get('/api/script-compliance/:filename', async (req, res) => {
  // Protected by global /api authGate (same as tone/sentiment Result GETs).
  const parseComplianceJson = (rawJson, filename) => {
    if (rawJson == null || !String(rawJson).trim()) return null;
    try {
      const detail = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      if (!detail || typeof detail !== 'object') return null;
      // Empty {} from older writers is not usable detail.
      if (Array.isArray(detail.categories) && detail.categories.length > 0) return detail;
      return null;
    } catch (parseErr) {
      writeLog(`[${getISTTimeString()}] ScriptComplianceJson parse failed for ${filename}: ${parseErr.message}`);
      return null;
    }
  };

  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ScriptCompliance, ScriptComplianceJson
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      // Older DBs may lack ScriptComplianceJson — retry scalar-only.
      if (String(consolidatedErr.message || '').includes('ScriptComplianceJson')) {
        result = await pool.request()
          .input('filename', sql.NVarChar, filename)
          .query(`
            SELECT ScriptCompliance
            FROM Consolidated_Audio_Analysis
            WHERE AudioFileName = @filename
          `);
      } else if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      } else {
        return res.status(200).json({
          success: true,
          scriptCompliance: 'Script compliance will be available after Phase 2b is enabled.',
          scriptComplianceDetail: null,
        });
      }
    }
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Script compliance data not found.' });
    }
    const row = result.recordset[0];
    let detail = parseComplianceJson(row.ScriptComplianceJson, filename);

    // Fallback: CAA may lack JSON when a prior callback CAA update failed silently
    // while AI_Processing_Result still received ScriptComplianceJson.
    if (!detail) {
      try {
        const apr = await pool.request()
          .input('filename', sql.NVarChar, filename)
          .query(`
            SELECT ScriptCompliance, ScriptComplianceJson
            FROM AI_Processing_Result
            WHERE AudioFileName = @filename
          `);
        if (apr.recordset.length > 0) {
          const aprRow = apr.recordset[0];
          detail = parseComplianceJson(aprRow.ScriptComplianceJson, filename);
          if (detail && (row.ScriptCompliance == null || row.ScriptCompliance === '') && aprRow.ScriptCompliance != null) {
            row.ScriptCompliance = aprRow.ScriptCompliance;
          }
        }
      } catch (aprErr) {
        if (!String(aprErr.message || '').includes('ScriptComplianceJson') && !isMissingDbObjectError(aprErr)) {
          writeLog(`[${getISTTimeString()}] ScriptCompliance APR fallback failed for ${filename}: ${aprErr.message}`);
        }
      }
    }

    res.status(200).json({
      success: true,
      scriptCompliance: row.ScriptCompliance,
      scriptComplianceDetail: detail,
    });
  } catch (error) {
    console.error('Error fetching script compliance:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/* 10.5 Profile Picture APIs */
/**
 * API 10.44.42 - POST /api/user/:username/profile-picture
 * Uploads a user's profile picture
 */
router.post("/api/user/:username/profile-picture", uploadProfilePic.single("profilePic"), async (req, res) => {
  const username = req.params.username;
  if (!assertSelfOrElevated(req, username)) {
    writeLog(`[${getISTTimeString()}] Profile picture upload denied for ${username}`);
    return res.status(403).json({ success: false, message: "You do not have permission to update this profile picture." });
  }
  if (!req.file) {
    writeLog(`[${getISTTimeString()}] Profile picture upload failed: No file uploaded for ${username}`);
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }

  try {
    // Rename the old profile picture with current date
    const oldFilePattern = path.join(profilePicsDir, `${username}.*`);
    const oldFiles = fs.readdirSync(profilePicsDir).filter(file => file.startsWith(username) && file !== req.file.filename);
    if (oldFiles.length > 0) {
      const oldFile = oldFiles[0];
      const oldExt = path.extname(oldFile);
      const newOldFileName = `${username}_${new Date().toISOString().replace(/[:.]/g, '-')}${oldExt}`;
      fs.renameSync(path.join(profilePicsDir, oldFile), path.join(profilePicsDir, newOldFileName));
      writeLog(`[${getISTTimeString()}] Renamed old profile picture ${oldFile} to ${newOldFileName} for ${username}`);
    }

    // Return success with the new file URL
    const newFileUrl = `${req.protocol}://${req.get("host")}/api/user/${username}/profile-picture`;
    writeLog(`[${getISTTimeString()}] Profile picture uploaded successfully for ${username}`);
    return res.status(200).json({ success: true, message: "Profile picture updated!", url: newFileUrl });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error uploading profile picture for ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Failed to upload profile picture." });
  }
});

/**
 * API 10.45.43 - GET /api/user/:username/profile-picture
 * Retrieves a user's profile picture
 */
router.get("/api/user/:username/profile-picture", (req, res) => {
  const username = req.params.username;
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "You do not have permission to view this profile picture." });
  }
  const filePath = findProfilePictureFile(username);

  if (!filePath) {
    return res.status(404).json({ success: false, message: "Profile picture not found." });
  }

  res.setHeader("Cache-Control", "private, max-age=300");
  res.sendFile(filePath);
});

router.get("/api/check-login-availability", async (req, res) => {
  try {
    // Recovery mode: when there is no valid/active license, allow login so a
    // Super Admin can reach the admin panel and install a new license. The
    // licenseGuard keeps every licensed feature locked, so this is safe.
    if (!global.licensePayload || global.licenseState === "expired") {
      writeLog(`[${getISTTimeString()}] Login availability: license recovery mode — login permitted`);
      return res.status(200).json({ success: true, message: "Login allowed (license recovery mode).", recovery: true });
    }

    // Supports v2 (payload.users) and v3 (limits.maxConcurrentUsers); 0/absent = unlimited.
    const maxUsers = global.licensePayload.users ?? global.licensePayload.limits?.maxConcurrentUsers ?? 0;
    const pool = await connectToDatabase();
    const activeSessions = await pool.request()
      .query("SELECT COUNT(*) AS count FROM ActiveSessions WHERE IsActive = 1");
    const activeCount = activeSessions.recordset[0].count;

    if (maxUsers && activeCount >= maxUsers) {
      writeLog(`[${getISTTimeString()}] Login availability check failed: Maximum login count (${maxUsers}) reached`);
      return res.status(403).json({ success: false, message: `Maximum login count (${maxUsers}) reached as per the license.` });
    }

    writeLog(`[${getISTTimeString()}] Login availability check passed: ${activeCount}/${maxUsers} active sessions`);
    return res.status(200).json({ success: true, message: "Login allowed.", activeCount, maxUsers });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Login availability check error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking login availability." });
  }
});

/**
 * Protected fixed-corpus export for throughput/quality regression gates.
 */
router.post("/api/system-monitor/capacity-export", requireSystemMonitorAccess, async (req, res) => {
  const audioFiles = Array.isArray(req.body?.audioFiles)
    ? [...new Set(req.body.audioFiles.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  if (!audioFiles.length || audioFiles.length > 200) {
    return res.status(400).json({
      success: false,
      message: "audioFiles[] is required (max 200).",
    });
  }
  const parseJson = (value) => {
    if (value == null || typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return value; }
  };
  try {
    const pool = await connectToDatabase();
    const calls = [];
    let oomCount = 0;
    for (const audioFile of audioFiles) {
      const requestFor = () => pool.request().input("audioFile", sql.NVarChar, audioFile);
      const [uploadResult, aiResult, consolidatedResult, logResult] = await Promise.all([
        requestFor().query("SELECT TOP 1 * FROM dbo.AudioUploads WHERE AudioFileName = @audioFile"),
        requestFor().query("SELECT TOP 1 * FROM dbo.AI_Processing_Result WHERE AudioFileName = @audioFile")
          .catch(() => ({ recordset: [] })),
        requestFor().query("SELECT TOP 1 * FROM dbo.Consolidated_Audio_Analysis WHERE AudioFileName = @audioFile")
          .catch(() => ({ recordset: [] })),
        requestFor().query(`
          SELECT LogID, Stage, Level, Message, Detail, CreatedAt
          FROM dbo.CallProcessingLog
          WHERE AudioFileName = @audioFile
          ORDER BY LogID ASC
        `).catch(() => ({ recordset: [] })),
      ]);
      const upload = uploadResult.recordset[0] || {};
      const ai = aiResult.recordset[0] || {};
      const consolidated = consolidatedResult.recordset[0] || {};
      const logs = logResult.recordset || [];
      const parsedLogs = logs.map((row) => ({
        ...row,
        parsedDetail: parseJson(row.Detail),
      }));
      const latestRunMetricIndex = parsedLogs.reduce(
        (latest, row, index) => (
          row.parsedDetail?.metric === "queue_enqueue"
            ? index
            : latest
        ),
        -1,
      );
      // Re-analysis appends to CallProcessingLog. Restrict metrics to the latest
      // queued run so repeated baseline/candidate exports do not aggregate history.
      const runLogs = latestRunMetricIndex >= 0
        ? parsedLogs.slice(latestRunMetricIndex)
        : parsedLogs;
      const runId = latestRunMetricIndex >= 0
        ? String(parsedLogs[latestRunMetricIndex].parsedDetail?.run_id || "")
        : "";
      oomCount += runLogs.filter((row) => (
        /(?:CUDA\s+)?out of memory|\bOOM\b/i.test(`${row.Message || ""} ${row.Detail || ""}`)
      )).length;
      const stageMs = {};
      let queueWaitMs = 0;
      let queueMetricCreatedAt = null;
      let enqueuedMetricEpoch = 0;
      for (const row of runLogs) {
        const detail = row.parsedDetail;
        if (detail?.metric === "pipeline_stage" && detail.stage) {
          stageMs[detail.stage] = (stageMs[detail.stage] || 0) + Number(detail.elapsed_ms || 0);
        }
        if (detail?.metric === "queue_wait") {
          queueWaitMs = Number(detail.queue_wait_ms || 0);
          queueMetricCreatedAt = row.CreatedAt;
        }
        if (detail?.metric === "queue_enqueue") {
          enqueuedMetricEpoch = Number(detail.enqueued_at || 0) / 1000;
        }
      }
      const completeLog = [...runLogs].reverse().find((row) => row.Stage === "complete");
      const collectionsScore = Object.fromEntries(
        Object.entries(consolidated).filter(([key]) => (
          key.startsWith("AI_Coll_")
          || ["AI_Overall_Scoring", "AI_Feedback", "AI_Call_Type"].includes(key)
        )),
      );
      const queueStartedEpoch = queueMetricCreatedAt
        ? new Date(queueMetricCreatedAt).getTime() / 1000
        : 0;
      const enqueuedEpoch = queueStartedEpoch
        ? Math.max(0, queueStartedEpoch - (queueWaitMs / 1000))
        : (
          enqueuedMetricEpoch
          || (upload.UploadDate ? new Date(upload.UploadDate).getTime() / 1000 : 0)
        );
      const completedEpoch = completeLog?.CreatedAt
        ? new Date(completeLog.CreatedAt).getTime() / 1000
        : 0;
      calls.push({
        audio_file: audioFile,
        language: ai.OriginalLanguage || ai.AudioLanguage || consolidated.AudioLanguage || "",
        transcript: ai.TranscribeOutput || "",
        translation: ai.TranslateOutput || consolidated.TranslateOutput || "",
        collections_score: collectionsScore,
        compliance: parseJson(
          ai.ScriptComplianceJson
          || consolidated.ScriptComplianceJson
          || ai.ScriptCompliance
          || consolidated.ScriptCompliance,
        ),
        tone: parseJson(ai.ToneAnalysis || consolidated.ToneAnalysis),
        sentiment: parseJson(ai.Sentiment || consolidated.Sentiment),
        disposition: consolidated.Disposition || consolidated.AI_Disposition || "",
        campaign: consolidated.Campaign || consolidated.CampaignName || "",
        run_id: runId,
        status: resolveCapacityRunStatus({
          uploadStatus: upload.ProcessStatus,
          aiStatus: ai.Status,
          consolidatedStatus: consolidated.Status,
          hasRunBoundary: latestRunMetricIndex >= 0,
          hasCompletionEvent: Boolean(completeLog),
        }),
        stage_ms: stageMs,
        queue_wait_ms: queueWaitMs,
        completion_seconds: resolveCapacityCompletionSeconds({
          enqueuedEpoch,
          completedEpoch,
          hasRunBoundary: latestRunMetricIndex >= 0,
          legacyProcessingSeconds: (
            ai.ProcessingSeconds || consolidated.TotalDurationOfAIProcessing
          ),
        }),
        enqueued_epoch: enqueuedEpoch,
        completed_epoch: completedEpoch,
      });
    }
    const queueWaits = calls.map((call) => call.queue_wait_ms / 1000).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(queueWaits.length * 0.95) - 1);
    return res.json({
      success: true,
      calls,
      queue_age_p95_seconds: queueWaits[p95Index] || 0,
      oom_count: oomCount,
      stuck_jobs: calls.filter((call) => ACTIVE_RUN_STATUS.test(call.status)).length,
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Capacity export failed: ${error.message}`);
    return res.status(500).json({ success: false, message: "Capacity export failed." });
  }
});

/**
 * API 10.6 - GET /api/system-monitor
 * System monitoring endpoint that returns comprehensive system metrics including all network interfaces and GPUs
 */
router.get("/api/system-monitor", requireSystemMonitorAccess, async (req, res) => {
  try {
    writeLog(`[${getISTTimeString()}] System monitoring data requested`);

    const { collectGpuMetrics } = require("../services/gpuMetrics");
    
    // Get basic system information in parallel for better performance
    const [
      cpuInfo,
      memInfo,
      diskInfo,
      networkStats,
      networkInterfaces,
      gpuInfo,
      osInfo,
      tempInfo
    ] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.networkInterfaces(),
      si.graphics().catch(() => ({ controllers: [] })),
      si.osInfo(),
      si.cpuTemperature().catch(() => null) // CPU temp might not be available on all systems
    ]);

    // Get current CPU load
    const cpuLoad = await si.currentLoad();

    // Process network interfaces - get all physical interfaces
    const allNetworkInterfaces = [];
    const processedIfaces = new Set();
    
    // Combine interface info with stats
    for (const iface of networkInterfaces) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00" && !processedIfaces.has(iface.iface)) {
        processedIfaces.add(iface.iface);
        
        // Find corresponding stats for this interface
        const stats = networkStats.find(stat => stat.iface === iface.iface) || {
          rx_bytes: 0,
          tx_bytes: 0,
          rx_sec: 0,
          tx_sec: 0
        };

        // systeminformation rx_sec/tx_sec are bytes/sec → MB/s for UI
        allNetworkInterfaces.push({
          name: iface.iface,
          type: iface.type || 'Unknown',
          speed: iface.speed || 0,
          operstate: iface.operstate || 'unknown',
          mac: iface.mac,
          ip4: iface.ip4 || 'N/A',
          upload: parseFloat((stats.tx_sec / (1024 * 1024)).toFixed(3)),
          download: parseFloat((stats.rx_sec / (1024 * 1024)).toFixed(3)),
          uploadTotal: Math.round(stats.tx_bytes / (1024 * 1024)), // MB
          downloadTotal: Math.round(stats.rx_bytes / (1024 * 1024)), // MB
          unit: 'MB/s',
        });
      }
    }

    // Live GPU metrics: nvidia-smi (all visible GPUs) with systeminformation fallback
    const aiHealthUrl = `${String(process.env.AI_MAIN_URL || "http://ai:8000").replace(/\/$/, "")}/health`;
    const [gpuResult, uploadQueue, aiHealth] = await Promise.all([
      collectGpuMetrics(gpuInfo),
      getUploadQueueMetrics().catch((error) => ({
        enabled: false,
        error: error.message,
        counts: {},
        oldestWaitingAgeMs: 0,
      })),
      fetch(aiHealthUrl, { signal: AbortSignal.timeout(5000) })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .catch((error) => ({ success: false, error: error.message })),
    ]);
    const allGPUs = gpuResult.gpus || [];

    // Calculate total network activity (sum of all interfaces)
    const totalUpload = allNetworkInterfaces.reduce((sum, iface) => sum + iface.upload, 0);
    const totalDownload = allNetworkInterfaces.reduce((sum, iface) => sum + iface.download, 0);

    // Prepare response data
    const systemData = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        cpu: {
          currentLoad: parseFloat(cpuLoad.currentLoad.toFixed(1)),
          model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
          cores: cpuInfo.cores,
          physicalCores: cpuInfo.physicalCores,
          speed: cpuInfo.speed,
          temperature: tempInfo ? tempInfo.main || tempInfo.max || null : null
        },
        // Linux pressure: MemAvailable-based (not total−MemFree / buff-cache-as-used)
        memory: toHostMemoryMetrics(memInfo),
        disks: diskInfo.map(disk => ({
          fs: disk.fs,
          type: disk.type,
          size: Math.round(disk.size / (1024 * 1024 * 1024)), // Convert to GB
          used: Math.round(disk.used / (1024 * 1024 * 1024)), // Convert to GB
          use: parseFloat(disk.use.toFixed(1)),
          mount: disk.mount
        })),
        network: {
          // Single network object for backward compatibility
          upload: parseFloat(totalUpload.toFixed(3)),
          download: parseFloat(totalDownload.toFixed(3)),
          unit: 'MB/s',
          // All network interfaces
          interfaces: allNetworkInterfaces
        },
        gpu: allGPUs.length > 0 ? allGPUs : null,
        gpuMeta: {
          count: allGPUs.length,
          source: gpuResult.source,
          error: allGPUs.length ? null : gpuResult.error || null,
        },
        uploadQueue,
        ai: {
          capacity: aiHealth.capacity || null,
          gpuStageScheduler: aiHealth.gpu_stage_scheduler || null,
          gpuIdentity: aiHealth.gpu_identity || null,
          activeJobs: aiHealth.active_jobs ?? null,
          error: aiHealth.error || null,
        },
        system: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch,
          uptime: Math.round(osInfo.uptime / 3600) // Convert to hours
        }
      }
    };

    const memoryMetrics = systemData.data.memory;
    writeLog(`[${getISTTimeString()}] System monitoring data compiled: CPU ${cpuLoad.currentLoad.toFixed(1)}%, Memory ${memoryMetrics.usage}% (used ${memoryMetrics.used}/${memoryMetrics.total} GB, available ${memoryMetrics.available} GB), Networks: ${allNetworkInterfaces.length}, GPUs: ${allGPUs.length} (${gpuResult.source || 'none'})`);
    
    return res.status(200).json(systemData);
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching system monitoring data: ${error.message}`);
    console.error(`[${getISTTimeString()}] System monitoring error:`, error);
    
    // Return error response
    return res.status(500).json({
      success: false,
      message: "Error fetching system data",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
};
