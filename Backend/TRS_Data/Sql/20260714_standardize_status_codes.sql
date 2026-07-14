/*
    Standardize persisted status values to short codes.

    Impact:
      - Updates existing mock/dev data from long status names to short codes.
      - Tightens selected status columns to varchar/char short-code lengths.
      - Replaces status CHECK/default constraints for the affected columns.
      - Converts fixture BracketStateJson match status values from text to short codes.

    Rollback:
      - Restore from backup, or run an inverse mapping script before reverting code.
      - This script is data-changing but non-destructive: it does not drop tables,
        columns, rows, or business records.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @sql nvarchar(max);

DECLARE @targets TABLE
(
    SchemaName sysname NOT NULL,
    TableName  sysname NOT NULL,
    ColumnName sysname NOT NULL
);

INSERT INTO @targets (SchemaName, TableName, ColumnName)
VALUES
    ('dbo', 'Events',             'RegistrationStatus'),
    ('dbo', 'Programs',           'Status'),
    ('dbo', 'EventRegistrations', 'RegStatus'),
    ('dbo', 'EventRegistrations', 'RegistrationStatus'),
    ('dbo', 'ParticipantGroups',  'GroupStatus'),
    ('dbo', 'Participants',       'ParticipantStatus'),
    ('dbo', 'Payments',           'PaymentStatus'),
    ('dbo', 'PaymentItems',       'ItemStatus'),
    ('dbo', 'Refunds',            'RefundStatus'),
    ('dbo', 'PaymentAttempts',    'Status'),
    ('dbo', 'WebhookLogs',        'ProcessingStatus');

DECLARE @statusIndexes TABLE
(
    SchemaName sysname NOT NULL,
    TableName  sysname NOT NULL,
    IndexName  sysname NOT NULL,
    DropSql    nvarchar(max) NOT NULL,
    CreateSql  nvarchar(max) NOT NULL
);

;WITH DependentIndexes AS
(
    SELECT DISTINCT
        s.name AS SchemaName,
        tbl.name AS TableName,
        i.object_id AS ObjectId,
        i.index_id AS IndexId,
        i.name AS IndexName,
        i.is_unique AS IsUnique,
        i.has_filter AS HasFilter,
        i.filter_definition AS FilterDefinition
    FROM @targets t
    JOIN sys.tables tbl
      ON tbl.object_id = OBJECT_ID(QUOTENAME(t.SchemaName) + '.' + QUOTENAME(t.TableName))
    JOIN sys.schemas s
      ON s.schema_id = tbl.schema_id
    JOIN sys.columns c
      ON c.object_id = tbl.object_id
     AND c.name = t.ColumnName
    JOIN sys.indexes i
      ON i.object_id = c.object_id
    WHERE i.type = 2
      AND i.is_primary_key = 0
      AND i.is_unique_constraint = 0
      AND (
          EXISTS (
              SELECT 1
              FROM sys.index_columns ic
              WHERE ic.object_id = c.object_id
                AND ic.index_id = i.index_id
                AND ic.column_id = c.column_id
          )
          OR (i.has_filter = 1 AND i.filter_definition LIKE '%' + QUOTENAME(t.ColumnName) + '%')
          OR (i.has_filter = 1 AND i.filter_definition LIKE '%' + t.ColumnName + '%')
      )
)
INSERT INTO @statusIndexes (SchemaName, TableName, IndexName, DropSql, CreateSql)
SELECT
    di.SchemaName,
    di.TableName,
    di.IndexName,
    N'DROP INDEX ' + QUOTENAME(di.IndexName) + N' ON ' + QUOTENAME(di.SchemaName) + N'.' + QUOTENAME(di.TableName) + N';',
    N'CREATE ' + CASE WHEN di.IsUnique = 1 THEN N'UNIQUE ' ELSE N'' END +
    N'NONCLUSTERED INDEX ' + QUOTENAME(di.IndexName) +
    N' ON ' + QUOTENAME(di.SchemaName) + N'.' + QUOTENAME(di.TableName) +
    N' (' + keyCols.KeyColumns + N')' +
    CASE WHEN includeCols.IncludeColumns IS NULL THEN N'' ELSE N' INCLUDE (' + includeCols.IncludeColumns + N')' END +
    CASE WHEN di.HasFilter = 1 AND di.FilterDefinition IS NOT NULL THEN N' WHERE ' + di.FilterDefinition ELSE N'' END +
    N';'
FROM DependentIndexes di
CROSS APPLY
(
    SELECT STUFF((
        SELECT N', ' + QUOTENAME(c.name) +
            CASE WHEN ic.is_descending_key = 1 THEN N' DESC' ELSE N' ASC' END
        FROM sys.index_columns ic
        JOIN sys.columns c
          ON c.object_id = ic.object_id
         AND c.column_id = ic.column_id
        WHERE ic.object_id = di.ObjectId
          AND ic.index_id = di.IndexId
          AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS KeyColumns
) keyCols
OUTER APPLY
(
    SELECT STUFF((
        SELECT N', ' + QUOTENAME(c.name)
        FROM sys.index_columns ic
        JOIN sys.columns c
          ON c.object_id = ic.object_id
         AND c.column_id = ic.column_id
        WHERE ic.object_id = di.ObjectId
          AND ic.index_id = di.IndexId
          AND ic.is_included_column = 1
        ORDER BY ic.index_column_id
        FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS IncludeColumns
) includeCols;

SELECT @sql = STRING_AGG(DropSql, CHAR(10)) FROM @statusIndexes;
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;

SELECT @sql = STRING_AGG(
    'ALTER TABLE ' + QUOTENAME(t.SchemaName) + '.' + QUOTENAME(t.TableName) +
    ' DROP CONSTRAINT ' + QUOTENAME(dc.name) + ';',
    CHAR(10))
FROM @targets t
JOIN sys.default_constraints dc
  ON dc.parent_object_id = OBJECT_ID(QUOTENAME(t.SchemaName) + '.' + QUOTENAME(t.TableName))
JOIN sys.columns c
  ON c.object_id = dc.parent_object_id
 AND c.column_id = dc.parent_column_id
 AND c.name = t.ColumnName;

IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;

SELECT @sql = STRING_AGG(
    'ALTER TABLE ' + QUOTENAME(s.name) + '.' + QUOTENAME(tbl.name) +
    ' DROP CONSTRAINT ' + QUOTENAME(cc.name) + ';',
    CHAR(10))
FROM @targets t
JOIN sys.tables tbl
  ON tbl.object_id = OBJECT_ID(QUOTENAME(t.SchemaName) + '.' + QUOTENAME(t.TableName))
JOIN sys.schemas s
  ON s.schema_id = tbl.schema_id
JOIN sys.check_constraints cc
  ON cc.parent_object_id = tbl.object_id
WHERE cc.definition LIKE '%' + t.ColumnName + '%';

IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;

UPDATE dbo.Events
SET RegistrationStatus = CASE RegistrationStatus
    WHEN 'open'   THEN 'O'
    WHEN 'paused' THEN 'PA'
    WHEN 'closed' THEN 'CL'
    WHEN 'draft'  THEN 'O'
    WHEN 'upcoming' THEN 'O'
    ELSE RegistrationStatus
END
WHERE RegistrationStatus IN ('open', 'paused', 'closed', 'draft', 'upcoming');

UPDATE dbo.Programs
SET Status = CASE Status
    WHEN 'open'     THEN 'O'
    WHEN 'closed'   THEN 'CL'
    WHEN 'upcoming' THEN 'O'
    WHEN 'full'     THEN 'O'
    WHEN 'not_full' THEN 'O'
    ELSE Status
END
WHERE Status IN ('open', 'closed', 'upcoming', 'full', 'not_full');

UPDATE dbo.EventRegistrations
SET RegStatus = CASE RegStatus
    WHEN 'Pending'           THEN 'P'
    WHEN 'Confirmed'         THEN 'C'
    WHEN 'Cancelled'         THEN 'X'
    WHEN 'CancelPending'     THEN 'CP'
    WHEN 'RefundFailed'      THEN 'RF'
    WHEN 'PartiallyRefunded' THEN 'RF'
    ELSE RegStatus
END
WHERE RegStatus IN ('Pending', 'Confirmed', 'Cancelled', 'CancelPending', 'RefundFailed', 'PartiallyRefunded');

UPDATE dbo.EventRegistrations
SET RegistrationStatus = CASE RegistrationStatus
    WHEN 'Pending'           THEN 'P'
    WHEN 'Confirmed'         THEN 'C'
    WHEN 'Cancelled'         THEN 'X'
    WHEN 'CancelPending'     THEN 'C'
    WHEN 'RefundFailed'      THEN 'C'
    WHEN 'PartiallyRefunded' THEN 'C'
    ELSE RegistrationStatus
END
WHERE RegistrationStatus IN ('Pending', 'Confirmed', 'Cancelled', 'CancelPending', 'RefundFailed', 'PartiallyRefunded');

UPDATE dbo.ParticipantGroups
SET GroupStatus = CASE GroupStatus
    WHEN 'Pending'       THEN 'P'
    WHEN 'Confirmed'     THEN 'C'
    WHEN 'Cancelled'     THEN 'X'
    WHEN 'CancelPending' THEN 'C'
    WHEN 'RefundFailed'  THEN 'C'
    ELSE GroupStatus
END
WHERE GroupStatus IN ('Pending', 'Confirmed', 'Cancelled', 'CancelPending', 'RefundFailed');

UPDATE dbo.Participants
SET ParticipantStatus = CASE ParticipantStatus
    WHEN 'Active'    THEN 'A'
    WHEN 'Cancelled' THEN 'X'
    ELSE ParticipantStatus
END
WHERE ParticipantStatus IN ('Active', 'Cancelled');

UPDATE dbo.Payments
SET PaymentStatus = CASE PaymentStatus
    WHEN 'Pending'           THEN 'P'
    WHEN 'Success'           THEN 'S'
    WHEN 'Paid'              THEN 'S'
    WHEN 'PartiallyRefunded' THEN 'PR'
    WHEN 'FullyRefunded'     THEN 'FR'
    WHEN 'Failed'            THEN 'F'
    WHEN 'Cancelled'         THEN 'X'
    WHEN 'Waived'            THEN 'W'
    WHEN 'PendingCollection' THEN 'PC'
    ELSE PaymentStatus
END
WHERE PaymentStatus IN ('Pending', 'Success', 'Paid', 'PartiallyRefunded', 'FullyRefunded', 'Failed', 'Cancelled', 'Waived', 'PendingCollection');

UPDATE dbo.PaymentItems
SET ItemStatus = CASE ItemStatus
    WHEN 'Pending'   THEN 'P'
    WHEN 'Success'   THEN 'S'
    WHEN 'Paid'      THEN 'S'
    WHEN 'Refunded'  THEN 'R'
    WHEN 'Cancelled' THEN 'X'
    ELSE ItemStatus
END
WHERE ItemStatus IN ('Pending', 'Success', 'Paid', 'Refunded', 'Cancelled');

UPDATE dbo.Refunds
SET RefundStatus = CASE RefundStatus
    WHEN 'Pending' THEN 'P'
    WHEN 'Success' THEN 'S'
    WHEN 'Failed'  THEN 'F'
    ELSE RefundStatus
END
WHERE RefundStatus IN ('Pending', 'Success', 'Failed');

UPDATE dbo.PaymentAttempts
SET Status = CASE Status
    WHEN 'Created'             THEN 'CR'
    WHEN 'Submitted'           THEN 'SB'
    WHEN 'Succeeded'           THEN 'S'
    WHEN 'Failed'              THEN 'F'
    WHEN 'Canceled'            THEN 'X'
    WHEN 'Cancelled'           THEN 'X'
    WHEN 'Expired'             THEN 'EX'
    WHEN 'NeedsReconciliation' THEN 'NR'
    ELSE Status
END
WHERE Status IN ('Created', 'Submitted', 'Succeeded', 'Failed', 'Canceled', 'Cancelled', 'Expired', 'NeedsReconciliation');

UPDATE dbo.WebhookLogs
SET ProcessingStatus = CASE ProcessingStatus
    WHEN 'Pending'    THEN 'P'
    WHEN 'Success'    THEN 'S'
    WHEN 'Failed'     THEN 'F'
    WHEN 'Ignored'    THEN 'I'
    WHEN 'Processing' THEN 'I'
    ELSE ProcessingStatus
END
WHERE ProcessingStatus IN ('Pending', 'Success', 'Failed', 'Ignored', 'Processing');

IF OBJECT_ID('dbo.Fixtures', 'U') IS NOT NULL
BEGIN
    UPDATE dbo.Fixtures
    SET BracketStateJson = REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(
            BracketStateJson,
            '"status":"Scheduled"', '"status":"SC"'),
            '"status":"Completed"', '"status":"C"'),
            '"status":"Walkover"',  '"status":"W"'),
            '"status":"InProgress"', '"status":"IP"')
    WHERE BracketStateJson LIKE '%"status":"Scheduled"%'
       OR BracketStateJson LIKE '%"status":"Completed"%'
       OR BracketStateJson LIKE '%"status":"Walkover"%'
       OR BracketStateJson LIKE '%"status":"InProgress"%';
END;

ALTER TABLE dbo.Events ALTER COLUMN RegistrationStatus varchar(2) NOT NULL;
ALTER TABLE dbo.Programs ALTER COLUMN Status varchar(2) NOT NULL;
ALTER TABLE dbo.EventRegistrations ALTER COLUMN RegStatus varchar(2) NOT NULL;
ALTER TABLE dbo.EventRegistrations ALTER COLUMN RegistrationStatus varchar(2) NOT NULL;
ALTER TABLE dbo.ParticipantGroups ALTER COLUMN GroupStatus varchar(2) NOT NULL;
ALTER TABLE dbo.Participants ALTER COLUMN ParticipantStatus varchar(1) NOT NULL;
ALTER TABLE dbo.Payments ALTER COLUMN PaymentStatus varchar(2) NOT NULL;
ALTER TABLE dbo.PaymentItems ALTER COLUMN ItemStatus varchar(2) NOT NULL;
ALTER TABLE dbo.Refunds ALTER COLUMN RefundStatus char(1) NOT NULL;
ALTER TABLE dbo.PaymentAttempts ALTER COLUMN Status varchar(2) NOT NULL;
ALTER TABLE dbo.WebhookLogs ALTER COLUMN ProcessingStatus varchar(1) NOT NULL;

ALTER TABLE dbo.Events
    ADD CONSTRAINT DF_Events_RegistrationStatus DEFAULT ('O') FOR RegistrationStatus,
        CONSTRAINT CK_Events_RegistrationStatus CHECK (RegistrationStatus IN ('O', 'PA', 'CL'));

ALTER TABLE dbo.Programs
    ADD CONSTRAINT DF_Programs_Status DEFAULT ('O') FOR Status,
        CONSTRAINT CK_Programs_Status CHECK (Status IN ('O', 'CL'));

ALTER TABLE dbo.EventRegistrations
    ADD CONSTRAINT DF_EventRegistrations_RegStatus DEFAULT ('P') FOR RegStatus,
        CONSTRAINT CK_EventRegistrations_RegStatus CHECK (RegStatus IN ('P', 'C', 'X', 'CP', 'RF'));

ALTER TABLE dbo.EventRegistrations
    ADD CONSTRAINT DF_EventRegistrations_RegistrationStatus DEFAULT ('P') FOR RegistrationStatus,
        CONSTRAINT CK_EventRegistrations_RegistrationStatus CHECK (RegistrationStatus IN ('P', 'C', 'X'));

ALTER TABLE dbo.ParticipantGroups
    ADD CONSTRAINT DF_ParticipantGroups_GroupStatus DEFAULT ('P') FOR GroupStatus,
        CONSTRAINT CK_ParticipantGroups_GroupStatus CHECK (GroupStatus IN ('P', 'C', 'X'));

ALTER TABLE dbo.Participants
    ADD CONSTRAINT DF_Participants_ParticipantStatus DEFAULT ('A') FOR ParticipantStatus,
        CONSTRAINT CK_Participants_ParticipantStatus CHECK (ParticipantStatus IN ('A', 'X'));

ALTER TABLE dbo.Payments
    ADD CONSTRAINT DF_Payments_PaymentStatus DEFAULT ('P') FOR PaymentStatus,
        CONSTRAINT CK_Payments_PaymentStatus CHECK (PaymentStatus IN ('P', 'S', 'PR', 'FR', 'F', 'X', 'W', 'PC'));

ALTER TABLE dbo.PaymentItems
    ADD CONSTRAINT DF_PaymentItems_ItemStatus DEFAULT ('P') FOR ItemStatus,
        CONSTRAINT CK_PaymentItems_ItemStatus CHECK (ItemStatus IN ('P', 'S', 'R', 'X'));

ALTER TABLE dbo.Refunds
    ADD CONSTRAINT DF_Refunds_RefundStatus DEFAULT ('P') FOR RefundStatus,
        CONSTRAINT CK_Refunds_RefundStatus CHECK (RefundStatus IN ('P', 'S', 'F'));

ALTER TABLE dbo.PaymentAttempts
    ADD CONSTRAINT DF_PaymentAttempts_Status DEFAULT ('CR') FOR Status,
        CONSTRAINT CK_PaymentAttempts_Status CHECK (Status IN ('CR', 'SB', 'S', 'F', 'X', 'EX', 'NR'));

ALTER TABLE dbo.WebhookLogs
    ADD CONSTRAINT DF_WebhookLogs_ProcessingStatus DEFAULT ('P') FOR ProcessingStatus,
        CONSTRAINT CK_WebhookLogs_ProcessingStatus CHECK (ProcessingStatus IN ('P', 'S', 'F', 'I'));

SELECT @sql = STRING_AGG(CreateSql, CHAR(10)) FROM @statusIndexes;
IF @sql IS NOT NULL EXEC sys.sp_executesql @sql;

COMMIT TRANSACTION;
