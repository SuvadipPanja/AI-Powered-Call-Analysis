-- Phase 2 — Agent hold-time detection columns on Consolidated_Audio_Analysis.
-- Mirrors ai-mvp/db_schema.py :: _CAA_INTELLIGENCE_COLUMNS hold fields.

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Hold_Detected') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Hold_Detected NVARCHAR(10) NULL;

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Hold_Count') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Hold_Count INT NULL;

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Hold_Total_Sec') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Hold_Total_Sec FLOAT NULL;

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Hold_Longest_Sec') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Hold_Longest_Sec FLOAT NULL;

IF COL_LENGTH('dbo.Consolidated_Audio_Analysis', 'AI_Hold_Events') IS NULL
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD AI_Hold_Events NVARCHAR(MAX) NULL;
