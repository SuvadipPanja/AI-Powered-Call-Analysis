/*
 * Migration: 003_call_audits.sql
 * Purpose: Create CallAudits and CallAuditScores tables for Manual Audit System
 * Author: $Panja
 * Date: 2025-06-18
 *
 * Run this against your SQL Server database before deploying the updated backend.
 * These are idempotent — safe to run multiple times.
 */

-- 1. CallAudits — master audit record per call
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CallAudits')
BEGIN
    CREATE TABLE dbo.CallAudits (
        AuditID              INT IDENTITY(1,1) PRIMARY KEY,
        AudioFileName        NVARCHAR(500) NOT NULL,
        AuditorUsername      NVARCHAR(100) NOT NULL,
        AuditorRole          NVARCHAR(50)  NOT NULL,
        AgentName            NVARCHAR(200) NULL,
        AgentID              NVARCHAR(100) NULL,
        AgentLocation        NVARCHAR(200) NULL,
        AgentSupervisor      NVARCHAR(200) NULL,
        OverallManualScore   FLOAT         NULL,
        OverallAIScore       FLOAT         NULL,
        OverallComments      NVARCHAR(MAX) NULL,
        ToneNotes            NVARCHAR(MAX) NULL,
        AIScoresSnapshot     NVARCHAR(MAX) NULL,  -- JSON blob of AI scores at audit time
        CreatedAt            DATETIME      NOT NULL DEFAULT GETDATE(),
        UpdatedAt            DATETIME      NULL,
        CONSTRAINT UQ_CallAudits_File UNIQUE (AudioFileName)
    );
    PRINT 'Created table: CallAudits';
END
GO

-- 2. CallAuditScores — per-parameter scores with rationale
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'CallAuditScores')
BEGIN
    CREATE TABLE dbo.CallAuditScores (
        ScoreID          INT IDENTITY(1,1) PRIMARY KEY,
        AuditID          INT            NOT NULL,
        ParameterName    NVARCHAR(100)  NOT NULL,
        ManualScore      FLOAT          NULL,
        AIScore          FLOAT          NULL,
        Rationale        NVARCHAR(MAX)  NULL,
        CONSTRAINT FK_AuditScores_Audit FOREIGN KEY (AuditID) REFERENCES dbo.CallAudits(AuditID) ON DELETE CASCADE,
        CONSTRAINT UQ_AuditScores_Param UNIQUE (AuditID, ParameterName)
    );
    PRINT 'Created table: CallAuditScores';
END
GO

-- Indexes for common queries
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CallAudits_Auditor')
    CREATE INDEX IX_CallAudits_Auditor ON dbo.CallAudits (AuditorUsername);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CallAudits_Agent')
    CREATE INDEX IX_CallAudits_Agent ON dbo.CallAudits (AgentName);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CallAudits_CreatedAt')
    CREATE INDEX IX_CallAudits_CreatedAt ON dbo.CallAudits (CreatedAt);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CallAudits_Supervisor')
    CREATE INDEX IX_CallAudits_Supervisor ON dbo.CallAudits (AgentSupervisor);
GO

PRINT 'Migration 003_call_audits.sql complete.';
