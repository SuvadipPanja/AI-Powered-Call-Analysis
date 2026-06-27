-- Phase 2b: consolidated results table (ResultPage tabs + reports)
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

    CREATE UNIQUE INDEX IX_Consolidated_Audio_Analysis_AudioFileName
        ON dbo.Consolidated_Audio_Analysis (AudioFileName);
END
GO
