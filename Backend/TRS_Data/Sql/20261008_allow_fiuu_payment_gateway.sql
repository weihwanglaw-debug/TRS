-- Prepared for review; not executed automatically. Select the intended TRS database first.
-- Widens the existing Payments gateway check. No data updates/deletions or gateway switch.
-- ALTER TABLE briefly requires a schema lock; apply during a quiet period.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.Payments', N'U') IS NULL
    THROW 50000, 'Payments table is missing.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.Payments') AND name = N'CK_Payments_Gateway')
    THROW 50000, 'Expected CK_Payments_Gateway constraint is missing; review schema first.', 1;
-- Preserve any existing gateway rules; add only Fiuu. Safe to rerun.
DECLARE @existing nvarchar(max) = (SELECT definition FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.Payments') AND name = N'CK_Payments_Gateway');
IF @existing NOT LIKE N'%''Fiuu''%'
BEGIN
    ALTER TABLE dbo.Payments DROP CONSTRAINT CK_Payments_Gateway;
    EXEC(N'ALTER TABLE dbo.Payments WITH CHECK ADD CONSTRAINT CK_Payments_Gateway CHECK (('
        + @existing + N') OR [PaymentGateway] = ''Fiuu'');');
END;
COMMIT TRANSACTION;
SELECT name, definition FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.Payments') AND name = N'CK_Payments_Gateway';

-- Rollback for the verified original local schema (execute separately only if needed):
-- First select Stripe in Master Config. Do not delete Fiuu history to force rollback.
-- IF EXISTS (SELECT 1 FROM dbo.Payments WHERE PaymentGateway NOT IN ('Manual','PayNow','Stripe'))
--     THROW 50000, 'Additional gateway history exists; retain the widened constraint.', 1;
-- BEGIN TRANSACTION;
-- ALTER TABLE dbo.Payments DROP CONSTRAINT CK_Payments_Gateway;
-- ALTER TABLE dbo.Payments WITH CHECK ADD CONSTRAINT CK_Payments_Gateway
--     CHECK (PaymentGateway IN ('Manual','PayNow','Stripe'));
-- COMMIT TRANSACTION;
