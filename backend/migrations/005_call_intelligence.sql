/*
 * Migration: 005_call_intelligence.sql
 * Purpose: Phase 2d per-call intelligence columns on Consolidated_Audio_Analysis
 *          (escalation, customer query category, loan/lead signals).
 * Safe to run multiple times (idempotent).
 * Run: docker exec -i ai_call_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -C -d call_analysis_db -i /path/to/005_call_intelligence.sql
 *
 * NOTE: The AI orchestrator also creates these columns at startup
 * (ai-mvp/db_schema.py :: ALTER_CAA_INTELLIGENCE_SQL). This migration keeps the
 * DB self-consistent for environments where the backend provisions the schema.
 */

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Primary_Query_Type') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Primary_Query_Type NVARCHAR(100) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Secondary_Query_Types') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Secondary_Query_Types NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Escalation_Requested') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Escalation_Requested NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Escalation_Actioned') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Escalation_Actioned NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Escalation_Category') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Escalation_Category NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_CSAT_Transferred') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_CSAT_Transferred NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Loan_Is_Loan_Call') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Loan_Is_Loan_Call NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Loan_Type') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Loan_Type NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Loan_Interest') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Loan_Interest NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_EMI_Affordability') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_EMI_Affordability NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_EMI_Amount') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_EMI_Amount FLOAT NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Loan_Amount') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Loan_Amount FLOAT NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Agent_Convinced') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Agent_Convinced NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Loan_Success_Probability') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Loan_Success_Probability FLOAT NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Intelligence_Summary') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Intelligence_Summary NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Call_Intelligence') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Call_Intelligence NVARCHAR(MAX) NULL;
GO
