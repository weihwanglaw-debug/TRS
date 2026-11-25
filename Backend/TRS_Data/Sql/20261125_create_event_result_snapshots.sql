SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.EventResultSnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EventResultSnapshots (
        EventId int NOT NULL CONSTRAINT PK_EventResultSnapshots PRIMARY KEY,
        Version bigint NOT NULL,
        Source varchar(3) NOT NULL,
        PayloadJson nvarchar(max) NOT NULL,
        ReceivedAt datetimeoffset NOT NULL,
        CONSTRAINT FK_EventResultSnapshots_Event FOREIGN KEY (EventId) REFERENCES dbo.Events(EventID) ON DELETE CASCADE,
        CONSTRAINT CK_EventResultSnapshots_Source CHECK (Source IN ('TLS', 'TRS')),
        CONSTRAINT CK_EventResultSnapshots_Json CHECK (ISJSON(PayloadJson) = 1),
        CONSTRAINT CK_EventResultSnapshots_Version CHECK (Version > 0)
    );
END;
COMMIT TRANSACTION;
