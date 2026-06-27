/**
 * Idempotent database migrations — runs on backend startup (dev + prod).
 * Creates/alters tables, indexes, views; removes confirmed-unused tables.
 */
const bankSettingsService = require("./bankSettingsService");
const { ensureSchema: ensureCallProcessingLogSchema } = require("./callProcessingLog");
const queryCategoryService = require("./queryCategoryService");

let migrated = false;

async function columnExists(pool, table, column) {
  const r = await pool.request()
    .input("table", table)
    .input("column", column)
    .query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @table AND COLUMN_NAME = @column
    `);
  return (r.recordset[0]?.cnt || 0) > 0;
}

async function tableExists(pool, table) {
  const r = await pool.request()
    .input("table", table)
    .query(`SELECT COUNT(*) AS cnt FROM sys.tables WHERE name = @table`);
  return (r.recordset[0]?.cnt || 0) > 0;
}

async function indexExists(pool, indexName, table) {
  const r = await pool.request()
    .input("indexName", indexName)
    .input("table", table)
    .query(`
      SELECT COUNT(*) AS cnt FROM sys.indexes
      WHERE name = @indexName AND object_id = OBJECT_ID('dbo.' + @table)
    `);
  return (r.recordset[0]?.cnt || 0) > 0;
}

async function ensureIndexes(pool) {
  const plan = [
    ["Consolidated_Audio_Analysis", "AudioFileName", "IX_CAA_AudioFileName", "UNIQUE"],
    ["Consolidated_Audio_Analysis", "SelectedCallDate", "IX_CAA_SelectedCallDate", ""],
    ["Consolidated_Audio_Analysis", "Status", "IX_CAA_Status", ""],
    ["Consolidated_Audio_Analysis", "AgentName", "IX_CAA_AgentName", ""],
    ["Consolidated_Audio_Analysis", "CallType", "IX_CAA_CallType", ""],
    ["Consolidated_Audio_Analysis", "UploadDate", "IX_CAA_UploadDate", ""],
    ["AI_Processing_Result", "AudioFileName", "IX_APR_AudioFileName", ""],
    ["AudioUploads", "AgentName", "IX_AU_AgentName", ""],
    ["AudioUploads", "UploadDate", "IX_AU_UploadDate", ""],
    ["ActiveSessions", "Token", "IX_ActiveSessions_Token", ""],
    ["CallAudits", "AudioFileName", "IX_CallAudits_AudioFileName", ""],
    ["CallProcessingLog", "AudioFileName", "IX_CallProcessingLog_AudioFileName", ""],
  ];

  for (const [table, column, indexName, uniqueFlag] of plan) {
    if (!(await tableExists(pool, table))) continue;
    if (!(await columnExists(pool, table, column))) continue;
    if (await indexExists(pool, indexName, table)) continue;
    const uniqueSql = uniqueFlag === "UNIQUE" ? "UNIQUE " : "";
    await pool.request().query(`
      CREATE ${uniqueSql}INDEX ${indexName} ON dbo.[${table}] ([${column}])
    `);
    console.log(`[db-migrate] Created index ${indexName} on ${table}.${column}`);
  }
}

async function ensureViews(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.vw_Consolidated_Call_Summary', 'V') IS NULL
    EXEC('
      CREATE VIEW dbo.vw_Consolidated_Call_Summary AS
      SELECT
        UploadID, UploadDate, AudioFileName, AgentName, AgentID, AgentLocation,
        SelectedCallDate, CallType, Status, AudioLanguage, AudioDuration, AudioWPM,
        AI_Overall_Scoring, ScriptCompliance, AI_Call_Type, AI_Resolution_Status,
        AI_Rude_Behavior, TotalDurationOfAIProcessing
      FROM dbo.Consolidated_Audio_Analysis WITH (NOLOCK)
    ')
  `);

  await pool.request().query(`
    IF OBJECT_ID('dbo.vw_BankSettings_Active', 'V') IS NULL
    EXEC('
      CREATE VIEW dbo.vw_BankSettings_Active AS
      SELECT TOP 1
        SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
        NonBankingTermsJson, TabooWordsJson, ScriptTargetsJson, UpdatedAt, UpdatedBy
      FROM dbo.BankSettings WITH (NOLOCK)
      WHERE SettingID = 1
    ')
  `);

  // Refresh view if BankSettings gained new columns (drop + recreate)
  if (await tableExists(pool, "BankSettings")) {
    const hasTaboo = await columnExists(pool, "BankSettings", "TabooWordsJson");
    if (hasTaboo) {
      await pool.request().query(`
        IF OBJECT_ID('dbo.vw_BankSettings_Active', 'V') IS NOT NULL
          DROP VIEW dbo.vw_BankSettings_Active;
      `);
      await pool.request().query(`
        CREATE VIEW dbo.vw_BankSettings_Active AS
        SELECT TOP 1
          SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
          NonBankingTermsJson, TabooWordsJson, ScriptTargetsJson, UpdatedAt, UpdatedBy
        FROM dbo.BankSettings WITH (NOLOCK)
        WHERE SettingID = 1
      `);
    }
  }
}

