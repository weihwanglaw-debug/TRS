using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Stripe;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public sealed class PaymentAttemptService
{
    public const string Created = "Created";
    public const string Submitted = "Submitted";
    public const string Succeeded = "Succeeded";
    public const string Failed = "Failed";
    public const string Expired = "Expired";
    public const string Canceled = "Canceled";
    public const string NeedsReconciliation = "NeedsReconciliation";

    private readonly TRSDbContext _db;
    private readonly RegistrationWorkflowService _registrationWorkflow;
    private readonly EmailService _emailService;
    private readonly IConfiguration _config;
    private readonly ILogger<PaymentAttemptService> _log;

    public PaymentAttemptService(
        TRSDbContext db,
        RegistrationWorkflowService registrationWorkflow,
        EmailService emailService,
        IConfiguration config,
        ILogger<PaymentAttemptService> log)
    {
        _db = db;
        _registrationWorkflow = registrationWorkflow;
        _emailService = emailService;
        _config = config;
        _log = log;
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
            RequireEventOpen = true,
            ValidatePricingAgainstCurrentPrograms = true,
        }, ct);

        if (!pricing.Success)
            return PaymentAttemptCreateResult.Fail(pricing.Code!, pricing.Message);

        var amount = pricing.Value!.TotalAmount;
        if (amount <= 0)
            return PaymentAttemptCreateResult.Fail("INVALID_AMOUNT", "Total amount must be greater than zero.");

        var methodInput = (request.PaymentMethod ?? "card").Trim().ToLowerInvariant();
        var isPayNow = methodInput == "paynow";
        var stripeMethod = isPayNow ? "paynow" : "card";
        var dbMethod = isPayNow ? "PayNow" : "CreditCard";
        var currency = pricing.Value.Currency;

        if (isPayNow && !currency.Equals("SGD", StringComparison.OrdinalIgnoreCase))
            return PaymentAttemptCreateResult.Fail("PAYNOW_CURRENCY", "PayNow is only available for SGD payments.");

        var publishableKey = _config["Stripe:PublishableKey"];
        if (string.IsNullOrWhiteSpace(publishableKey))
            return PaymentAttemptCreateResult.Fail("STRIPE_PUBLISHABLE_KEY_MISSING", "Stripe publishable key is not configured.");

        var now = DateTime.UtcNow;
        var expiresAt = now.AddMinutes(Math.Max(1, _config.GetValue("Stripe:EmbeddedAttemptMinutes", 2)));
        var attemptKey = NormalizeAttemptKey(request.AttemptKey, payload, dbMethod, amount, payloadJson);
        var existingForKey = await _db.PaymentAttempts
            .FirstOrDefaultAsync(a => a.AttemptKey == attemptKey, ct);

        if (existingForKey is { GatewayPaymentIntentId: not null } &&
            existingForKey.Status == Created)
        {
            var existingIntent = await new PaymentIntentService()
                .GetAsync(existingForKey.GatewayPaymentIntentId, cancellationToken: ct);
            return PaymentAttemptCreateResult.Ok(existingForKey, existingIntent.ClientSecret, publishableKey);
        }

        if (existingForKey is { GatewayPaymentIntentId: not null } &&
            existingForKey.Status == Submitted &&
            existingForKey.ExpiresAt > now)
        {
            var released = await ReleaseSubmittedAttemptIfSafeAsync(
                existingForKey,
                now,
                "Payment attempt was abandoned before confirmation.",
                ct);
            if (!released)
            {
                return PaymentAttemptCreateResult.Fail(
                    "PAYMENT_IN_PROGRESS",
                    "A payment is already being processed. Please wait for confirmation before trying again.");
            }

            attemptKey = NormalizeAttemptKey(null, payload, dbMethod, amount, payloadJson);
        }

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
                return PaymentAttemptCreateResult.Fail(
                    "PAYMENT_REVIEW_REQUIRED",
                    "A previous payment for this registration needs organiser review. Please contact the organiser before trying again.");

            if (active.Status == Submitted && active.ExpiresAt > now)
            {
                var released = await ReleaseSubmittedAttemptIfSafeAsync(
                    active,
                    now,
                    "Superseded by a new payment attempt.",
                    ct);
                if (released) continue;

                return PaymentAttemptCreateResult.Fail(
                    "PAYMENT_IN_PROGRESS",
                    "A payment is already being processed. Please wait for confirmation before trying again.");
            }

            if (active.Status == Created && active.ExpiresAt > now)
            {
                await CancelCreatedAttemptAsync(active, "Superseded by a new payment attempt.", ct);
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

        _db.PaymentAttempts.Add(attempt);
        await _db.SaveChangesAsync(ct);

        try
        {
            var intent = await new PaymentIntentService().CreateAsync(
                new PaymentIntentCreateOptions
                {
                    Amount = ToMinorUnits(amount),
                    Currency = currency.ToLowerInvariant(),
                    PaymentMethodTypes = new List<string> { stripeMethod },
                    ReceiptEmail = payload.ContactEmail,
                    Metadata = new Dictionary<string, string>
                    {
                        ["flow"] = "embedded_attempt",
                        ["attempt_id"] = attempt.PaymentAttemptId.ToString(),
                        ["attempt_key"] = attempt.AttemptKey,
                        ["event_id"] = payload.EventId.ToString(),
                        ["payment_method"] = dbMethod,
                        ["contact_email"] = payload.ContactEmail ?? "",
                        ["contact_name"] = payload.ContactName ?? "",
                        ["contact_phone"] = payload.ContactPhone ?? "",
                    },
                },
                new RequestOptions { IdempotencyKey = $"embedded_attempt_{attempt.AttemptKey}" },
                ct);

            attempt.GatewayPaymentIntentId = intent.Id;
            attempt.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            return PaymentAttemptCreateResult.Ok(attempt, intent.ClientSecret, publishableKey);
        }
        catch (StripeException ex)
        {
            attempt.Status = Failed;
            attempt.FailedAt = DateTime.UtcNow;
            attempt.UpdatedAt = DateTime.UtcNow;
            attempt.ErrorMessage = ex.StripeError?.Message ?? ex.Message;
            await _db.SaveChangesAsync(ct);
            _log.LogError(ex, "Stripe error creating embedded payment attempt {AttemptId}", attempt.PaymentAttemptId);
            return PaymentAttemptCreateResult.Fail(ex.StripeError?.Code ?? "STRIPE_ERROR", "Payment gateway error. Please try again.");
        }
    }

    public async Task<PaymentAttemptStatusResult?> GetStatusAsync(int attemptId, CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        return attempt == null ? null : PaymentAttemptStatusResult.From(attempt);
    }

    public async Task<PaymentAttemptAbandonResult> AbandonAsync(int attemptId, CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        if (attempt == null)
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
        }

        return PaymentAttemptAbandonResult.Ok(PaymentAttemptStatusResult.From(attempt));
    }

    public async Task<bool> MarkSubmittedAsync(int attemptId, CancellationToken ct = default)
    {
        var attempt = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
        if (attempt == null) return false;
        if (attempt.Status == Created)
        {
            attempt.Status = Submitted;
            attempt.SubmittedAt = DateTime.UtcNow;
            attempt.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        return true;
    }

    public async Task MarkProcessingAsync(PaymentIntent intent, CancellationToken ct = default)
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

    public async Task<PaymentFinalizationResult> FinalizePaymentIntentAsync(
        PaymentIntent intent,
        string? gatewayEventId = null,
        CancellationToken ct = default)
    {
        if (intent == null || string.IsNullOrWhiteSpace(intent.Id))
            return PaymentFinalizationResult.Fail("INVALID_PAYMENT_INTENT", "Payment intent is invalid.");

        var existingPayment = await _db.Payments.AsNoTracking()
            .FirstOrDefaultAsync(p => p.GatewayPaymentId == intent.Id, ct);
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
                gatewayEventId ?? $"payment_intent_{intent.Id}",
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
                RequireEventOpen = false,
                ValidatePricingAgainstCurrentPrograms = false,
                PaymentGateway = "Stripe",
                PaymentMethod = attempt.PaymentMethod,
                PaymentStatus = "S",
                PaymentAmountOverride = ToMajorUnits(intent.AmountReceived > 0 ? intent.AmountReceived : intent.Amount),
                GatewayPaymentId = intent.Id,
            }, ct);

            if (created.Success) break;
            if (!string.Equals(created.Code, "CREATE_FAILED", StringComparison.Ordinal)) break;
            await Task.Delay(300, ct);
        }

        if (created == null || !created.Success)
        {
            var racedPayment = await _db.Payments.AsNoTracking()
                .FirstOrDefaultAsync(p => p.GatewayPaymentId == intent.Id, ct);
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

    public async Task MarkFailedAsync(PaymentIntent intent, string? message, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null) return;
        if (attempt.Status is Succeeded or NeedsReconciliation) return;
        attempt.Status = Failed;
        attempt.FailedAt = DateTime.UtcNow;
        attempt.UpdatedAt = DateTime.UtcNow;
        attempt.ErrorMessage = message ?? "Payment failed.";
        await _db.SaveChangesAsync(ct);
    }

    public async Task MarkCanceledAsync(PaymentIntent intent, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(intent, ct);
        if (attempt == null) return;
        if (attempt.Status is Succeeded or NeedsReconciliation) return;
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
            PaymentIntent intent;
            try
            {
                intent = await new PaymentIntentService().GetAsync(
                    attempt.GatewayPaymentIntentId,
                    cancellationToken: ct);
            }
            catch (StripeException ex)
            {
                _log.LogWarning(ex, "Backstop could not retrieve PaymentIntent {PaymentIntentId}", attempt.GatewayPaymentIntentId);
                continue;
            }

            switch (intent.Status)
            {
                case "succeeded":
                    await FinalizePaymentIntentAsync(intent, $"attempt_backstop_{intent.Id}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", ct);
                    break;
                case "processing" when attempt.ExpiresAt <= now:
                    await MarkNeedsReconciliationAsync(
                        attempt,
                        "CHECKOUT_EXPIRED_PROCESSING",
                        "Payment was still processing after the payment attempt expired.",
                        intent,
                        $"attempt_backstop_{intent.Id}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}",
                        ct);
                    break;
                case "requires_payment_method":
                case "canceled":
                    attempt.Status = attempt.ExpiresAt <= now ? Expired : Failed;
                    attempt.FailedAt = attempt.Status == Failed ? now : null;
                    attempt.UpdatedAt = now;
                    attempt.ErrorMessage = "Stripe payment was not completed.";
                    await _db.SaveChangesAsync(ct);
                    break;
                case "requires_action":
                case "requires_confirmation":
                case "requires_capture":
                    if (attempt.ExpiresAt <= now)
                    {
                        attempt.Status = Expired;
                        attempt.UpdatedAt = now;
                        attempt.ErrorMessage = "Payment attempt expired before payment was completed.";
                        await _db.SaveChangesAsync(ct);
                    }
                    break;
            }
        }
    }

    private async Task CancelCreatedAttemptAsync(PaymentAttempt attempt, string reason, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(attempt.GatewayPaymentIntentId))
        {
            try
            {
                var intent = await new PaymentIntentService().GetAsync(
                    attempt.GatewayPaymentIntentId,
                    cancellationToken: ct);
                if (intent.Status is "requires_payment_method" or "requires_confirmation")
                    await new PaymentIntentService().CancelAsync(attempt.GatewayPaymentIntentId, cancellationToken: ct);
            }
            catch (StripeException ex)
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

        PaymentIntent intent;
        try
        {
            intent = await new PaymentIntentService().GetAsync(
                attempt.GatewayPaymentIntentId,
                cancellationToken: ct);
        }
        catch (StripeException ex)
        {
            _log.LogWarning(ex, "Could not inspect PaymentIntent {PaymentIntentId} before releasing attempt {AttemptId}",
                attempt.GatewayPaymentIntentId,
                attempt.PaymentAttemptId);
            return false;
        }

        switch (intent.Status)
        {
            case "succeeded":
                await FinalizePaymentIntentAsync(intent, $"attempt_release_{intent.Id}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", ct);
                return false;
            case "processing":
                return false;
            case "requires_payment_method":
            case "requires_action":
            case "requires_confirmation":
            case "requires_capture":
            case "canceled":
                if (intent.Status != "canceled")
                {
                    var canceled = await CancelPaymentIntentIfPossibleAsync(intent.Id, ct);
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

    private async Task<bool> CancelPaymentIntentIfPossibleAsync(string paymentIntentId, CancellationToken ct)
    {
        try
        {
            await new PaymentIntentService().CancelAsync(paymentIntentId, cancellationToken: ct);
            return true;
        }
        catch (StripeException ex)
        {
            _log.LogWarning(ex, "Could not cancel PaymentIntent {PaymentIntentId}", paymentIntentId);
            return false;
        }
    }

    private async Task<PaymentAttempt?> FindAttemptAsync(PaymentIntent intent, CancellationToken ct)
    {
        if (intent.Metadata != null &&
            intent.Metadata.TryGetValue("attempt_id", out var idText) &&
            int.TryParse(idText, out var attemptId))
        {
            var byId = await _db.PaymentAttempts.FirstOrDefaultAsync(a => a.PaymentAttemptId == attemptId, ct);
            if (byId != null) return byId;
        }

        return await _db.PaymentAttempts
            .FirstOrDefaultAsync(a => a.GatewayPaymentIntentId == intent.Id, ct);
    }

    private async Task MarkNeedsReconciliationAsync(
        PaymentAttempt attempt,
        string reason,
        string message,
        PaymentIntent intent,
        string? gatewayEventId,
        CancellationToken ct)
    {
        attempt.Status = NeedsReconciliation;
        attempt.ReconciliationReason = reason;
        attempt.ErrorMessage = message;
        attempt.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        await LogEmbeddedReconciliationAsync(
            gatewayEventId ?? $"payment_intent_{intent.Id}_{reason}",
            intent,
            $"{reason}: {message}",
            ct,
            attempt);
    }

    private async Task LogEmbeddedReconciliationAsync(
        string gatewayEventId,
        PaymentIntent intent,
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
            PaymentGateway = "stripe",
            GatewayEventId = safeEventId,
            GatewaySessionId = intent.Id,
            EventType = "processing_error",
            PayloadJson = JsonSerializer.Serialize(intent),
            ProcessingStatus = "F",
            ErrorMessage = errorMessage,
            ReceivedAt = DateTime.UtcNow,
            ProcessedAt = DateTime.UtcNow,
            ContactName = attempt?.ContactName ?? intent.Metadata?.GetValueOrDefault("contact_name"),
            ContactEmail = attempt?.ContactEmail ?? intent.Metadata?.GetValueOrDefault("contact_email"),
            ContactPhone = attempt?.ContactPhone ?? intent.Metadata?.GetValueOrDefault("contact_phone"),
            Amount = ToMajorUnits(intent.AmountReceived > 0 ? intent.AmountReceived : intent.Amount),
            Currency = intent.Currency?.ToUpperInvariant(),
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

    private static string NormalizeAttemptKey(
        string? input,
        CreateRegistrationRequest payload,
        string paymentMethod,
        decimal amount,
        string payloadJson)
    {
        if (!string.IsNullOrWhiteSpace(input) && input.Length <= 100)
            return input.Trim();

        var seed = $"{payload.EventId}|{payload.ContactEmail}|{paymentMethod}|{amount}|{payloadJson}|{Guid.NewGuid():N}";
        var bytes = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed));
        return Convert.ToHexString(bytes)[..40].ToLowerInvariant();
    }

    private static long ToMinorUnits(decimal amount) =>
        decimal.ToInt64(decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero));

    private static decimal ToMajorUnits(long amount) => amount / 100m;
}

