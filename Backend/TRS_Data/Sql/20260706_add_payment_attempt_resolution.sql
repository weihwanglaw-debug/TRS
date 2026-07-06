IF COL_LENGTH('dbo.PaymentAttempts', 'ResolvedAt') IS NULL
BEGIN
    ALTER TABLE dbo.PaymentAttempts ADD ResolvedAt datetime2(7) NULL;
END
GO

IF COL_LENGTH('dbo.PaymentAttempts', 'ResolvedBy') IS NULL
BEGIN
    ALTER TABLE dbo.PaymentAttempts ADD ResolvedBy nvarchar(256) NULL;
END
GO

IF COL_LENGTH('dbo.PaymentAttempts', 'ResolutionNote') IS NULL
BEGIN
    ALTER TABLE dbo.PaymentAttempts ADD ResolutionNote nvarchar(1000) NULL;
END
GO
