/*
    Add waived item status support.

    Impact:
      - Additive status expansion for dbo.PaymentItems.ItemStatus.
      - Allows item-level reports to show W = Waived when an admin waives a payment.
      - Normalizes any legacy long item labels.
      - Backfills active items under waived payments from P/S to W.
      - Does not touch refunded or cancelled items.

    Rollback strategy:
      - Before restoring the previous constraint, convert any ItemStatus = 'W'
        rows to an allowed legacy status such as 'P' after confirming the
        business impact.
      - Then replace CK_PaymentItems_ItemStatus with the previous
        CHECK (ItemStatus IN ('P', 'S', 'R', 'X')) constraint.
*/

IF OBJECT_ID('dbo.PaymentItems', 'U') IS NOT NULL
BEGIN
    DECLARE @PaymentItemStatusConstraint sysname;

    SELECT TOP (1) @PaymentItemStatusConstraint = cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.PaymentItems')
      AND cc.definition LIKE '%ItemStatus%';

    IF @PaymentItemStatusConstraint IS NOT NULL
    BEGIN
        DECLARE @DropPaymentItemStatusConstraintSql nvarchar(max) =
            N'ALTER TABLE dbo.PaymentItems DROP CONSTRAINT ' + QUOTENAME(@PaymentItemStatusConstraint) + N';';

        EXEC sys.sp_executesql @DropPaymentItemStatusConstraintSql;
    END;

    UPDATE dbo.PaymentItems
       SET ItemStatus = CASE ItemStatus
           WHEN 'Pending'   THEN 'P'
           WHEN 'Success'   THEN 'S'
           WHEN 'Paid'      THEN 'S'
           WHEN 'Refunded'  THEN 'R'
           WHEN 'Cancelled' THEN 'X'
           WHEN 'Waived'    THEN 'W'
           ELSE ItemStatus
       END
    WHERE ItemStatus IN ('Pending', 'Success', 'Paid', 'Refunded', 'Cancelled', 'Waived');

    UPDATE pi
       SET pi.ItemStatus = 'W',
           pi.UpdatedAt = SYSUTCDATETIME()
    FROM dbo.PaymentItems pi
    INNER JOIN dbo.Payments p ON p.PaymentID = pi.PaymentID
    WHERE p.PaymentStatus IN ('W', 'Waived')
      AND pi.ItemStatus NOT IN ('R', 'X', 'W');

    ALTER TABLE dbo.PaymentItems
    ADD CONSTRAINT CK_PaymentItems_ItemStatus
        CHECK (ItemStatus IN ('P', 'S', 'R', 'X', 'W'));
END;
