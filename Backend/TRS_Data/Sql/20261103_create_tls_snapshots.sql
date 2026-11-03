-- Additive integration storage. Existing fixtures, registrations and payments are untouched.
-- Rollback: disable TLS publishing and restore the previous application; retain these tables.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.TlsLiveSnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TlsLiveSnapshots (
        EventId int NOT NULL CONSTRAINT PK_TlsLiveSnapshots PRIMARY KEY,
        Version bigint NOT NULL,
        PayloadJson nvarchar(max) NOT NULL,
        MatchCount int NOT NULL,
        ReceivedAt datetimeoffset NOT NULL,
        CONSTRAINT FK_TlsLiveSnapshots_Event FOREIGN KEY (EventId) REFERENCES dbo.Events(EventID) ON DELETE CASCADE,
        CONSTRAINT CK_TlsLiveSnapshots_Json CHECK (ISJSON(PayloadJson) = 1),
        CONSTRAINT CK_TlsLiveSnapshots_Version CHECK (Version > 0)
    );
END;
IF OBJECT_ID(N'dbo.TlsResultSnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TlsResultSnapshots (
        ProgramId int NOT NULL CONSTRAINT PK_TlsResultSnapshots PRIMARY KEY,
        EventId int NOT NULL,
        Version bigint NOT NULL,
        PayloadJson nvarchar(max) NOT NULL,
        ReceivedAt datetimeoffset NOT NULL,
        CONSTRAINT FK_TlsResultSnapshots_Program FOREIGN KEY (ProgramId) REFERENCES dbo.Programs(ProgramID) ON DELETE CASCADE,
        CONSTRAINT FK_TlsResultSnapshots_Event FOREIGN KEY (EventId) REFERENCES dbo.Events(EventID),
        CONSTRAINT CK_TlsResultSnapshots_Json CHECK (ISJSON(PayloadJson) = 1),
        CONSTRAINT CK_TlsResultSnapshots_Version CHECK (Version > 0)
    );
    CREATE INDEX IX_TlsResultSnapshots_EventId ON dbo.TlsResultSnapshots(EventId);
END;
COMMIT;
