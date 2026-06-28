require('dotenv').config();
const sql  = require("./sqlClient");
const fs   = require("fs");
const path = require("path");
const { resolveProjectPath } = require("./projectPaths");

// ──────────────────────────────────────────────────────────────
// 1)  Logging helpers
// ──────────────────────────────────────────────────────────────
const logDir  = resolveProjectPath(process.env.BACKEND_LOG_DIR || '/app/logs');
const logFile = path.join(logDir, process.env.UPLOAD_HANDLER_LOG_FILE || 'upload_handler.log');

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const writeLog = msg =>
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);

// ──────────────────────────────────────────────────────────────
// 2)  Main handler
// ──────────────────────────────────────────────────────────────
const handleFileUpload = async (req, res, config) => {
  const { enqueueAudioProcessing } = require("./services/uploadQueue");
  const { checkAiEntitlement } = require("./services/aiEntitlement");
  try {
    // ─── basic validation ────────────────────────────────────
    if (!req.file)
      return res.status(400).json({ success:false, message:"No file uploaded." });

    // ─── Sprint 9: license must permit AI processing ─────────
    const entitlement = checkAiEntitlement();
    if (!entitlement.ok) {
      writeLog(`[Upload Handler] AI dispatch blocked: ${entitlement.reason}`);
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return res.status(403).json({ success:false, code:"AI_NOT_LICENSED", message: entitlement.reason });
    }

    const { agent, callType, date } = req.body;
    if (!agent || !callType || !date)
      return res.status(400).json({ success:false, message:"Required fields are missing." });

    // ─── insert Pending row ──────────────────────────────────
    const pool = await sql.connect(config);
    await pool.request()
      .input("fileName", sql.NVarChar, req.file.filename)
      .input("agent",    sql.NVarChar, agent)
      .input("callDate", sql.Date,     date)
      .input("callType", sql.NVarChar, callType)
      .query(`
        INSERT INTO AudioUploads
          (AudioFileName, SelectedAgent, SelectedCallDate, CallType, ProcessStatus, UploadDate)
        VALUES
          (@fileName, @agent, @callDate, @callType, 'Pending', GETDATE())
      `);

    writeLog(`[Upload Handler] Row inserted for ${req.file.filename} (Pending)`);

    const queueResult = await enqueueAudioProcessing(req.file.filename, {
      sql,
      config,
      writeLog,
    });
    writeLog(`[Upload Handler] AI dispatch mode=${queueResult.mode} for ${req.file.filename}`);

    // ─── immediate HTTP response (include filename — avoids latest-audio race) ─
    res.status(200).json({
      success: true,
      message: "File uploaded; processing started.",
      audioFileName: req.file.filename,
    });

  } catch (err) {
    writeLog(`[Upload Handler] Fatal error: ${err.message}`);
    res.status(500).json({ success:false, message:"Internal server error." });
  }
};

module.exports = { handleFileUpload };
