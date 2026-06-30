/*
    Remove obsolete SBA-required program rule.

    Business rule:
      - ProgramFields.EnableSbaId controls whether the SBA ID field/lookup is displayed.
      - SBA ID is optional when displayed.
      - Registration must not be blocked because SBA ID is missing.

    Impact:
      - Drops dbo.Programs.SbaRequired.
      - Does not touch ProgramFields.EnableSbaId.
      - Does not touch SBA ranking import/lookup data.

    Rollback:
      ALTER TABLE dbo.Programs ADD SbaRequired bit NOT NULL
          CONSTRAINT DF_Programs_SbaRequired DEFAULT (0);
*/

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.Programs', 'SbaRequired') IS NOT NULL
BEGIN
    DECLARE @dropSql nvarchar(max) = N'';

    SELECT @dropSql = @dropSql
        + N'ALTER TABLE dbo.Programs DROP CONSTRAINT ' + QUOTENAME(dc.name) + N';'
    FROM sys.default_constraints dc
    JOIN sys.columns c
        ON c.object_id = dc.parent_object_id
       AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.Programs')
      AND c.name = N'SbaRequired';

    SELECT @dropSql = @dropSql
        + N'ALTER TABLE dbo.Programs DROP CONSTRAINT ' + QUOTENAME(cc.name) + N';'
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Programs')
      AND cc.definition LIKE N'%SbaRequired%';

    IF @dropSql <> N''
        EXEC sp_executesql @dropSql;

    ALTER TABLE dbo.Programs DROP COLUMN SbaRequired;
END;

COMMIT TRANSACTION;
