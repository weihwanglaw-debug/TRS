IF OBJECT_ID('dbo.AdminAuditLogDetail', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AdminAuditLogDetail
    (
        AuditDetailID BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_AdminAuditLogDetail PRIMARY KEY,
        AuditID BIGINT NOT NULL,
        FieldName NVARCHAR(200) NOT NULL,
        OldValue NVARCHAR(MAX) NULL,
        NewValue NVARCHAR(MAX) NULL,
        ValueType VARCHAR(50) NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_AdminAuditLogDetail_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_AdminAuditLogDetail_AdminAuditLog
            FOREIGN KEY (AuditID) REFERENCES dbo.AdminAuditLog(AuditID)
            ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AdminAuditLogDetail_AuditID'
      AND object_id = OBJECT_ID('dbo.AdminAuditLogDetail')
)
BEGIN
    CREATE INDEX IX_AdminAuditLogDetail_AuditID
        ON dbo.AdminAuditLogDetail (AuditID);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AdminAuditLogDetail_FieldName'
      AND object_id = OBJECT_ID('dbo.AdminAuditLogDetail')
)
BEGIN
    CREATE INDEX IX_AdminAuditLogDetail_FieldName
        ON dbo.AdminAuditLogDetail (FieldName);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_AdminAuditLog_Entity'
      AND object_id = OBJECT_ID('dbo.AdminAuditLog')
)
BEGIN
    CREATE INDEX IX_AdminAuditLog_Entity
        ON dbo.AdminAuditLog (EntityType, EntityID, CreatedAt);
END;
