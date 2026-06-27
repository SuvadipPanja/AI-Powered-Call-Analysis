"""DDL helpers for Phase 2b tables."""

CREATE_CONSOLIDATED_SQL = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Consolidated_Audio_Analysis'
)
BEGIN
    CREATE TABLE dbo.Consolidated_Audio_Analysis (
        UploadID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        UploadDate DATETIME NULL,
        AudioFileName NVARCHAR(500) NOT NULL,
        AgentName NVARCHAR(200) NULL,
        SelectedCallDate DATE NULL,
        CallType NVARCHAR(50) NULL,
        AgentID NVARCHAR(50) NULL,
        AgentLocation NVARCHAR(200) NULL,
        AgentSupervisor NVARCHAR(200) NULL,
        AgentManager NVARCHAR(200) NULL,
        AgentAuditor NVARCHAR(200) NULL,
        Status NVARCHAR(50) NULL,
        AudioLanguage NVARCHAR(50) NULL,
        AudioDuration NVARCHAR(50) NULL,
        AudioWPM FLOAT NULL,
        TotalDurationOfAIProcessing NVARCHAR(50) NULL,
        TranslateOutput NVARCHAR(MAX) NULL,
        ToneAnalysis NVARCHAR(MAX) NULL,
        Sentiment NVARCHAR(MAX) NULL,
        ScriptCompliance NVARCHAR(50) NULL,
        AIScoring FLOAT NULL,
        AI_Opening_Speech FLOAT NULL,
        AI_Empathy FLOAT NULL,
        AI_Query_Handling FLOAT NULL,
        AI_Adherence_to_Protocol FLOAT NULL,
        AI_Resolution_Assurance FLOAT NULL,
        AI_Query_Resolution FLOAT NULL,
        AI_Polite_Tone FLOAT NULL,
        AI_Authentication_Verification FLOAT NULL,
        AI_Escalation_Handling FLOAT NULL,
        AI_Closing_Speech FLOAT NULL,
        AI_Rude_Behavior NVARCHAR(20) NULL,
        AI_Overall_Scoring FLOAT NULL,
        AI_Call_Type NVARCHAR(100) NULL,
        AI_Lead_Classification NVARCHAR(100) NULL,
        AI_Resolution_Status NVARCHAR(100) NULL,
        AI_Feedback NVARCHAR(MAX) NULL,
        AI_Summary NVARCHAR(MAX) NULL,
        ManualScoring NVARCHAR(MAX) NULL,
        Manual_Opening_Speech FLOAT NULL,
        Manual_Empathy FLOAT NULL,
        Manual_Query_Handling FLOAT NULL,
        Manual_Adherence_to_Protocol FLOAT NULL,
        Manual_Resolution_Assurance FLOAT NULL,
        Manual_Query_Resolution FLOAT NULL,
        Manual_Polite_Tone FLOAT NULL,
        Manual_Authentication_Verification FLOAT NULL,
        Manual_Escalation_Handling FLOAT NULL,
        Manual_Closing_Speech FLOAT NULL,
        Manual_Rude_Behavior NVARCHAR(20) NULL,
        Manual_Overall_Scoring FLOAT NULL,
        Manual_Call_Type NVARCHAR(100) NULL,
        Manual_Lead_Classification NVARCHAR(100) NULL,
        Manual_Resolution_Status NVARCHAR(100) NULL,
        Manual_Feedback NVARCHAR(MAX) NULL,
        ManualScoredByUserID NVARCHAR(100) NULL,
        ErrorReason NVARCHAR(MAX) NULL
    );
END
"""

CREATE_CAA_INDEX_SQL = """
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Consolidated_Audio_Analysis_AudioFileName'
      AND object_id = OBJECT_ID('dbo.Consolidated_Audio_Analysis')
)
BEGIN
    CREATE UNIQUE INDEX IX_Consolidated_Audio_Analysis_AudioFileName
        ON dbo.Consolidated_Audio_Analysis (AudioFileName);
END
"""

ALTER_AUDIO_UPLOADS_PROGRESS_SQL = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessStage'
)
    ALTER TABLE dbo.AudioUploads ADD ProcessStage NVARCHAR(50) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessProgress'
)
    ALTER TABLE dbo.AudioUploads ADD ProcessProgress INT NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessMessage'
)
    ALTER TABLE dbo.AudioUploads ADD ProcessMessage NVARCHAR(500) NULL;
"""

def _add_caa_column_sql(column: str, col_type: str) -> str:
    return f"""
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Consolidated_Audio_Analysis'
      AND COLUMN_NAME = '{column}'
)
    ALTER TABLE dbo.Consolidated_Audio_Analysis ADD {column} {col_type};
"""


# Phase 2d — per-call intelligence columns (escalation, query category, loan/lead).
_CAA_INTELLIGENCE_COLUMNS = (
    ("AI_Primary_Query_Type", "NVARCHAR(100) NULL"),
    ("AI_Secondary_Query_Types", "NVARCHAR(MAX) NULL"),
    ("AI_Escalation_Requested", "NVARCHAR(10) NULL"),
    ("AI_Escalation_Actioned", "NVARCHAR(10) NULL"),
    ("AI_Escalation_Category", "NVARCHAR(50) NULL"),
    ("AI_CSAT_Transferred", "NVARCHAR(10) NULL"),
    ("AI_Loan_Is_Loan_Call", "NVARCHAR(10) NULL"),
    ("AI_Loan_Type", "NVARCHAR(50) NULL"),
    ("AI_Loan_Interest", "NVARCHAR(20) NULL"),
    ("AI_EMI_Affordability", "NVARCHAR(20) NULL"),
    ("AI_EMI_Amount", "FLOAT NULL"),
    ("AI_Loan_Amount", "FLOAT NULL"),
    ("AI_Agent_Convinced", "NVARCHAR(20) NULL"),
    ("AI_Loan_Success_Probability", "FLOAT NULL"),
    ("AI_Intelligence_Summary", "NVARCHAR(MAX) NULL"),
    ("AI_Call_Intelligence", "NVARCHAR(MAX) NULL"),
)

ALTER_CAA_INTELLIGENCE_SQL = "\n".join(
    _add_caa_column_sql(col, col_type) for col, col_type in _CAA_INTELLIGENCE_COLUMNS
)

ALTER_AI_RESULT_METADATA_SQL = """
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ASREngine'
)
    ALTER TABLE dbo.AI_Processing_Result ADD ASREngine NVARCHAR(200) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ScoringModel'
)
    ALTER TABLE dbo.AI_Processing_Result ADD ScoringModel NVARCHAR(100) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'TranslationModel'
)
    ALTER TABLE dbo.AI_Processing_Result ADD TranslationModel NVARCHAR(100) NULL;

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'OriginalLanguage'
)
    ALTER TABLE dbo.AI_Processing_Result ADD OriginalLanguage NVARCHAR(50) NULL;
"""
