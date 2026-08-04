/*
    Add configurable T-shirt size options per program.

    Impact:
      - Adds ProgramFields.TshirtOptions for comma-separated admin-defined options.
      - Widens Participants.TshirtSize so custom labels such as "Adult XL" can be stored.
      - Existing programs keep current behavior by backfilling the current default size list.

    Rollback:
      - Only safe to shrink Participants.TshirtSize back to VARCHAR(5) after confirming no
        values exceed 5 characters.
      - ProgramFields.TshirtOptions can be dropped if no longer needed.
*/

IF COL_LENGTH('dbo.ProgramFields', 'TshirtOptions') IS NULL
BEGIN
    ALTER TABLE dbo.ProgramFields
        ADD TshirtOptions nvarchar(500) NULL;
END;

EXEC(N'
UPDATE dbo.ProgramFields
SET TshirtOptions = N''XS,S,M,L,XL,XXL,3XL''
WHERE EnableTshirt = 1
  AND NULLIF(LTRIM(RTRIM(TshirtOptions)), N'''') IS NULL;
');

IF COL_LENGTH('dbo.Participants', 'TshirtSize') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Participants
        ALTER COLUMN TshirtSize nvarchar(50) NULL;
END;
