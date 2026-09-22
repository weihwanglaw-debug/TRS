-- Adds an event-scoped list of SBA IDs that cannot use public registration.
-- Impact: additive table only; no existing event, registration, participant, or payment data is changed.
-- Deployment: run this script before deploying the API version that uses EventRestrictedSbaPlayers.
-- Rollback: deploy the previous API first, then drop dbo.EventRestrictedSbaPlayers if its audit/business data is no longer required.

IF OBJECT_ID('dbo.EventRestrictedSbaPlayers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.EventRestrictedSbaPlayers
    (
        EventRestrictedSbaPlayerID int IDENTITY(1,1) NOT NULL,
        EventID int NOT NULL,
        SbaID varchar(20) NOT NULL,
        PlayerNameSnapshot nvarchar(200) NOT NULL,
        CreatedAt datetime2(7) NOT NULL
            CONSTRAINT DF_EventRestrictedSbaPlayers_CreatedAt DEFAULT(sysutcdatetime()),
        CONSTRAINT PK_EventRestrictedSbaPlayers
            PRIMARY KEY CLUSTERED (EventRestrictedSbaPlayerID),
        CONSTRAINT FK_EventRestrictedSbaPlayers_Event
            FOREIGN KEY (EventID) REFERENCES dbo.Events(EventID) ON DELETE CASCADE,
        CONSTRAINT UQ_EventRestrictedSbaPlayers_Event_SbaID
            UNIQUE (EventID, SbaID)
    );
END;
GO
