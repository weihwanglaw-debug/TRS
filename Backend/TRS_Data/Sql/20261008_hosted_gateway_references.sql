-- Apply after 20261008_payment_gateway_configuration.sql, before starting the updated API.
-- Additive only. No gateway is enabled or selected by this script.
-- Rollback: restore the previous application version; leave these nullable columns/indexes in place.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.PaymentAttempts', 'GatewayOrderId') IS NULL
    ALTER TABLE dbo.PaymentAttempts ADD GatewayOrderId varchar(100) NULL;
IF COL_LENGTH('dbo.PaymentAttempts', 'GatewayTransactionId') IS NULL
    ALTER TABLE dbo.PaymentAttempts ADD GatewayTransactionId varchar(255) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PaymentAttempts') AND name = 'UQ_PaymentAttempts_GatewayOrder')
    EXEC('CREATE UNIQUE INDEX UQ_PaymentAttempts_GatewayOrder ON dbo.PaymentAttempts(PaymentGateway, GatewayOrderId) WHERE GatewayOrderId IS NOT NULL');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PaymentAttempts') AND name = 'UQ_PaymentAttempts_GatewayTransaction')
    EXEC('CREATE UNIQUE INDEX UQ_PaymentAttempts_GatewayTransaction ON dbo.PaymentAttempts(PaymentGateway, GatewayTransactionId) WHERE GatewayTransactionId IS NOT NULL');
COMMIT TRANSACTION;
