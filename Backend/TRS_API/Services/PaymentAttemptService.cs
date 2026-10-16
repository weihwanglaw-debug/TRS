using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stripe;
using TRS_API.Models;
using TRS_API.Services.Payments;
using TRS_Data.Models;

namespace TRS_API.Services;

public sealed class PaymentAttemptService
{
    public const string Created = StatusCodesEx.PaymentAttempt.Created;
    public const string Submitted = StatusCodesEx.PaymentAttempt.Submitted;
    public const string Succeeded = StatusCodesEx.PaymentAttempt.Succeeded;
    public const string Failed = StatusCodesEx.PaymentAttempt.Failed;
    public const string Expired = StatusCodesEx.PaymentAttempt.Expired;
    public const string Canceled = StatusCodesEx.PaymentAttempt.Canceled;
    public const string NeedsReconciliation = StatusCodesEx.PaymentAttempt.NeedsReconciliation;

    private readonly TRSDbContext _db;
    private readonly RegistrationWorkflowService _registrationWorkflow;
    private readonly EmailService _emailService;
    private readonly IConfiguration _config;
    private readonly ILogger<PaymentAttemptService> _log;
    private readonly EventSbaRestrictionService _sbaRestrictions;
    private readonly PaymentGatewayResolver _gateways;
    private readonly PaymentGatewayConfigurationService _gatewayConfiguration;

    public PaymentAttemptService(
        TRSDbContext db,
        RegistrationWorkflowService registrationWorkflow,
        EmailService emailService,
        IConfiguration config,
        ILogger<PaymentAttemptService> log,
        EventSbaRestrictionService sbaRestrictions,
        PaymentGatewayResolver gateways,
        PaymentGatewayConfigurationService gatewayConfiguration)
    {
        _db = db;
        _registrationWorkflow = registrationWorkflow;
        _emailService = emailService;
        _config = config;
        _log = log;
        _sbaRestrictions = sbaRestrictions;
        _gateways = gateways;
        _gatewayConfiguration = gatewayConfiguration;
        StripeConfiguration.ApiKey = _config["Stripe:SecretKey"];
    }

