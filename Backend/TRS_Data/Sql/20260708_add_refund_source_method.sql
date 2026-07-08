IF COL_LENGTH('dbo.Refunds', 'RefundSource') IS NULL
BEGIN
    ALTER TABLE dbo.Refunds
        ADD RefundSource varchar(20) NULL;
END;
GO

IF COL_LENGTH('dbo.Refunds', 'RefundMethod') IS NULL
BEGIN
    ALTER TABLE dbo.Refunds
        ADD RefundMethod varchar(50) NULL;
END;
GO

UPDATE dbo.Refunds
SET
    RefundSource = 'System',
    RefundMethod = 'Gateway'
WHERE
    RefundSource IS NULL
    AND RefundMethod IS NULL
    AND GatewayRefundID IS NOT NULL;
GO
