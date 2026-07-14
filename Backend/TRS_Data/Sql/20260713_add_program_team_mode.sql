IF COL_LENGTH('dbo.Programs', 'TeamMode') IS NULL
BEGIN
    ALTER TABLE dbo.Programs
        ADD TeamMode bit NOT NULL
            CONSTRAINT DF_Programs_TeamMode DEFAULT (0);
END
