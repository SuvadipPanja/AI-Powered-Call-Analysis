/**
 * Migration: Auto Upload settings and run history
 * Run against the application database (SQL Server).
 */

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AutoUploadSettings')
BEGIN
    CREATE TABLE dbo.AutoUploadSettings (
        SettingID          INT IDENTITY(1,1) PRIMARY KEY,
        AudioParentPath    NVARCHAR(1000) NOT NULL DEFAULT '',
        MetadataParentPath NVARCHAR(1000) NOT NULL DEFAULT '',
        DateMode           NVARCHAR(20) NOT NULL DEFAULT 'relative',
        OffsetDays         INT NOT NULL DEFAULT 1,
        SpecificDate       DATE NULL,
        Enabled            BIT NOT NULL DEFAULT 0,
        CronExpression     NVARCHAR(100) NOT NULL DEFAULT '1 0 * * *',
        UpdatedAt          DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy          NVARCHAR(100) NULL
    );
    INSERT INTO dbo.AutoUploadSettings (AudioParentPath, MetadataParentPath, DateMode, OffsetDays, Enabled, CronExpression)
    VALUES ('', '', 'relative', 1, 0, '1 0 * * *');
    PRINT 'Created table: AutoUploadSettings';
END;

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AutoUploadRunHistory')
BEGIN
    CREATE TABLE dbo.AutoUploadRunHistory (
        RunID            INT IDENTITY(1,1) PRIMARY KEY,
        StartedAt        DATETIME NOT NULL DEFAULT GETDATE(),
        FinishedAt       DATETIME NULL,
        Status           NVARCHAR(30) NOT NULL DEFAULT 'running',
        TriggeredBy      NVARCHAR(100) NULL,
        TargetDateFolder NVARCHAR(20) NULL,
        MetadataFile     NVARCHAR(1000) NULL,
        FilesFound       INT NOT NULL DEFAULT 0,
        FilesProcessed   INT NOT NULL DEFAULT 0,
        FilesSkipped     INT NOT NULL DEFAULT 0,
        FilesFailed      INT NOT NULL DEFAULT 0,
        ErrorMessage     NVARCHAR(MAX) NULL,
        DetailsJson      NVARCHAR(MAX) NULL
    );
    PRINT 'Created table: AutoUploadRunHistory';
END;
