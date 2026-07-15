BEGIN TRANSACTION;

-- Event sport type is now binary at the event level.
-- Program.Type decides singles / pairs / team / custom behavior.
UPDATE dbo.Events
SET SportType = CASE
    WHEN SportType = 'Badminton' THEN 'Badminton'
    ELSE 'Non Badminton'
END
WHERE IsSports = 1;

-- Fixture results live inside Fixtures.BracketStateJson, so clearing Fixtures resets
-- generated fixtures and entered results for fresh testing.
DELETE FROM dbo.Fixtures;

-- Program.Type is now the sole source of truth for team-entry behavior.
-- Preserve old team-entry behavior before dropping the legacy TeamMode flag.
IF COL_LENGTH('dbo.Programs', 'TeamMode') IS NOT NULL
BEGIN
    UPDATE dbo.Programs
    SET Type = 'team'
    WHERE TeamMode = 1
      AND Type <> 'team';
END;

-- Optional: if test programs were closed only because fixtures were generated,
-- uncomment this line to reopen them for fresh fixture testing.
-- UPDATE dbo.Programs SET Status = 'O' WHERE Status = 'CL' AND IsActive = 1;

DECLARE @defaultConstraintName sysname;

SELECT @defaultConstraintName = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c
    ON c.default_object_id = dc.object_id
JOIN sys.tables t
    ON t.object_id = c.object_id
JOIN sys.schemas s
    ON s.schema_id = t.schema_id
WHERE s.name = 'dbo'
  AND t.name = 'Programs'
  AND c.name = 'TeamMode';

IF @defaultConstraintName IS NOT NULL
BEGIN
    DECLARE @dropConstraintSql nvarchar(max);
    SET @dropConstraintSql = N'ALTER TABLE dbo.Programs DROP CONSTRAINT ' + QUOTENAME(@defaultConstraintName);
    EXEC sp_executesql @dropConstraintSql;
END;

IF COL_LENGTH('dbo.Programs', 'TeamMode') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Programs DROP COLUMN TeamMode;
END;

COMMIT TRANSACTION;
