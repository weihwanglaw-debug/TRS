using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using TRS_API.Services;
using TRS_Data;
using TRS_Data.Models;

namespace TRS_API.Controllers;

/// <summary>
/// Endpoints that serve the Payment Reconciliation page:
///   GET  /api/admin/payment-reconciliation/stats          - dashboard card count
///   GET  /api/admin/payment-reconciliation/webhook-failures - Case-C row list
///   POST /api/admin/payment-reconciliation/webhook-failures/{id}/refund - orphan refund
/// </summary>
[ApiController]
[Route("api/admin/payment-reconciliation")]
[Authorize(Roles = "superadmin,eventadmin")]
public class AdminPaymentReconciliationController : ControllerBase
{
    private readonly TRSDbContext _db;
    private readonly ILogger<AdminPaymentReconciliationController> _logger;
    private readonly IConfiguration _config;

    public AdminPaymentReconciliationController(TRSDbContext db,
        ILogger<AdminPaymentReconciliationController> logger,
        IConfiguration config)
    {
        _db     = db;
        _logger = logger;
        _config = config;
    }

    // GET /api/admin/payment-reconciliation/stats
    // Returns the combined count for the Dashboard "Payment Reconciliation" card.
    // caseA: RegStatus=C, PaymentStatus=P
    // caseB: RegStatus=P, PaymentStatus=S
    // caseC: WebhookLog ProcessingStatus=F, EventType=checkout.session.completed,
    //        no matching Payment row (money collected, no registration)
    [HttpGet("stats")]
    public async Task<IActionResult> Stats()
    {
        var caseA = await _db.EventRegistrations
            .Include(r => r.Payments)
            .CountAsync(r =>
                r.RegStatus == StatusCodesEx.Registration.Confirmed &&
                r.Payments.Any(p => p.PaymentStatus == StatusCodesEx.Payment.Pending));

        var caseB = await _db.EventRegistrations
            .Include(r => r.Payments)
            .CountAsync(r =>
                r.RegStatus == StatusCodesEx.Registration.Pending &&
                r.Payments.Any(p => p.PaymentStatus == StatusCodesEx.Payment.Success));

        // Case C: failed checkout.session.completed webhooks where no Payment
        // row exists for that Stripe session (money collected, nothing in DB).
        var failedSessionIds = await _db.WebhookLogs
            .Where(w =>
                w.ProcessingStatus == "F" &&
                (w.EventType == "checkout.session.completed" ||
                 w.EventType == "payment_intent.succeeded" ||
                 w.EventType == "processing_error") &&
                w.GatewaySessionId != null)
            .Select(w => w.GatewaySessionId!)
            .ToListAsync();

        var refundDiscrepancies = await _db.WebhookLogs
            .Where(w =>
                w.ProcessingStatus == "F" &&
                w.EventType == "charge.refunded" &&
                w.GatewaySessionId != null)
            .Select(w => w.GatewaySessionId!)
            .Distinct()
            .CountAsync();

        var matchedSessionIds = await _db.Payments
            .Where(p => (p.GatewaySessionId != null && failedSessionIds.Contains(p.GatewaySessionId!)) ||
                        (p.GatewayPaymentId != null && failedSessionIds.Contains(p.GatewayPaymentId!)))
            .Select(p => p.GatewaySessionId ?? p.GatewayPaymentId!)
            .ToListAsync();

        var caseC = failedSessionIds
            .Except(matchedSessionIds)
            .Count() + refundDiscrepancies;

        return Ok(new
        {
            caseA,
            caseB,
            caseC,
            total = caseA + caseB + caseC,
        });
    }