    public async Task<PaymentAttemptCreateResult> CreateAsync(
        EmbeddedPaymentAttemptRequest request,
        CancellationToken ct = default)
    {
        var payloadJson = request.RegistrationPayload.GetRawText();
        var payload = JsonSerializer.Deserialize<CreateRegistrationRequest>(
            payloadJson,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        if (payload == null)
            return PaymentAttemptCreateResult.Fail("INVALID_REGISTRATION", "Invalid registration payload.");

        var pricing = await _registrationWorkflow.ValidateAndPriceAsync(payload, new RegistrationValidationOptions
        {
            RegistrationGateMode = EventRegistrationGateMode.StrictPublic,
            ValidatePricingAgainstCurrentPrograms = true,
        }, ct);

        if (!pricing.Success)
        {
            if (pricing.Code is StatusCodesEx.Validation.DuplicateRegistration or "DUPLICATE_TEAM")
            {
                var confirmedAttempt = await FindConfirmedAttemptForSameRegistrationAsync(payload, ct);
                if (confirmedAttempt != null)
                    return PaymentAttemptCreateResult.Confirmed(confirmedAttempt);
            }

            return PaymentAttemptCreateResult.Fail(pricing.Code!, pricing.Message);
        }

        var amount = pricing.Value!.TotalAmount;
        if (amount <= 0)
            return PaymentAttemptCreateResult.Fail("INVALID_AMOUNT", "Total amount must be greater than zero.");

        var methodInput = (request.PaymentMethod ?? "card").Trim().ToLowerInvariant();
        if (methodInput is not ("card" or "paynow" or "hosted"))
            return PaymentAttemptCreateResult.Fail("PAYMENT_METHOD_UNAVAILABLE", "This payment method is unavailable. Refresh the payment options.");
        var isPayNow = methodInput == "paynow";
        var dbMethod = methodInput == "hosted" ? "Others" : isPayNow ? "PayNow" : "CreditCard";
        var currency = pricing.Value.Currency;

        if (isPayNow && !currency.Equals("SGD", StringComparison.OrdinalIgnoreCase))
            return PaymentAttemptCreateResult.Fail("PAYNOW_CURRENCY", "PayNow is only available for SGD payments.");

        var now = DateTime.UtcNow;
        var expiresAt = now.AddMinutes(Math.Max(1, _config.GetValue("Stripe:EmbeddedAttemptMinutes", 2)));
        var attemptKey = PaymentAttemptAccessKey.NormalizeOrGenerate(request.AttemptKey);
        var existingForKey = await _db.PaymentAttempts
            .FirstOrDefaultAsync(a => a.AttemptKey == attemptKey, ct);

        if (existingForKey is { Status: Succeeded, RegistrationId: not null })
            return PaymentAttemptCreateResult.Confirmed(existingForKey);

        if (existingForKey is { GatewayPaymentIntentId: not null } &&
            existingForKey.Status == Created && (existingForKey.GatewayOrderId == null || existingForKey.ExpiresAt > now))
        {
            try
            {
                var existingCheckout = await _gateways.Resolve(existingForKey.PaymentGateway).GetCheckoutAsync(existingForKey.GatewayPaymentIntentId, ct);
                return PaymentAttemptCreateResult.Ok(existingForKey, existingCheckout);
            }
            catch (PaymentGatewayException ex) { return PaymentAttemptCreateResult.Fail(ex.Code, ex.Message); }
        }

        if (existingForKey is { Status: Created, GatewayOrderId: not null } && existingForKey.ExpiresAt <= now)
        {
            existingForKey.Status = Expired;
            existingForKey.UpdatedAt = now;
        }

        if (existingForKey is { GatewayPaymentIntentId: not null } &&
            existingForKey.Status == Submitted)
        {
            var released = await ReleaseSubmittedAttemptIfSafeAsync(
                existingForKey,
                now,
                "Payment attempt was abandoned before confirmation.",
                ct);
            if (existingForKey.Status == Succeeded && existingForKey.RegistrationId.HasValue)
                return PaymentAttemptCreateResult.Confirmed(existingForKey);

            if (!released)
            {
                if (!_gateways.Resolve(existingForKey.PaymentGateway).SupportsCancellation)
                    return PaymentAttemptCreateResult.Fail("PAYMENT_IN_PROGRESS", "Your earlier payment is unconfirmed. Check its status before making another payment.");
                _log.LogWarning(
                    "Allowing a new payment attempt while attempt {AttemptId} remains in status {Status}",
                    existingForKey.PaymentAttemptId,
                    existingForKey.Status);
            }

            attemptKey = PaymentAttemptAccessKey.NormalizeOrGenerate(null);
        }
        else if (existingForKey != null && existingForKey.Status != Created)
        {
            // The browser may retry with a key that belongs to a terminal or
            // reconciliation attempt. A fresh server key avoids the unique-key
            // collision without blocking a new payment attempt.
            attemptKey = PaymentAttemptAccessKey.NormalizeOrGenerate(null);
        }
        else if (existingForKey is { Status: Created, GatewayPaymentIntentId: null })
        {
            // A previous request may have stopped after the local row was saved
            // but before a PaymentIntent was attached. No payment could have
            // started from that row, so retire it and let the retry continue.
            existingForKey.Status = Failed;
            existingForKey.FailedAt = now;
            existingForKey.UpdatedAt = now;
            existingForKey.ErrorMessage = "Payment gateway setup did not complete.";
            attemptKey = PaymentAttemptAccessKey.NormalizeOrGenerate(null);
        }

        IPaymentGateway selectedGateway;
        try { selectedGateway = await _gatewayConfiguration.GetActiveAsync(ct); }
        catch (GatewayConfigurationException ex) { return PaymentAttemptCreateResult.Fail(ex.Code, ex.Message); }

        if (!selectedGateway.GetSupportedPaymentMethods(currency).Contains(methodInput))
            return PaymentAttemptCreateResult.Fail("PAYMENT_METHOD_UNAVAILABLE", "This payment method is unavailable for the selected gateway. Refresh the payment options.");

        var activeAttempts = await _db.PaymentAttempts
            .Where(a => a.EventId == payload.EventId
                && a.ContactEmail == (payload.ContactEmail ?? "")
                && (a.Status == Created
                    || a.Status == Submitted
                    || (a.Status == NeedsReconciliation && a.ResolvedAt == null)))
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);

        foreach (var active in activeAttempts)
        {
            if (active.Status == NeedsReconciliation && active.ResolvedAt == null)
            {
                _log.LogWarning(
                    "Allowing a new payment attempt while attempt {AttemptId} needs reconciliation",
                    active.PaymentAttemptId);
                continue;
            }

            if (active.Status == Submitted)
            {
                var released = await ReleaseSubmittedAttemptIfSafeAsync(
                    active,
                    now,
                    "Superseded by a new payment attempt.",
                    ct);
                if (active.Status == Succeeded && active.RegistrationId.HasValue)
                    return PaymentAttemptCreateResult.Confirmed(active);

                if (!released)
                {
                    if (!_gateways.Resolve(active.PaymentGateway).SupportsCancellation)
                        return PaymentAttemptCreateResult.Fail("PAYMENT_IN_PROGRESS", "Your earlier payment is unconfirmed. Check its status before making another payment.");
                    _log.LogWarning(
                        "Allowing a concurrent payment attempt while attempt {AttemptId} remains in status {Status}",
                        active.PaymentAttemptId,
                        active.Status);
                }
                continue;
            }

            if (active.Status == Created && active.ExpiresAt > now)
            {
                await CancelCreatedAttemptAsync(active, "Superseded by a new payment attempt.", ct);
                if (active.Status == Succeeded && active.RegistrationId.HasValue)
                    return PaymentAttemptCreateResult.Confirmed(active);
                if (active.GatewayOrderId != null && active.Status is Submitted or NeedsReconciliation)
                {
                    await _db.SaveChangesAsync(ct);
                    return PaymentAttemptCreateResult.Fail("PAYMENT_IN_PROGRESS", "Your earlier payment remains unconfirmed. Check its status before paying again.");
                }
                continue;
            }

            if (active.ExpiresAt <= now)
            {
                active.Status = Expired;
                active.UpdatedAt = now;
                active.ErrorMessage ??= "Payment attempt expired before payment was submitted.";
            }
        }

        var attempt = new PaymentAttempt
        {
            AttemptKey = attemptKey,
            PaymentGateway = selectedGateway.Code,
            EventId = payload.EventId,
            ContactName = payload.ContactName ?? "",
            ContactEmail = payload.ContactEmail ?? "",
            ContactPhone = payload.ContactPhone ?? "",
            PaymentMethod = dbMethod,
            Amount = amount,
            Currency = currency,
            Status = Created,
            PayloadJson = payloadJson,
            LineItemsJson = JsonSerializer.Serialize(pricing.Value.Groups),
            CreatedAt = now,
            UpdatedAt = now,
            ExpiresAt = expiresAt,
        };

        await using var restrictionTx = await _db.Database.BeginTransactionAsync(ct);
        if (!await _sbaRestrictions.AcquireEventWriteLockAsync(payload.EventId, ct))
        {
            await restrictionTx.RollbackAsync(ct);
            return PaymentAttemptCreateResult.Fail("EVENT_NOT_FOUND", "Event not found.");
        }

        var restrictionValidation = await _sbaRestrictions.ValidatePublicRegistrationAsync(payload, ct);
        if (!restrictionValidation.Success)
        {
            await restrictionTx.RollbackAsync(ct);
            return PaymentAttemptCreateResult.Fail(restrictionValidation.Code!, restrictionValidation.Message);
        }

        _db.PaymentAttempts.Add(attempt);
        await _db.SaveChangesAsync(ct);
        await restrictionTx.CommitAsync(ct);

        try
        {
            var checkout = await selectedGateway.CreateCheckoutAsync(new GatewayCheckoutRequest(
                amount,
                currency,
                dbMethod,
                attempt.PaymentAttemptId,
                payload.EventId,
                payload.ContactEmail,
                payload.ContactName,
                payload.ContactPhone,
                $"embedded_attempt_{PaymentAttemptAccessKey.PartitionKey(attempt.AttemptKey, attempt.PaymentAttemptId.ToString())}"), ct);

            attempt.GatewayPaymentIntentId = checkout.PaymentReference;
            attempt.GatewayOrderId = checkout.OrderReference;
            attempt.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            return PaymentAttemptCreateResult.Ok(attempt, checkout);
        }
        catch (PaymentGatewayException ex)
        {
            attempt.Status = Failed;
            attempt.FailedAt = DateTime.UtcNow;
            attempt.UpdatedAt = DateTime.UtcNow;
            attempt.ErrorMessage = ex.Message;
            await _db.SaveChangesAsync(ct);
            _log.LogError(ex, "Gateway error creating payment attempt {AttemptId}", attempt.PaymentAttemptId);
            return PaymentAttemptCreateResult.Fail(ex.Code, "Payment gateway error. Please try again.");
        }
    }

