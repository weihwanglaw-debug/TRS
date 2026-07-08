-- Add event-level registration status.
-- Impact: additive nullable-safe column with default "open"; existing events remain open.
-- Rollback: drop CK_Events_RegistrationStatus, DF_Events_RegistrationStatus, then drop Events.RegistrationStatus.

IF COL_LENGTH('dbo.Events', 'RegistrationStatus') IS NULL
BEGIN
    ALTER TABLE dbo.Events
        ADD RegistrationStatus varchar(20) NOT NULL
            CONSTRAINT DF_Events_RegistrationStatus DEFAULT ('open');
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = 'CK_Events_RegistrationStatus'
      AND parent_object_id = OBJECT_ID('dbo.Events')
)
BEGIN
    ALTER TABLE dbo.Events
        ADD CONSTRAINT CK_Events_RegistrationStatus
        CHECK (RegistrationStatus IN ('open', 'paused', 'closed'));
END;
GO
