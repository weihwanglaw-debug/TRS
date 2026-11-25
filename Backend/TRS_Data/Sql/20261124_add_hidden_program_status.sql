-- Apply before deploying the API. Existing program statuses are retained.
-- Rollback: explicitly change hidden programs to CL before restoring the old constraint/API.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE parent_object_id = OBJECT_ID('dbo.Programs') AND name = 'CK_Programs_Status')
    ALTER TABLE dbo.Programs DROP CONSTRAINT CK_Programs_Status;
ALTER TABLE dbo.Programs WITH CHECK ADD CONSTRAINT CK_Programs_Status
    CHECK (Status IN ('O', 'CL', 'H'));
COMMIT TRANSACTION;