    public async Task<PaymentAttemptStatusResult?> GetStatusAsync(
        int attemptId,
        string? attemptKey,
        CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        return attempt == null || !PaymentAttemptAccessKey.Matches(attempt.AttemptKey, attemptKey)
            ? null
            : PaymentAttemptStatusResult.From(attempt);
    }

    public async Task<PaymentAttemptAbandonResult> AbandonAsync(
        int attemptId,
        string? attemptKey,
        CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        if (attempt == null || !PaymentAttemptAccessKey.Matches(attempt.AttemptKey, attemptKey))
            return PaymentAttemptAbandonResult.Fail("NOT_FOUND", "Payment attempt was not found.");

        if (attempt.Status == Succeeded)
            return PaymentAttemptAbandonResult.Fail("PAYMENT_ALREADY_SUCCEEDED", "Payment has already succeeded.");

        if (attempt.Status == NeedsReconciliation && attempt.ResolvedAt == null)
            return PaymentAttemptAbandonResult.Fail(
                "PAYMENT_REVIEW_REQUIRED",
                "This payment needs organiser review. Please do not try again until it is reviewed.");

        if (attempt.Status == Submitted)
        {
            var released = await ReleaseSubmittedAttemptIfSafeAsync(
                attempt,
                DateTime.UtcNow,
                "Payment attempt was closed by the customer before confirmation.",
                ct);
            if (!released)
            {
                return PaymentAttemptAbandonResult.Fail(
                    "PAYMENT_IN_PROGRESS",
                    "Payment is still processing. Please wait for confirmation before trying again.");
            }
        }
        else if (attempt.Status == Created)
        {
            await CancelCreatedAttemptAsync(attempt, "Payment attempt was closed by the customer.", ct);
            await _db.SaveChangesAsync(ct);
            if (attempt.GatewayOrderId != null && attempt.Status is Submitted or NeedsReconciliation)
                return PaymentAttemptAbandonResult.Fail("PAYMENT_IN_PROGRESS", "The provider payment outcome remains unconfirmed.");
        }

        return PaymentAttemptAbandonResult.Ok(PaymentAttemptStatusResult.From(attempt));
    }

