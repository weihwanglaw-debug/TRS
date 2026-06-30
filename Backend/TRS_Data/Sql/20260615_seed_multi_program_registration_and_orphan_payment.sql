/*
TRS test-data seed: multi-program registration + unmatched Stripe payment.

Purpose:
- Add one confirmed paid registration under EventID 1 with:
  - Men's Singles x 2 entries
  - Mixed Doubles x 1 entry
- Add one unmatched paid Stripe webhook row for the admin payment reconciliation page.

Impact:
- Additive only. Does not delete or update existing registration/payment records.
- Does not modify event/program setup.
- The orphan webhook will appear in Payment Reconciliation because it has no
  matching Payments.GatewaySessionID.

Important Stripe note:
- If @OrphanGatewaySessionId is fake, the row is useful for UI/reconciliation-list
  testing, but the actual refund action will fail when the backend asks Stripe
  for that session.
- For end-to-end refund testing, replace @OrphanGatewaySessionId with a real
  paid Stripe test Checkout Session ID that has not been linked to any Payment row.

Rollback:
- Run the DELETE block at the bottom using the printed IDs, or run this script
  inside a transaction and change COMMIT to ROLLBACK before execution.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @EventId int = 1;
DECLARE @SinglesProgramId int = 1;
DECLARE @MixedProgramId int = 3;
DECLARE @Now datetime2 = SYSUTCDATETIME();

DECLARE @OrphanGatewaySessionId varchar(255) = 'cs_test_unmatched_manual_20260615_001';
DECLARE @OrphanGatewayEventId varchar(255) = CONCAT('evt_test_unmatched_manual_', FORMAT(@Now, 'yyyyMMddHHmmssfff'));
DECLARE @OrphanAmount decimal(10,2) = 125.00;

IF NOT EXISTS (SELECT 1 FROM dbo.Events WHERE EventID = @EventId)
    THROW 51000, 'EventID 1 not found.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.Programs WHERE ProgramID = @SinglesProgramId AND EventID = @EventId)
    THROW 51001, 'Men''s Singles ProgramID 1 not found for EventID 1.', 1;

IF NOT EXISTS (SELECT 1 FROM dbo.Programs WHERE ProgramID = @MixedProgramId AND EventID = @EventId)
    THROW 51002, 'Mixed Doubles ProgramID 3 not found for EventID 1.', 1;

IF EXISTS (SELECT 1 FROM dbo.Payments WHERE GatewaySessionID = @OrphanGatewaySessionId)
    THROW 51003, 'The orphan GatewaySessionID already exists in Payments, so it will not appear as unmatched.', 1;

DECLARE
    @EventName nvarchar(300),
    @SinglesProgramName nvarchar(300),
    @MixedProgramName nvarchar(300),
    @SinglesFee decimal(10,2),
    @MixedFee decimal(10,2),
    @SinglesFeeStructure varchar(10),
    @MixedFeeStructure varchar(10),
    @SinglesPaymentRequired bit,
    @MixedPaymentRequired bit;

SELECT @EventName = [Name]
FROM dbo.Events
WHERE EventID = @EventId;

SELECT
    @SinglesProgramName = [Name],
    @SinglesFee = Fee,
    @SinglesFeeStructure = FeeStructure,
    @SinglesPaymentRequired = PaymentRequired
FROM dbo.Programs
WHERE ProgramID = @SinglesProgramId;

SELECT
    @MixedProgramName = [Name],
    @MixedFee = Fee,
    @MixedFeeStructure = FeeStructure,
    @MixedPaymentRequired = PaymentRequired
FROM dbo.Programs
WHERE ProgramID = @MixedProgramId;

DECLARE
    @SinglesGroupFee decimal(10,2) = CASE WHEN @SinglesPaymentRequired = 1 THEN @SinglesFee ELSE 0 END,
    @MixedGroupFee decimal(10,2) = CASE
        WHEN @MixedPaymentRequired = 0 THEN 0
        WHEN LOWER(@MixedFeeStructure) = 'per_player' THEN @MixedFee * 2
        ELSE @MixedFee
    END;

DECLARE @TotalAmount decimal(10,2) = (@SinglesGroupFee * 2) + @MixedGroupFee;
DECLARE @RegistrationId int;

INSERT INTO dbo.EventRegistrations
(
    EventID, EventName, SubmittedAt, RegStatus,
    ContactName, ContactEmail, ContactPhone,
    UpdatedAt, NumberOfParticipants, TotalAmount, Currency,
    RegistrationStatus, CreatedAt, ConfirmedAt
)
VALUES
(
    @EventId, @EventName, @Now, 'Confirmed',
    N'Nadia Lim Hui Min', N'nadia.lim@example.com', '9123 6845',
    @Now, 4, @TotalAmount, 'SGD',
    'C', @Now, @Now
);

SET @RegistrationId = CONVERT(int, SCOPE_IDENTITY());

DECLARE @Groups table
(
    GroupKey varchar(20) NOT NULL,
    GroupId int NOT NULL
);

INSERT INTO dbo.ParticipantGroups
(
    RegistrationID, EventID, ProgramID, ProgramName, Fee,
    GroupStatus, Seed, ClubDisplay, NamesDisplay, CreatedAt, UpdatedAt
)
OUTPUT 'MS1', inserted.GroupID INTO @Groups
VALUES
(
    @RegistrationId, @EventId, @SinglesProgramId, @SinglesProgramName, @SinglesGroupFee,
    'Confirmed', NULL, N'Singapore Badminton Academy', N'Adrian Koh Jun Wei', @Now, @Now
);

INSERT INTO dbo.ParticipantGroups
(
    RegistrationID, EventID, ProgramID, ProgramName, Fee,
    GroupStatus, Seed, ClubDisplay, NamesDisplay, CreatedAt, UpdatedAt
)
OUTPUT 'MS2', inserted.GroupID INTO @Groups
VALUES
(
    @RegistrationId, @EventId, @SinglesProgramId, @SinglesProgramName, @SinglesGroupFee,
    'Confirmed', NULL, N'Jurong East Sports Club', N'Muhammad Danish Bin Rahman', @Now, @Now
);

INSERT INTO dbo.ParticipantGroups
(
    RegistrationID, EventID, ProgramID, ProgramName, Fee,
    GroupStatus, Seed, ClubDisplay, NamesDisplay, CreatedAt, UpdatedAt
)
OUTPUT 'XD1', inserted.GroupID INTO @Groups
VALUES
(
    @RegistrationId, @EventId, @MixedProgramId, @MixedProgramName, @MixedGroupFee,
    'Confirmed', NULL, N'ActiveSG Badminton Academy', N'Jonathan Teo Wei Han / Amelia Wong Li En', @Now, @Now
);

DECLARE @Participants table
(
    ParticipantKey varchar(20) NOT NULL,
    ParticipantId int NOT NULL,
    GroupKey varchar(20) NOT NULL,
    FullName nvarchar(200) NOT NULL
);

INSERT INTO dbo.Participants
(
    GroupID, FullName, DateOfBirth, Gender, Nationality, ClubSchoolCompany,
    Email, ContactNumber, TshirtSize, SbaId, GuardianName, GuardianContact,
    DocumentUrl, Remark, CreatedAt, UpdatedAt
)
OUTPUT 'MS1A', inserted.ParticipantID, 'MS1', inserted.FullName INTO @Participants
SELECT
    g.GroupId, N'Adrian Koh Jun Wei', '2001-04-18', 'Male', N'Singaporean', N'Singapore Badminton Academy',
    N'adrian.koh@example.com', '8123 4567', 'M', 'LOCAL-MP-001', NULL, NULL,
    NULL, N'Multi-program test registration - singles entry 1.', @Now, @Now
FROM @Groups g
WHERE g.GroupKey = 'MS1';

INSERT INTO dbo.Participants
(
    GroupID, FullName, DateOfBirth, Gender, Nationality, ClubSchoolCompany,
    Email, ContactNumber, TshirtSize, SbaId, GuardianName, GuardianContact,
    DocumentUrl, Remark, CreatedAt, UpdatedAt
)
OUTPUT 'MS2A', inserted.ParticipantID, 'MS2', inserted.FullName INTO @Participants
SELECT
    g.GroupId, N'Muhammad Danish Bin Rahman', '1999-09-07', 'Male', N'Singaporean', N'Jurong East Sports Club',
    N'danish.rahman@example.com', '8234 5678', 'L', 'LOCAL-MP-002', NULL, NULL,
    NULL, N'Multi-program test registration - singles entry 2.', @Now, @Now
FROM @Groups g
WHERE g.GroupKey = 'MS2';

INSERT INTO dbo.Participants
(
    GroupID, FullName, DateOfBirth, Gender, Nationality, ClubSchoolCompany,
    Email, ContactNumber, TshirtSize, SbaId, GuardianName, GuardianContact,
    DocumentUrl, Remark, CreatedAt, UpdatedAt
)
OUTPUT 'XD1A', inserted.ParticipantID, 'XD1', inserted.FullName INTO @Participants
SELECT
    g.GroupId, N'Jonathan Teo Wei Han', '1998-02-13', 'Male', N'Singaporean', N'ActiveSG Badminton Academy',
    N'jonathan.teo@example.com', '8345 6789', 'M', 'LOCAL-MP-003A', NULL, NULL,
    NULL, N'Multi-program test registration - mixed doubles male player.', @Now, @Now
FROM @Groups g
WHERE g.GroupKey = 'XD1';

INSERT INTO dbo.Participants
(
    GroupID, FullName, DateOfBirth, Gender, Nationality, ClubSchoolCompany,
    Email, ContactNumber, TshirtSize, SbaId, GuardianName, GuardianContact,
    DocumentUrl, Remark, CreatedAt, UpdatedAt
)
OUTPUT 'XD1B', inserted.ParticipantID, 'XD1', inserted.FullName INTO @Participants
SELECT
    g.GroupId, N'Amelia Wong Li En', '2000-11-22', 'Female', N'Singaporean', N'ActiveSG Badminton Academy',
    N'amelia.wong@example.com', '8456 7890', 'S', 'LOCAL-MP-003B', NULL, NULL,
    NULL, N'Multi-program test registration - mixed doubles female player.', @Now, @Now
FROM @Groups g
WHERE g.GroupKey = 'XD1';

DECLARE @PaymentId int;
DECLARE @GatewaySessionId varchar(255) = CONCAT('cs_test_multi_program_', @RegistrationId);
DECLARE @GatewayPaymentId varchar(255) = CONCAT('pi_test_multi_program_', @RegistrationId);
DECLARE @GatewayChargeId varchar(255) = CONCAT('ch_test_multi_program_', @RegistrationId);

INSERT INTO dbo.Payments
(
    RegistrationID, EventID, PaymentGateway, GatewaySessionID, GatewayPaymentID, GatewayChargeID,
    PaymentMethod, Amount, Currency, PaymentStatus, ReceiptNumber,
    PaymentGatewayResponse, AdminNote, CreatedAt, UpdatedAt, PaidAt
)
VALUES
(
    @RegistrationId, @EventId, 'stripe', @GatewaySessionId, @GatewayPaymentId, @GatewayChargeId,
    'CreditCard', @TotalAmount, 'SGD', 'S', CONCAT('TRS-', FORMAT(@Now, 'yyyyMMdd'), '-', RIGHT(CONCAT('00000', @RegistrationId), 5)),
    N'{"seeded":true,"scenario":"multi_program_registration"}',
    N'Seeded paid multi-program registration for admin testing.', @Now, @Now, @Now
);

SET @PaymentId = CONVERT(int, SCOPE_IDENTITY());

IF LOWER(@SinglesFeeStructure) = 'per_player'
BEGIN
    INSERT INTO dbo.PaymentItems
    (
        PaymentID, GroupID, ParticipantID, EventID, ProgramID, ProgramName,
        Description, PlayerName, Amount, ItemStatus, CreatedAt, UpdatedAt
    )
    SELECT
        @PaymentId, g.GroupId, p.ParticipantId, @EventId, @SinglesProgramId, @SinglesProgramName,
        CONCAT(@SinglesProgramName, ' - ', p.FullName), p.FullName, @SinglesGroupFee, 'S', @Now, @Now
    FROM @Groups g
    JOIN @Participants p ON p.GroupKey = g.GroupKey
    WHERE g.GroupKey IN ('MS1', 'MS2');
END
ELSE
BEGIN
    INSERT INTO dbo.PaymentItems
    (
        PaymentID, GroupID, ParticipantID, EventID, ProgramID, ProgramName,
        Description, PlayerName, Amount, ItemStatus, CreatedAt, UpdatedAt
    )
    SELECT
        @PaymentId, g.GroupId, NULL, @EventId, @SinglesProgramId, @SinglesProgramName,
        CONCAT(@SinglesProgramName, ' - ', pg.NamesDisplay), NULL, @SinglesGroupFee, 'S', @Now, @Now
    FROM @Groups g
    JOIN dbo.ParticipantGroups pg ON pg.GroupID = g.GroupId
    WHERE g.GroupKey IN ('MS1', 'MS2');
END

IF LOWER(@MixedFeeStructure) = 'per_player'
BEGIN
    INSERT INTO dbo.PaymentItems
    (
        PaymentID, GroupID, ParticipantID, EventID, ProgramID, ProgramName,
        Description, PlayerName, Amount, ItemStatus, CreatedAt, UpdatedAt
    )
    SELECT
        @PaymentId, g.GroupId, p.ParticipantId, @EventId, @MixedProgramId, @MixedProgramName,
        CONCAT(@MixedProgramName, ' - ', p.FullName), p.FullName, CASE WHEN @MixedPaymentRequired = 1 THEN @MixedFee ELSE 0 END, 'S', @Now, @Now
    FROM @Groups g
    JOIN @Participants p ON p.GroupKey = g.GroupKey
    WHERE g.GroupKey = 'XD1';
END
ELSE
BEGIN
    INSERT INTO dbo.PaymentItems
    (
        PaymentID, GroupID, ParticipantID, EventID, ProgramID, ProgramName,
        Description, PlayerName, Amount, ItemStatus, CreatedAt, UpdatedAt
    )
    SELECT
        @PaymentId, g.GroupId, NULL, @EventId, @MixedProgramId, @MixedProgramName,
        CONCAT(@MixedProgramName, ' - ', pg.NamesDisplay), NULL, @MixedGroupFee, 'S', @Now, @Now
    FROM @Groups g
    JOIN dbo.ParticipantGroups pg ON pg.GroupID = g.GroupId
    WHERE g.GroupKey = 'XD1';
END

INSERT INTO dbo.PaymentAuditLog
(
    EntityType, EntityID, Action, OldStatus, NewStatus, Reason,
    PerformedBy, IPAddress, Notes, CreatedAt
)
VALUES
(
    'Payment', @PaymentId, 'SeedPaidRegistration', NULL, 'S',
    'Seeded paid registration for multi-program admin test.',
    'admin', '127.0.0.1',
    CONCAT('RegistrationID=', @RegistrationId, '; PaymentID=', @PaymentId),
    @Now
);

INSERT INTO dbo.WebhookLogs
(
    PaymentID, PaymentGateway, GatewayEventID, GatewaySessionId, EventType,
    PayloadJSON, ProcessingStatus, ErrorMessage, ReceivedAt, ProcessedAt,
    ContactName, ContactEmail, ContactPhone, Amount, Currency
)
VALUES
(
    NULL, 'Stripe', @OrphanGatewayEventId, @OrphanGatewaySessionId, 'checkout.session.completed',
    CONCAT(
        '{"id":"', @OrphanGatewayEventId,
        '","type":"checkout.session.completed","data":{"object":{"id":"', @OrphanGatewaySessionId,
        '","payment_status":"paid","amount_total":', CAST(CAST(@OrphanAmount * 100 AS int) AS varchar(20)),
        ',"currency":"sgd","metadata":{"seeded":"true","scenario":"unmatched_payment_refund"}}}}'
    ),
    'F',
    'Seeded unmatched paid Stripe checkout session. Payment was collected but no registration/payment row was created.',
    @Now, @Now,
    N'Grace Tan Shu Hui', N'grace.tan@example.com', '8567 8901', @OrphanAmount, 'SGD'
);

DECLARE @WebhookLogId int = CONVERT(int, SCOPE_IDENTITY());

PRINT 'Seed completed.';
SELECT
    @RegistrationId AS RegistrationID,
    @PaymentId AS PaymentID,
    @WebhookLogId AS OrphanWebhookLogID,
    @TotalAmount AS RegistrationPaymentAmount,
    @OrphanGatewaySessionId AS OrphanGatewaySessionID,
    @OrphanAmount AS OrphanAmount;

SELECT
    er.RegistrationID,
    er.ContactName,
    er.TotalAmount,
    er.RegStatus,
    er.RegistrationStatus,
    p.PaymentID,
    p.PaymentStatus,
    p.GatewaySessionID
FROM dbo.EventRegistrations er
JOIN dbo.Payments p ON p.RegistrationID = er.RegistrationID
WHERE er.RegistrationID = @RegistrationId;

SELECT
    pg.GroupID,
    pg.ProgramName,
    pg.NamesDisplay,
    pg.Fee,
    pg.GroupStatus
FROM dbo.ParticipantGroups pg
WHERE pg.RegistrationID = @RegistrationId
ORDER BY pg.GroupID;

SELECT
    WebhookLogID,
    GatewaySessionId,
    ProcessingStatus,
    EventType,
    Amount,
    Currency,
    ContactName,
    ContactEmail
FROM dbo.WebhookLogs
WHERE WebhookLogID = @WebhookLogId;

COMMIT TRANSACTION;

/*
Rollback/delete helper for this seeded data:

BEGIN TRANSACTION;
DECLARE @RegistrationId int = <printed RegistrationID>;
DECLARE @WebhookLogId int = <printed OrphanWebhookLogID>;

DELETE r
FROM dbo.Refunds r
WHERE r.WebhookLogId = @WebhookLogId;

DELETE FROM dbo.WebhookLogs
WHERE WebhookLogID = @WebhookLogId;

DELETE FROM dbo.PaymentAuditLog
WHERE EntityType = 'Payment'
  AND Action = 'SeedPaidRegistration'
  AND Notes LIKE CONCAT('%RegistrationID=', @RegistrationId, '%');

DELETE pi
FROM dbo.PaymentItems pi
JOIN dbo.Payments p ON p.PaymentID = pi.PaymentID
WHERE p.RegistrationID = @RegistrationId;

DELETE FROM dbo.Payments
WHERE RegistrationID = @RegistrationId;

DELETE p
FROM dbo.Participants p
JOIN dbo.ParticipantGroups pg ON pg.GroupID = p.GroupID
WHERE pg.RegistrationID = @RegistrationId;

DELETE FROM dbo.ParticipantGroups
WHERE RegistrationID = @RegistrationId;

DELETE FROM dbo.EventRegistrations
WHERE RegistrationID = @RegistrationId;

COMMIT TRANSACTION;
*/
