using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data;
using TRS_Data.Models;

namespace TRS_API.Controllers
{
    [ApiController]
    [Route("api/webhooks/stripe")]
    [AllowAnonymous]
    public class StripeWebhookController : ControllerBase
    {
        private readonly ILogger<StripeWebhookController> _logger;
        private readonly IConfiguration _config;
        private readonly TRSDbContext _db;
        private readonly IBackgroundJobQueue _jobQueue;
        private readonly IServiceScopeFactory _serviceScopeFactory;
        private readonly PaymentFinalizationService _paymentFinalization;
        private readonly PaymentAttemptService _paymentAttempts;

        public StripeWebhookController(
            ILogger<StripeWebhookController> logger,
            IConfiguration config,
            TRSDbContext db,
            IBackgroundJobQueue jobQueue,
            IServiceScopeFactory serviceScopeFactory,
            PaymentFinalizationService paymentFinalization,
            PaymentAttemptService paymentAttempts)
        {
            _logger = logger;
            _config = config;
            _db = db;
            _jobQueue = jobQueue;
            _serviceScopeFactory = serviceScopeFactory;
            _paymentFinalization = paymentFinalization;
            _paymentAttempts = paymentAttempts;
        }

        [HttpPost]
        public async Task<IActionResult> Webhook()
        {
            string json    = string.Empty;
            string eventId = string.Empty;

            try
            {
                json = await new StreamReader(Request.Body).ReadToEndAsync();
                var stripeEvent = EventUtility.ConstructEvent(
                    json,
                    Request.Headers["Stripe-Signature"],
                    _config["Stripe:WebhookSecret"]
                );

                eventId = stripeEvent.Id;

                var alreadyHandled = await _db.WebhookLogs
                    .AnyAsync(e => e.GatewayEventId == eventId
                        && (e.ProcessingStatus == StatusCodesEx.Processing.Success ||
                            e.ProcessingStatus == StatusCodesEx.Processing.Ignored));
                if (alreadyHandled)
                {
                    _logger.LogInformation("Duplicate webhook ignored: {EventId}", eventId);
                    return Ok();
                }

                switch (stripeEvent.Type)
                {
                    case "checkout.session.completed":
                        var session = stripeEvent.Data.Object as Session;
                        await HandleCheckoutCompleted(session!, eventId);
                        break;

                    case "checkout.session.expired":
                        var expiredSession = stripeEvent.Data.Object as Session;
                        await HandleCheckoutExpired(expiredSession!, eventId);
                        break;

                    case "payment_intent.processing":
                        var processingIntent = stripeEvent.Data.Object as PaymentIntent;
                        await _paymentAttempts.MarkProcessingAsync(processingIntent!, HttpContext.RequestAborted);
                        await UpsertWebhookLogAsync(eventId, stripeEvent.Type, json, StatusCodesEx.Processing.Ignored);
                        break;

                    case "payment_intent.succeeded":
                        var succeededIntent = stripeEvent.Data.Object as PaymentIntent;
                        var result = await _paymentAttempts.FinalizePaymentIntentAsync(
                            succeededIntent!,
                            eventId,
                            HttpContext.RequestAborted);
                        await UpsertWebhookLogAsync(
                            eventId,
                            stripeEvent.Type,
                            json,
                            result.Success ? (result.AlreadyProcessed ? "I" : "S") : "F",
                            result.Success ? null : $"{result.Code}: {result.Message}",
                            intent: succeededIntent);
                        break;

                    case "payment_intent.payment_failed":
                        var failedIntent = stripeEvent.Data.Object as PaymentIntent;
                        await _paymentAttempts.MarkFailedAsync(
                            failedIntent!,
                            failedIntent?.LastPaymentError?.Message,
                            HttpContext.RequestAborted);
                        await UpsertWebhookLogAsync(eventId, stripeEvent.Type, json, "I", intent: failedIntent);
                        break;

                    case "payment_intent.canceled":
                        var canceledIntent = stripeEvent.Data.Object as PaymentIntent;
                        await _paymentAttempts.MarkCanceledAsync(canceledIntent!, HttpContext.RequestAborted);
                        await UpsertWebhookLogAsync(eventId, stripeEvent.Type, json, "I", intent: canceledIntent);
                        break;

                    case "charge.refunded":
                        var refundedCharge = stripeEvent.Data.Object as Charge;
                        await HandleChargeRefunded(refundedCharge!, eventId);
                        break;

                    default:
                        await UpsertWebhookLogAsync(eventId, stripeEvent.Type, json, "I");
                        break;
                }

                return Ok();
            }
            catch (StripeException ex)
            {
                _logger.LogError(ex, "Webhook signature verification failed");

                _db.WebhookLogs.Add(new WebhookLog
                {
                    PaymentGateway   = "stripe",
                    GatewayEventId   = await CreateUniqueGatewayEventIdAsync("unknown_signature"),
                    EventType        = "signature_verification_failed",
                    PayloadJson      = json,
                    ProcessingStatus = StatusCodesEx.Processing.Failed,
                    ErrorMessage     = ex.Message,
                    ReceivedAt       = DateTime.UtcNow
                });
                await _db.SaveChangesAsync();

                return BadRequest();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Webhook processing error for event {EventId}", eventId);

                try
                {
                    await LogUnhandledWebhookErrorAsync(eventId, json, ex.Message);
                }
                catch { /* ignore logging errors */ }

                return StatusCode(500);
            }
        }