    public async Task<bool> MarkSubmittedAsync(
        int attemptId,
        string? attemptKey,
        CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        if (attempt == null || !PaymentAttemptAccessKey.Matches(attempt.AttemptKey, attemptKey)) return false;
        if (attempt.GatewayOrderId != null && attempt.Status != Created) return false;
        if (attempt.Status == Created)
        {
            if (attempt.ExpiresAt <= DateTime.UtcNow) return false;
            attempt.Status = Submitted;
            attempt.SubmittedAt = DateTime.UtcNow;
            attempt.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task MarkProcessingAsync(GatewayPayment intent, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null) return;
        if (attempt.Status == Created)
        {
            attempt.Status = Submitted;
            attempt.SubmittedAt = DateTime.UtcNow;
            attempt.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
    }

    public async Task<PaymentFinalizationResult> FinalizePaymentAsync(
        GatewayPayment? intent,
        string? gatewayEventId = null,
        CancellationToken ct = default)
    {
        if (intent?.OrderReference != null)
            return await ApplyHostedPaymentAsync(intent, ct);
        return await FinalizePaymentCoreAsync(intent, gatewayEventId, ct);
    }

    public async Task<PaymentAttemptStatusResult?> RecoverHostedAsync(int attemptId, string? attemptKey, CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.AsNoTracking().FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        if (attempt == null || !PaymentAttemptAccessKey.Matches(attempt.AttemptKey, attemptKey)) return null;
        if (attempt.GatewayOrderId != null && attempt.Status is Created or Submitted)
        {
            try
            {
                var payment = await _gateways.Resolve(attempt.PaymentGateway).GetPaymentAsync(attempt.GatewayOrderId, ct);
                await ApplyHostedPaymentAsync(payment, ct);
            }
            catch (PaymentGatewayException ex)
            {
                // Missing/unavailable provider data is unknown, never proof of failed payment.
                _log.LogWarning("Hosted payment recovery remains unconfirmed ({Code}).", ex.Code);
            }
        }
        return await GetStatusAsync(attemptId, attemptKey, ct);
    }

    // Serialize browser returns, callbacks and recovery for the same hosted order.
    // A session lock allows RegistrationWorkflowService to own its existing transaction.
    public async Task<PaymentFinalizationResult> ApplyHostedPaymentAsync(GatewayPayment payment, CancellationToken ct = default)
    {
        if (payment.OrderReference == null || payment.TransactionReference == null || payment.AttemptId == null)
            return PaymentFinalizationResult.Fail("INVALID_PAYMENT", "Hosted payment context is incomplete.");
        await _db.Database.OpenConnectionAsync(ct);
        var resource = "TRS:hosted:" + payment.GatewayCode + ":" + payment.OrderReference;
        var locked = false;
        try
        {
            await using (var command = _db.Database.GetDbConnection().CreateCommand())
            {
                command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=10000; SELECT @result;";
                var parameter = command.CreateParameter(); parameter.ParameterName = "@resource"; parameter.Value = resource;
                command.Parameters.Add(parameter);
                locked = Convert.ToInt32(await command.ExecuteScalarAsync(ct)) >= 0;
            }
            if (!locked) throw new InvalidOperationException("Hosted payment processing is busy. Retry the notification.");
            var attempt = await FindAttemptAsync(payment, ct);
            if (attempt == null) return PaymentFinalizationResult.Fail("PAYMENT_ATTEMPT_MISSING", "Payment attempt is missing.");
            await _db.Entry(attempt).ReloadAsync(ct);
            if (payment.Amount != attempt.Amount || payment.Currency != attempt.Currency
                || (payment.State == GatewayPaymentState.Succeeded && payment.AmountReceived != attempt.Amount))
                throw new InvalidOperationException("Verified payment does not match the stored amount and currency.");

            var eventId = payment.GatewayCode.ToLowerInvariant() + "_" + payment.TransactionReference + "_" + payment.State;
            var log = await _db.WebhookLogs.SingleOrDefaultAsync(w => w.GatewayEventId == eventId, ct);
            var expiredPending = payment.State is GatewayPaymentState.Processing or GatewayPaymentState.AwaitingCapture
                && attempt.Status is Created or Submitted && attempt.ExpiresAt <= DateTime.UtcNow;
            if (log?.ProcessedAt != null && !expiredPending)
                return attempt.PaymentId is int pid && attempt.RegistrationId is int rid
                    ? PaymentFinalizationResult.Ok(rid, pid, true)
                    : PaymentFinalizationResult.Fail("PAYMENT_UNCONFIRMED", "Payment is not confirmed for registration.");
            log ??= new WebhookLog
            {
                PaymentGateway = payment.GatewayCode, GatewayEventId = eventId,
                GatewaySessionId = payment.PaymentReference,
                EventType = payment.State == GatewayPaymentState.Succeeded ? "payment.succeeded" : "payment.status",
                PayloadJson = payment.ProviderPayloadJson, ProcessingStatus = StatusCodesEx.Processing.Pending,
                ContactName = attempt.ContactName, ContactEmail = attempt.ContactEmail, ContactPhone = attempt.ContactPhone,
                Amount = payment.Amount, Currency = payment.Currency,
            };
            if (log.WebhookLogId == 0) _db.WebhookLogs.Add(log);
            await _db.SaveChangesAsync(ct);
            PaymentFinalizationResult result;
            if (attempt.GatewayTransactionId != null && attempt.GatewayTransactionId != payment.TransactionReference)
            {
                log.EventType = "processing_error";
                log.ProcessingStatus = StatusCodesEx.Processing.Failed;
                log.ErrorMessage = "ADDITIONAL_TRANSACTION: Another transaction used this order. Review and refund any additional captured payment.";
                result = PaymentFinalizationResult.Fail("ADDITIONAL_TRANSACTION", log.ErrorMessage);
            }
            else
            {
                attempt.GatewayTransactionId = payment.TransactionReference;
                if (payment.State == GatewayPaymentState.Succeeded && payment.VerifiedPaymentMethod is { } verifiedMethod)
                {
                    if (verifiedMethod is not ("CreditCard" or "PayNow" or "Others"))
                        throw new InvalidOperationException("Verified payment method is not supported.");
                    attempt.PaymentMethod = verifiedMethod;
                }
                await _db.SaveChangesAsync(ct);
                if (payment.State == GatewayPaymentState.Succeeded)
                {
                    if (attempt.Status is Canceled or Expired or Failed)
                    {
                        await MarkNeedsReconciliationAsync(attempt, "LATE_PAYMENT", "Payment arrived after checkout was closed or expired.", payment, eventId + "_review", ct);
                        result = PaymentFinalizationResult.Fail("LATE_PAYMENT", "Payment requires organiser review.");
                    }
                    else result = await FinalizePaymentCoreAsync(payment, eventId + "_review", ct);
                    log.PaymentId = result.Success ? result.PaymentId : null;
                    log.ProcessingStatus = result.Success ? StatusCodesEx.Processing.Success : StatusCodesEx.Processing.Failed;
                    log.ErrorMessage = result.Success ? null : result.Message;
                }
                else
                {
                    // A late failure must never erase captured money or an unresolved paid reconciliation.
                    if (attempt.Status is Created or Submitted)
                    {
                        if (payment.State == GatewayPaymentState.Canceled)
                        {
                            attempt.Status = Failed; attempt.FailedAt = DateTime.UtcNow;
                            attempt.ErrorMessage = "The payment provider confirmed that this payment was not completed.";
                        }
                        else if (attempt.ExpiresAt <= DateTime.UtcNow)
                        {
                            await MarkNeedsReconciliationAsync(attempt, "CHECKOUT_EXPIRED_PROCESSING",
                                "Checkout expired while the provider outcome remained unconfirmed.", payment, eventId + "_review", ct);
                        }
                        else { attempt.Status = Submitted; attempt.SubmittedAt ??= DateTime.UtcNow; }
                        attempt.UpdatedAt = DateTime.UtcNow;
                    }
                    log.ProcessingStatus = StatusCodesEx.Processing.Ignored;
                    result = PaymentFinalizationResult.Fail("PAYMENT_UNCONFIRMED", "Payment has not been captured.");
                }
            }
            log.ProcessedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return result;
        }
        finally
        {
            try
            {
                if (locked)
                {
                    await using var command = _db.Database.GetDbConnection().CreateCommand();
                    command.CommandText = "EXEC sys.sp_releaseapplock @Resource=@resource, @LockOwner='Session';";
                    var parameter = command.CreateParameter(); parameter.ParameterName = "@resource"; parameter.Value = resource;
                    command.Parameters.Add(parameter);
                    await command.ExecuteNonQueryAsync(CancellationToken.None);
                }
            }
            finally { await _db.Database.CloseConnectionAsync(); }
        }
    }

    private async Task<PaymentFinalizationResult> FinalizePaymentCoreAsync(
        GatewayPayment? intent, string? gatewayEventId, CancellationToken ct)
    {
        if (intent == null || string.IsNullOrWhiteSpace(intent.PaymentReference))
            return PaymentFinalizationResult.Fail("INVALID_PAYMENT_INTENT", "Payment intent is invalid.");

        var existingPayment = await _db.Payments.AsNoTracking()
            .FirstOrDefaultAsync(p => p.PaymentGateway.ToLower() == intent.GatewayCode.ToLower() && p.GatewayPaymentId == intent.PaymentReference, ct);
        if (existingPayment != null)
        {
            var processedAttempt = await FindAttemptAsync(intent, ct);
            if (processedAttempt != null && processedAttempt.Status != Succeeded)
            {
                processedAttempt.Status = Succeeded;
                processedAttempt.RegistrationId = existingPayment.RegistrationId;
                processedAttempt.PaymentId = existingPayment.PaymentId;
                processedAttempt.SucceededAt = DateTime.UtcNow;
                processedAttempt.FinalizedAt = DateTime.UtcNow;
                processedAttempt.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
            return PaymentFinalizationResult.Ok(existingPayment.RegistrationId, existingPayment.PaymentId, alreadyProcessed: true);
        }

        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null)
        {
            await LogEmbeddedReconciliationAsync(
                gatewayEventId ?? $"payment_intent_{intent.PaymentReference}",
                intent,
                "PAYMENT_ATTEMPT_MISSING: Payment succeeded but the system could not find the payment attempt.",
                ct);
            return PaymentFinalizationResult.Fail("PAYMENT_ATTEMPT_MISSING", "Payment attempt is missing.");
        }

        if (DateTime.UtcNow > attempt.ExpiresAt)
        {
            await MarkNeedsReconciliationAsync(
                attempt,
                "CHECKOUT_EXPIRED",
                "Payment was received after the payment attempt expired.",
                intent,
                gatewayEventId,
                ct);
            return PaymentFinalizationResult.Fail("CHECKOUT_EXPIRED", "Payment was received after checkout expired.");
        }

        CreateRegistrationRequest? payload;
        try
        {
            payload = JsonSerializer.Deserialize<CreateRegistrationRequest>(
                attempt.PayloadJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException ex)
        {
            _log.LogError(ex, "PaymentAttempt {AttemptId} payload is invalid JSON", attempt.PaymentAttemptId);
            await MarkNeedsReconciliationAsync(
                attempt,
                "INVALID_CHECKOUT_CONTEXT",
                "Stored registration payload is invalid.",
                intent,
                gatewayEventId,
                ct);
            return PaymentFinalizationResult.Fail("INVALID_CHECKOUT_CONTEXT", "Stored checkout details are invalid.");
        }

        if (payload == null)
            return PaymentFinalizationResult.Fail("INVALID_CHECKOUT_CONTEXT", "Stored checkout details are invalid.");

        RegistrationWorkflowResult<RegistrationCreateOutcome>? created = null;
        for (var i = 0; i < 2; i++)
        {
            created = await _registrationWorkflow.CreateAsync(payload, new RegistrationPersistOptions
            {
                RegistrationGateMode = EventRegistrationGateMode.AlreadyPaidFinalization,
                ValidatePricingAgainstCurrentPrograms = false,
                PaymentGateway = attempt.PaymentGateway,
                PaymentMethod = attempt.PaymentMethod,
                PaymentStatus = StatusCodesEx.Payment.Success,
                PaymentAmountOverride = intent.EffectiveAmount,
                GatewayPaymentId = intent.PaymentReference,
            }, ct);

            if (created.Success) break;
            if (!string.Equals(created.Code, "CREATE_FAILED", StringComparison.Ordinal)) break;
            // CreateAsync restores tracking after rollback before this same-context retry.
            if (i == 0) await Task.Delay(300, ct);
        }

        if (created == null || !created.Success)
        {
            var racedPayment = await _db.Payments.AsNoTracking()
                .FirstOrDefaultAsync(p => p.PaymentGateway.ToLower() == intent.GatewayCode.ToLower() && p.GatewayPaymentId == intent.PaymentReference, ct);
            if (racedPayment != null)
                return PaymentFinalizationResult.Ok(racedPayment.RegistrationId, racedPayment.PaymentId, alreadyProcessed: true);

            await MarkNeedsReconciliationAsync(
                attempt,
                created?.Code ?? "CREATE_FAILED",
                created?.Message ?? "Failed to save registration.",
                intent,
                gatewayEventId,
                ct);
            return PaymentFinalizationResult.Fail(created?.Code ?? "CREATE_FAILED", created?.Message ?? "Failed to save registration.");
        }

        attempt.Status = Succeeded;
        attempt.RegistrationId = created.Value!.RegistrationId;
        attempt.PaymentId = created.Value.PaymentId;
        attempt.SucceededAt = DateTime.UtcNow;
        attempt.FinalizedAt = DateTime.UtcNow;
        attempt.UpdatedAt = DateTime.UtcNow;
        attempt.ErrorMessage = null;
        attempt.ReconciliationReason = null;
        await _db.SaveChangesAsync(ct);

        return PaymentFinalizationResult.Ok(created.Value.RegistrationId, created.Value.PaymentId, alreadyProcessed: false);
    }

    public async Task MarkFailedAsync(GatewayPayment intent, string? message, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null) return;
        if (attempt.Status == Succeeded) return;
        if (attempt.Status == NeedsReconciliation)
        {
            await ResolveUnpaidReconciliationAsync(
                attempt,
                intent,
                Failed,
                message ?? "Stripe confirmed that payment failed.",
                ct);
            return;
        }
        attempt.Status = Failed;
        attempt.FailedAt = DateTime.UtcNow;
        attempt.UpdatedAt = DateTime.UtcNow;
        attempt.ErrorMessage = message ?? "Payment failed.";
        await _db.SaveChangesAsync(ct);
    }

    public async Task MarkCanceledAsync(GatewayPayment intent, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null) return;
        if (attempt.Status == Succeeded) return;
        if (attempt.Status == NeedsReconciliation)
        {
            await ResolveUnpaidReconciliationAsync(
                attempt,
                intent,
                Canceled,
                "Stripe confirmed that payment was cancelled.",
                ct);
            return;
        }
        attempt.Status = Canceled;
        attempt.CanceledAt = DateTime.UtcNow;
        attempt.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    public async Task SweepAsync(CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        var expiredCreated = await _db.PaymentAttempts
            .Where(a => a.Status == Created && a.ExpiresAt <= now)
            .ToListAsync(ct);
        foreach (var attempt in expiredCreated)
        {
            attempt.Status = Expired;
            attempt.UpdatedAt = now;
            attempt.ErrorMessage ??= "Payment attempt expired before payment was submitted.";
        }
        if (expiredCreated.Count > 0)
            await _db.SaveChangesAsync(ct);

        var backstopAgeMinutes = Math.Max(2, _config.GetValue("Stripe:EmbeddedBackstopMinutes", 10));
        var backstopBefore = now.AddMinutes(-backstopAgeMinutes);
        var unresolvedSubmitted = await _db.PaymentAttempts
            .Where(a => a.Status == Submitted &&
                a.GatewayPaymentIntentId != null &&
                (a.SubmittedAt == null || a.SubmittedAt <= backstopBefore || a.ExpiresAt <= now))
            .OrderBy(a => a.SubmittedAt ?? a.CreatedAt)
            .Take(50)
            .ToListAsync(ct);

        foreach (var attempt in unresolvedSubmitted)
        {
            GatewayPayment intent;
            try
            {
                intent = await _gateways.Resolve(attempt.PaymentGateway).GetPaymentAsync(attempt.GatewayPaymentIntentId!, ct);
            }
            catch (PaymentGatewayException ex)
            {
                _log.LogWarning(ex, "Backstop could not retrieve PaymentIntent {PaymentIntentId}", attempt.GatewayPaymentIntentId);
                continue;
            }

            if (intent.OrderReference != null)
            {
                await ApplyHostedPaymentAsync(intent, ct);
                continue;
            }

            switch (intent.State)
            {
                case GatewayPaymentState.Succeeded:
                    await FinalizePaymentAsync(intent, $"attempt_backstop_{intent.PaymentReference}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", ct);
                    break;
                case GatewayPaymentState.Processing when attempt.ExpiresAt <= now:
                    await MarkNeedsReconciliationAsync(
                        attempt,
                        "CHECKOUT_EXPIRED_PROCESSING",
                        "Payment was still processing after the payment attempt expired.",
                        intent,
                        $"attempt_backstop_{intent.PaymentReference}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}",
                        ct);
                    break;
                case GatewayPaymentState.AwaitingPaymentMethod:
                case GatewayPaymentState.Canceled:
                    attempt.Status = attempt.ExpiresAt <= now ? Expired : Failed;
                    attempt.FailedAt = attempt.Status == Failed ? now : null;
                    attempt.UpdatedAt = now;
                    attempt.ErrorMessage = "Stripe payment was not completed.";
                    await _db.SaveChangesAsync(ct);
                    break;
                case GatewayPaymentState.AwaitingAction:
                case GatewayPaymentState.AwaitingConfirmation:
                case GatewayPaymentState.AwaitingCapture:
                    if (attempt.ExpiresAt <= now)
                    {
                        var canceled = await CancelPaymentIntentIfPossibleAsync(attempt.PaymentGateway, intent.PaymentReference, ct);
                        if (!canceled)
                        {
                            _log.LogWarning(
                                "Leaving expired payment attempt {AttemptId} submitted because PaymentIntent {PaymentIntentId} could not be cancelled safely",
                                attempt.PaymentAttemptId,
                                intent.PaymentReference);
                            break;
                        }

                        attempt.Status = Expired;
                        attempt.UpdatedAt = now;
                        attempt.ErrorMessage = "Payment attempt expired before payment was completed.";
                        await _db.SaveChangesAsync(ct);
                    }
                    break;
            }
        }

        var unresolvedReconciliations = await _db.PaymentAttempts
            .Where(attempt =>
                attempt.Status == NeedsReconciliation &&
                attempt.ResolvedAt == null &&
                attempt.GatewayPaymentIntentId != null)
            .OrderBy(attempt => attempt.UpdatedAt)
            .Take(50)
            .ToListAsync(ct);

        foreach (var attempt in unresolvedReconciliations)
        {
            GatewayPayment intent;
            try
            {
                intent = await _gateways.Resolve(attempt.PaymentGateway).GetPaymentAsync(attempt.GatewayPaymentIntentId!, ct);
            }
            catch (PaymentGatewayException ex)
            {
                _log.LogWarning(ex, "Backstop could not reconcile PaymentIntent {PaymentIntentId}", attempt.GatewayPaymentIntentId);
                continue;
            }

            if (intent.OrderReference != null)
            {
                await ApplyHostedPaymentAsync(intent, ct);
                continue;
            }

            if (intent.State == GatewayPaymentState.AwaitingPaymentMethod)
            {
                await ResolveUnpaidReconciliationAsync(
                    attempt,
                    intent,
                    Failed,
                    intent.FailureMessage ?? "Stripe confirmed that payment was not completed.",
                    ct);
            }
            else if (intent.State == GatewayPaymentState.Canceled)
            {
                await ResolveUnpaidReconciliationAsync(
                    attempt,
                    intent,
                    Canceled,
                    "Stripe confirmed that payment was cancelled.",
                    ct);
            }
        }
    }

    private async Task CancelCreatedAttemptAsync(PaymentAttempt attempt, string reason, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(attempt.GatewayPaymentIntentId))
        {
            try
            {
                var intent = await _gateways.Resolve(attempt.PaymentGateway).GetPaymentAsync(attempt.GatewayPaymentIntentId!, ct);
                if (intent.OrderReference != null)
                {
                    await ApplyHostedPaymentAsync(intent, ct);
                    // Closing a hosted page never proves cancellation, even before its submit response arrived.
                    return;
                }
                if (intent.State is GatewayPaymentState.AwaitingPaymentMethod or GatewayPaymentState.AwaitingConfirmation)
                    await _gateways.Resolve(attempt.PaymentGateway).CancelPaymentAsync(attempt.GatewayPaymentIntentId, ct);
            }
            catch (PaymentGatewayException ex)
            {
                _log.LogWarning(ex, "Could not cancel PaymentIntent {PaymentIntentId}", attempt.GatewayPaymentIntentId);
            }
        }

        attempt.Status = Canceled;
        attempt.CanceledAt = DateTime.UtcNow;
        attempt.UpdatedAt = DateTime.UtcNow;
        attempt.ErrorMessage = reason;
    }

    private async Task<bool> ReleaseSubmittedAttemptIfSafeAsync(
        PaymentAttempt attempt,
        DateTime now,
        string reason,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(attempt.GatewayPaymentIntentId))
        {
            attempt.Status = Failed;
            attempt.FailedAt = now;
            attempt.UpdatedAt = now;
            attempt.ErrorMessage = "Payment attempt did not have a gateway payment intent.";
            await _db.SaveChangesAsync(ct);
            return true;
        }

        GatewayPayment intent;
        try
        {
            intent = await _gateways.Resolve(attempt.PaymentGateway).GetPaymentAsync(attempt.GatewayPaymentIntentId!, ct);
        }
        catch (PaymentGatewayException ex)
        {
            _log.LogWarning(ex, "Could not inspect PaymentIntent {PaymentIntentId} before releasing attempt {AttemptId}",
                attempt.GatewayPaymentIntentId,
                attempt.PaymentAttemptId);
            return false;
        }

        if (intent.OrderReference != null)
        {
            await ApplyHostedPaymentAsync(intent, ct);
            return attempt.Status == Failed;
        }

        switch (intent.State)
        {
            case GatewayPaymentState.Succeeded:
                await FinalizePaymentAsync(intent, $"attempt_release_{intent.PaymentReference}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", ct);
                return false;
            case GatewayPaymentState.Processing:
                return false;
            case GatewayPaymentState.AwaitingPaymentMethod:
            case GatewayPaymentState.AwaitingAction:
            case GatewayPaymentState.AwaitingConfirmation:
            case GatewayPaymentState.AwaitingCapture:
            case GatewayPaymentState.Canceled:
                if (intent.State != GatewayPaymentState.Canceled)
                {
                    var canceled = await CancelPaymentIntentIfPossibleAsync(attempt.PaymentGateway, intent.PaymentReference, ct);
                    if (!canceled) return false;
                }

                attempt.Status = Canceled;
                attempt.CanceledAt = now;
                attempt.UpdatedAt = now;
                attempt.ErrorMessage = reason;
                await _db.SaveChangesAsync(ct);
                return true;
            default:
                return false;
        }
    }

