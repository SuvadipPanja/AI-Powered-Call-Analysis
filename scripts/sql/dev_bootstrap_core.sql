/*
 * dev_bootstrap_core.sql
 * ---------------------------------------------------------------------------
 * DEVELOPMENT-ONLY bootstrap for the core schema.
 *
 * In production these tables ship pre-created inside the proprietary
 * `call-analysis-db` SQL Server image. They are NOT created by the backend's
 * runtime migrations (services/dbMigrate.js) nor by the numbered SQL
 * migrations, so a fresh local SQL Server (e.g. mcr.microsoft.com/mssql/server)
 * has no core tables. This script creates the minimum needed to run the
 * backend + frontend locally (auth, sessions, users, agents, licensing).
 *
 * Idempotent: safe to run multiple times. Run against call_analysis_db.
 */

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserID                 INT IDENTITY(1,1) PRIMARY KEY,
        Username               NVARCHAR(100) NOT NULL,
        Password               NVARCHAR(255) NULL,
        Email                  NVARCHAR(255) NULL,
        AccountType            NVARCHAR(50)  NOT NULL DEFAULT 'Agent',
        SecurityQuestionType   NVARCHAR(200) NULL,
        SecurityQuestionAnswer NVARCHAR(255) NULL,
        LoginAlias             NVARCHAR(100) NULL,
        GovID                  NVARCHAR(100) NULL,
        CreatedBy              NVARCHAR(100) NULL,
        CreationDate           DATETIME NULL DEFAULT GETDATE()
    );
    PRINT 'Created table: Users';
END
GO

IF OBJECT_ID('dbo.UserSessionLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserSessionLog (
        LogID      INT IDENTITY(1,1) PRIMARY KEY,
        UserID     NVARCHAR(100) NULL,
        Username   NVARCHAR(100) NULL,
        UserType   NVARCHAR(50)  NULL,
        LoginTime  DATETIME NULL,
        LogoutTime DATETIME NULL
    );
    PRINT 'Created table: UserSessionLog';
END
GO

IF OBJECT_ID('dbo.ActiveSessions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ActiveSessions (
        SessionID           INT IDENTITY(1,1) PRIMARY KEY,
        UserID              NVARCHAR(100) NULL,
        Username            NVARCHAR(100) NULL,
        LogID               INT NULL,
        LoginTime           DATETIME NULL,
        LogoutTime          DATETIME NULL,
        IsActive            BIT NOT NULL DEFAULT 1,
        Token               NVARCHAR(255) NULL,
        SessionInactiveTime DATETIME NULL
    );
    PRINT 'Created table: ActiveSessions';
END
GO

IF OBJECT_ID('dbo.Agents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Agents (
        agent_id            NVARCHAR(100) NOT NULL PRIMARY KEY,
        agent_name          NVARCHAR(200) NOT NULL,
        agent_email         NVARCHAR(255) NULL,
        agent_mobile        NVARCHAR(50)  NULL,
        supervisor          NVARCHAR(200) NULL,
        agent_type          NVARCHAR(50)  NULL,
        manager             NVARCHAR(200) NULL,
        auditor             NVARCHAR(200) NULL,
        notes               NVARCHAR(MAX) NULL,
        agent_location      NVARCHAR(200) NULL,
        is_active           BIT NOT NULL DEFAULT 1,
        deactivated_date    DATETIME NULL,
        agent_creation_date DATETIME NULL DEFAULT GETDATE()
    );
    PRINT 'Created table: Agents';
END
GO

IF OBJECT_ID('dbo.Licenses', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Licenses (
        LicenseID  INT IDENTITY(1,1) PRIMARY KEY,
        LicenseKey NVARCHAR(MAX) NULL,
        UploadedBy NVARCHAR(100) NULL,
        CreatedAt  DATETIME NULL DEFAULT GETDATE(),
        IsActive   BIT NOT NULL DEFAULT 1,
        EndDate    DATETIME NULL,
        UpdatedAt  DATETIME NULL
    );
    PRINT 'Created table: Licenses';
END
GO

/* Base AI/pipeline tables. The Python AI service and runtime migrations ALTER
 * these to add columns, so the base table must exist first. Minimal columns
 * only; full processing requires the AI service (out of scope for local dev). */
IF OBJECT_ID('dbo.AudioUploads', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AudioUploads (
        UploadID         INT IDENTITY(1,1) PRIMARY KEY,
        AudioFileName    NVARCHAR(500) NOT NULL,
        AgentName        NVARCHAR(200) NULL,
        AgentID          NVARCHAR(100) NULL,
        SelectedCallDate DATE NULL,
        CallType         NVARCHAR(50) NULL,
        UploadDate       DATETIME NULL DEFAULT GETDATE(),
        Status           NVARCHAR(50) NULL,
        ProcessStage     NVARCHAR(50) NULL,
        ProcessProgress  INT NULL,
        ProcessMessage   NVARCHAR(500) NULL
    );
    PRINT 'Created table: AudioUploads';
END
GO

IF OBJECT_ID('dbo.AI_Processing_Result', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AI_Processing_Result (
        ResultID         INT IDENTITY(1,1) PRIMARY KEY,
        AudioFileName    NVARCHAR(500) NOT NULL,
        TranscribeOutput NVARCHAR(MAX) NULL,
        OriginalLanguage NVARCHAR(50) NULL,
        ASREngine        NVARCHAR(200) NULL,
        ScoringModel     NVARCHAR(100) NULL,
        TranslationModel NVARCHAR(100) NULL,
        Status           NVARCHAR(50) NULL
    );
    PRINT 'Created table: AI_Processing_Result';
END
GO

PRINT 'dev_bootstrap_core.sql complete.';
GO
