-- Additive gateway configuration foundation. Run against the reviewed TRS database.
-- Stop the API before applying; deploy the matching code before restarting it.
-- No payment/refund rows are deleted or rewritten. Existing attempts are Stripe.
-- Re-runnable: existing catalog flags and the active selection are preserved.
-- Rollback: restore prior application code and leave these additive objects in place.
-- Do not drop this column/catalog after another provider has transactions.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.PaymentGateways', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PaymentGateways (
        Code varchar(32) NOT NULL CONSTRAINT PK_PaymentGateways PRIMARY KEY,
        DisplayName nvarchar(100) NOT NULL,
        EnabledForNewPayments bit NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL
    );
END;
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentGateways WHERE Code = 'Stripe')
    INSERT dbo.PaymentGateways VALUES ('Stripe', N'Stripe', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentGateways WHERE Code = 'Fiuu')
    INSERT dbo.PaymentGateways VALUES ('Fiuu', N'Fiuu', 0, SYSUTCDATETIME(), SYSUTCDATETIME());

IF COL_LENGTH('dbo.PaymentAttempts', 'PaymentGateway') IS NULL
    EXEC(N'ALTER TABLE dbo.PaymentAttempts ADD PaymentGateway varchar(32) NOT NULL
        CONSTRAINT DF_PaymentAttempts_PaymentGateway DEFAULT (''Stripe'') WITH VALUES;');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_PaymentAttempts_PaymentGateways')
    EXEC(N'ALTER TABLE dbo.PaymentAttempts WITH CHECK ADD CONSTRAINT FK_PaymentAttempts_PaymentGateways
        FOREIGN KEY (PaymentGateway) REFERENCES dbo.PaymentGateways(Code);');
IF NOT EXISTS (SELECT 1 FROM dbo.SystemConfig WHERE ConfigKey = 'activePaymentGateway')
    INSERT dbo.SystemConfig (ConfigKey, ConfigValue, UpdatedAt, UpdatedBy)
    VALUES ('activePaymentGateway', N'Stripe', SYSUTCDATETIME(), N'gateway-configuration-migration');

COMMIT TRANSACTION;
