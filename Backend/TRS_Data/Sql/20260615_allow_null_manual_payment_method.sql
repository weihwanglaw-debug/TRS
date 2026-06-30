/*
    TRS payment bypass cleanup

    Purpose:
      - Allow Payments.PaymentMethod to be NULL.
      - Preserve the existing allowed method values when a method is present.
      - Clear method/reference values for Waived and Pending Collection rows,
        because those statuses do not represent an actual collected payment.

    Rollback note:
      Before reverting PaymentMethod to NOT NULL, backfill NULL values first:
        UPDATE dbo.Payments SET PaymentMethod = 'Others' WHERE PaymentMethod IS NULL;
*/

BEGIN TRANSACTION;

DECLARE @constraintName sysname;

SELECT @constraintName = cc.name
FROM sys.check_constraints cc
JOIN sys.columns c
    ON c.object_id = cc.parent_object_id
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Payments')
  AND c.name = N'PaymentMethod'
  AND cc.definition LIKE N'%PaymentMethod%';

IF @constraintName IS NOT NULL
BEGIN
    DECLARE @dropSql nvarchar(max) =
        N'ALTER TABLE dbo.Payments DROP CONSTRAINT ' + QUOTENAME(@constraintName) + N';';
    EXEC sp_executesql @dropSql;
END;

ALTER TABLE dbo.Payments ALTER COLUMN PaymentMethod varchar(20) NULL;

ALTER TABLE dbo.Payments WITH CHECK ADD CONSTRAINT CK_Payments_Method
CHECK (
    PaymentMethod IS NULL
    OR PaymentMethod IN ('CreditCard', 'PayNow', 'Free', 'Cash', 'BankTransfer', 'Others')
);

UPDATE dbo.Payments
SET PaymentMethod = NULL,
    ReceiptNumber = NULL,
    PaidAt = NULL,
    UpdatedAt = SYSUTCDATETIME()
WHERE PaymentStatus IN ('W', 'PC');

COMMIT TRANSACTION;
