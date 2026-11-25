-- Additive: existing events remain unmarked. No business data is deleted.
IF COL_LENGTH('dbo.Events', 'ReadyForEventIntegration') IS NULL
    ALTER TABLE dbo.Events ADD ReadyForEventIntegration bit NOT NULL
        CONSTRAINT DF_Events_ReadyForEventIntegration DEFAULT (0);
-- Rollback: restore the previous application. The unused column may remain.
