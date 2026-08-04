/*
    Add an event-level max-programs-per-participant registration rule.

    Impact:
      - Adds Events.MaxProgramsPerParticipant as a nullable integer.
      - NULL means no restriction, preserving current behavior for existing events.
      - Values 1 through 8 are enforced by the application.

    Rollback:
      - Drop Events.MaxProgramsPerParticipant if the feature is removed.
*/

IF COL_LENGTH('dbo.Events', 'MaxProgramsPerParticipant') IS NULL
BEGIN
    ALTER TABLE dbo.Events
        ADD MaxProgramsPerParticipant int NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Events_MaxProgramsPerParticipant'
      AND parent_object_id = OBJECT_ID('dbo.Events')
)
BEGIN
    EXEC(N'
    ALTER TABLE dbo.Events
        ADD CONSTRAINT CK_Events_MaxProgramsPerParticipant
        CHECK (MaxProgramsPerParticipant IS NULL OR MaxProgramsPerParticipant BETWEEN 1 AND 8);
    ');
END;
