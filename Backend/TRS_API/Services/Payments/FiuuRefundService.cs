using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TRS_API.Controllers;
using TRS_Data.Models;

namespace TRS_API.Services.Payments;

public sealed class FiuuRefundService(TRSDbContext db, FiuuApiClient api, FiuuSignatureValidator signatures,
    IOptions<FiuuOptions> options, IBackgroundJobQueue jobs, IServiceScopeFactory scopes, ILogger<FiuuRefundService> logger)
{
    public static bool IsCaptured(FiuuPaymentResult payment) => payment.PaymentStatus == StatusCodesEx.Payment.Success
        && (string.Equals(payment.ProviderStatusName, "captured", StringComparison.OrdinalIgnoreCase)
            || string.Equals(payment.ProviderStatusName, "settled", StringComparison.OrdinalIgnoreCase));

    public static string TransactionId(string reference)
    {
        if (!reference.StartsWith("fiuu:", StringComparison.Ordinal))
            throw FiuuSignatureValidator.Invalid("FIUU_REFERENCE", "The original Fiuu transaction reference is missing.");
        var id = reference[5..];
        try { FiuuSignatureValidator.Reference(id, 20, true); }
        catch (ArgumentException) { throw FiuuSignatureValidator.Invalid("FIUU_REFERENCE", "The original Fiuu transaction reference is invalid."); }
        return id;
    }

    public async Task<FiuuPaymentResult> QueryPaymentAsync(string reference, CancellationToken ct)
    {
        var transaction = TransactionId(reference);
        var attempt = await db.PaymentAttempts.AsNoTracking().SingleOrDefaultAsync(a => a.PaymentGateway == "Fiuu" && a.GatewayTransactionId == transaction, ct);
        if (attempt?.GatewayOrderId != null)
            return await api.QueryPaymentAsync(transaction, attempt.GatewayOrderId, attempt.Amount, attempt.Currency, ct);
        // Additional captured transactions have their own verified log, even though the order is already bound.
        var log = await db.WebhookLogs.AsNoTracking().Where(w => w.PaymentGateway == "Fiuu" && w.GatewaySessionId == reference
            && (w.EventType == "processing_error" || w.EventType == "payment.succeeded") && w.Amount != null && w.Currency != null)
            .OrderByDescending(w => w.WebhookLogId).FirstOrDefaultAsync(ct);
        if (log == null) throw FiuuSignatureValidator.Invalid("FIUU_CONTEXT_MISSING", "Verified payment context is missing. Review this transaction with the provider.");
        FiuuPaymentResult? recorded;
        try { recorded = JsonSerializer.Deserialize<FiuuPaymentResult>(log.PayloadJson); }
        catch (JsonException) { recorded = null; }
        if (recorded == null || recorded.TransactionId != transaction || recorded.Amount != log.Amount || recorded.Currency != log.Currency)
            throw FiuuSignatureValidator.Invalid("FIUU_CONTEXT_MISSING", "Verified payment context does not match this transaction.");
        return await api.QueryPaymentAsync(transaction, recorded.OrderId, recorded.Amount, recorded.Currency, ct);
    }

    public static bool IsDefiniteRejection(string code) => code is
        "FIUU_PR001" or "FIUU_PR002" or "FIUU_PR003" or "FIUU_PR004" or "FIUU_PR005" or "FIUU_PR006"
        or "FIUU_PR007" or "FIUU_PR008" or "FIUU_PR009" or "FIUU_PR010" or "FIUU_PR011" or "FIUU_PR012"
        or "FIUU_PR013" or "FIUU_PR014" or "FIUU_PR017" or "FIUU_PR018" or "FIUU_PR019" or "FIUU_PR020";

    public async Task<GatewayRefund> SubmitAsync(GatewayRefundRequest request, CancellationToken ct)
    {
        if (request.LocalRefundId is not int id)
            throw FiuuSignatureValidator.Invalid("REFUND_CONTEXT_REQUIRED", "A saved refund request is required.");
        var refund = await LoadAsync(id, ct);
        await using var operation = new FiuuRefundOperationLock(db);
        await operation.AcquireAsync(Resource(refund), ct);
        await db.Entry(refund).ReloadAsync(ct);
        var reference = PaymentReference(refund);
        if (reference != request.PaymentReference || refund.RefundAmount != request.Amount)
            throw FiuuSignatureValidator.Invalid("REFUND_CONTEXT_MISMATCH", "The saved refund does not match the requested transaction or amount.");
        if (refund.RefundStatus != StatusCodesEx.Refund.Pending) return new(refund.GatewayRefundId, refund.RefundStatus);
        if (refund.GatewaySubmittedAt != null)
        {
            // A previous dispatch might have reached Fiuu. Never submit it again, even on a not-found inquiry.
            try { return ToGateway(await QueryRefundAsync(refund, ct)); }
            catch (PaymentGatewayException ex) { return await UncertainAsync(refund, ex.Code, ct); }
        }
        if (await db.WebhookLogs.AnyAsync(w => w.PaymentGateway == "Fiuu" && w.GatewaySessionId == reference
            && w.EventType == "refund.updated" && w.ProcessingStatus == StatusCodesEx.Processing.Failed, ct))
            throw FiuuSignatureValidator.Invalid("REFUND_REVIEW_REQUIRED", "Review the conflicting refund outcome before requesting another refund.");
        try { options.Value.Validate(); FiuuOptions.ValidateBaseUrl(options.Value.PublicApiBaseUrl); }
        catch (InvalidOperationException) { throw FiuuSignatureValidator.Invalid("FIUU_CONFIGURATION", "Fiuu refund callback settings are incomplete."); }
        var payment = await QueryPaymentAsync(reference, ct);
        if (!IsCaptured(payment) || request.Amount <= 0 || request.Amount > payment.Amount)
            throw FiuuSignatureValidator.Invalid("FIUU_REFUND_VALIDATION", "Refund requires a captured payment and a valid refundable amount.");
        refund.GatewayRequestId ??= "TRSR" + Guid.NewGuid().ToString("N");
        refund.GatewaySubmittedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); // Durable dispatch marker BEFORE any network submission.
        try
        {
            var result = await api.SubmitRefundAsync(refund.GatewayRequestId, payment.TransactionId, request.Amount,
                notificationUrl: new Uri(options.Value.PublicApiBaseUrl.TrimEnd('/') + "/api/webhooks/fiuu/refund"), ct: ct);
            return ToGateway(result);
        }
        catch (PaymentGatewayException ex) when (IsDefiniteRejection(ex.Code))
        {
            throw;
        }
        catch (Exception ex) when (ex is PaymentGatewayException or OperationCanceledException or HttpRequestException)
        {
            // Request cancellation also does not prove rejection. The persisted row remains recoverable.
            return await UncertainAsync(refund, ex is PaymentGatewayException gatewayError ? gatewayError.Code : "FIUU_REQUEST_UNCERTAIN", CancellationToken.None);
        }
    }

    private static GatewayRefund ToGateway(FiuuRefundResult result) => new("fiuu-refund:" + result.RefundId, result.RefundStatus,
        result.RefundStatus == StatusCodesEx.Refund.Failed ? result.ProviderStatus : null, result.Reason);

    private async Task<GatewayRefund> UncertainAsync(Refund refund, string code, CancellationToken ct)
    {
        db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "Refund", EntityId = refund.RefundId, Action = "RefundOutcomeUnconfirmed",
            OldStatus = refund.RefundStatus, NewStatus = StatusCodesEx.Refund.Pending, PerformedBy = refund.RequestedBy ?? "system",
            Notes = $"Request={refund.GatewayRequestId}; Code={code}; query the original request, do not resubmit.", CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        return new(refund.GatewayRefundId, StatusCodesEx.Refund.Pending);
    }

    public async Task ReceiveAsync(IReadOnlyDictionary<string, string> fields, CancellationToken ct)
    {
        var reference = FiuuSignatureValidator.Required(fields, "RefID");
        var refund = await db.Refunds.Include(r => r.Payment).SingleOrDefaultAsync(r => r.PaymentGateway == "Fiuu" && r.GatewayRequestId == reference, ct)
            ?? throw FiuuSignatureValidator.Invalid("FIUU_REFUND_NOT_FOUND", "Refund request was not found.");
        var result = signatures.ValidateRefundNotification(fields, reference, TransactionId(PaymentReference(refund)), refund.RefundAmount);
        await ApplyAsync(refund.RefundId, result, ct);
    }

    public async Task SweepAsync(CancellationToken ct)
    {
        var ids = await db.Refunds.AsNoTracking().Where(r => r.PaymentGateway == "Fiuu" && r.RefundStatus == StatusCodesEx.Refund.Pending
            && r.GatewaySubmittedAt != null && r.GatewayRequestId != null).OrderBy(r => r.GatewaySubmittedAt).Select(r => r.RefundId).ToListAsync(ct);
        foreach (var id in ids)
        {
            try
            {
                var refund = await LoadAsync(id, ct);
                var result = await QueryRefundAsync(refund, ct);
                await ApplyAsync(id, result, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                logger.LogWarning("Fiuu refund {RefundId} remains unconfirmed ({Code}).", id,
                    ex is PaymentGatewayException gatewayError ? gatewayError.Code : ex.GetType().Name);
            }
        }
    }

    private Task<FiuuRefundResult> QueryRefundAsync(Refund refund, CancellationToken ct) =>
        api.QueryRefundAsync(refund.GatewayRequestId ?? throw new InvalidOperationException("Refund request reference is missing."),
            TransactionId(PaymentReference(refund)), ct);

    private Task<Refund> LoadAsync(int id, CancellationToken ct) => db.Refunds.Include(r => r.Payment)
        .SingleAsync(r => r.RefundId == id && r.PaymentGateway == "Fiuu", ct);
    private static string PaymentReference(Refund refund) => refund.Payment?.GatewayPaymentId ?? refund.GatewaySessionId
        ?? throw FiuuSignatureValidator.Invalid("FIUU_REFERENCE", "The original transaction is missing.");
    private static string Resource(Refund refund) => refund.Payment != null
        ? FiuuRefundOperationLock.Registration(refund.Payment.RegistrationId) : FiuuRefundOperationLock.Orphan(PaymentReference(refund));

    public async Task ApplyAsync(int id, FiuuRefundResult result, CancellationToken ct)
    {
        var refund = await LoadAsync(id, ct);
        await using var operation = new FiuuRefundOperationLock(db);
        await operation.AcquireAsync(Resource(refund), ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.ChangeTracker.Clear();
        refund = await LoadAsync(id, ct);
        FiuuSignatureValidator.Match(result.Reference, refund.GatewayRequestId ?? "");
        FiuuSignatureValidator.Match(result.TransactionId, TransactionId(PaymentReference(refund)));
        var gatewayId = "fiuu-refund:" + result.RefundId;
        if (refund.GatewayRefundId != null) FiuuSignatureValidator.Match(gatewayId, refund.GatewayRefundId);
        var eventId = "fiuu_refund_" + result.RefundId + "_" + result.RefundStatus;
        if (await db.WebhookLogs.AnyAsync(w => w.GatewayEventId == eventId, ct)) return;
        var before = refund.RefundStatus;
        var conflict = before != StatusCodesEx.Refund.Pending && result.RefundStatus != StatusCodesEx.Refund.Pending && before != result.RefundStatus;
        var changed = before == StatusCodesEx.Refund.Pending && result.RefundStatus != before;
        refund.GatewayRefundId ??= gatewayId;
        if (changed)
        {
            refund.RefundStatus = result.RefundStatus;
            refund.ProcessedAt = DateTime.UtcNow;
        }
        // A synchronous success may have been saved before the controller finished updating totals.
        // Recompute on the first verified success notification even when the refund is already S.
        if (changed || (before == StatusCodesEx.Refund.Success && result.RefundStatus == StatusCodesEx.Refund.Success))
        {
            if (refund.PaymentId is int paymentId)
            {
                var payment = await db.Payments.Include(p => p.Items).Include(p => p.Refunds)
                    .Include(p => p.Registration).ThenInclude(r => r.ParticipantGroups).ThenInclude(g => g.Participants)
                    .SingleAsync(p => p.PaymentId == paymentId, ct);
                ApplyRegistrationOutcome(payment, refund);
            }
            else if (result.RefundStatus == StatusCodesEx.Refund.Success) await ResolveOrphanAsync(id, "fiuu-webhook", ct);
            db.PaymentAuditLogs.Add(new PaymentAuditLog
            {
                EntityType = "Refund", EntityId = id, Action = "RefundOutcomeVerified", OldStatus = before, NewStatus = refund.RefundStatus,
                PerformedBy = "fiuu-webhook", Reason = refund.RefundReason, Notes = $"Request={result.Reference}; Refund={gatewayId}", CreatedAt = DateTime.UtcNow,
            });
        }
        db.WebhookLogs.Add(new WebhookLog
        {
            PaymentGateway = "Fiuu", GatewayEventId = eventId, GatewaySessionId = PaymentReference(refund), PaymentId = refund.PaymentId,
            EventType = "refund.updated", PayloadJson = JsonSerializer.Serialize(result),
            ProcessingStatus = conflict ? StatusCodesEx.Processing.Failed : changed ? StatusCodesEx.Processing.Success : StatusCodesEx.Processing.Ignored,
            ErrorMessage = conflict ? "Conflicting terminal refund status. Review the provider transaction before further refunds." : null,
            Amount = refund.RefundAmount, ReceivedAt = DateTime.UtcNow, ProcessedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        if (changed && result.RefundStatus == StatusCodesEx.Refund.Success && refund.Payment != null)
            await QueueEmailAsync(refund.Payment.RegistrationId);
    }

    public async Task ResolveOrphanAsync(int id, string actor, CancellationToken ct)
    {
        var refund = await LoadAsync(id, ct);
        if (refund.PaymentId != null || refund.RefundStatus != StatusCodesEx.Refund.Success) return;
        var reference = PaymentReference(refund);
        var logs = await db.WebhookLogs.Where(w => w.PaymentGateway == "Fiuu" && w.GatewaySessionId == reference
            && w.ProcessingStatus == StatusCodesEx.Processing.Failed && !w.EventType.StartsWith("refund.")).ToListAsync(ct);
        foreach (var log in logs) { log.ProcessingStatus = StatusCodesEx.Processing.Success; log.ProcessedAt = DateTime.UtcNow; }
        var txn = TransactionId(reference);
        var attempt = await db.PaymentAttempts.SingleOrDefaultAsync(a => a.PaymentGateway == "Fiuu" && a.GatewayTransactionId == txn
            && a.Status == PaymentAttemptService.NeedsReconciliation && a.ResolvedAt == null, ct);
        if (attempt != null)
        {
            attempt.ResolvedAt = DateTime.UtcNow; attempt.ResolvedBy = actor;
            attempt.ResolutionNote = "Resolved by completed refund " + refund.GatewayRefundId; attempt.UpdatedAt = DateTime.UtcNow;
        }
        // Caller commits atomically with the refund outcome and audit.
    }

    public static void ApplyRegistrationOutcome(Payment payment, Refund refund)
    {
        var item = payment.Items.SingleOrDefault(i => i.PaymentItemId == refund.PaymentItemId)
            ?? throw new InvalidOperationException("Refund payment item is missing.");
        if (refund.RefundStatus == StatusCodesEx.Refund.Success)
        {
            PaymentController.ApplyRefundItemOutcome(payment, item);
            PaymentController.ApplyRefundOutcome(payment);
            ApplyCancellation(payment, item, refund);
        }
        if (IsCancellation(refund)) UpdateCancellationStatus(payment);
    }

    private static bool IsCancellation(Refund refund) => refund.RefundReason?.StartsWith("Cancelled ", StringComparison.OrdinalIgnoreCase) == true;
    private static void ApplyCancellation(Payment payment, PaymentItem item, Refund refund)
    {
        if (!IsCancellation(refund)) return;
        var group = payment.Registration.ParticipantGroups.Single(g => g.GroupId == item.GroupId);
        if (item.ParticipantId is int id)
        {
            var participant = group.Participants.Single(p => p.ParticipantId == id);
            participant.ParticipantStatus = StatusCodesEx.Participant.Cancelled; participant.UpdatedAt = DateTime.UtcNow;
        }
        else foreach (var participant in group.Participants)
        { participant.ParticipantStatus = StatusCodesEx.Participant.Cancelled; participant.UpdatedAt = DateTime.UtcNow; }
        if (item.ParticipantId == null || group.Participants.All(p => p.ParticipantStatus == StatusCodesEx.Participant.Cancelled))
        { group.GroupStatus = StatusCodesEx.Registration.Cancelled; group.UpdatedAt = DateTime.UtcNow; }
    }

    private static void UpdateCancellationStatus(Payment payment)
    {
        var cancellations = payment.Refunds.Where(IsCancellation).ToList();
        var statuses = cancellations.GroupBy(r => r.PaymentItemId).Select(g => g.OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.RefundId).First().RefundStatus).ToList();
        var whole = cancellations.Any(r => r.RefundReason!.StartsWith("Cancelled registration:", StringComparison.OrdinalIgnoreCase));
        var status = statuses.Contains(StatusCodesEx.Refund.Failed) ? StatusCodesEx.Registration.RefundFailed
            : statuses.Contains(StatusCodesEx.Refund.Pending) ? (whole ? StatusCodesEx.Registration.CancelPending : StatusCodesEx.Registration.Confirmed)
            : payment.Registration.ParticipantGroups.All(g => g.GroupStatus == StatusCodesEx.Registration.Cancelled) ? StatusCodesEx.Registration.Cancelled
            : whole ? StatusCodesEx.Registration.RefundFailed : StatusCodesEx.Registration.Confirmed;
        payment.Registration.RegStatus = status;
        payment.Registration.RegistrationStatus = status == StatusCodesEx.Registration.Cancelled ? status : StatusCodesEx.Registration.Confirmed;
        payment.Registration.UpdatedAt = DateTime.UtcNow;
    }

    private async Task QueueEmailAsync(int registrationId)
    {
        await jobs.EnqueueAsync(async ct =>
        {
            using var scope = scopes.CreateScope();
            try
            {
                var context = scope.ServiceProvider.GetRequiredService<TRSDbContext>();
                var pdf = await scope.ServiceProvider.GetRequiredService<ReceiptService>().GenerateAsync(context, registrationId);
                await scope.ServiceProvider.GetRequiredService<EmailService>().SendRefundNotificationAsync(context, registrationId, pdf, ct);
            }
            catch (Exception ex) { logger.LogError(ex, "Refund notification could not be sent for registration {RegistrationId}", registrationId); }
        });
    }
}
