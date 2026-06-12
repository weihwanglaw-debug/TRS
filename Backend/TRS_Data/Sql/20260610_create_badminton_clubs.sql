IF OBJECT_ID(N'dbo.BadmintonClub', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.BadmintonClub
    (
        ClubId        int IDENTITY(1,1) NOT NULL,
        Name          nvarchar(255)     NOT NULL,
        ContactNumber nvarchar(50)      NULL,
        Email         nvarchar(255)     NULL,
        Address       nvarchar(500)     NULL,
        Country       nvarchar(100)     NULL,
        IsActive      bit               NOT NULL CONSTRAINT DF_BadmintonClub_IsActive DEFAULT (1),
        CreatedAt     datetime2(7)      NOT NULL CONSTRAINT DF_BadmintonClub_CreatedAt DEFAULT (getdate()),
        UpdatedAt     datetime2(7)      NULL,
        CONSTRAINT PK_BadmintonClub PRIMARY KEY CLUSTERED (ClubId)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_BadmintonClub_ActiveName'
      AND object_id = OBJECT_ID(N'dbo.BadmintonClub')
)
BEGIN
    CREATE UNIQUE INDEX UX_BadmintonClub_ActiveName
        ON dbo.BadmintonClub(Name)
        WHERE IsActive = 1;
END;
GO