async function ensureCallIntelligenceColumns(pool) {
  // Phase 2d — per-call intelligence columns on Consolidated_Audio_Analysis.
  // Mirrors ai-mvp/db_schema.py :: ALTER_CAA_INTELLIGENCE_SQL so the schema is
  // guaranteed regardless of which service provisions it first.
  if (!(await tableExists(pool, "Consolidated_Audio_Analysis"))) return;
  const cols = [
    ["AI_Primary_Query_Type", "NVARCHAR(100)"],
    ["AI_Secondary_Query_Types", "NVARCHAR(MAX)"],
    ["AI_Escalation_Requested", "NVARCHAR(10)"],
    ["AI_Escalation_Actioned", "NVARCHAR(10)"],
    ["AI_Escalation_Category", "NVARCHAR(50)"],
    ["AI_CSAT_Transferred", "NVARCHAR(10)"],
    ["AI_Loan_Is_Loan_Call", "NVARCHAR(10)"],
    ["AI_Loan_Type", "NVARCHAR(50)"],
    ["AI_Loan_Interest", "NVARCHAR(20)"],
    ["AI_EMI_Affordability", "NVARCHAR(20)"],
    ["AI_EMI_Amount", "FLOAT"],
    ["AI_Loan_Amount", "FLOAT"],
    ["AI_Agent_Convinced", "NVARCHAR(20)"],
    ["AI_Loan_Success_Probability", "FLOAT"],
    ["AI_Intelligence_Summary", "NVARCHAR(MAX)"],
    ["AI_Call_Intelligence", "NVARCHAR(MAX)"],
  ];
  for (const [name, type] of cols) {
    if (await columnExists(pool, "Consolidated_Audio_Analysis", name)) continue;
    await pool.request().query(
      `ALTER TABLE dbo.Consolidated_Audio_Analysis ADD [${name}] ${type} NULL`
    );
    console.log(`[db-migrate] Added column Consolidated_Audio_Analysis.${name}`);
  }
}

async function dropUnusedTables(pool) {
  const unused = ["BankingOptionsLog", "BankingRates"];
  for (const table of unused) {
    if (!(await tableExists(pool, table))) continue;
    await pool.request().query(`DROP TABLE dbo.[${table}]`);
    console.log(`[db-migrate] Dropped unused table dbo.${table}`);
  }
}

async function updateStatistics(pool) {
  const tables = [
    "Consolidated_Audio_Analysis",
    "AI_Processing_Result",
    "AudioUploads",
    "BankSettings",
    "CallProcessingLog",
    "CallAudits",
  ];
  for (const table of tables) {
    if (!(await tableExists(pool, table))) continue;
    try {
      await pool.request().query(`UPDATE STATISTICS dbo.[${table}] WITH FULLSCAN`);
    } catch {
      await pool.request().query(`UPDATE STATISTICS dbo.[${table}]`);
    }
  }
}

/**
 * Run all migrations once per process.
 * @param {import('mssql').ConnectionPool} pool
 */
async function runDatabaseMigrations(pool) {
  if (migrated) return { ok: true, skipped: true };
  const steps = [];

  try {
    await bankSettingsService.ensureBankSettingsSchema(pool);
    steps.push("BankSettings");

    await ensureCallProcessingLogSchema(pool);
    steps.push("CallProcessingLog");

    // Call audits (idempotent)
    await pool.request().query(`
      IF OBJECT_ID('dbo.CallAudits', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.CallAudits (
          AuditID INT IDENTITY(1,1) PRIMARY KEY,
          AudioFileName NVARCHAR(500) NOT NULL,
          AuditorUsername NVARCHAR(100) NOT NULL,
          AuditorRole NVARCHAR(50) NOT NULL,
          AgentName NVARCHAR(200) NULL,
          AgentID NVARCHAR(100) NULL,
          AgentLocation NVARCHAR(200) NULL,
          AgentSupervisor NVARCHAR(200) NULL,
          OverallManualScore FLOAT NULL,
          OverallAIScore FLOAT NULL,
          OverallComments NVARCHAR(MAX) NULL,
          ToneNotes NVARCHAR(MAX) NULL,
          AIScoresSnapshot NVARCHAR(MAX) NULL,
          CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
          UpdatedAt DATETIME NULL,
          CONSTRAINT UQ_CallAudits_File UNIQUE (AudioFileName)
        );
      END
    `);
    steps.push("CallAudits");

    await ensureCallIntelligenceColumns(pool);
    steps.push("CallIntelligence");

    await queryCategoryService.ensureSchemaAndSeed(pool);
    steps.push("QueryCategories");

    await ensureIndexes(pool);
    steps.push("Indexes");

    await ensureViews(pool);
    steps.push("Views");

    await dropUnusedTables(pool);
    steps.push("Cleanup");

    await updateStatistics(pool);
    steps.push("Statistics");

    migrated = true;
    return { ok: true, steps };
  } catch (err) {
    console.error("[db-migrate] FAILED:", err.message);
    return { ok: false, error: err.message, steps };
  }
}

module.exports = { runDatabaseMigrations };
