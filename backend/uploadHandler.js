require('dotenv').config();
const sql = require("mssql");
const fs = require("fs");
const path = require("path");
const { executePythonScript } = require("./pythonScriptHandler");

// Interpolate BACKEND_LOG_DIR by replacing ${Project log}
const logDir = process.env.BACKEND_LOG_DIR.replace('${Project log}', process.env['Project log']);
const logFile = path.join(logDir, process.env.UPLOAD_HANDLER_LOG_FILE);
const pythonScriptPath = process.env.PYTHON_SCRIPT_PATH;

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("[INFO] Log directory created:", logDir);
}

const writeLog = (message) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
};

const handleFileUpload = async (req, res, config) => {
  try {
    writeLog("[Upload Handler] Received file upload request.");

    if (!req.file) {
      writeLog("[Upload Handler] No file provided.");
      return res.status(400).send({ success: false, message: "No file uploaded." });
    }

    const { agent, callType, date } = req.body;
    if (!agent || !callType || !date) {
      writeLog("[Upload Handler] Missing required fields.");
      return res.status(400).send({ success: false, message: "Required fields are missing." });
    }

    writeLog(`[Upload Handler] File details: ${JSON.stringify(req.file)}`);
    writeLog(`[Upload Handler] Request Body: ${JSON.stringify(req.body)}`);

    const pool = await sql.connect(config);

    const query = `
      INSERT INTO AudioUploads (AudioFileName, SelectedAgent, SelectedCallDate, CallType, ProcessStatus)
      VALUES (@fileName, @agent, @callDate, @callType, 'Pending')
    `;
    await pool.request()
      .input("fileName", sql.NVarChar, req.file.filename)
      .input("agent", sql.NVarChar, agent)
      .input("callDate", sql.Date, date)
      .input("callType", sql.NVarChar, callType)
      .query(query);

    writeLog("[Upload Handler] Database updated successfully.");

    // Notify client of script progress
    executePythonScript(pythonScriptPath, [req.file.filename], async (code) => {
      try {
        const processStatus = code === 0 ? "Complete" : "Failed";
        const updateQuery = `
          UPDATE AudioUploads
          SET ProcessStatus = @status
          WHERE AudioFileName = @fileName
        `;
        await pool.request()
          .input("status", sql.NVarChar, processStatus)
          .input("fileName", sql.NVarChar, req.file.filename)
          .query(updateQuery);

        writeLog(`[Upload Handler] ProcessStatus updated to '${processStatus}'.`);
      } catch (error) {
        writeLog(`[Upload Handler] Error updating ProcessStatus: ${error.message}`);
      }
    });

    // Send immediate response to indicate processing has started
    res.status(200).send({ success: true, message: "File uploaded and processing started." });

  } catch (error) {
    writeLog(`[Upload Handler] Error occurred: ${error.message}`);
    return res.status(500).send({ success: false, message: "Internal server error." });
  }
};

module.exports = { handleFileUpload };