public sealed class PaymentAttemptCreateResult
{
    public bool Success { get; private init; }
    public string? Code { get; private init; }
    public string Message { get; private init; } = "";
    public PaymentAttempt? Attempt { get; private init; }
    public string? ClientSecret { get; private init; }
    public string? PublishableKey { get; private init; }

    public static PaymentAttemptCreateResult Ok(PaymentAttempt attempt, string clientSecret, string publishableKey) => new()
    {
        Success = true,
        Attempt = attempt,
        ClientSecret = clientSecret,
        PublishableKey = publishableKey,
    };

    public static PaymentAttemptCreateResult Fail(string code, string message) => new()
    {
        Success = false,
        Code = code,
        Message = message,
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
    public string Status { get; init; } = "";
    public DateTime ExpiresAt { get; init; }
    public int? RegistrationId { get; init; }
    public int? PaymentId { get; init; }
    public string? ReconciliationReason { get; init; }
    public string? ErrorMessage { get; init; }

    public static PaymentAttemptStatusResult From(PaymentAttempt attempt) => new()
    {
        PaymentAttemptId = attempt.PaymentAttemptId,
        Status = attempt.Status,
        ExpiresAt = attempt.ExpiresAt,
        RegistrationId = attempt.RegistrationId,
        PaymentId = attempt.PaymentId,
        ReconciliationReason = attempt.ReconciliationReason,
        ErrorMessage = attempt.ErrorMessage,
    };
}
