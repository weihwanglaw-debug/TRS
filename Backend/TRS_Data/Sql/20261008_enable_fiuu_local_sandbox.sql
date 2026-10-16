-- LOCAL SANDBOX DATABASE ONLY. Review the selected database before execution.
-- Prepared, not executed. No schema changes and no gateway switch.
-- Application also requires Development + Fiuu:EnableSandboxCheckout + valid sandbox settings.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentGateways WHERE Code = 'Fiuu')
    THROW 50000, 'Fiuu catalog row missing. Apply gateway configuration setup first.', 1;
UPDATE dbo.PaymentGateways
SET EnabledForNewPayments = 1, UpdatedAt = SYSUTCDATETIME()
WHERE Code = 'Fiuu' AND EnabledForNewPayments = 0;
COMMIT TRANSACTION;
SELECT Code, EnabledForNewPayments FROM dbo.PaymentGateways;
SELECT ConfigValue AS ActiveGateway FROM dbo.SystemConfig WHERE ConfigKey = 'activePaymentGateway';

-- Then select Fiuu through superadmin Master Config and the existing Save action.
-- Rollback: select Stripe in Master Config FIRST, then run the following separately:
-- UPDATE dbo.PaymentGateways SET EnabledForNewPayments = 0, UpdatedAt = SYSUTCDATETIME() WHERE Code = 'Fiuu';
-- Disable Fiuu:EnableSandboxCheckout locally and restart the API.
-- Existing Fiuu payments/refunds must retain their original credentials/callbacks for servicing.