    // GET /api/admin/payment-reconciliation/webhook-failures
    // Returns all unresolved Case-C rows for the "Unmatched Stripe Payments" tab.
    // Filters out any row where a Payment was subsequently written for that session
    // (self-healed race condition).
    [HttpGet("webhook-failures")]
    public async Task<IActionResult> GetWebhookFailures()
    {
        var failures = await _db.WebhookLogs
            .Where(w =>
                w.ProcessingStatus == "F" &&
                (w.EventType == "checkout.session.completed" ||
                 w.EventType == "payment_intent.succeeded" ||
                 w.EventType == "charge.refunded" ||
                 w.EventType == "processing_error") &&
                w.GatewaySessionId != null)
            .OrderByDescending(w => w.ReceivedAt)
            .ToListAsync();

        if (failures.Count == 0)
            return Ok(Array.Empty<object>());

        // Filter out self-healed rows
        var sessionIds = failures
            .Select(f => f.GatewaySessionId!)
            .ToList();

        var healedList = await _db.Payments
            .Where(p => (p.GatewaySessionId != null && sessionIds.Contains(p.GatewaySessionId!)) ||
                        (p.GatewayPaymentId != null && sessionIds.Contains(p.GatewayPaymentId!)))
            .Select(p => p.GatewaySessionId ?? p.GatewayPaymentId!)
            .ToListAsync();
        var healed = healedList.ToHashSet();

        // Also get retry counts from the log (each webhook retry creates its own row
        // with the same GatewaySessionId but a different GatewayEventId suffix -
        // Stripe re-uses the same event ID on retries, so count by GatewaySessionId).
        var retryCounts = failures
            .GroupBy(f => f.GatewaySessionId!)
            .ToDictionary(g => g.Key, g => g.Count());

        // Deduplicate: one row per GatewaySessionId, pick the latest
        var deduped = failures
            .GroupBy(f => f.GatewaySessionId!)
            .Select(g => g.OrderByDescending(f => f.ReceivedAt).First())
            .Where(f => f.EventType == "charge.refunded" || !healed.Contains(f.GatewaySessionId!))
            .ToList();

        var result = deduped.Select(w => new
        {
            webhookLogId   = w.WebhookLogId,
            gatewaySessionId = w.GatewaySessionId,
            eventType      = w.EventType,
            errorMessage   = w.ErrorMessage,
            receivedAt     = w.ReceivedAt,
            retryCount     = retryCounts.GetValueOrDefault(w.GatewaySessionId!, 1),
            amount         = w.Amount,
            currency       = w.Currency ?? "SGD",
            contactName    = w.ContactName,
            contactEmail   = w.ContactEmail,
            contactPhone   = w.ContactPhone,
        });

        return Ok(result);
    }

    [HttpGet("refund-history")]
    public async Task<IActionResult> GetRefundHistory()
    {
        var rows = await _db.Refunds
            .Where(r => r.PaymentId == null && r.WebhookLogId != null)
            .Include(r => r.WebhookLog)
            .OrderByDescending(r => r.CreatedAt)
            .Take(200)
            .Select(r => new
            {
                refundId = r.RefundId,
                webhookLogId = r.WebhookLogId,
                gatewaySessionId = r.GatewaySessionId,
                gatewayRefundId = r.GatewayRefundId,
                refundSource = r.RefundSource,
                refundMethod = r.RefundMethod,
                refundAmount = r.RefundAmount,
                currency = r.WebhookLog != null ? (r.WebhookLog.Currency ?? "SGD") : "SGD",
                refundReason = r.RefundReason,
                refundStatus = r.RefundStatus,
                requestedBy = r.RequestedBy,
                approvedBy = r.ApprovedBy,
                createdAt = r.CreatedAt,
                processedAt = r.ProcessedAt,
                contactName = r.WebhookLog != null ? r.WebhookLog.ContactName : null,
                contactEmail = r.WebhookLog != null ? r.WebhookLog.ContactEmail : null,
                contactPhone = r.WebhookLog != null ? r.WebhookLog.ContactPhone : null,
            })
            .ToListAsync();

        return Ok(rows);
    }