        private async Task HandleCheckoutCompleted(Session session, string eventId)
        {
            if (session.Metadata.TryGetValue("flow", out var flow) && flow == "session_first")
            {
                var result = await _paymentFinalization.FinalizeSessionFirstAsync(session);
                if (!result.Success)
                {
                    _logger.LogError(
                        "Webhook: failed to finalize session-first session {SessionId}: {Code} {Message}",
                        session.Id, result.Code, result.Message);

                    // ── CHANGED: store payer contact on the failed WebhookLog row ──
                    // This ensures Case-C rows on the admin reconciliation page always
                    // show name/email/phone without needing a live Stripe API call.
                    await UpsertWebhookLogAsync(
                        eventId,
                        "checkout.session.completed",
                        System.Text.Json.JsonSerializer.Serialize(session),
                        "F",
                        $"{result.Code}: {result.Message}",
                        session);   // pass session so payer metadata is captured

                    if (IsRetryableFinalizationFailure(result.Code))
                        throw new InvalidOperationException($"Retryable payment finalization failure: {result.Code}");
                    return;
                }

                await UpsertWebhookLogAsync(
                    eventId,
                    "checkout.session.completed",
                    System.Text.Json.JsonSerializer.Serialize(session),
                    result.AlreadyProcessed ? StatusCodesEx.Processing.Ignored : StatusCodesEx.Processing.Success,
                    session: session);   // CHANGED: pass session for metadata capture on all outcomes

                return;
            }

            // ── Legacy flow ───────────────────────────────────────────────────
            var existingLog = await _db.WebhookLogs
                .FirstOrDefaultAsync(e => e.GatewayEventId == eventId && e.ProcessingStatus == StatusCodesEx.Processing.Success);

            if (existingLog != null)
            {
                _logger.LogInformation("Duplicate webhook ignored: {EventId}", eventId);
                return;
            }

            const int maxRetries = 3;
            int attempt = 0;

            while (attempt < maxRetries)
            {
                using var transaction = await _db.Database.BeginTransactionAsync();
                try
                {
                    if (!session.Metadata.TryGetValue("registration_id", out var regIdStr) ||
                        !int.TryParse(regIdStr, out var registrationId))
                    {
                        _logger.LogWarning("Registration ID not found in session {SessionId}", session.Id);
                        await transaction.RollbackAsync();
                        return;
                    }

                    var registration = await _db.EventRegistrations
                        .FirstOrDefaultAsync(r => r.RegistrationId == registrationId);

                    if (registration == null)
                    {
                        _logger.LogWarning("Registration {RegId} not found", registrationId);
                        await transaction.RollbackAsync();
                        return;
                    }

                    var existingPayment = await _db.Payments
                        .FirstOrDefaultAsync(p => p.GatewaySessionId == session.Id);

                    if (existingPayment != null)
                    {
                        _logger.LogInformation("Payment already processed for session {SessionId}", session.Id);
                        await transaction.RollbackAsync();
                        return;
                    }

                    session.Metadata.TryGetValue("payment_method", out var paymentMethodMeta);
                    var paymentMethod = paymentMethodMeta ?? "CreditCard";
                    var receiptProgramId = await _db.PaymentItems
                        .Where(pi => pi.GroupId != 0 &&
                               _db.ParticipantGroups
                                  .Where(g => g.RegistrationId == registrationId)
                                  .Select(g => g.GroupId)
                                  .Contains(pi.GroupId))
                        .Select(pi => (int?)pi.ProgramId)
                        .OrderBy(pid => pid)
                        .FirstOrDefaultAsync();

                    var payment = new Payment
                    {
                        RegistrationId   = registrationId,
                        EventId          = registration.EventId,
                        Amount           = registration.TotalAmount,
                        Currency         = registration.Currency,
                        PaymentGateway   = "Stripe",
                        PaymentMethod    = paymentMethod,
                        PaymentStatus    = StatusCodesEx.Payment.Success,
                        GatewaySessionId = session.Id,
                        GatewayPaymentId = session.PaymentIntentId,
                        PaidAt           = DateTime.UtcNow,
                        CreatedAt        = DateTime.UtcNow,
                        ReceiptNumber    = ReceiptNumberGenerator.Generate(registration.EventId, receiptProgramId),
                    };

                    _db.Payments.Add(payment);
                    await _db.SaveChangesAsync();

                    var paymentItems = await _db.PaymentItems
                        .Where(pi => pi.GroupId != 0 &&
                               _db.ParticipantGroups
                                  .Where(g => g.RegistrationId == registrationId)
                                  .Select(g => g.GroupId)
                                  .Contains(pi.GroupId))
                        .ToListAsync();

                    foreach (var item in paymentItems)
                    {
                        item.ItemStatus = StatusCodesEx.PaymentItem.Success;
                        item.PaymentId  = payment.PaymentId;
                        item.UpdatedAt  = DateTime.UtcNow;
                    }

                    registration.RegistrationStatus = StatusCodesEx.Registration.Confirmed;
                    registration.RegStatus          = StatusCodesEx.Registration.Confirmed;
                    registration.UpdatedAt          = DateTime.UtcNow;
                    registration.ConfirmedAt        = DateTime.UtcNow;

                    var groups = await _db.ParticipantGroups
                        .Where(g => g.RegistrationId == registrationId)
                        .ToListAsync();
                    foreach (var g in groups) { g.GroupStatus = StatusCodesEx.Registration.Confirmed; g.UpdatedAt = DateTime.UtcNow; }

                    await UpsertWebhookLogAsync(
                        eventId,
                        "checkout.session.completed",
                        System.Text.Json.JsonSerializer.Serialize(session),
                        "S",
                        session: session);

                    try { await _db.SaveChangesAsync(); }
                    catch (DbUpdateException ex) when (ex.InnerException?.Message.Contains("duplicate") == true)
                    {
                        _logger.LogInformation("Duplicate webhook detected during save: {EventId}", eventId);
                        await transaction.RollbackAsync();
                        return;
                    }

                    await transaction.CommitAsync();

                    var paymentIdForJob = payment.PaymentId;
                    var regIdForJob     = registrationId;
                    await _jobQueue.EnqueueAsync(async ct =>
                    {
                        using var scope = _serviceScopeFactory.CreateScope();
                        var receiptSvc  = scope.ServiceProvider.GetRequiredService<ReceiptService>();
                        var detailsPdfSvc = scope.ServiceProvider.GetRequiredService<RegistrationDetailsPdfService>();
                        var emailSvc    = scope.ServiceProvider.GetRequiredService<EmailService>();
                        var jobDb       = scope.ServiceProvider.GetRequiredService<TRSDbContext>();
                        try
                        {
                            var pdfBytes = await receiptSvc.GenerateAsync(jobDb, regIdForJob);
                            var detailsPdfBytes = await detailsPdfSvc.GenerateAsync(jobDb, regIdForJob);
                            _logger.LogInformation("Receipt generated ({Bytes} bytes) for registration {RegId}",
                                pdfBytes.Length, regIdForJob);
                            await emailSvc.SendPaymentConfirmationAsync(jobDb, regIdForJob, pdfBytes, detailsPdfBytes, ct);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Failed to generate receipt for payment {PaymentId}", paymentIdForJob);
                        }
                    });

                    _logger.LogInformation("Successfully processed legacy payment {PaymentId} for registration {RegId}",
                        payment.PaymentId, registrationId);
                    return;
                }
                catch (DbUpdateException ex) when (attempt < maxRetries - 1)
                {
                    await transaction.RollbackAsync();
                    attempt++;
                    _logger.LogWarning(ex, "Retry attempt {Attempt} for webhook {EventId}", attempt, eventId);
                    await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt)));
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    try
                    {
                        await UpsertWebhookLogAsync(
                            eventId,
                            "checkout.session.completed",
                            System.Text.Json.JsonSerializer.Serialize(session),
                            "F",
                            ex.Message,
                            session);
                    }
                    catch (Exception logEx) { _logger.LogError(logEx, "Failed to log webhook error"); }
                    throw;
                }
            }
        }

        private async Task HandleCheckoutExpired(Session session, string eventId)
        {
            if (session.Metadata.TryGetValue("flow", out var flow) && flow == "session_first")
            {
                _logger.LogInformation(
                    "Webhook: session-first session {SessionId} expired — purging PendingCheckout row",
                    session.Id);
                try
                {
                    var pending = await _db.PendingCheckouts.FindAsync(session.Id);
                    if (pending != null)
                    {
                        _db.PendingCheckouts.Remove(pending);
                        await _db.SaveChangesAsync();
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Failed to purge PendingCheckout for expired session {SessionId}", session.Id);
                }
                return;
            }

            try
            {
                var payment = await _db.Payments.FirstOrDefaultAsync(p => p.GatewaySessionId == session.Id);
                if (payment != null && payment.PaymentStatus == StatusCodesEx.Payment.Pending)
                {
                    payment.PaymentStatus = StatusCodesEx.Payment.Cancelled;
                    await UpsertWebhookLogAsync(
                        eventId,
                        "checkout.session.expired",
                        System.Text.Json.JsonSerializer.Serialize(session),
                        "S");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error handling checkout expired for session {SessionId}", session.Id);
            }
        }

        private async Task HandleChargeRefunded(Charge charge, string eventId)
        {
            var payment = await _db.Payments
                .Include(p => p.Items)
                .Include(p => p.Refunds)
                .FirstOrDefaultAsync(p =>
                    p.GatewayPaymentId == charge.PaymentIntentId ||
                    p.GatewayChargeId  == charge.Id);

            if (payment == null)
            {
                _logger.LogWarning(
                    "Refund webhook received for unknown charge/payment intent {ChargeId}/{PaymentIntentId}",
                    charge.Id, charge.PaymentIntentId);
                await LogChargeRefundReconciliationFailureAsync(
                    eventId,
                    charge,
                    $"Refund webhook received for unknown charge/payment intent {charge.Id}/{charge.PaymentIntentId}");
                return;
            }

            var changed = false;
            foreach (var stripeRefund in charge.Refunds?.Data ?? Enumerable.Empty<Stripe.Refund>())
            {
                var localRefund = await _db.Refunds.FirstOrDefaultAsync(r => r.GatewayRefundId == stripeRefund.Id);
                if (localRefund == null)
                {
                    _logger.LogWarning(
                        "Refund webhook {EventId} references Stripe refund {RefundId}, but no local refund row exists",
                        eventId,
                        stripeRefund.Id);
                    await LogChargeRefundReconciliationFailureAsync(
                        $"{eventId}_{stripeRefund.Id}",
                        charge,
                        $"Stripe refund {stripeRefund.Id} has no matching local refund row.");
                    continue;
                }

                var newStatus = stripeRefund.Status switch
                {
                    "succeeded" => StatusCodesEx.Refund.Success,
                    "failed"    => StatusCodesEx.Refund.Failed,
                    _           => localRefund.RefundStatus
                };

                if (localRefund.RefundStatus != newStatus)
                {
                    localRefund.RefundStatus = newStatus;
                    localRefund.ProcessedAt  = DateTime.UtcNow;
                    changed = true;
                }

                var item = payment.Items.FirstOrDefault(i => i.PaymentItemId == localRefund.PaymentItemId);
                if (item != null && newStatus == StatusCodesEx.Refund.Success)
                {
                    PaymentController.ApplyRefundItemOutcome(payment, item);
                    changed = true;
                }
            }

            if (!changed) return;

            PaymentController.ApplyRefundOutcome(payment);
            await _db.SaveChangesAsync();
            await UpsertWebhookLogAsync(
                eventId,
                "charge.refunded",
                System.Text.Json.JsonSerializer.Serialize(charge),
                "S");
        }

        private static bool IsRetryableFinalizationFailure(string? code) =>
            string.Equals(code, "CREATE_FAILED", StringComparison.Ordinal);

        private async Task LogChargeRefundReconciliationFailureAsync(
            string eventId,
            Charge charge,
            string errorMessage)
        {
            var gatewayReference = !string.IsNullOrWhiteSpace(charge.PaymentIntentId)
                ? charge.PaymentIntentId
                : charge.Id;

            _db.WebhookLogs.Add(new WebhookLog
            {
                PaymentGateway = "stripe",
                GatewayEventId = await CreateUniqueGatewayEventIdAsync(eventId),
                GatewaySessionId = gatewayReference,
                EventType = "charge.refunded",
                PayloadJson = System.Text.Json.JsonSerializer.Serialize(charge),
                ProcessingStatus = StatusCodesEx.Processing.Failed,
                ErrorMessage = errorMessage,
                ReceivedAt = DateTime.UtcNow,
                ProcessedAt = DateTime.UtcNow,
                Amount = charge.AmountRefunded > 0 ? charge.AmountRefunded / 100m : null,
                Currency = charge.Currency?.ToUpperInvariant(),
            });
            await _db.SaveChangesAsync();
        }

        // ── CHANGED: optional session parameter added to capture payer metadata ──
        // When session is provided (checkout.session.completed events), the log row
        // is enriched with GatewaySessionId and payer contact fields so the admin
        // payment reconciliation page can display Case-C rows without a live Stripe call.
        private async Task UpsertWebhookLogAsync(
            string  eventId,
            string  eventType,
            string  payloadJson,
            string  processingStatus,
            string? errorMessage = null,
            Session? session     = null,
            PaymentIntent? intent = null)
        {
            var now = DateTime.UtcNow;
            var log = await _db.WebhookLogs
                .FirstOrDefaultAsync(e => e.GatewayEventId == eventId);

            if (log == null)
            {
                log = new WebhookLog
                {
                    PaymentGateway   = "stripe",
                    GatewayEventId   = eventId,
                    EventType        = eventType,
                    PayloadJson      = payloadJson,
                    ProcessingStatus = processingStatus,
                    ErrorMessage     = errorMessage,
                    ReceivedAt       = now,
                    ProcessedAt      = processingStatus == StatusCodesEx.Processing.Pending ? null : now,
                };
                _db.WebhookLogs.Add(log);
            }
            else
            {
                log.EventType        = eventType;
                log.PayloadJson      = payloadJson;
                log.ProcessingStatus = processingStatus;
                log.ErrorMessage     = errorMessage;
                log.ProcessedAt      = processingStatus == StatusCodesEx.Processing.Pending ? null : now;
            }

            // Populate payer metadata from session when available.
            // These fields are used by GET /api/admin/payment-reconciliation/webhook-failures
            // to show contact info for Case-C orphan payment rows.
            if (session != null)
            {
                log.GatewaySessionId = session.Id;
                log.ContactName      = session.Metadata?.GetValueOrDefault("contact_name")
                                       ?? session.CustomerDetails?.Name;
                log.ContactEmail     = session.Metadata?.GetValueOrDefault("contact_email")
                                       ?? session.CustomerDetails?.Email;
                log.ContactPhone     = session.Metadata?.GetValueOrDefault("contact_phone")
                                       ?? session.CustomerDetails?.Phone;
                log.Amount           = session.AmountTotal.HasValue
                                         ? session.AmountTotal.Value / 100m
                                         : null;
                log.Currency         = session.Currency?.ToUpperInvariant();
            }

            if (intent != null)
            {
                log.GatewaySessionId = intent.Id;
                log.ContactName      = intent.Metadata?.GetValueOrDefault("contact_name");
                log.ContactEmail     = intent.Metadata?.GetValueOrDefault("contact_email");
                log.ContactPhone     = intent.Metadata?.GetValueOrDefault("contact_phone");
                log.Amount           = (intent.AmountReceived > 0 ? intent.AmountReceived : intent.Amount) / 100m;
                log.Currency         = intent.Currency?.ToUpperInvariant();
            }

            await _db.SaveChangesAsync();
        }

        private async Task LogUnhandledWebhookErrorAsync(string? eventId, string payloadJson, string errorMessage)
        {
            if (!string.IsNullOrWhiteSpace(eventId))
            {
                var existing = await _db.WebhookLogs
                    .FirstOrDefaultAsync(e => e.GatewayEventId == eventId);

                if (existing != null)
                {
                    existing.ProcessingStatus = StatusCodesEx.Processing.Failed;
                    existing.ErrorMessage ??= errorMessage;
                    existing.ProcessedAt = DateTime.UtcNow;
                    await _db.SaveChangesAsync();
                    return;
                }
            }

            await UpsertWebhookLogAsync(
                string.IsNullOrWhiteSpace(eventId) ? await CreateUniqueGatewayEventIdAsync("unknown_processing") : eventId,
                "processing_error",
                payloadJson,
                "F",
                errorMessage);
        }

        private async Task<string> CreateUniqueGatewayEventIdAsync(string prefix)
        {
            var baseId = $"{prefix}_{DateTime.UtcNow:yyyyMMddHHmmssfff}_{Guid.NewGuid():N}"[..Math.Min(255, prefix.Length + 1 + 17 + 1 + 32)];
            var candidate = baseId;
            var suffix = 0;

            while (await _db.WebhookLogs.AnyAsync(w => w.GatewayEventId == candidate))
            {
                suffix++;
                var suffixText = $"_{suffix}";
                candidate = baseId.Length + suffixText.Length <= 255
                    ? $"{baseId}{suffixText}"
                    : $"{baseId[..(255 - suffixText.Length)]}{suffixText}";
            }

            return candidate;
        }
    }
}
