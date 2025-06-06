require('dotenv').config();
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone"); // Add moment-timezone for Indian timezone handling

// Interpolate BACKEND_LOG_DIR by replacing ${Project log}
const logDir = process.env.BACKEND_LOG_DIR.replace('${Project log}', process.env['Project log']);
const logFile = path.join(logDir, process.env.PYTHON_SCRIPT_LOG_FILE);

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("[INFO] Log directory created:", logDir);
}

const writeLog = (message) => {
  const timestamp = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"); // Indian timezone
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
};

const executePythonScript = (scriptPath, args = [], callback) => {
  writeLog(`[INFO] Starting Python script: ${scriptPath}`);

  const pythonProcess = spawn("python", [scriptPath, ...args]);

  pythonProcess.stdout.on("data", (data) => {
    writeLog(`[STDOUT] ${data}`);
  });

  pythonProcess.stderr.on("data", (data) => {
    writeLog(`[STDERR] ${data}`);
  });

  pythonProcess.on("close", (code) => {
    writeLog(`[INFO] Script exited with code: ${code}`);

    if (callback) callback(code);
  });

  pythonProcess.on("error", (error) => {
    writeLog(`[ERROR] Script error: ${error.message}`);
  });
};

module.exports = {
  executePythonScript,
};