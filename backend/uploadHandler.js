require('dotenv').config();
const sql  = require("./sqlClient");
const fs   = require("fs");
const path = require("path");
const { executePythonScript } = require("./pythonScriptHandler");
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
  try {
    // ─── basic validation ────────────────────────────────────
    if (!req.file)
      return res.status(400).json({ success:false, message:"No file uploaded." });

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

    // ─── call AI‑Main ────────────────────────────────────────
    executePythonScript("", [req.file.filename], async (code) => {
      try {
        const processStatus =
          code === 0
            ? "In Progress"                      // request accepted
            : "Error: request to AI‑Main failed"; // couldn't reach AI‑Main

        await pool.request()
          .input("status",   sql.NVarChar, processStatus)
          .input("fileName", sql.NVarChar, req.file.filename)
          .query(`
            UPDATE AudioUploads
            SET ProcessStatus = @status
            WHERE AudioFileName = @fileName
          `);

        writeLog(`[Upload Handler] ProcessStatus → '${processStatus}' for ${req.file.filename}`);
      } catch (err) {
        writeLog(`[Upload Handler] DB update failed: ${err.message}`);
      }
    });

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