    private async Task<bool> CancelPaymentIntentIfPossibleAsync(string gatewayCode, string paymentIntentId, CancellationToken ct)
    {
        try
        {
            await _gateways.Resolve(gatewayCode).CancelPaymentAsync(paymentIntentId, ct);
            return true;
        }
        catch (PaymentGatewayException ex)
        {
            _log.LogWarning(ex, "Could not cancel PaymentIntent {PaymentIntentId}", paymentIntentId);
            return false;
        }
    }

    private async Task<PaymentAttempt?> FindAttemptAsync(GatewayPayment intent, CancellationToken ct)
    {
        if (intent.OrderReference != null)
            return await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentGateway == intent.GatewayCode
                && a.GatewayOrderId == intent.OrderReference && a.PaymentAttemptId == intent.AttemptId, ct);
        if (intent.AttemptId is int attemptId)
        {
            var byId = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId && a.PaymentGateway.ToLower() == intent.GatewayCode.ToLower() && a.GatewayPaymentIntentId == intent.PaymentReference, ct);
            if (byId != null) return byId;
        }

        return await _db.PaymentAttempts
            .FirstOrDefaultAsync(a => a.PaymentGateway.ToLower() == intent.GatewayCode.ToLower() && a.GatewayPaymentIntentId == intent.PaymentReference, ct);
    }

    private async Task<PaymentAttempt?> FindConfirmedAttemptForSameRegistrationAsync(
        CreateRegistrationRequest request,
        CancellationToken ct)
    {
        var candidates = await _db.PaymentAttempts
            .AsNoTracking()
            .Where(attempt =>
                attempt.EventId == request.EventId &&
                attempt.ContactEmail == (request.ContactEmail ?? "") &&
                attempt.Status == Succeeded &&
                attempt.RegistrationId != null)
            .OrderByDescending(attempt => attempt.SucceededAt)
            .ToListAsync(ct);

        foreach (var candidate in candidates)
        {
            try
            {
                var storedRequest = JsonSerializer.Deserialize<CreateRegistrationRequest>(
                    candidate.PayloadJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (storedRequest != null && PaymentAttemptRegistrationIdentity.Matches(storedRequest, request))
                    return candidate;
            }
            catch (JsonException ex)
            {
                _log.LogWarning(ex, "Could not compare registration identity for payment attempt {AttemptId}", candidate.PaymentAttemptId);
            }
        }

        return null;
    }

    private async Task MarkNeedsReconciliationAsync(
        PaymentAttempt attempt,
        string reason,
        string message,
        GatewayPayment intent,
        string? gatewayEventId,
        CancellationToken ct)
    {
        attempt.Status = NeedsReconciliation;
        attempt.ReconciliationReason = reason;
        attempt.ErrorMessage = message;
        attempt.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await LogEmbeddedReconciliationAsync(
            gatewayEventId ?? $"payment_intent_{intent.PaymentReference}_{reason}",
            intent,
            $"{reason}: {message}",
            ct,
            attempt);
    }

    private async Task ResolveUnpaidReconciliationAsync(
        PaymentAttempt attempt,
        GatewayPayment intent,
        string terminalStatus,
        string message,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        attempt.Status = terminalStatus;
        attempt.ErrorMessage = message;
        attempt.FailedAt = terminalStatus == Failed ? now : attempt.FailedAt;
        attempt.CanceledAt = terminalStatus == Canceled ? now : attempt.CanceledAt;
        attempt.ResolvedAt = now;
        attempt.ResolvedBy = "stripe-webhook";
        attempt.ResolutionNote = message;
        attempt.UpdatedAt = now;

        var reconciliationLogs = await _db.WebhookLogs
            .Where(log =>
                log.PaymentGateway.ToLower() == intent.GatewayCode.ToLower() &&
                log.GatewaySessionId == intent.PaymentReference &&
                log.ProcessingStatus == StatusCodesEx.Processing.Failed &&
                (log.EventType == "payment_intent.succeeded" || log.EventType == "processing_error"))
            .ToListAsync(ct);
        foreach (var log in reconciliationLogs)
        {
            log.ProcessingStatus = StatusCodesEx.Processing.Ignored;
            log.ProcessedAt = now;
            log.ErrorMessage = $"Resolved without payment: {message}";
        }

        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "PaymentAttempt",
            EntityId = attempt.PaymentAttemptId,
            Action = "ReconciliationResolvedUnpaid",
            Reason = message,
            PerformedBy = "stripe-webhook",
            Notes = $"PaymentIntent={intent.PaymentReference}; TerminalStatus={terminalStatus}",
            CreatedAt = now,
        });

        await _db.SaveChangesAsync(ct);
    }

    private async Task LogEmbeddedReconciliationAsync(
        string gatewayEventId,
        GatewayPayment intent,
        string errorMessage,
        CancellationToken ct,
        PaymentAttempt? attempt = null)
    {
        var safeEventId = gatewayEventId;
        var suffix = 0;
        while (await _db.WebhookLogs.AnyAsync(w => w.GatewayEventId == safeEventId, ct))
        {
            suffix++;
            safeEventId = $"{gatewayEventId}_{suffix}";
        }

        var log = new WebhookLog
        {
            PaymentGateway = intent.GatewayCode,
            GatewayEventId = safeEventId,
            GatewaySessionId = intent.PaymentReference,
            EventType = "processing_error",
            PayloadJson = intent.ProviderPayloadJson,
            ProcessingStatus = StatusCodesEx.Processing.Failed,
            ErrorMessage = errorMessage,
            ReceivedAt = DateTime.UtcNow,
            ProcessedAt = DateTime.UtcNow,
            ContactName = attempt?.ContactName ?? intent.ContactName,
            ContactEmail = attempt?.ContactEmail ?? intent.ContactEmail,
            ContactPhone = attempt?.ContactPhone ?? intent.ContactPhone,
            Amount = intent.EffectiveAmount,
            Currency = intent.Currency,
        };
        _db.WebhookLogs.Add(log);
        await _db.SaveChangesAsync(ct);

        try
        {
            await _emailService.SendPaymentReconciliationAlertAsync(_db, log, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _log.LogError(
                ex,
                "Failed to send payment reconciliation alert for webhook log {WebhookLogId}",
                log.WebhookLogId);
        }
    }
}

