-- Remove legacy event-level consent statement.
-- Impact: destructive schema cleanup; drops nullable dbo.Events.ConsentStatement.
-- Reason: consent text is managed globally through Master Config (consentText).
-- Rollback schema only:
--   ALTER TABLE dbo.Events ADD ConsentStatement nvarchar(max) NULL;
-- Note: dropped per-event values are not recoverable unless restored from backup.

IF COL_LENGTH('dbo.Events', 'ConsentStatement') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Events
        DROP COLUMN ConsentStatement;
END;
GO
