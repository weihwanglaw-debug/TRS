/*
    Purpose:
      Support explicit cancellation without refund at payment-item level and
      participant-level cancellation for per-player fee structures.

    Impact:
      - Adds dbo.Participants.ParticipantStatus if missing.
      - Replaces dbo.PaymentItems.ItemStatus CHECK constraint if present so
        X = Cancelled without refund is allowed.
      - No existing data is deleted or changed, except SQL Server backfills
        the new Participants.ParticipantStatus column with its default.

    Rollback:
      Only rollback after removing/handling rows where ItemStatus = 'X' or
      ParticipantStatus = 'Cancelled'. Then drop the added column and restore
      the previous CHECK constraint.
*/

IF OBJECT_ID('dbo.Participants', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Participants', 'ParticipantStatus') IS NULL
BEGIN
    ALTER TABLE dbo.Participants
    ADD ParticipantStatus varchar(15) NOT NULL
        CONSTRAINT DF_Participants_ParticipantStatus DEFAULT ('Active');

    EXEC sp_executesql N'
        ALTER TABLE dbo.Participants
        ADD CONSTRAINT CK_Participants_ParticipantStatus
            CHECK (ParticipantStatus IN (''Active'', ''Cancelled''));';
END;

IF OBJECT_ID('dbo.PaymentItems', 'U') IS NOT NULL
BEGIN
    DECLARE @PaymentItemStatusConstraint sysname;

    SELECT TOP (1) @PaymentItemStatusConstraint = cc.name
    FROM sys.check_constraints cc
    WHERE cc.parent_object_id = OBJECT_ID('dbo.PaymentItems')
      AND cc.definition LIKE '%ItemStatus%';

    IF @PaymentItemStatusConstraint IS NOT NULL
    BEGIN
        DECLARE @dropSql nvarchar(max) =
            N'ALTER TABLE dbo.PaymentItems DROP CONSTRAINT ' + QUOTENAME(@PaymentItemStatusConstraint) + N';';
        EXEC sp_executesql @dropSql;
    END;

    ALTER TABLE dbo.PaymentItems
    ADD CONSTRAINT CK_PaymentItems_ItemStatus
        CHECK (ItemStatus IN ('P', 'S', 'R', 'X'));
END;
