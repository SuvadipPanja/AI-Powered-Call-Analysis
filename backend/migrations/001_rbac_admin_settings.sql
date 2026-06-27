/*
 * Migration: 001_rbac_admin_settings.sql
 * Purpose: Add Locations table, AppSettings table for RBAC + Admin Settings
 * Author: $Panja
 * Date: 2025-06-17
 * 
 * Run this against your SQL Server database before deploying the updated backend.
 * These are idempotent — safe to run multiple times.
 */

-- 1. Locations table (managed by admin, used for agent dropdowns)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Locations')
BEGIN
    CREATE TABLE dbo.Locations (
        LocationID   INT IDENTITY(1,1) PRIMARY KEY,
        LocationName NVARCHAR(200) NOT NULL UNIQUE,
        IsActive     BIT NOT NULL DEFAULT 1,
        CreatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt    DATETIME NULL
    );
    PRINT 'Created table: Locations';
END
GO

-- Seed Locations from existing Agents data
INSERT INTO dbo.Locations (LocationName)
SELECT DISTINCT LTRIM(RTRIM(agent_location))
FROM dbo.Agents
WHERE agent_location IS NOT NULL
  AND LTRIM(RTRIM(agent_location)) <> ''
  AND LTRIM(RTRIM(agent_location)) NOT IN (SELECT LocationName FROM dbo.Locations);
GO

-- 2. AppSettings table (key-value store for application configuration)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AppSettings')
BEGIN
    CREATE TABLE dbo.AppSettings (
        SettingID    INT IDENTITY(1,1) PRIMARY KEY,
        SettingKey   NVARCHAR(100) NOT NULL UNIQUE,
        SettingValue NVARCHAR(MAX) NULL,
        UpdatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy    NVARCHAR(100) NULL
    );
    PRINT 'Created table: AppSettings';

    -- Default settings
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES ('app_name', 'AI-Powered Call Analysis');
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES ('app_logo_url', '');
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES ('backup_enabled', 'false');
    INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES ('backup_path', '');
END
GO

-- 3. Ensure AccountType column exists on Users (it should already; this is a safety net)
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'AccountType'
)
BEGIN
    ALTER TABLE dbo.Users ADD AccountType NVARCHAR(50) NOT NULL DEFAULT 'Agent';
    PRINT 'Added AccountType column to Users';
END
GO

-- 4. Add Category column to AppSettings for grouping (idempotent)
IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AppSettings') AND name = 'Category'
)
BEGIN
    ALTER TABLE dbo.AppSettings ADD Category NVARCHAR(50) NULL DEFAULT 'general';
    PRINT 'Added Category column to AppSettings';
END
GO

-- 5. AdminAuditLog table for tracking admin actions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AdminAuditLog')
BEGIN
    CREATE TABLE dbo.AdminAuditLog (
        LogID        INT IDENTITY(1,1) PRIMARY KEY,
        Action       NVARCHAR(100) NOT NULL,
        EntityType   NVARCHAR(50)  NOT NULL,
        EntityID     NVARCHAR(100) NULL,
        Details      NVARCHAR(MAX) NULL,
        PerformedBy  NVARCHAR(100) NOT NULL,
        PerformedAt  DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE NONCLUSTERED INDEX IX_AdminAuditLog_PerformedAt
        ON dbo.AdminAuditLog (PerformedAt DESC);
    PRINT 'Created table: AdminAuditLog';
END
GO