    [HttpPatch("webhook-failures/{webhookLogId:int}/reviewed")]
    public async Task<IActionResult> MarkRefundWebhookReviewed(
        int webhookLogId,
        [FromBody] ReconciliationReviewRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Note))
            return BadRequest(new { code = "NOTE_REQUIRED", message = "Review note is required." });

        var log = await _db.WebhookLogs.FindAsync(webhookLogId);
        if (log == null)
            return NotFound(new { code = "NOT_FOUND" });

        if (log.EventType != "charge.refunded")
            return BadRequest(new { code = "INVALID_EVENT_TYPE", message = "Only refund webhook discrepancies can be marked reviewed." });

        if (string.IsNullOrWhiteSpace(log.GatewaySessionId))
            return BadRequest(new { code = "NO_GATEWAY_REFERENCE", message = "Cannot mark reviewed because the Stripe reference is missing." });

        if (log.ProcessingStatus != "F")
            return Conflict(new { code = "ALREADY_RESOLVED", message = "This reconciliation row is already resolved." });

        var now = DateTime.UtcNow;
        var relatedLogs = await _db.WebhookLogs
            .Where(w =>
                w.ProcessingStatus == "F" &&
                w.EventType == "charge.refunded" &&
                w.GatewaySessionId == log.GatewaySessionId)
            .ToListAsync();

        foreach (var related in relatedLogs)
        {
            related.ProcessingStatus = "I";
            related.ProcessedAt = now;
        }

        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "WebhookLog",
            EntityId = webhookLogId,
            Action = "WebhookFailureReviewed",
            Reason = req.Note,
            PerformedBy = User.Identity?.Name ?? "admin",
            Notes = $"GatewayReference={log.GatewaySessionId} ReviewedRows={relatedLogs.Count}",
            CreatedAt = now,
        });

        await _db.SaveChangesAsync();

        return Ok(new
        {
            webhookLogId,
            gatewaySessionId = log.GatewaySessionId,
            reviewedCount = relatedLogs.Count,
        });
    }

    [HttpPost("webhook-failures/{webhookLogId:int}/external-refund")]
    [Authorize(Roles = "superadmin")]
    public async Task<IActionResult> RecordExternalOrphanRefund(
        int webhookLogId,
        [FromBody] ExternalOrphanRefundRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest(new { code = "REASON_REQUIRED", message = "Reason is required." });

        var method = NormalizeExternalRefundMethod(req.RefundMethod);
        if (method == null)
            return BadRequest(new { code = "REFUND_METHOD_REQUIRED", message = "Refund method is required." });

        var reference = req.RefundReference?.Trim();
        if (RequiresExternalRefundReference(method) && string.IsNullOrWhiteSpace(reference))
            return BadRequest(new { code = "REFUND_REFERENCE_REQUIRED", message = "Refund reference / ID is required for this refund method." });

        var log = await _db.WebhookLogs.FindAsync(webhookLogId);
        if (log == null)
            return NotFound(new { code = "NOT_FOUND" });

        if (log.EventType == "charge.refunded")
            return BadRequest(new { code = "REVIEW_REQUIRED", message = "Use Mark Reviewed for refund webhook discrepancies that do not need a refund record." });

        if (log.ProcessingStatus != "F")
            return Conflict(new { code = "ALREADY_RESOLVED", message = "This webhook failure is already resolved." });

        if (string.IsNullOrWhiteSpace(log.GatewaySessionId))
            return BadRequest(new { code = "NO_SESSION_ID", message = "Cannot record refund because the payment reference is missing." });

        var refundAmount = req.Amount ?? log.Amount;
        if (refundAmount is null or <= 0m)
            return BadRequest(new { code = "AMOUNT_REQUIRED", message = "Refund amount is required." });

        await using var tx = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);

        log = await _db.WebhookLogs
            .FromSqlInterpolated($"SELECT * FROM WebhookLogs WITH (UPDLOCK, HOLDLOCK) WHERE WebhookLogID = {webhookLogId}")
            .SingleOrDefaultAsync();
        if (log == null)
            return NotFound(new { code = "NOT_FOUND" });
        if (log.ProcessingStatus != "F")
            return Conflict(new { code = "ALREADY_RESOLVED", message = "This webhook failure is already resolved." });

        var existing = await _db.Refunds
            .FirstOrDefaultAsync(r =>
                r.GatewaySessionId == log.GatewaySessionId &&
                (r.RefundStatus == "P" || r.RefundStatus == "S"));

        if (existing != null)
            return Conflict(new { code = "ALREADY_REFUNDED", message = "A refund is already recorded for this payment reference." });

        var now = DateTime.UtcNow;
        var refund = new TRS_Data.Models.Refund
        {
            PaymentId = null,
            PaymentItemId = null,
            GatewaySessionId = log.GatewaySessionId,
            WebhookLogId = webhookLogId,
            PaymentGateway = "External",
            RefundSource = "External",
            RefundMethod = method,
            GatewayRefundId = reference,
            RefundAmount = refundAmount.Value,
            RefundReason = req.Reason,
            RefundStatus = "S",
            RequestedBy = User.Identity?.Name ?? "admin",
            CreatedAt = now,
            ProcessedAt = now,
        };
        _db.Refunds.Add(refund);

        log.ProcessingStatus = "S";
        log.ProcessedAt = now;

        await _db.SaveChangesAsync();

        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "Refund",
            EntityId = refund.RefundId,
            Action = "ExternalRefundRecorded",
            Reason = req.Reason,
            PerformedBy = User.Identity?.Name ?? "admin",
            Notes = $"WebhookLogId={webhookLogId} SessionId={log.GatewaySessionId} Amount={refund.RefundAmount} Method={method} Reference={reference} AdminNote={req.AdminNote}",
            CreatedAt = now,
        });
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        return Ok(new
        {
            refundId = refund.RefundId,
            refundStatus = refund.RefundStatus,
            refundAmount = refund.RefundAmount,
            gatewayRefundId = refund.GatewayRefundId,
        });
    }

    // POST /api/admin/payment-reconciliation/webhook-failures/{id}/refund
    // Issues a Stripe refund for an orphan payment (Case C).
    // Reuses the same RefundService().CreateAsync() call as the normal refund flow,
    // but writes a Refund row with PaymentId=null and marks the WebhookLog resolved.
    [HttpPost("webhook-failures/{webhookLogId:int}/refund")]
    [Authorize(Roles = "superadmin")]   // restrict to superadmin - irreversible
    public async Task<IActionResult> RefundOrphanedPayment(
        int webhookLogId,
        [FromBody] OrphanRefundRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest(new { code = "REASON_REQUIRED", message = "Reason is required." });

        var log = await _db.WebhookLogs.FindAsync(webhookLogId);
        if (log == null)
            return NotFound(new { code = "NOT_FOUND" });

        if (log.ProcessingStatus != "F")
            return Conflict(new { code = "ALREADY_RESOLVED", message = "This webhook failure is already resolved." });

        if (log.EventType == "charge.refunded")
            return BadRequest(new { code = "REFUND_REVIEW_REQUIRED", message = "This row is a refund webhook discrepancy. Review it in the payment provider dashboard and the system before taking manual action." });

        if (string.IsNullOrEmpty(log.GatewaySessionId))
            return BadRequest(new { code = "NO_SESSION_ID", message = "Cannot refund - session ID not recorded on this webhook." });

        // Retrieve the Stripe reference to get the PaymentIntent ID and amount.
        // Hosted checkout orphan rows store cs_..., embedded attempts store pi_...
        StripeConfiguration.ApiKey = _config["Stripe:SecretKey"];
        string paymentIntentId;
        long amountCents;
        try
        {
            if (log.GatewaySessionId.StartsWith("pi_", StringComparison.OrdinalIgnoreCase))
            {
                var intent = await new PaymentIntentService().GetAsync(log.GatewaySessionId);
                if (intent.Status != "succeeded")
                    return BadRequest(new { code = "NOT_PAID", message = $"PaymentIntent status is '{intent.Status}' - only 'succeeded' intents can be refunded here." });
                paymentIntentId = intent.Id;
                amountCents = intent.AmountReceived > 0 ? intent.AmountReceived : intent.Amount;
            }
            else
            {
                var session = await new SessionService().GetAsync(log.GatewaySessionId);
                paymentIntentId = session.PaymentIntentId;
                amountCents = session.AmountTotal ?? 0;
            }
        }
        catch (StripeException ex)
        {
            _logger.LogError(ex, "Failed to retrieve Stripe orphan reference {ReferenceId}", log.GatewaySessionId);
            return StatusCode(502, new { code = "STRIPE_ERROR", message = ex.StripeError?.Message ?? ex.Message });
        }


        if (amountCents <= 0)
            return BadRequest(new { code = "ZERO_AMOUNT", message = "Session amount is zero." });

        // Write a pending Refund row before calling Stripe (safe to retry)
        TRS_Data.Models.Refund refund;
        await using (var tx = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable))
        {
            log = await _db.WebhookLogs
                .FromSqlInterpolated($"SELECT * FROM WebhookLogs WITH (UPDLOCK, HOLDLOCK) WHERE WebhookLogID = {webhookLogId}")
                .SingleOrDefaultAsync();
            if (log == null)
                return NotFound(new { code = "NOT_FOUND" });
            if (log.ProcessingStatus != "F")
                return Conflict(new { code = "ALREADY_RESOLVED", message = "This webhook failure is already resolved." });

            var existing = await _db.Refunds
                .FirstOrDefaultAsync(r =>
                    r.GatewaySessionId == log.GatewaySessionId &&
                    (r.RefundStatus == "P" || r.RefundStatus == "S"));

            if (existing?.RefundStatus == "S")
                return Conflict(new
                {
                    code = "ALREADY_REFUNDED",
                    message = "A successful refund already exists for this session.",
                    gatewayRefundId = existing.GatewayRefundId,
                });

            if (existing != null)
            {
                if (!string.IsNullOrEmpty(existing.GatewayRefundId))
                    return Conflict(new { code = "REFUND_IN_PROGRESS", message = "A refund is already in progress for this session." });
                refund = existing;
            }
            else
            {
                refund = new TRS_Data.Models.Refund
        {
            PaymentId       = null,           // orphan - no Payment row
            PaymentItemId   = null,           // orphan - no PaymentItem row
            GatewaySessionId = log.GatewaySessionId,
            WebhookLogId    = webhookLogId,
            PaymentGateway  = "Stripe",
            RefundSource    = "System",
            RefundMethod    = "Gateway",
            RefundAmount    = amountCents / 100m,
            RefundReason    = req.Reason,
            RefundStatus    = "P",
            RequestedBy     = User.Identity?.Name ?? "admin",
            CreatedAt       = DateTime.UtcNow,
        };
                _db.Refunds.Add(refund);
                try
                {
                    await _db.SaveChangesAsync();
                }
                catch (DbUpdateException ex)
                {
                    _logger.LogWarning(ex, "Duplicate orphan refund prevented for session {SessionId}", log.GatewaySessionId);
                    return Conflict(new { code = "REFUND_IN_PROGRESS", message = "A refund is already in progress for this session." });
                }
            }

            await tx.CommitAsync();
        }

        try
        {
            // Same call pattern as ProcessRefundItemAsync in RegistrationsController
            var stripeRefund = await new RefundService().CreateAsync(
                new RefundCreateOptions
                {
                    PaymentIntent = paymentIntentId,
                    Amount        = amountCents,
                    Reason        = "requested_by_customer",
                    Metadata      = new Dictionary<string, string>
                    {
                        ["webhook_log_id"] = webhookLogId.ToString(),
                        ["admin_note"]     = req.AdminNote ?? "",
                    },
                },
                new RequestOptions { IdempotencyKey = $"orphan_refund_{log.GatewaySessionId}" });

            refund.GatewayRefundId = stripeRefund.Id;
            refund.RefundSource     = "System";
            refund.RefundMethod     = "Gateway";
            refund.RefundStatus    = stripeRefund.Status == "failed" ? "F" : "S";
            refund.ProcessedAt     = DateTime.UtcNow;

            if (refund.RefundStatus == "S")
            {
                // Mark the WebhookLog resolved so it drops off the Case-C list
                log.ProcessingStatus = "S";
                log.ProcessedAt      = DateTime.UtcNow;

                var gatewaySessionId = log.GatewaySessionId;
                if (!string.IsNullOrWhiteSpace(gatewaySessionId) &&
                    gatewaySessionId.StartsWith("pi_", StringComparison.OrdinalIgnoreCase))
                {
                    var attempt = await _db.PaymentAttempts
                        .FirstOrDefaultAsync(a => a.GatewayPaymentIntentId == gatewaySessionId);
                    if (attempt != null &&
                        attempt.Status == PaymentAttemptService.NeedsReconciliation &&
                        attempt.ResolvedAt == null)
                    {
                        attempt.ResolvedAt = log.ProcessedAt;
                        attempt.ResolvedBy = User.Identity?.Name ?? "admin";
                        attempt.ResolutionNote = $"Resolved by orphan refund {stripeRefund.Id}: {req.Reason}";
                        attempt.UpdatedAt = log.ProcessedAt.Value;
                    }
                }
            }

            _db.PaymentAuditLogs.Add(new PaymentAuditLog
            {
                EntityType  = "OrphanRefund",
                EntityId    = refund.RefundId,
                Action      = refund.RefundStatus == "S" ? "OrphanRefundIssued" : "OrphanRefundFailed",
                Reason      = req.Reason,
                PerformedBy = User.Identity?.Name ?? "admin",
                Notes       = $"WebhookLogId={webhookLogId} SessionId={log.GatewaySessionId} " +
                              $"Payer={log.ContactEmail} AdminNote={req.AdminNote}",
                CreatedAt   = DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();

            if (refund.RefundStatus != "S")
                return StatusCode(502, new { code = "REFUND_FAILED", message = "Stripe accepted the request but the refund did not complete." });

            return Ok(new
            {
                refundId        = refund.RefundId,
                refundStatus    = refund.RefundStatus,
                refundAmount    = refund.RefundAmount,
                gatewayRefundId = refund.GatewayRefundId,
            });
        }
        catch (StripeException ex)
        {
            refund.RefundStatus = "F";
            refund.ProcessedAt  = DateTime.UtcNow;

            _db.PaymentAuditLogs.Add(new PaymentAuditLog
            {
                EntityType  = "OrphanRefund",
                EntityId    = refund.RefundId,
                Action      = "OrphanRefundFailed",
                Reason      = req.Reason,
                PerformedBy = User.Identity?.Name ?? "admin",
                Notes       = ex.StripeError?.Message ?? ex.Message,
                CreatedAt   = DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();

            _logger.LogError(ex, "Stripe refund failed for orphan session {SessionId}", log.GatewaySessionId);
            return StatusCode(502, new { code = ex.StripeError?.Code ?? "REFUND_FAILED", message = ex.StripeError?.Message ?? ex.Message });
        }
    }

    private static string? NormalizeExternalRefundMethod(string? method)
    {
        if (string.IsNullOrWhiteSpace(method)) return null;
        return method.Trim() switch
        {
            "GatewayDashboard" => "GatewayDashboard",
            "PayNow" => "PayNow",
            "BankTransfer" => "BankTransfer",
            "Cash" => "Cash",
            "Other" => "Other",
            _ => null,
        };
    }

    private static bool RequiresExternalRefundReference(string method) =>
        method is "GatewayDashboard" or "PayNow" or "BankTransfer" or "Other";
}

// Request models
public class OrphanRefundRequest
{
    public string  Reason    { get; set; } = null!;
    public string? AdminNote { get; set; }
}

public class ReconciliationReviewRequest
{
    public string Note { get; set; } = null!;
}

public class ExternalOrphanRefundRequest
{
    public decimal? Amount { get; set; }
    public string RefundMethod { get; set; } = null!;
    public string? RefundReference { get; set; }
    public string Reason { get; set; } = null!;
    public string? AdminNote { get; set; }
}
