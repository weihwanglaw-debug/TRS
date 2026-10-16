-- Additive; prepare/review separately from execution. No gateway is enabled.
-- Rollback before Fiuu use: revert application code, retain nullable fields/index.
-- Once submitted refunds exist, retain compatible callbacks/recovery until all obligations settle.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF COL_LENGTH('dbo.Refunds', 'GatewayRequestId') IS NULL
    ALTER TABLE dbo.Refunds ADD GatewayRequestId varchar(100) NULL;
IF COL_LENGTH('dbo.Refunds', 'GatewaySubmittedAt') IS NULL
    ALTER TABLE dbo.Refunds ADD GatewaySubmittedAt datetime2 NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Refunds') AND name = 'UQ_Refunds_GatewayRequest')
    EXEC('CREATE UNIQUE INDEX UQ_Refunds_GatewayRequest ON dbo.Refunds(PaymentGateway, GatewayRequestId) WHERE GatewayRequestId IS NOT NULL');
COMMIT TRANSACTION;
