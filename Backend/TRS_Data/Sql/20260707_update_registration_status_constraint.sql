/*
    Purpose:
      Allow the registration cancellation workflow statuses used by the API.

    Impact:
      Replaces only the RegStatus CHECK constraint on dbo.EventRegistrations.
      No data is changed.

    Rollback:
      Only rollback after changing/removing rows with RegStatus in
      ('CancelPending', 'RefundFailed'), then recreate the old narrower check.
*/

IF OBJECT_ID('dbo.EventRegistrations', 'U') IS NOT NULL
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = 'CK_Registrations_RegStatus'
          AND parent_object_id = OBJECT_ID('dbo.EventRegistrations')
    )
    BEGIN
        ALTER TABLE dbo.EventRegistrations
        DROP CONSTRAINT CK_Registrations_RegStatus;
    END;

    ALTER TABLE dbo.EventRegistrations
    ADD CONSTRAINT CK_Registrations_RegStatus
    CHECK (RegStatus IN (
        'Pending',
        'Confirmed',
        'Cancelled',
        'CancelPending',
        'RefundFailed'
    ));
END;
