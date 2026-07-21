-- Removes deprecated event-level capacity. Program capacity remains in Programs.MaxParticipants.
IF COL_LENGTH('dbo.Events', 'MaxParticipants') IS NOT NULL
BEGIN
    DECLARE @defaultConstraintName sysname;

    SELECT @defaultConstraintName = dc.name
    FROM sys.default_constraints dc
    INNER JOIN sys.columns c ON c.default_object_id = dc.object_id
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = 'dbo'
      AND t.name = 'Events'
      AND c.name = 'MaxParticipants';

    IF @defaultConstraintName IS NOT NULL
        EXEC('ALTER TABLE dbo.Events DROP CONSTRAINT [' + @defaultConstraintName + ']');

    ALTER TABLE dbo.Events DROP COLUMN MaxParticipants;
END;
GO
