/*
Production pre-launch reset. Run the ENTIRE file in one fresh SSMS query window.
Select the production TRS database yourself; there is deliberately no USE statement.

KEEP: AdminUsers, BadmintonClub, SbaRankings, SystemConfig (including all values).
DELETE: all rows in the 24 explicitly listed business/job/log tables below.
No schema changes, constraint disabling, identity reseeding, or Stripe API calls.
Uploads, IIS logs, server files, SQL transaction logs, and Stripe history are untouched.

Before EXECUTE:
1. Reconcile real Stripe payments/refunds (including the SGD 1.00 test). Resolve
   pending payments and old webhook retries; deleting logs removes deduplication history.
2. Stop the PROD API site AND its application pool; stop all other database writers.
   Do not disable the court-booking integration. Keep the API stopped until verified.
3. Take and verify a full database backup, preferably test-restoring it separately.
4. Run PREVIEW. Review every table/count and the reported ServerName.
5. Set @ExpectedServer to that exact verified server name, set @Mode = 'EXECUTE',
   and enter the confirmation phrase. Rerun the ENTIRE file.

EXECUTE commits automatically ONLY after postconditions pass. Errors roll back.
After commit, rollback requires restoring the backup; there is no SQL undo.
Large tables need transaction-log space. Do not kill SSMS while rollback is running.
The server/database guards identify the connection, not the physical VPS by themselves.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';
DECLARE @ExpectedServer nvarchar(128) = N'';
DECLARE @Confirmation nvarchar(100) = N'';

IF @@TRANCOUNT <> 0
    THROW 51000, 'Use a fresh query window with no open transaction.', 1;
IF (@@OPTIONS & 2) = 2
    THROW 51000, 'Turn IMPLICIT_TRANSACTIONS OFF before running this script.', 1;
IF DB_NAME() <> N'TRS'
    THROW 51000, 'Wrong database. Select production database TRS and rerun the entire file.', 1;
IF @Mode IS NULL OR @Mode NOT IN ('PREVIEW', 'EXECUTE')
    THROW 51000, 'Mode must be PREVIEW or EXECUTE.', 1;
IF ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL'), 0) <> 1
    THROW 51000, 'Database CONTROL permission is required for complete schema inspection.', 1;

SELECT CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS ServerName,
       DB_NAME() AS DatabaseName, @Mode AS RunMode;

IF @Mode = 'EXECUTE'
BEGIN
    IF NULLIF(@ExpectedServer, N'') IS NULL
       OR @ExpectedServer <> CONVERT(nvarchar(128), SERVERPROPERTY('ServerName'))
        THROW 51000, 'ExpectedServer must match the verified production server name.', 1;
    IF @Confirmation IS NULL OR @Confirmation <> N'RESET TRS KEEP MASTER AND USERS'
        THROW 51000, 'Execution confirmation phrase is missing or incorrect.', 1;
END;

DECLARE @Scope TABLE
(
    TableName sysname NOT NULL PRIMARY KEY,
    ActionName varchar(6) NOT NULL,
    ObjectId int NULL,
    BeforeRows bigint NULL,
    AfterRows bigint NULL,
    DeleteOrder int NULL
);

INSERT INTO @Scope (TableName, ActionName) VALUES
('AdminUsers', 'KEEP'),
('BadmintonClub', 'KEEP'),
('SbaRankings', 'KEEP'),
('SystemConfig', 'KEEP'),
('AdminAuditLogDetail', 'DELETE'),
('AdminAuditLog', 'DELETE'),
('AppLogs', 'DELETE'),
('BackgroundJobs', 'DELETE'),
('PaymentAuditLog', 'DELETE'),
('PendingCheckouts', 'DELETE'),
('PaymentAttempts', 'DELETE'),
('Refunds', 'DELETE'),
('WebhookLogs', 'DELETE'),
('PaymentItems', 'DELETE'),
('Payments', 'DELETE'),
('Fixtures', 'DELETE'),
('EventParticipants', 'DELETE'),
('ParticipantCustomFieldValues', 'DELETE'),
('Participants', 'DELETE'),
('ParticipantGroups', 'DELETE'),
('EventRegistrations', 'DELETE'),
('ProgramFields', 'DELETE'),
('ProgramCustomFields', 'DELETE'),
('Programs', 'DELETE'),
('EventRestrictedSbaPlayers', 'DELETE'),
('EventDocuments', 'DELETE'),
('EventGalleryImages', 'DELETE'),
('Events', 'DELETE');

UPDATE @Scope SET ObjectId = OBJECT_ID(N'dbo.' + QUOTENAME(TableName), N'U');
IF EXISTS (SELECT 1 FROM @Scope WHERE ObjectId IS NULL)
BEGIN
    SELECT TableName AS MissingTable FROM @Scope WHERE ObjectId IS NULL;
    THROW 51000, 'Expected tables are missing. Review schema; nothing has been deleted.', 1;
END;

-- Never infer that an unknown table is disposable, even when it is empty.
IF EXISTS (SELECT 1 FROM sys.tables t WHERE t.is_ms_shipped = 0
           AND NOT EXISTS (SELECT 1 FROM @Scope s WHERE s.ObjectId = t.object_id))
BEGIN
    SELECT SCHEMA_NAME(t.schema_id) AS SchemaName, t.name AS UnexpectedTable
    FROM sys.tables t WHERE t.is_ms_shipped = 0
      AND NOT EXISTS (SELECT 1 FROM @Scope s WHERE s.ObjectId = t.object_id);
    THROW 51000, 'Unreviewed tables exist. Review scope before resetting this database.', 1;
END;

IF EXISTS (SELECT 1 FROM sys.tables t JOIN @Scope s ON s.ObjectId = t.object_id
           WHERE t.temporal_type <> 0 OR t.is_memory_optimized = 1)
    THROW 51000, 'Temporal or memory-optimized tables require a separate reviewed reset.', 1;

IF EXISTS (SELECT 1 FROM sys.triggers tr JOIN @Scope s ON s.ObjectId = tr.parent_id
           WHERE s.ActionName = 'DELETE' AND tr.is_disabled = 0)
BEGIN
    SELECT s.TableName, tr.name AS EnabledTrigger
    FROM sys.triggers tr JOIN @Scope s ON s.ObjectId = tr.parent_id
    WHERE s.ActionName = 'DELETE' AND tr.is_disabled = 0;
    THROW 51000, 'Enabled triggers on deletion targets require review; none were disabled.', 1;
END;

-- Reject even disabled inbound FKs from retained data; do not cascade into KEEP tables.
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys fk
    JOIN @Scope target ON target.ObjectId = fk.referenced_object_id
    WHERE target.ActionName = 'DELETE'
      AND NOT EXISTS (SELECT 1 FROM @Scope child
                      WHERE child.ObjectId = fk.parent_object_id AND child.ActionName = 'DELETE')
)
    THROW 51000, 'A retained/out-of-scope table references a deletion target. Review dependency.', 1;

-- Calculate child-before-parent order from the actual database, including disabled FKs.
DECLARE @Step int = 0, @ObjectId int, @TableName sysname, @Sql nvarchar(max), @Rows bigint;
WHILE EXISTS (SELECT 1 FROM @Scope WHERE ActionName = 'DELETE' AND DeleteOrder IS NULL)
BEGIN
    SET @ObjectId = NULL;
    SELECT TOP (1) @ObjectId = s.ObjectId
    FROM @Scope s
    WHERE s.ActionName = 'DELETE' AND s.DeleteOrder IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM sys.foreign_keys fk
          JOIN @Scope child ON child.ObjectId = fk.parent_object_id
          WHERE fk.referenced_object_id = s.ObjectId
            AND child.ActionName = 'DELETE' AND child.DeleteOrder IS NULL
            AND child.ObjectId <> s.ObjectId
      )
    ORDER BY s.TableName;
    IF @ObjectId IS NULL
        THROW 51000, 'Cyclic dependencies require review. No constraints were disabled.', 1;
    SET @Step += 1;
    UPDATE @Scope SET DeleteOrder = @Step WHERE ObjectId = @ObjectId;
END;

BEGIN TRY
    IF @Mode = 'EXECUTE' BEGIN TRANSACTION;

    -- Execution locks all scope tables until commit, keeping baseline counts stable.
    DECLARE CountBefore CURSOR LOCAL FAST_FORWARD FOR
        SELECT TableName FROM @Scope ORDER BY TableName;
    OPEN CountBefore;
    FETCH NEXT FROM CountBefore INTO @TableName;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@TableName)
            + CASE WHEN @Mode = 'EXECUTE' THEN N' WITH (TABLOCKX, HOLDLOCK);' ELSE N';' END;
        EXEC sys.sp_executesql @Sql, N'@n bigint OUTPUT', @n = @Rows OUTPUT;
        UPDATE @Scope SET BeforeRows = @Rows WHERE TableName = @TableName;
        FETCH NEXT FROM CountBefore INTO @TableName;
    END;
    CLOSE CountBefore;
    DEALLOCATE CountBefore;

    SELECT ActionName, N'dbo.' + TableName AS TableName,
           BeforeRows AS [RowCount], DeleteOrder
    FROM @Scope ORDER BY ActionName DESC, DeleteOrder, TableName;

    IF @Mode = 'PREVIEW'
    BEGIN
        PRINT 'PREVIEW ONLY: No application data changed. Review counts and prerequisites before EXECUTE.';
        RETURN;
    END;

    DECLARE DeleteTables CURSOR LOCAL FAST_FORWARD FOR
        SELECT TableName FROM @Scope WHERE ActionName = 'DELETE' ORDER BY DeleteOrder;
    OPEN DeleteTables;
    FETCH NEXT FROM DeleteTables INTO @TableName;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Sql = N'DELETE FROM dbo.' + QUOTENAME(@TableName) + N';';
        EXEC sys.sp_executesql @Sql;
        FETCH NEXT FROM DeleteTables INTO @TableName;
    END;
    CLOSE DeleteTables;
    DEALLOCATE DeleteTables;

    DECLARE CountAfter CURSOR LOCAL FAST_FORWARD FOR
        SELECT TableName FROM @Scope ORDER BY TableName;
    OPEN CountAfter;
    FETCH NEXT FROM CountAfter INTO @TableName;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @Sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@TableName) + N';';
        EXEC sys.sp_executesql @Sql, N'@n bigint OUTPUT', @n = @Rows OUTPUT;
        UPDATE @Scope SET AfterRows = @Rows WHERE TableName = @TableName;
        FETCH NEXT FROM CountAfter INTO @TableName;
    END;
    CLOSE CountAfter;
    DEALLOCATE CountAfter;

    IF EXISTS (SELECT 1 FROM @Scope WHERE ActionName = 'DELETE' AND AfterRows <> 0)
        THROW 51000, 'A deletion target is not empty. Reset will be rolled back.', 1;
    IF EXISTS (SELECT 1 FROM @Scope WHERE ActionName = 'KEEP' AND AfterRows <> BeforeRows)
        THROW 51000, 'Retained table counts changed. Reset will be rolled back.', 1;

    COMMIT TRANSACTION;
    PRINT 'COMMITTED: Business and log data cleared; master data and users retained.';
    SELECT ActionName, N'dbo.' + TableName AS TableName, BeforeRows, AfterRows
    FROM @Scope ORDER BY ActionName DESC, TableName;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    -- Cursors can remain allocated after a statement error in the same session.
    IF CURSOR_STATUS('local', 'CountBefore') >= 0 CLOSE CountBefore;
    IF CURSOR_STATUS('local', 'CountBefore') >= -1 DEALLOCATE CountBefore;
    IF CURSOR_STATUS('local', 'DeleteTables') >= 0 CLOSE DeleteTables;
    IF CURSOR_STATUS('local', 'DeleteTables') >= -1 DEALLOCATE DeleteTables;
    IF CURSOR_STATUS('local', 'CountAfter') >= 0 CLOSE CountAfter;
    IF CURSOR_STATUS('local', 'CountAfter') >= -1 DEALLOCATE CountAfter;
    THROW;
END CATCH;
