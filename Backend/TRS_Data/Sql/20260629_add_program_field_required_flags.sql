/*
    Adds independent mandatory flags for built-in program participant fields.

    Impact:
      - Additive only. No existing data is removed or rewritten.
      - Existing programs keep all built-in fields non-mandatory by default.
      - Custom field mandatory behavior remains in ProgramCustomFields.IsRequired.

    Rollback:
      ALTER TABLE dbo.ProgramFields DROP COLUMN RequireTshirt;
      ALTER TABLE dbo.ProgramFields DROP COLUMN RequireRemark;
      ALTER TABLE dbo.ProgramFields DROP COLUMN RequireGuardianInfo;
      ALTER TABLE dbo.ProgramFields DROP COLUMN RequireDocumentUpload;
      ALTER TABLE dbo.ProgramFields DROP COLUMN RequireSbaId;
*/

IF COL_LENGTH('dbo.ProgramFields', 'RequireSbaId') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD RequireSbaId bit NOT NULL
            CONSTRAINT DF_ProgramFields_RequireSbaId DEFAULT (0);
END;

IF COL_LENGTH('dbo.ProgramFields', 'RequireDocumentUpload') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD RequireDocumentUpload bit NOT NULL
            CONSTRAINT DF_ProgramFields_RequireDocumentUpload DEFAULT (0);
END;

IF COL_LENGTH('dbo.ProgramFields', 'RequireGuardianInfo') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD RequireGuardianInfo bit NOT NULL
            CONSTRAINT DF_ProgramFields_RequireGuardianInfo DEFAULT (0);
END;

IF COL_LENGTH('dbo.ProgramFields', 'RequireRemark') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD RequireRemark bit NOT NULL
            CONSTRAINT DF_ProgramFields_RequireRemark DEFAULT (0);
END;

IF COL_LENGTH('dbo.ProgramFields', 'RequireTshirt') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD RequireTshirt bit NOT NULL
            CONSTRAINT DF_ProgramFields_RequireTshirt DEFAULT (0);
END;
