/**
 * Production call-processing log — file + SQL Server (CallProcessingLog table).
 */
const fs = require("fs");
const path = require("path");
const { resolveProjectPath } = require("../projectPaths");

const LOG_DIR = resolveProjectPath(process.env.BACKEND_LOG_DIR || "/app/logs");
const LOG_FILE = path.join(LOG_DIR, process.env.CALL_PROCESSING_LOG_FILE || "call_processing.log");

let schemaReady = false;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeFileEntry(entry) {
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
}

async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.request().query(`
    IF OBJECT_ID('dbo.CallProcessingLog', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.CallProcessingLog (
        LogID         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        AudioFileName NVARCHAR(500) NULL,
        Service       NVARCHAR(50) NOT NULL,
        Stage         NVARCHAR(50) NULL,
        Level         NVARCHAR(20) NOT NULL,
        Message       NVARCHAR(MAX) NOT NULL,
        Detail        NVARCHAR(MAX) NULL,
        CreatedAt     DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_CallProcessingLog_AudioFileName
        ON dbo.CallProcessingLog (AudioFileName, CreatedAt DESC);
    END
  `);
  schemaReady = true;
}

/**
 * @param {import('mssql').ConnectionPool|null} pool
 */
async function logCallEvent(pool, {
  audioFile = null,
  stage = "",
  message = "",
  level = "INFO",
  service = "backend",
  detail = null,
}) {
  const entry = {
    ts: new Date().toISOString(),
    service,
    level: String(level).toUpperCase(),
    audioFile: audioFile || "",
    stage,
    message,
  };
  if (detail) entry.detail = String(detail).slice(0, 8000);
  try {
    writeFileEntry(entry);
  } catch (_) { /* ignore */ }

  if (!pool) return;
  try {
    await ensureSchema(pool);
    await pool.request()
      .input("audioFile", audioFile ? String(audioFile).slice(0, 500) : null)
      .input("service", String(service).slice(0, 50))
      .input("stage", stage ? String(stage).slice(0, 50) : null)
      .input("level", String(level).toUpperCase().slice(0, 20))
      .input("message", String(message).slice(0, 4000))
      .input("detail", detail ? String(detail).slice(0, 8000) : null)
      .query(`
        INSERT INTO dbo.CallProcessingLog (AudioFileName, Service, Stage, Level, Message, Detail)
        VALUES (@audioFile, @service, @stage, @level, @message, @detail)
      `);
  } catch (_) { /* non-fatal */ }
}

module.exports = { logCallEvent, ensureSchema, LOG_FILE };
