require('dotenv').config();
const fs = require("fs");
const path = require("path");

// Use environment variables for log directory and file name
const logDir = path.join(__dirname, process.env.ACTION_LOG_DIR);
const logFilePath = path.join(logDir, process.env.ACTION_LOG_FILE);

// Middleware to log actions
function logAction(req, res, next) {
  const logData = {
    timestamp: new Date().toISOString(),
    method: req.method,
    route: req.originalUrl,
    body: req.body,
    params: req.params,
    query: req.query,
  };

  fs.appendFile(logFilePath, JSON.stringify(logData, null, 2) + "\n", (err) => {
    if (err) {
      console.error("Failed to write log:", err);
    }
  });

  console.log(`Logged action: ${req.method} ${req.originalUrl}`);
  next();
}

module.exports = { logAction };