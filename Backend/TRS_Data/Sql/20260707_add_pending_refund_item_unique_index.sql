/*
    Purpose:
      Prevent duplicate in-flight refunds for the same normal PaymentItem.

    Impact:
      Adds a filtered unique index on dbo.Refunds(PaymentItemID) for pending
      refunds only. This is additive and does not block later partial refunds
      after a previous refund has moved out of Pending.

    Rollback:
      Drop UX_Refunds_Pending_PaymentItemID.
*/

IF OBJECT_ID('dbo.Refunds', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Refunds', 'PaymentItemID') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE name = 'UX_Refunds_Pending_PaymentItemID'
          AND object_id = OBJECT_ID('dbo.Refunds')
   )
BEGIN
    CREATE UNIQUE INDEX UX_Refunds_Pending_PaymentItemID
        ON dbo.Refunds(PaymentItemID)
        WHERE PaymentItemID IS NOT NULL
          AND RefundStatus = 'P';
END;
