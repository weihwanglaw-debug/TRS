IF OBJECT_ID('dbo.PaymentAttempts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentAttempts
    (
        PaymentAttemptID int IDENTITY(1,1) NOT NULL,
        AttemptKey varchar(120) NOT NULL,
        EventID int NOT NULL,
        ContactName nvarchar(200) NOT NULL CONSTRAINT DF_PaymentAttempts_ContactName DEFAULT(N''),
        ContactEmail nvarchar(255) NOT NULL CONSTRAINT DF_PaymentAttempts_ContactEmail DEFAULT(N''),
        ContactPhone varchar(30) NOT NULL CONSTRAINT DF_PaymentAttempts_ContactPhone DEFAULT(''),
        PaymentMethod varchar(20) NOT NULL CONSTRAINT DF_PaymentAttempts_PaymentMethod DEFAULT('CreditCard'),
        Amount decimal(10,2) NOT NULL,
        Currency varchar(3) NOT NULL CONSTRAINT DF_PaymentAttempts_Currency DEFAULT('SGD'),
        GatewayPaymentIntentID varchar(255) NULL,
        Status varchar(30) NOT NULL CONSTRAINT DF_PaymentAttempts_Status DEFAULT('Created'),
        PayloadJSON nvarchar(max) NOT NULL,
        LineItemsJSON nvarchar(max) NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_PaymentAttempts_CreatedAt DEFAULT(sysutcdatetime()),
        ExpiresAt datetime2(7) NOT NULL,
        SubmittedAt datetime2(7) NULL,
        SucceededAt datetime2(7) NULL,
        FinalizedAt datetime2(7) NULL,
        CanceledAt datetime2(7) NULL,
        FailedAt datetime2(7) NULL,
        RegistrationID int NULL,
        PaymentID int NULL,
        ReconciliationReason varchar(100) NULL,
        ErrorMessage nvarchar(1000) NULL,
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_PaymentAttempts_UpdatedAt DEFAULT(sysutcdatetime()),
        RowVersion rowversion NOT NULL,
        CONSTRAINT PK_PaymentAttempts PRIMARY KEY CLUSTERED (PaymentAttemptID),
        CONSTRAINT UQ_PaymentAttempts_AttemptKey UNIQUE (AttemptKey)
    );

    CREATE UNIQUE INDEX UQ_PaymentAttempts_GatewayPaymentIntentID
        ON dbo.PaymentAttempts(GatewayPaymentIntentID)
        WHERE GatewayPaymentIntentID IS NOT NULL;

    CREATE INDEX IX_PaymentAttempts_ActiveLookup
        ON dbo.PaymentAttempts(EventID, ContactEmail, Status);
END
GO