public sealed class PaymentAttemptCreateResult
{
    public bool Success { get; private init; }
    public string? Code { get; private init; }
    public string Message { get; private init; } = "";
    public PaymentAttempt? Attempt { get; private init; }
    public string? ClientSecret { get; private init; }
    public string? PublishableKey { get; private init; }
    public HostedCheckout? HostedCheckout { get; private init; }
    public bool AlreadyConfirmed { get; private init; }

    public static PaymentAttemptCreateResult Ok(PaymentAttempt attempt, GatewayCheckout checkout) => new()
    {
        Success = true,
        Attempt = attempt,
        ClientSecret = checkout.ClientToken,
        PublishableKey = checkout.PublishableKey,
        HostedCheckout = checkout.Hosted,
    };

    public static PaymentAttemptCreateResult Fail(string code, string message) => new()
    {
        Success = false,
        Code = code,
        Message = message,
    };

    public static PaymentAttemptCreateResult Confirmed(PaymentAttempt attempt) => new()
    {
        Success = true,
        Attempt = attempt,
        AlreadyConfirmed = true,
    };
}

public sealed class PaymentAttemptAbandonResult
{
    public bool Success { get; private init; }
    public string? Code { get; private init; }
    public string Message { get; private init; } = "";
    public PaymentAttemptStatusResult? Status { get; private init; }

    public static PaymentAttemptAbandonResult Ok(PaymentAttemptStatusResult status) => new()
    {
        Success = true,
        Status = status,
    };

    public static PaymentAttemptAbandonResult Fail(string code, string message) => new()
    {
        Success = false,
        Code = code,
        Message = message,
    };
}

public sealed class PaymentAttemptStatusResult
{
    public int PaymentAttemptId { get; init; }
    public int EventId { get; init; }
    public string Status { get; init; } = "";
    public DateTime ExpiresAt { get; init; }
    public int? RegistrationId { get; init; }
    public int? PaymentId { get; init; }
    public string? ReconciliationReason { get; init; }
    public string? ErrorMessage { get; init; }

    public static PaymentAttemptStatusResult From(PaymentAttempt attempt) => new()
    {
        PaymentAttemptId = attempt.PaymentAttemptId,
        EventId = attempt.EventId,
        Status = attempt.Status,
        ExpiresAt = attempt.ExpiresAt,
        RegistrationId = attempt.RegistrationId,
        PaymentId = attempt.PaymentId,
        ReconciliationReason = attempt.ReconciliationReason,
        ErrorMessage = attempt.ErrorMessage,
    };
}
