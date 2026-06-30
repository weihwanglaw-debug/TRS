/*
TRS test-data reset script.

Purpose:
- Clear registration, participant, payment, refund, pending checkout, webhook,
  payment audit, background job, and fixture records for a clean registration test.
- Keep event, program, program-field, custom-field, admin user, config, SBA,
  badminton club, upload, and logging tables intact.

Impact:
- Destructive for test registration/payment/fixture data.
- Does not call Stripe and does not refund live/test Stripe payments.
- Run only against a local/dev/test database.

Rollback:
- The script runs inside one transaction. Review the after-counts, then choose
  COMMIT or ROLLBACK at the bottom.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

PRINT 'Before cleanup';
SELECT 'Refunds' AS TableName, COUNT(*) AS [RowCount] FROM dbo.Refunds
UNION ALL SELECT 'PaymentAuditLog', COUNT(*) FROM dbo.PaymentAuditLog
UNION ALL SELECT 'WebhookLogs', COUNT(*) FROM dbo.WebhookLogs
UNION ALL SELECT 'PaymentItems', COUNT(*) FROM dbo.PaymentItems
UNION ALL SELECT 'Payments', COUNT(*) FROM dbo.Payments
UNION ALL SELECT 'EventParticipants', COUNT(*) FROM dbo.EventParticipants
UNION ALL SELECT 'ParticipantCustomFieldValues', COUNT(*) FROM dbo.ParticipantCustomFieldValues
UNION ALL SELECT 'Participants', COUNT(*) FROM dbo.Participants
UNION ALL SELECT 'ParticipantGroups', COUNT(*) FROM dbo.ParticipantGroups
UNION ALL SELECT 'EventRegistrations', COUNT(*) FROM dbo.EventRegistrations
UNION ALL SELECT 'PendingCheckouts', COUNT(*) FROM dbo.PendingCheckouts
UNION ALL SELECT 'BackgroundJobs', COUNT(*) FROM dbo.BackgroundJobs
UNION ALL SELECT 'Fixtures', COUNT(*) FROM dbo.Fixtures;

DELETE FROM dbo.Refunds;
DELETE FROM dbo.PaymentAuditLog;
DELETE FROM dbo.WebhookLogs;
DELETE FROM dbo.PaymentItems;
DELETE FROM dbo.Payments;
DELETE FROM dbo.EventParticipants;
DELETE FROM dbo.ParticipantCustomFieldValues;
DELETE FROM dbo.Participants;
DELETE FROM dbo.ParticipantGroups;
DELETE FROM dbo.EventRegistrations;
DELETE FROM dbo.PendingCheckouts;
DELETE FROM dbo.BackgroundJobs;
DELETE FROM dbo.Fixtures;

PRINT 'After cleanup';
SELECT 'Refunds' AS TableName, COUNT(*) AS [RowCount] FROM dbo.Refunds
UNION ALL SELECT 'PaymentAuditLog', COUNT(*) FROM dbo.PaymentAuditLog
UNION ALL SELECT 'WebhookLogs', COUNT(*) FROM dbo.WebhookLogs
UNION ALL SELECT 'PaymentItems', COUNT(*) FROM dbo.PaymentItems
UNION ALL SELECT 'Payments', COUNT(*) FROM dbo.Payments
UNION ALL SELECT 'EventParticipants', COUNT(*) FROM dbo.EventParticipants
UNION ALL SELECT 'ParticipantCustomFieldValues', COUNT(*) FROM dbo.ParticipantCustomFieldValues
UNION ALL SELECT 'Participants', COUNT(*) FROM dbo.Participants
UNION ALL SELECT 'ParticipantGroups', COUNT(*) FROM dbo.ParticipantGroups
UNION ALL SELECT 'EventRegistrations', COUNT(*) FROM dbo.EventRegistrations
UNION ALL SELECT 'PendingCheckouts', COUNT(*) FROM dbo.PendingCheckouts
UNION ALL SELECT 'BackgroundJobs', COUNT(*) FROM dbo.BackgroundJobs
UNION ALL SELECT 'Fixtures', COUNT(*) FROM dbo.Fixtures;

/*
Optional identity reseed for local-only tests.
Uncomment if you want IDs to restart from 1 after cleanup.

DBCC CHECKIDENT ('dbo.Refunds', RESEED, 0);
DBCC CHECKIDENT ('dbo.PaymentAuditLog', RESEED, 0);
DBCC CHECKIDENT ('dbo.WebhookLogs', RESEED, 0);
DBCC CHECKIDENT ('dbo.PaymentItems', RESEED, 0);
DBCC CHECKIDENT ('dbo.Payments', RESEED, 0);
DBCC CHECKIDENT ('dbo.EventParticipants', RESEED, 0);
DBCC CHECKIDENT ('dbo.ParticipantCustomFieldValues', RESEED, 0);
DBCC CHECKIDENT ('dbo.Participants', RESEED, 0);
DBCC CHECKIDENT ('dbo.ParticipantGroups', RESEED, 0);
DBCC CHECKIDENT ('dbo.EventRegistrations', RESEED, 0);
DBCC CHECKIDENT ('dbo.BackgroundJobs', RESEED, 0);
DBCC CHECKIDENT ('dbo.Fixtures', RESEED, 0);
*/

-- Choose one:
-- COMMIT TRANSACTION;
ROLLBACK TRANSACTION;
