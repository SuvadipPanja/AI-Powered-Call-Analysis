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
    validator,
    si,
  } = deps;
  const { mapScoringFields, isMissingDbObjectError, manualScoringFromCallAudit, mergeManualScoringFromConsolidated } = H;
  const fs = require("fs");
  const path = require("path");

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

    // Ensure the expected structure
    const toneAnalysis = {
      status: cleanedData.status || 'success',
      results: normalizeToneResults(
        cleanedData.results || {
          Agent: cleanedData.Agent || {},
          Customer: cleanedData.Customer || {},
          Overall_Tone: cleanedData.Overall_Tone || { Agent: 'N/A', Customer: 'N/A' },
        }
      ),
    };
    if (!toneAnalysis.results.Overall_Tone) {
      toneAnalysis.results.Overall_Tone = cleanedData.Overall_Tone || { Agent: 'N/A', Customer: 'N/A' };
    }
    if (cleanedData.taboo_analysis && typeof cleanedData.taboo_analysis === 'object') {
      toneAnalysis.taboo_analysis = cleanedData.taboo_analysis;
    }

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
    const pool = await sql.connect(config);
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
    const pool = await sql.connect(config);
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

    res.status(200).json({
      success: true,
      aiScoring: mapScoringFields(record, 'AI'),
      manualScoring,
    });
  } catch (error) {
    console.error('Error fetching scoring details:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
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
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);
    let result;
    try {
      result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT ScriptCompliance
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) {
        throw consolidatedErr;
      }
      return res.status(200).json({
        success: true,
        scriptCompliance: 'Script compliance will be available after Phase 2b is enabled.',
      });
    }
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Script compliance data not found.' });
    }
    res.status(200).json({ success: true, scriptCompliance: result.recordset[0].ScriptCompliance });
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
 * API 10.6 - GET /api/system-monitor
 * System monitoring endpoint that returns comprehensive system metrics including all network interfaces and GPUs
 */
router.get("/api/system-monitor", async (req, res) => {
  try {
    writeLog(`[${getISTTimeString()}] System monitoring data requested`);
    
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
      si.graphics(),
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

        allNetworkInterfaces.push({
          name: iface.iface,
          type: iface.type || 'Unknown',
          speed: iface.speed || 0,
          operstate: iface.operstate || 'unknown',
          mac: iface.mac,
          ip4: iface.ip4 || 'N/A',
          upload: parseFloat((stats.tx_sec / 1024).toFixed(2)), // Convert to KB/s
          download: parseFloat((stats.rx_sec / 1024).toFixed(2)), // Convert to KB/s
          uploadTotal: Math.round(stats.tx_bytes / (1024 * 1024)), // Convert to MB
          downloadTotal: Math.round(stats.rx_bytes / (1024 * 1024)) // Convert to MB
        });
      }
    }

    // Process GPU information - get all detected GPUs
    const allGPUs = [];
    if (gpuInfo && gpuInfo.controllers && gpuInfo.controllers.length > 0) {
      for (let i = 0; i < gpuInfo.controllers.length; i++) {
        const gpu = gpuInfo.controllers[i];
        allGPUs.push({
          id: i,
          model: gpu.model || `GPU ${i}`,
          vendor: gpu.vendor || 'Unknown',
          vram: gpu.vram || 0,
          vramDynamic: gpu.vramDynamic || false,
          subDeviceId: gpu.subDeviceId || null,
          driverVersion: gpu.driverVersion || 'Unknown',
          memoryTotal: gpu.memoryTotal || gpu.vram || 0,
          memoryUsed: gpu.memoryUsed || 0,
          memoryFree: gpu.memoryFree || (gpu.memoryTotal - gpu.memoryUsed) || 0,
          utilizationGpu: gpu.utilizationGpu || 0,
          utilizationMemory: gpu.utilizationMemory || 0,
          temperatureGpu: gpu.temperatureGpu || 0,
          powerDraw: gpu.powerDraw || 0,
          powerLimit: gpu.powerLimit || 0,
          clockCore: gpu.clockCore || 0,
          clockMemory: gpu.clockMemory || 0
        });
      }
    }

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
        memory: {
          used: parseFloat((memInfo.used / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          total: parseFloat((memInfo.total / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          free: parseFloat((memInfo.free / (1024 * 1024 * 1024)).toFixed(2)), // Convert to GB
          usage: parseFloat(((memInfo.used / memInfo.total) * 100).toFixed(1))
        },
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
          upload: parseFloat(totalUpload.toFixed(2)),
          download: parseFloat(totalDownload.toFixed(2)),
          // All network interfaces
          interfaces: allNetworkInterfaces
        },
        gpu: allGPUs.length > 0 ? allGPUs : null,
        system: {
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch,
          uptime: Math.round(osInfo.uptime / 3600) // Convert to hours
        }
      }
    };

    writeLog(`[${getISTTimeString()}] System monitoring data compiled: CPU ${cpuLoad.currentLoad.toFixed(1)}%, Memory ${((memInfo.used / memInfo.total) * 100).toFixed(1)}%, Networks: ${allNetworkInterfaces.length}, GPUs: ${allGPUs.length}`);
    
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
