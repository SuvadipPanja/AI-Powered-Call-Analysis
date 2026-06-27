/*
 * Migration: 004_db_comprehensive.sql
 * Purpose: BankSettings v2 columns, indexes, views, cleanup unused tables
 * Safe to run multiple times (idempotent).
 * Run: docker exec -i ai_call_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -C -d call_analysis_db -i /path/to/004_db_comprehensive.sql
 */

-- BankSettings table + new columns
IF OBJECT_ID('dbo.BankSettings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.BankSettings (
        SettingID           INT NOT NULL PRIMARY KEY DEFAULT 1,
        BankName            NVARCHAR(200) NOT NULL DEFAULT N'Call Center',
        BankNameLocal       NVARCHAR(200) NULL,
        GlossaryJson        NVARCHAR(MAX) NULL,
        ProductTermsJson    NVARCHAR(MAX) NULL,
        NonBankingTermsJson NVARCHAR(MAX) NULL,
        TabooWordsJson      NVARCHAR(MAX) NULL,
        ScriptTargetsJson   NVARCHAR(MAX) NULL,
        UpdatedAt           DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy           NVARCHAR(100) NULL,
        CONSTRAINT CK_BankSettings_SingleRow CHECK (SettingID = 1)
    );
END
GO

IF COL_LENGTH('dbo.BankSettings', 'NonBankingTermsJson') IS NULL
    ALTER TABLE dbo.BankSettings ADD NonBankingTermsJson NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.BankSettings', 'TabooWordsJson') IS NULL
    ALTER TABLE dbo.BankSettings ADD TabooWordsJson NVARCHAR(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.BankSettings WHERE SettingID = 1)
BEGIN
    INSERT INTO dbo.BankSettings (SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson)
    VALUES (1, N'Call Center', N'', N'[]', N'[]');
END
GO

-- CallProcessingLog
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
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CallProcessingLog_AudioFileName')
    CREATE INDEX IX_CallProcessingLog_AudioFileName ON dbo.CallProcessingLog (AudioFileName, CreatedAt DESC);
GO

-- Drop unused legacy tables (not referenced in app code)
IF OBJECT_ID('dbo.BankingOptionsLog', 'U') IS NOT NULL DROP TABLE dbo.BankingOptionsLog;
GO
IF OBJECT_ID('dbo.BankingRates', 'U') IS NOT NULL DROP TABLE dbo.BankingRates;
GO

-- Views
IF OBJECT_ID('dbo.vw_Consolidated_Call_Summary', 'V') IS NOT NULL
    DROP VIEW dbo.vw_Consolidated_Call_Summary;
GO
CREATE VIEW dbo.vw_Consolidated_Call_Summary AS
SELECT
    UploadID, UploadDate, AudioFileName, AgentName, AgentID, AgentLocation,
    SelectedCallDate, CallType, Status, AudioLanguage, AudioDuration, AudioWPM,
    AI_Overall_Scoring, ScriptCompliance, AI_Call_Type, AI_Resolution_Status,
    AI_Rude_Behavior, TotalDurationOfAIProcessing
FROM dbo.Consolidated_Audio_Analysis WITH (NOLOCK);
GO

IF OBJECT_ID('dbo.vw_BankSettings_Active', 'V') IS NOT NULL
    DROP VIEW dbo.vw_BankSettings_Active;
GO
CREATE VIEW dbo.vw_BankSettings_Active AS
SELECT TOP 1
    SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
    NonBankingTermsJson, TabooWordsJson, ScriptTargetsJson, UpdatedAt, UpdatedBy
FROM dbo.BankSettings WITH (NOLOCK)
WHERE SettingID = 1;
GO

-- Key indexes (skip if column missing — defensive)
IF OBJECT_ID('dbo.Consolidated_Audio_Analysis', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AudioFileName') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CAA_AudioFileName')
        CREATE UNIQUE INDEX IX_CAA_AudioFileName ON dbo.Consolidated_Audio_Analysis (AudioFileName);
    IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'SelectedCallDate') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CAA_SelectedCallDate')
        CREATE INDEX IX_CAA_SelectedCallDate ON dbo.Consolidated_Audio_Analysis (SelectedCallDate);
    IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'Status') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CAA_Status')
        CREATE INDEX IX_CAA_Status ON dbo.Consolidated_Audio_Analysis (Status);
END
GO

UPDATE STATISTICS dbo.BankSettings WITH FULLSCAN;
GO
PRINT 'Migration 004_db_comprehensive.sql complete.';
GO
