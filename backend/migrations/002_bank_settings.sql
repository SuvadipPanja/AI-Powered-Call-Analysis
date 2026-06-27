/*
 * Migration: 002_bank_settings.sql (updated)
 * Purpose: Bank configuration for AI translation and compliance
 */

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BankSettings')
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

    INSERT INTO dbo.BankSettings (SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson)
    VALUES (1, N'Call Center', N'', N'[]', N'[]');

    PRINT 'Created table: BankSettings';
END
GO

IF COL_LENGTH('dbo.BankSettings', 'NonBankingTermsJson') IS NULL
    ALTER TABLE dbo.BankSettings ADD NonBankingTermsJson NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('dbo.BankSettings', 'TabooWordsJson') IS NULL
    ALTER TABLE dbo.BankSettings ADD TabooWordsJson NVARCHAR(MAX) NULL;
GO
