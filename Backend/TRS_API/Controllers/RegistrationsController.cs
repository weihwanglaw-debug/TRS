using TRS_API.Services;
using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Stripe;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/registrations")]
public class RegistrationsController : ControllerBase
{
    private static readonly HashSet<string> AllowedStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        StatusCodesEx.Registration.Pending,
        StatusCodesEx.Registration.Confirmed,
        StatusCodesEx.Registration.Cancelled,
        StatusCodesEx.Registration.CancelPending,
        StatusCodesEx.Registration.RefundFailed,
    };
    private static readonly HashSet<string> AllowedGroupStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        StatusCodesEx.Registration.Pending,
        StatusCodesEx.Registration.Confirmed,
        StatusCodesEx.Registration.Cancelled,
    };

    private readonly TRSDbContext _db;
    private readonly ILogger<RegistrationsController> _log;
    private readonly IBackgroundJobQueue _jobQueue;
    private readonly ReceiptService _receipt;
    private readonly RegistrationDetailsPdfService _registrationDetailsPdf;
    private readonly EmailService _email;
    private readonly IServiceScopeFactory _serviceScopeFactory;
    private readonly RegistrationWorkflowService _registrationWorkflow;
    public RegistrationsController(
        TRSDbContext db,
        ILogger<RegistrationsController> log,
        ReceiptService receipt,
        RegistrationDetailsPdfService registrationDetailsPdf,
        EmailService email,
        IBackgroundJobQueue jobQueue,
        IServiceScopeFactory serviceScopeFactory,
        RegistrationWorkflowService registrationWorkflow)
        => (_db, _log, _receipt, _registrationDetailsPdf, _email, _jobQueue, _serviceScopeFactory, _registrationWorkflow) =
            (db, log, receipt, registrationDetailsPdf, email, jobQueue, serviceScopeFactory, registrationWorkflow);

    // -- GET /api/registrations  -- admin, paged + filtered -----------------
    [HttpGet, Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> GetAll(
        [FromQuery] int? eventId, [FromQuery] int? programId,
        [FromQuery] string? regStatus, [FromQuery] string? payStatus,
        [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var q = _db.EventRegistrations
            .Include(r => r.Event)
            .Include(r => r.ParticipantGroups).ThenInclude(g => g.Participants).ThenInclude(p => p.CustomFieldValues)
            .Include(r => r.Payments).ThenInclude(p => p.Items)
            .AsQueryable();

        if (eventId.HasValue) q = q.Where(r => r.EventId == eventId);
        if (programId.HasValue) q = q.Where(r => r.ParticipantGroups.Any(g => g.ProgramId == programId));
        if (!string.IsNullOrEmpty(regStatus)) q = q.Where(r => r.RegStatus == regStatus);
        if (!string.IsNullOrEmpty(payStatus))
            q = q.Where(r => r.Payments.Any(p => p.PaymentStatus == payStatus));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            q = q.Where(r =>
                r.ContactName.Contains(term) ||
                r.RegistrationId.ToString().Contains(term));
        }

        var total = await q.CountAsync();
        var items = await q.OrderByDescending(r => r.SubmittedAt)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        return Ok(new
        {
            items = items.Select(MapReg),
            total,
            page,
            pageSize,
            totalPages = (int)Math.Ceiling((double)total / pageSize)
        });
    }

    // -- GET /api/registrations/:id  -- public (for PaymentResult receipt) --
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var reg = await LoadReg(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        return Ok(MapReg(reg));
    }

    // -- POST /api/registrations  -- public ---------------------------------
    [EnableRateLimiting("payment")]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRegistrationRequest req)
    {
        var gateMode = IsAdminUser()
            ? EventRegistrationGateMode.AdminAssisted
            : EventRegistrationGateMode.StrictPublic;
        var pricing = await _registrationWorkflow.ValidateAndPriceAsync(req, new RegistrationValidationOptions
        {
            RegistrationGateMode = gateMode,
            ValidatePricingAgainstCurrentPrograms = true,
        });
        if (!pricing.Success)
            return BadRequest(new { code = pricing.Code, message = pricing.Message });

        var paymentStatus = pricing.Value!.TotalAmount == 0
            ? StatusCodesEx.Payment.Success
            : StatusCodesEx.Payment.Pending;
        var createResult = await _registrationWorkflow.CreateAsync(req, new RegistrationPersistOptions
        {
            RegistrationGateMode = gateMode,
            ValidatePricingAgainstCurrentPrograms = true,
            PaymentGateway = req.Payment.Gateway,
            PaymentMethod = req.Payment.Method,
            PaymentStatus = paymentStatus,
        });

        if (!createResult.Success)
        {
            var isNotFound = string.Equals(createResult.Code, "EVENT_NOT_FOUND", StringComparison.Ordinal)
                || string.Equals(createResult.Code, "PROGRAM_NOT_FOUND", StringComparison.Ordinal);
            return isNotFound
                ? NotFound(new { code = createResult.Code, message = createResult.Message })
                : BadRequest(new { code = createResult.Code, message = createResult.Message });
        }

        var createdReg = await LoadReg(createResult.Value!.RegistrationId);
        return Ok(MapReg(createdReg!));
    }

    private bool IsAdminUser() =>
        User.IsInRole("superadmin") || User.IsInRole("eventadmin");

    // -- PATCH /api/registrations/:id/status  -- admin ----------------------
    [HttpPatch("{id:int}/status"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] UpdateRegStatusRequest req)
    {
        if (!AllowedStatuses.Contains(req.Status))
            return BadRequest(new { code = "INVALID_STATUS", message = "Status must be P, C, CP, RF, or X." });

        var reg = await _db.EventRegistrations.FindAsync(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        reg.RegStatus = req.Status;
        reg.RegistrationStatus = RegistrationStatusToDb(req.Status);
        if (req.Status == StatusCodesEx.Registration.Confirmed) reg.ConfirmedAt = DateTime.UtcNow;
        reg.UpdatedAt = DateTime.UtcNow;

        // Cascade the same status to every participant group so that capacity
        // counts (which exclude GroupStatus = X) and the fixture
        // participant list stay in sync with the registration-level status.
        var groups = await _db.ParticipantGroups
            .Where(g => g.RegistrationId == id)
            .ToListAsync();
        var groupStatus = RegistrationStatusToDb(req.Status);
        foreach (var g in groups)
        {
            g.GroupStatus = groupStatus;
            g.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    // -- PATCH /api/registrations/:id/groups/:gid/status  -- admin ----------
    [HttpPatch("{id:int}/groups/{gid:int}/status"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateGroupStatus(int id, int gid, [FromBody] UpdateRegStatusRequest req)
    {
        if (!AllowedGroupStatuses.Contains(req.Status))
            return BadRequest(new { code = "INVALID_STATUS", message = "Status must be P, C, or X." });

        var group = await _db.ParticipantGroups
            .FirstOrDefaultAsync(g => g.GroupId == gid && g.RegistrationId == id);
        if (group == null) return NotFound(new { code = "NOT_FOUND", message = "Group not found." });
        group.GroupStatus = req.Status; group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    // -- PATCH /api/registrations/:id/groups/:gid/seed  -- admin -------------
    [HttpPatch("{id:int}/groups/{gid:int}/seed"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateGroupSeed(int id, int gid, [FromBody] UpdateSeedRequest req)
    {
        var group = await _db.ParticipantGroups
            .FirstOrDefaultAsync(g => g.GroupId == gid && g.RegistrationId == id);
        if (group == null) return NotFound(new { code = "NOT_FOUND", message = "Group not found." });
        group.Seed = req.Seed; group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    // -- GET /api/registrations/:id/payment  -- admin -----------------------
    [HttpGet("{id:int}/payment"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> GetPayment(int id)
    {
        var payment = await _db.Payments
            .Include(p => p.Items)
            .Include(p => p.Refunds)
            .FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });
        return Ok(MapPayment(payment));
    }

    // -- GET /api/registrations/:id/payment/audit  -- admin -----------------
    [HttpGet("{id:int}/payment/audit"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> GetPaymentAudit(int id)
    {
        var payment = await _db.Payments.FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });

        var logs = await _db.PaymentAuditLogs
            .Where(a => a.EntityType == "Payment" && a.EntityId == payment.PaymentId)
            .OrderBy(a => a.CreatedAt)
            .Select(a => new
            {
                id = a.AuditId.ToString(),
                entityType = a.EntityType,
                entityId = a.EntityId.ToString(),
                action = a.Action,
                oldStatus = a.OldStatus,
                newStatus = a.NewStatus,
                reason = a.Reason,
                performedBy = a.PerformedBy,
                ipAddress = a.IpAddress,
                notes = a.Notes,
                createdAt = a.CreatedAt,
            })
            .ToListAsync();

        return Ok(logs);
    }

    // -- PATCH /api/registrations/:id/payment  -- admin (manual confirm) ----
    [HttpPatch("{id:int}/payment"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdatePayment(int id, [FromBody] UpdatePaymentManualRequest req)
    {
        var payment = await _db.Payments
            .Include(p => p.Items)
            .Include(p => p.Refunds)
            .FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });

        var oldStatus = payment.PaymentStatus;

        if (req.Method != null) payment.PaymentMethod = req.Method;

        if (req.PaymentStatus != null)
        {
            var targetStatus = req.PaymentStatus;
            if (!CanAdminSetPaymentStatus(payment.PaymentStatus, targetStatus))
                return Conflict(new
                {
                    code = "INVALID_TRANSITION",
                    message = $"Cannot change payment status from {payment.PaymentStatus} to {targetStatus}."
                });
            payment.PaymentStatus = targetStatus;
        }

        if (req.ReceiptNo != null) payment.ReceiptNumber = req.ReceiptNo;

        if (payment.PaymentStatus == StatusCodesEx.Payment.Success)
        {
            payment.PaidAt = DateTime.UtcNow;
            if (string.IsNullOrEmpty(payment.ReceiptNumber))
            {
                var receiptProgramId = payment.Items
                    .Select(i => (int?)i.ProgramId)
                    .Where(pid => pid.HasValue)
                    .Distinct()
                    .OrderBy(pid => pid)
                    .FirstOrDefault();
                payment.ReceiptNumber = ReceiptNumberGenerator.Generate(payment.EventId, receiptProgramId);
            }
            var reg = await LoadReg(id);
            ConfirmPayablePaymentItems(payment, reg);

            // also flip registration
            if (reg != null)
            {
                reg.RegStatus = StatusCodesEx.Registration.Confirmed;
                reg.RegistrationStatus = StatusCodesEx.Registration.Confirmed;
                reg.ConfirmedAt = DateTime.UtcNow;
            }
        }
        payment.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Audit log
        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "Payment",
            EntityId = payment.PaymentId,
            Action = "ManualPaymentConfirmed",
            OldStatus = oldStatus,
            NewStatus = payment.PaymentStatus,   // store short code in audit log
            Reason = req.AdminNote,
            PerformedBy = User.Identity?.Name ?? "admin",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();

        if (oldStatus != StatusCodesEx.Payment.Success && payment.PaymentStatus == StatusCodesEx.Payment.Success)
            await SendPaymentConfirmationEmailSafeAsync(id);

        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    // -- GET /api/registrations/:id/payment/refunds  -- admin ---------------
    [HttpGet("{id:int}/payment/refunds"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> GetRefunds(int id)
    {
        var payment = await _db.Payments.FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });
        var refunds = await _db.Refunds
            .Where(r => r.PaymentId == payment.PaymentId)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();
        return Ok(refunds.Select(r => new {
            id = r.RefundId.ToString(),
            paymentId = r.PaymentId.ToString(),
            paymentItemId = r.PaymentItemId.ToString(),
            gateway = r.PaymentGateway,
            gatewayRefundId = r.GatewayRefundId,
            refundSource = r.RefundSource,
            refundMethod = r.RefundMethod,
            r.RefundAmount,
            r.RefundReason,
            refundStatus = r.RefundStatus,
            requestedBy = r.RequestedBy,
            approvedBy = r.ApprovedBy,
            createdAt = r.CreatedAt,
            processedAt = r.ProcessedAt,
        }));
    }

    // -- POST /api/registrations/:id/payment/refunds  -- admin --------------
    [HttpPost("{id:int}/payment/refunds"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> InitiateRefund(int id, [FromBody] InitiateRefundRequest req)
    {
        var payment = await _db.Payments.Include(p => p.Items)
            .FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });

        var item = payment.Items.FirstOrDefault(i => i.PaymentItemId == req.PaymentItemId);
        if (item == null) return NotFound(new { code = "NOT_FOUND", message = "Payment item not found." });
        var externalRefund = BuildExternalRefundDetails(
            req.RefundSource,
            req.RefundMethod,
            req.RefundReference,
            req.AdminNote,
            req.RefundReason,
            out var externalValidationError);
        if (externalValidationError != null)
            return BadRequest(externalValidationError);

        var result = await ProcessRefundItemAsync(
            id,
            payment,
            item,
            req.RefundAmount,
            req.RefundReason,
            externalRefund,
            refundOnly: true);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await SendRefundEmailSafeAsync(id);

        var refund = result.Refund!;
        return Ok(new
        {
            id = refund.RefundId.ToString(),
            refundStatus = refund.RefundStatus,
            refundAmount = refund.RefundAmount,
            gatewayRefundId = refund.GatewayRefundId
        });
    }

    // -- POST /api/registrations/:id/payment/refunds/bulk  -- admin ----------
    [HttpPost("{id:int}/payment/refunds/bulk"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> InitiateRefunds(int id, [FromBody] BulkInitiateRefundRequest req)
    {
        var payment = await _db.Payments.Include(p => p.Items)
            .FirstOrDefaultAsync(p => p.RegistrationId == id);
        if (payment == null) return NotFound(new { code = "NOT_FOUND", message = "Payment not found." });

        var externalRefund = BuildExternalRefundDetails(
            req.RefundSource,
            req.RefundMethod,
            req.RefundReference,
            req.AdminNote,
            req.RefundReason,
            out var externalValidationError);
        if (externalValidationError != null)
            return BadRequest(externalValidationError);

        var refunds = new List<object>();
        var errors = new List<string>();

        foreach (var requestedItem in req.Items)
        {
            var item = payment.Items.FirstOrDefault(i => i.PaymentItemId == requestedItem.PaymentItemId);
            if (item == null)
            {
                errors.Add($"Item {requestedItem.PaymentItemId}: Payment item not found.");
                continue;
            }

            var result = await ProcessRefundItemAsync(
                id,
                payment,
                item,
                requestedItem.RefundAmount,
                req.RefundReason,
                externalRefund,
                refundOnly: true);

            if (!result.Success)
            {
                errors.Add($"{item.ProgramName}: {result.Message}");
                continue;
            }

            var refund = result.Refund!;
            refunds.Add(new
            {
                id = refund.RefundId.ToString(),
                refundStatus = refund.RefundStatus,
                refundAmount = refund.RefundAmount,
                gatewayRefundId = refund.GatewayRefundId,
                paymentItemId = refund.PaymentItemId?.ToString(),
            });
        }

        if (refunds.Count == 0)
            return BadRequest(new { code = "REFUND_FAILED", message = string.Join(" | ", errors) });

        await SendRefundEmailSafeAsync(id);
        return Ok(new { refunds, errors });
    }

    [HttpPost("{id:int}/cancel-with-refunds"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> CancelWithRefunds(int id, [FromBody] CancelRegistrationRequest req)
    {
        req.RefundMode = "refundPaidItems";
        return await CancelRegistration(id, req);
    }

    [HttpPost("{id:int}/cancel"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> CancelRegistration(int id, [FromBody] CancelRegistrationRequest req)
    {
        var reg = await LoadCancellationRegistration(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        return await CancelScopeAsync(reg, req, reg.ParticipantGroups.ToList(), null, "registration");
    }

    [HttpPost("{id:int}/groups/{groupId:int}/cancel"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> CancelGroup(int id, int groupId, [FromBody] CancelRegistrationRequest req)
    {
        var reg = await LoadCancellationRegistration(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        var group = reg.ParticipantGroups.FirstOrDefault(g => g.GroupId == groupId);
        if (group == null) return NotFound(new { code = "NOT_FOUND", message = "Participant group not found." });
        return await CancelScopeAsync(reg, req, new List<ParticipantGroup> { group }, null, "entry");
    }

    [HttpPost("{id:int}/participants/{participantId:int}/cancel"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> CancelParticipant(int id, int participantId, [FromBody] CancelRegistrationRequest req)
    {
        var reg = await LoadCancellationRegistration(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        var participant = reg.ParticipantGroups.SelectMany(g => g.Participants)
            .FirstOrDefault(p => p.ParticipantId == participantId);
        if (participant == null) return NotFound(new { code = "NOT_FOUND", message = "Participant not found." });

        var payment = reg.Payments.FirstOrDefault();
        var playerItem = payment?.Items.FirstOrDefault(i => i.ParticipantId == participantId);
        if (playerItem == null)
        {
            return BadRequest(new
            {
                code = "PLAYER_CANCEL_NOT_ALLOWED",
                message = "This participant does not have a player-level payment item. Cancel the whole entry instead."
            });
        }

        return await CancelScopeAsync(reg, req, new List<ParticipantGroup> { participant.Group }, participant, "participant");
    }

    // -- GET /api/registrations/export  -- admin -----------------------------
    [HttpGet("export"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Export([FromQuery] int? eventId, [FromQuery] int? programId)
    {
        var q = _db.EventRegistrations
            .Include(r => r.Event)
            .Include(r => r.ParticipantGroups).ThenInclude(g => g.Participants).ThenInclude(p => p.CustomFieldValues)
            .Include(r => r.Payments).ThenInclude(p => p.Items)
            .AsQueryable();
        if (eventId.HasValue) q = q.Where(r => r.EventId == eventId);
        if (programId.HasValue) q = q.Where(r => r.ParticipantGroups.Any(g => g.ProgramId == programId));
        var items = await q.OrderByDescending(r => r.SubmittedAt).ToListAsync();
        return Ok(items.Select(MapReg));
    }

    // -- GET /api/registrations/stats  -- admin ------------------------------
    [HttpGet("stats"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> Stats([FromQuery] int? eventId)
    {
        var q = _db.EventRegistrations.Include(r => r.Payments).AsQueryable();
        if (eventId.HasValue) q = q.Where(r => r.EventId == eventId);
        var all = await q.ToListAsync();
        return Ok(new
        {
            totalRegistrations = all.Count,
            confirmed = all.Count(r => r.RegStatus == StatusCodesEx.Registration.Confirmed),
            pending = all.Count(r => r.RegStatus == StatusCodesEx.Registration.Pending),
            cancelled = all.Count(r => r.RegStatus == StatusCodesEx.Registration.Cancelled),
            totalRevenue = all.Where(r => r.Payments.Any(p => p.PaymentStatus == StatusCodesEx.Payment.Success))
                             .Sum(r => r.Payments.Where(p => p.PaymentStatus == StatusCodesEx.Payment.Success).Sum(p => p.Amount)),
            pendingPayments = all.Count(r => r.Payments.Any(p => p.PaymentStatus == StatusCodesEx.Payment.Pending)),
        });
    }

    // -- GET /api/registrations/:id/receipt  -- public -------------------------
    [HttpGet("{id:int}/receipt")]
    public async Task<IActionResult> GetReceipt(int id)
    {
        try
        {
            var bytes = await _receipt.GenerateAsync(_db, id);
            var reg = await _db.EventRegistrations
                .Include(r => r.Payments)
                .FirstOrDefaultAsync(r => r.RegistrationId == id);
            var receiptNo = reg?.Payments.FirstOrDefault()?.ReceiptNumber
                ?? ReceiptNumberGenerator.FallbackRegistrationReference(id);
            return File(bytes, "application/pdf", $"Receipt-{receiptNo}.pdf");
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Error generating receipt for registration {Id}", id);
            return StatusCode(500, new { code = "RECEIPT_ERROR", message = "Failed to generate receipt." });
        }
    }

    // -- GET /api/registrations/:id/details-pdf  -- public --------------------
    [HttpGet("{id:int}/details-pdf")]
    public async Task<IActionResult> GetRegistrationDetailsPdf(int id)
    {
        try
        {
            var bytes = await _registrationDetailsPdf.GenerateAsync(_db, id);
            var reference = ReceiptNumberGenerator.FallbackRegistrationReference(id);
            return File(bytes, "application/pdf", $"RegistrationDetails-{reference}.pdf");
        }
        catch (KeyNotFoundException)
        {
            return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Error generating registration details PDF for registration {Id}", id);
            return StatusCode(500, new { code = "DETAILS_PDF_ERROR", message = "Failed to generate registration details PDF." });
        }
    }


    // -- PATCH /api/registrations/:id/participants/:pid  -- admin -----------
    // Update individual participant details.
    // TODO (future): write each changed field to ParticipantAuditLog with
    //   OldValue, NewValue, ModifiedBy, ModifiedAt for full change history.
    [HttpPatch("{id:int}/participants/{pid:int}"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> UpdateParticipant(int id, int pid, [FromBody] UpdateParticipantRequest req)
    {
        await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);

        // Verify the participant belongs to this registration
        var participant = await _db.Participants
            .Include(p => p.Group)
            .Include(p => p.CustomFieldValues)
            .FirstOrDefaultAsync(p => p.ParticipantId == pid && p.Group.RegistrationId == id);

        if (participant == null)
            return NotFound(new { code = "NOT_FOUND", message = "Participant not found in this registration." });

        if (participant.Group.GroupStatus == StatusCodesEx.Registration.Cancelled)
            return Conflict(new { code = "ENTRY_CANCELLED", message = "Cannot edit participants in a cancelled entry." });

        var program = await _db.Programs
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.ProgramId == participant.Group.ProgramId);

        if (program == null)
            return NotFound(new { code = "PROGRAM_NOT_FOUND", message = "Program not found." });

        var trimmedClub = req.ClubSchoolCompany?.Trim();
        if (req.ClubSchoolCompany != null && string.IsNullOrWhiteSpace(trimmedClub))
            return BadRequest(new { code = "MISSING_REQUIRED_FIELD", message = "Club / school / company is required." });

        // ── Duplicate check — only when FullName or Dob is being changed ──────
        // Excludes self (pid) so editing other fields on an existing participant
        // does not false-flag against its own record.
        if (req.FullName != null || req.Dob != null)
        {
            var checkName = req.FullName ?? participant.FullName;
            var checkDob  = participant.DateOfBirth; // default to existing
            if (req.Dob != null && DateOnly.TryParse(req.Dob, out var parsedDob))
                checkDob = parsedDob;

            var isDuplicate = await _db.Participants
                .Where(p =>
                    p.ParticipantId != pid &&
                    p.Group.ProgramId == participant.Group.ProgramId &&
                    p.Group.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                    p.ParticipantStatus != StatusCodesEx.Participant.Cancelled &&
                    p.FullName == checkName &&
                    p.DateOfBirth == checkDob)
                .AnyAsync();

            if (isDuplicate)
                return Conflict(new {
                    code    = "DUPLICATE_PARTICIPANT",
                    message = $"{checkName} with this date of birth is already registered in this program."
                });
        }

        // Capture old values for audit (TODO: write to ParticipantAuditLog)
        // var oldValues = new { participant.FullName, participant.DateOfBirth, ... };

        if (req.FullName          != null) participant.FullName          = req.FullName;
        if (req.Gender            != null) participant.Gender            = req.Gender;
        if (req.Nationality       != null) participant.Nationality       = req.Nationality;
        if (req.Email             != null) participant.Email             = req.Email;
        if (req.ContactNumber     != null) participant.ContactNumber     = req.ContactNumber;
        if (req.TshirtSize        != null) participant.TshirtSize        = req.TshirtSize;
        if (req.SbaId             != null) participant.SbaId             = req.SbaId;
        if (req.GuardianName      != null) participant.GuardianName      = req.GuardianName;
        if (req.GuardianContact   != null) participant.GuardianContact   = req.GuardianContact;
        if (req.Remark            != null) participant.Remark            = req.Remark;
        if (req.DocumentUrl       != null) participant.DocumentUrl       = req.DocumentUrl;

        if (req.Dob != null)
            participant.DateOfBirth = string.IsNullOrWhiteSpace(req.Dob)
                ? null
                : DateOnly.Parse(req.Dob);
        if (req.CustomFieldValues != null)
        {
            var programFields = await _db.ProgramCustomFields
                .Where(cf => cf.ProgramId == participant.Group.ProgramId)
                .ToListAsync();

            foreach (var (key, value) in req.CustomFieldValues)
            {
                var customField = ResolveCustomField(programFields, key);
                if (customField == null)
                    continue;

                var existing = participant.CustomFieldValues
                    .FirstOrDefault(cf => cf.CustomFieldId == customField.CustomFieldId);

                if (existing != null)
                {
                    existing.FieldLabel = customField.Label;
                    existing.FieldValue = value;
                }
                else
                {
                    _db.ParticipantCustomFieldValues.Add(new ParticipantCustomFieldValue
                    {
                        ParticipantId = participant.ParticipantId,
                        CustomFieldId = customField.CustomFieldId,
                        FieldLabel    = customField.Label,
                        FieldValue    = value,
                    });
                }
            }
        }

        if (trimmedClub != null)
        {
            if (program.TeamMode)
            {
                var currentTeamName = participant.Group.ClubDisplay?.Trim() ?? "";
                if (!string.Equals(currentTeamName, trimmedClub, StringComparison.Ordinal))
                {
                    var fixtureExists = await _db.Fixtures.AnyAsync(f => f.ProgramId == participant.Group.ProgramId);
                    if (fixtureExists)
                    {
                        return Conflict(new
                        {
                            code = "PROGRAM_FIXTURE_EXISTS",
                            message = "Team name cannot be changed after fixtures have been generated. Reset the fixture first."
                        });
                    }
                }

                var activeParticipants = await _db.Participants
                    .Where(p => p.GroupId == participant.GroupId && p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                    .OrderBy(p => p.ParticipantId)
                    .ToListAsync();

                foreach (var sibling in activeParticipants)
                    sibling.ClubSchoolCompany = trimmedClub;

                participant.Group.ClubDisplay = trimmedClub;
            }
            else
            {
                participant.ClubSchoolCompany = trimmedClub;

                var firstActiveParticipant = await _db.Participants
                    .Where(p => p.GroupId == participant.GroupId && p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                    .OrderBy(p => p.ParticipantId)
                    .FirstOrDefaultAsync();

                participant.Group.ClubDisplay = firstActiveParticipant?.ParticipantId == participant.ParticipantId
                    ? trimmedClub
                    : firstActiveParticipant?.ClubSchoolCompany?.Trim() ?? "";
            }
        }

        participant.UpdatedAt = DateTime.UtcNow;

        // TODO: write ParticipantAuditLog entries here (one per changed field)
        // _db.ParticipantAuditLogs.Add(new ParticipantAuditLog { ... });

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    // -- POST /api/registrations/:id/confirm  -- admin ---------------------
    // Admin confirms a registration directly - bypasses online payment.
    // Supports three payment outcomes:
    //   S  = Paid (manual confirmation - cash/bank/PayNow collected)
    //   W  = Waived (admin waives the fee entirely - VIP, staff, error correction)
    //   PC = Pending Collection (registration confirmed, payment to be collected later)
    [HttpPost("{id:int}/confirm"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> ConfirmRegistration(int id, [FromBody] ConfirmRegistrationRequest req)
    {
        var allowedStatuses = new[] { StatusCodesEx.Payment.Success, StatusCodesEx.Payment.Waived, StatusCodesEx.Payment.PendingCollection };
        var status = req.PaymentStatus;
        if (!allowedStatuses.Contains(status))
            return BadRequest(new { code = "INVALID_STATUS", message = "PaymentStatus must be S (Paid), W (Waived), or PC (Pending Collection)." });

        var allowedMethods = new[] { "Cash", "BankTransfer", "PayNow", "Others" };
        var method = string.IsNullOrWhiteSpace(req.Method) ? null : req.Method.Trim();
        var paymentReference = string.IsNullOrWhiteSpace(req.PaymentReference) ? null : req.PaymentReference.Trim();

        if (status == StatusCodesEx.Payment.Success)
        {
            if (method == null)
                return BadRequest(new { code = "INVALID_METHOD", message = "Payment method is required when payment status is Paid." });
            if (!allowedMethods.Contains(method))
                return BadRequest(new { code = "INVALID_METHOD", message = "Payment method must be Cash, BankTransfer, PayNow, or Others." });
        }
        else
        {
            method = null;
            paymentReference = null;
        }

        var reg = await LoadReg(id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });

        var payment = reg.Payments.FirstOrDefault();
        var oldStatus = payment?.PaymentStatus;

        if (payment == null)
        {
            // Create a manual payment record for free/waived registrations
            payment = new Payment
            {
                RegistrationId = id,
                EventId        = reg.EventId,
                PaymentGateway = "Manual",
                PaymentMethod  = method,
                Amount         = reg.ParticipantGroups.Sum(g => g.Fee),
                Currency       = "SGD",
                PaymentStatus  = status,
                AdminNote      = req.AdminNote,
                CreatedAt      = DateTime.UtcNow,
            };
            _db.Payments.Add(payment);
            await _db.SaveChangesAsync();
        }
        else
        {
            if (!CanAdminSetPaymentStatus(payment.PaymentStatus, status))
                return Conflict(new
                {
                    code = "INVALID_TRANSITION",
                    message = $"Cannot change payment status from {payment.PaymentStatus} to {status}."
                });
            payment.PaymentMethod = method;
            payment.PaymentStatus = status;
            payment.AdminNote     = req.AdminNote;
            payment.ReceiptNumber = paymentReference;
            payment.UpdatedAt = DateTime.UtcNow;
        }

        // For Paid: stamp paidAt, generate receipt, flip items to S.
        // Waived and Pending Collection intentionally keep method/reference blank.
        if (status == StatusCodesEx.Payment.Success)
        {
            payment.PaidAt = DateTime.UtcNow;
            if (string.IsNullOrEmpty(payment.ReceiptNumber))
            {
                var receiptProgramId = payment.Items
                    .Select(i => (int?)i.ProgramId)
                    .Where(pid => pid.HasValue)
                    .Distinct()
                    .OrderBy(pid => pid)
                    .FirstOrDefault();
                payment.ReceiptNumber = ReceiptNumberGenerator.Generate(payment.EventId, receiptProgramId);
            }
            ConfirmPayablePaymentItems(payment, reg);
        }
        else
        {
            payment.PaidAt = null;
        }

        // Confirm the registration regardless of payment status
        reg.RegStatus         = StatusCodesEx.Registration.Confirmed;
        reg.RegistrationStatus = StatusCodesEx.Registration.Confirmed;
        reg.ConfirmedAt       = DateTime.UtcNow;
        reg.UpdatedAt         = DateTime.UtcNow;

        // Cascade status to all participant groups
        foreach (var g in reg.ParticipantGroups)
        {
            if (g.GroupStatus == StatusCodesEx.Registration.Cancelled) continue;
            g.GroupStatus = StatusCodesEx.Registration.Confirmed;
            g.UpdatedAt   = DateTime.UtcNow;
        }

        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType  = "Payment",
            EntityId    = payment.PaymentId,
            Action      = $"AdminConfirm_{status}",
            OldStatus   = oldStatus,
            NewStatus   = status,
            Reason      = req.AdminNote,
            PerformedBy = User.Identity?.Name ?? "admin",
            IpAddress   = HttpContext.Connection.RemoteIpAddress?.ToString(),
            CreatedAt   = DateTime.UtcNow,
        });

        await _db.SaveChangesAsync();

        if (oldStatus != StatusCodesEx.Payment.Success && status == StatusCodesEx.Payment.Success)
            await SendPaymentConfirmationEmailSafeAsync(id);

        var updated = await LoadReg(id);
        return Ok(MapReg(updated!));
    }

    private static void ConfirmPayablePaymentItems(Payment payment, EventRegistration? reg)
    {
        var groupsById = reg?.ParticipantGroups.ToDictionary(g => g.GroupId) ?? new Dictionary<int, ParticipantGroup>();

        foreach (var item in payment.Items)
        {
            if (item.ItemStatus == StatusCodesEx.PaymentItem.Cancelled ||
                item.ItemStatus == StatusCodesEx.PaymentItem.Refunded) continue;

            if (groupsById.TryGetValue(item.GroupId, out var group))
            {
                if (group.GroupStatus == StatusCodesEx.Registration.Cancelled) continue;

                if (item.ParticipantId is int participantId &&
                    group.Participants.Any(p => p.ParticipantId == participantId && p.ParticipantStatus == StatusCodesEx.Participant.Cancelled))
                {
                    continue;
                }
            }

            item.ItemStatus = StatusCodesEx.PaymentItem.Success;
            item.UpdatedAt = DateTime.UtcNow;
        }
    }

    // -- Load helper ----------------------------------------------------------
    private Task<EventRegistration?> LoadReg(int id) =>
        _db.EventRegistrations
            .Include(r => r.Event)
            .Include(r => r.ParticipantGroups).ThenInclude(g => g.Participants)
            .ThenInclude(p => p.CustomFieldValues)
            .Include(r => r.Payments).ThenInclude(p => p.Items)
            .FirstOrDefaultAsync(r => r.RegistrationId == id);

    private Task<EventRegistration?> LoadCancellationRegistration(int id) =>
        _db.EventRegistrations
            .Include(r => r.Event)
            .Include(r => r.ParticipantGroups).ThenInclude(g => g.Participants)
            .Include(r => r.Payments).ThenInclude(p => p.Items)
            .FirstOrDefaultAsync(r => r.RegistrationId == id);

    private async Task<IActionResult> CancelScopeAsync(
        EventRegistration reg,
        CancelRegistrationRequest req,
        List<ParticipantGroup> groups,
        Participant? participant,
        string scope)
    {
        if (string.IsNullOrWhiteSpace(req.Reason))
            return BadRequest(new { code = "REASON_REQUIRED", message = "Cancellation reason is required." });

        var refundMode = (req.RefundMode ?? "none").Trim();
        if (!string.Equals(refundMode, "none", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(refundMode, "refundPaidItems", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { code = "INVALID_REFUND_MODE", message = "Refund mode must be none or refundPaidItems." });
        }

        var impact = await GetFixtureImpactAsync(groups);
        if (impact.Any())
        {
            return Conflict(new
            {
                code = "FIXTURE_EXISTS_CANCEL_BLOCKED",
                message = "Cancellation cannot be completed because a fixture has already been generated for one or more affected programs. Please remove the fixture first, then try again.",
                fixtureImpact = impact
            });
        }

        var payment = reg.Payments.FirstOrDefault();
        var affectedItems = payment?.Items
            .Where(i => participant != null
                ? i.ParticipantId == participant.ParticipantId
                : groups.Any(g => g.GroupId == i.GroupId))
            .ToList() ?? new List<PaymentItem>();

        var shouldRefund = string.Equals(refundMode, "refundPaidItems", StringComparison.OrdinalIgnoreCase);
        object? externalValidationError = null;
        var externalRefund = shouldRefund
            ? BuildExternalRefundDetails(
                req.RefundSource,
                req.RefundMethod,
                req.RefundReference,
                req.AdminNote,
                req.Reason,
                out externalValidationError)
            : null;
        if (shouldRefund && externalValidationError != null)
            return BadRequest(externalValidationError);

        var selectedGroupIds = groups.Select(g => g.GroupId).ToHashSet();
        var activeGroupIds = reg.ParticipantGroups
            .Where(g => g.GroupStatus != StatusCodesEx.Registration.Cancelled)
            .Select(g => g.GroupId)
            .ToHashSet();
        var participantCancelWillCancelGroup = participant == null ||
            participant.Group.Participants
                .Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
                .All(p => p.ParticipantId == participant.ParticipantId);
        var affectsEntireRegistration = activeGroupIds.Count > 0 &&
            activeGroupIds.IsSubsetOf(selectedGroupIds) &&
            participantCancelWillCancelGroup;
        var errors = new List<string>();
        var refundedAny = false;
        var appliedAnyLocalCancellation = false;

        if (affectsEntireRegistration && shouldRefund && payment != null && affectedItems.Any(i => i.ItemStatus == StatusCodesEx.PaymentItem.Success))
        {
            ApplyRegistrationWorkflowStatus(reg, StatusCodesEx.Registration.CancelPending);
            await _db.SaveChangesAsync();
        }

        foreach (var item in affectedItems)
        {
            if (shouldRefund && payment != null && item.ItemStatus == StatusCodesEx.PaymentItem.Success)
            {
                var alreadyRefunded = await _db.Refunds
                    .Where(r => r.PaymentItemId == item.PaymentItemId && r.RefundStatus == StatusCodesEx.Refund.Success)
                    .SumAsync(r => (decimal?)r.RefundAmount) ?? 0m;
                var remainingRefundAmount = item.Amount - alreadyRefunded;

                if (remainingRefundAmount > 0)
                {
                    var refund = await ProcessRefundItemAsync(
                        reg.RegistrationId,
                        payment,
                        item,
                        remainingRefundAmount,
                        $"Cancelled {scope}: {req.Reason}",
                        externalRefund);

                    if (!refund.Success)
                    {
                        errors.Add($"{item.ProgramName}: {refund.Message}");
                    }
                    else
                    {
                        refundedAny = true;
                        appliedAnyLocalCancellation |= ApplyItemCancellationScope(
                            reg,
                            item,
                            req.Reason,
                            scope,
                            "CancelledAfterRefund");
                    }

                    continue;
                }

                if (remainingRefundAmount <= 0 && item.ItemStatus == StatusCodesEx.PaymentItem.Refunded)
                {
                    appliedAnyLocalCancellation |= ApplyItemCancellationScope(
                        reg,
                        item,
                        req.Reason,
                        scope,
                        "CancelledAfterRefund");
                    continue;
                }
            }

            if (item.ItemStatus != StatusCodesEx.PaymentItem.Refunded)
            {
                var oldStatus = item.ItemStatus;
                item.ItemStatus = StatusCodesEx.PaymentItem.Cancelled;
                item.UpdatedAt = DateTime.UtcNow;
                _db.PaymentAuditLogs.Add(new PaymentAuditLog
                {
                    EntityType = "PaymentItem",
                    EntityId = item.PaymentItemId,
                    Action = "CancelledWithoutRefund",
                    OldStatus = oldStatus,
                    NewStatus = StatusCodesEx.PaymentItem.Cancelled,
                    Reason = req.Reason,
                    PerformedBy = User.Identity?.Name ?? "admin",
                    Notes = $"Scope={scope}",
                    CreatedAt = DateTime.UtcNow,
                });
            }

            if (shouldRefund)
            {
                appliedAnyLocalCancellation |= ApplyItemCancellationScope(
                    reg,
                    item,
                    req.Reason,
                    scope,
                    item.ItemStatus == StatusCodesEx.PaymentItem.Refunded ? "CancelledAfterRefund" : "CancelledWithoutRefund");
            }
        }

        if (!shouldRefund && participant != null)
        {
            appliedAnyLocalCancellation |= CancelParticipantOnly(participant, req.Reason, "CancelledWithoutRefund");
        }
        else if (!shouldRefund)
        {
            foreach (var group in groups)
                appliedAnyLocalCancellation |= CancelGroupOnly(group, req.Reason, "CancelledWithoutRefund");
        }

        ApplyPostCancellationRegistrationStatus(reg, errors.Count > 0, refundedAny, req.Reason, scope);

        await _db.SaveChangesAsync();

        if (appliedAnyLocalCancellation && !req.SuppressEmail)
            await SendCancellationEmailSafeAsync(reg.RegistrationId, scope, req.Reason, refundedAny);

        var updated = await LoadReg(reg.RegistrationId);
        return Ok(new { registration = MapReg(updated!), errors, fixtureImpact = impact });
    }

    private bool ApplyItemCancellationScope(
        EventRegistration reg,
        PaymentItem item,
        string reason,
        string scope,
        string action)
    {
        var group = reg.ParticipantGroups.FirstOrDefault(g => g.GroupId == item.GroupId);
        if (group == null) return false;

        if (item.ParticipantId is int participantId)
        {
            var participant = group.Participants.FirstOrDefault(p => p.ParticipantId == participantId);
            if (participant == null) return false;

            var changed = CancelParticipantOnly(participant, reason, action, $"Scope={scope}; PaymentItemId={item.PaymentItemId}");
            if (group.Participants.All(p => p.ParticipantStatus == StatusCodesEx.Participant.Cancelled))
                changed |= CancelGroupOnly(group, reason, action, $"Scope={scope}; PaymentItemId={item.PaymentItemId}");
            return changed;
        }

        return CancelGroupOnly(group, reason, action, $"Scope={scope}; PaymentItemId={item.PaymentItemId}");
    }

    private bool CancelParticipantOnly(Participant participant, string reason, string action, string? notes = null)
    {
        var changed = false;
        if (participant.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
        {
            var oldStatus = participant.ParticipantStatus;
            participant.ParticipantStatus = StatusCodesEx.Participant.Cancelled;
            participant.UpdatedAt = DateTime.UtcNow;
            AddCancellationAudit("Participant", participant.ParticipantId, action, oldStatus, StatusCodesEx.Participant.Cancelled, reason, notes);
            changed = true;
        }

        if (participant.Group.Participants.All(p => p.ParticipantStatus == StatusCodesEx.Participant.Cancelled))
            changed |= CancelGroupOnly(participant.Group, reason, action, notes);

        return changed;
    }

    private bool CancelGroupOnly(ParticipantGroup group, string reason, string action, string? notes = null)
    {
        var changed = false;
        if (group.GroupStatus != StatusCodesEx.Registration.Cancelled)
        {
            var oldStatus = group.GroupStatus;
            group.GroupStatus = StatusCodesEx.Registration.Cancelled;
            group.UpdatedAt = DateTime.UtcNow;
            AddCancellationAudit("ParticipantGroup", group.GroupId, action, oldStatus, StatusCodesEx.Registration.Cancelled, reason, notes);
            changed = true;
        }

        foreach (var p in group.Participants)
        {
            if (p.ParticipantStatus == StatusCodesEx.Participant.Cancelled) continue;
            p.ParticipantStatus = StatusCodesEx.Participant.Cancelled;
            p.UpdatedAt = DateTime.UtcNow;
            changed = true;
        }

        return changed;
    }

    private void AddCancellationAudit(
        string entityType,
        int entityId,
        string action,
        string? oldStatus,
        string newStatus,
        string reason,
        string? notes = null)
    {
        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = entityType,
            EntityId = entityId,
            Action = action,
            OldStatus = StatusToAuditCode(oldStatus),
            NewStatus = StatusToAuditCode(newStatus),
            Reason = reason,
            PerformedBy = User.Identity?.Name ?? "admin",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Notes = AppendAuditStatusContext(notes, oldStatus, newStatus),
            CreatedAt = DateTime.UtcNow,
        });
    }

    private void ApplyPostCancellationRegistrationStatus(
        EventRegistration reg,
        bool hasRefundErrors,
        bool refundedAny,
        string reason,
        string scope)
    {
        if (reg.ParticipantGroups.All(g => g.GroupStatus == StatusCodesEx.Registration.Cancelled))
        {
            var oldStatus = reg.RegStatus;
            ApplyRegistrationStatus(reg, StatusCodesEx.Registration.Cancelled);
            if (oldStatus != StatusCodesEx.Registration.Cancelled)
                AddCancellationAudit("Registration", reg.RegistrationId, "RegistrationCancelled", oldStatus, StatusCodesEx.Registration.Cancelled, reason, $"Scope={scope}");
        }
        else if (hasRefundErrors)
        {
            ApplyRegistrationWorkflowStatus(reg, StatusCodesEx.Registration.RefundFailed);
        }
        else if (refundedAny)
        {
            // RegStatus is limited to legacy registration lifecycle values.
            // Partial refund display/filtering is derived from payment/item state.
            reg.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            reg.UpdatedAt = DateTime.UtcNow;
        }
    }

    private async Task<List<FixtureImpactDto>> GetFixtureImpactAsync(IEnumerable<ParticipantGroup> groups)
    {
        var programIds = groups.Select(g => g.ProgramId).Distinct().ToList();
        if (programIds.Count == 0) return new List<FixtureImpactDto>();

        var fixtures = await _db.Fixtures
            .Where(f => programIds.Contains(f.ProgramId))
            .Select(f => new
            {
                f.ProgramId,
                f.IsLocked,
                Severity = f.IsLocked ? "locked" : "draft",
                Message = f.IsLocked
                    ? "A locked fixture exists for this program. Remove the fixture before cancelling."
                    : "A draft fixture exists for this program. Remove the fixture before cancelling."
            })
            .ToListAsync();

        return fixtures.Select(f => new FixtureImpactDto(f.ProgramId, f.IsLocked, f.Severity, f.Message)).ToList();
    }

    private sealed record FixtureImpactDto(int ProgramId, bool IsLocked, string Severity, string Message);

    private async Task SendCancellationEmailSafeAsync(int registrationId, string scope, string reason, bool attachReceipt)
    {
        try
        {
            byte[]? receiptPdf = attachReceipt ? await _receipt.GenerateAsync(_db, registrationId) : null;
            var detailsPdf = await _registrationDetailsPdf.GenerateAsync(_db, registrationId);
            await _email.SendCancellationNotificationAsync(_db, registrationId, scope, reason, attachReceipt, receiptPdf, detailsPdf);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send cancellation email for registration {RegistrationId}", registrationId);
        }
    }

    [HttpPost("{id:int}/notifications/cancellation"), Authorize(Roles = "superadmin,eventadmin")]
    public async Task<IActionResult> SendCancellationNotification(int id, [FromBody] CancellationNotificationRequest req)
    {
        var reg = await _db.EventRegistrations
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.RegistrationId == id);
        if (reg == null) return NotFound(new { code = "NOT_FOUND", message = "Registration not found." });

        await SendCancellationEmailSafeAsync(id, req.Scope, req.Reason, req.IncludesRefund);
        return Ok(new { sent = true });
    }

    private async Task SendRefundEmailSafeAsync(int registrationId)
    {
        try
        {
            var receiptPdf = await _receipt.GenerateAsync(_db, registrationId);
            await _email.SendRefundNotificationAsync(_db, registrationId, receiptPdf);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send refund email for registration {RegistrationId}", registrationId);
        }
    }

    private async Task SendPaymentConfirmationEmailSafeAsync(int registrationId)
    {
        try
        {
            var receiptPdf = await _receipt.GenerateAsync(_db, registrationId);
            var detailsPdf = await _registrationDetailsPdf.GenerateAsync(_db, registrationId);
            await _email.SendPaymentConfirmationAsync(_db, registrationId, receiptPdf, detailsPdf);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Failed to send payment confirmation email for registration {RegistrationId}", registrationId);
        }
    }

    // -- Status code translation helpers --------------------------------------
    // DB stores short codes; the frontend TypeScript types use long names.
    // All translation is centralised here so no other file needs to change.

    private async Task<RefundOperationResult> ProcessRefundItemAsync(
        int registrationId,
        Payment payment,
        PaymentItem item,
        decimal refundAmount,
        string? refundReason,
        ExternalRefundDetails? externalRefund = null,
        bool refundOnly = false)
    {
        var successfulRefunds = await _db.Refunds
            .Where(r => r.PaymentItemId == item.PaymentItemId && r.RefundStatus == StatusCodesEx.Refund.Success)
            .ToListAsync();
        var refundedAmount = successfulRefunds.Sum(r => r.RefundAmount);
        var remainingAmount = item.Amount - refundedAmount;
        if (remainingAmount <= 0)
        {
            await ReconcileRefundedAmountsAsync(payment, item);
            return RefundOperationResult.Fail("ALREADY_REFUNDED", "This item is already fully refunded.");
        }

        if (!CanRefundPaymentItem(payment, item, refundOnly))
            return RefundOperationResult.Fail("INVALID_STATE", refundOnly
                ? "Only paid or cancelled paid items can be refunded."
                : "Only confirmed items can be refunded.");
        if (refundAmount > remainingAmount)
            return RefundOperationResult.Fail("OVER_REFUND", $"Maximum refundable is {remainingAmount}.");

        var refund = await _db.Refunds
            .FirstOrDefaultAsync(r => r.PaymentItemId == item.PaymentItemId && r.RefundStatus == StatusCodesEx.Refund.Pending);
        if (refund != null)
        {
            if (externalRefund != null)
                return RefundOperationResult.Fail("REFUND_IN_PROGRESS", "A pending refund already exists for this item.");
            if (!string.IsNullOrEmpty(refund.GatewayRefundId))
                return RefundOperationResult.Fail("REFUND_IN_PROGRESS", "A refund for this item is already in progress.");
            if (refund.RefundAmount != refundAmount)
                return RefundOperationResult.Fail("REFUND_IN_PROGRESS", "A pending refund exists for this item with a different amount.");
            refund.RefundSource ??= externalRefund != null ? "External" : "System";
            refund.RefundMethod ??= externalRefund?.Method ?? "Gateway";
        }
        else
        {
            refund = new TRS_Data.Models.Refund
            {
                PaymentId = payment.PaymentId,
                PaymentItemId = item.PaymentItemId,
                PaymentGateway = payment.PaymentGateway,
                RefundSource = externalRefund != null ? "External" : "System",
                RefundMethod = externalRefund?.Method ?? "Gateway",
                RefundAmount = refundAmount,
                RefundReason = refundReason,
                GatewayRefundId = externalRefund?.Reference,
                RefundStatus = externalRefund != null ? StatusCodesEx.Refund.Success : StatusCodesEx.Refund.Pending,
                RequestedBy = User.Identity?.Name ?? "admin",
                CreatedAt = DateTime.UtcNow,
                ProcessedAt = externalRefund != null ? DateTime.UtcNow : null,
            };
            _db.Refunds.Add(refund);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _log.LogWarning(ex,
                    "Duplicate active refund prevented for payment item {PaymentItemId}",
                    item.PaymentItemId);
                return RefundOperationResult.Fail("REFUND_IN_PROGRESS", "A refund for this item is already in progress.");
            }
        }

        if (externalRefund != null)
        {
            refund.GatewayRefundId = externalRefund.Reference;
            refund.RefundStatus = StatusCodesEx.Refund.Success;
            refund.ProcessedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            await ReconcileSuccessfulRefundAsync(payment, item, refund, refundReason, externalRefund, refundOnly);
            return RefundOperationResult.Ok(refund);
        }

        try
        {
            if (payment.PaymentGateway == "Stripe")
            {
                var stripeRefund = await new RefundService().CreateAsync(
                    new RefundCreateOptions
                    {
                        PaymentIntent = payment.GatewayPaymentId,
                        Amount = (long)(refundAmount * 100),
                        Reason = "requested_by_customer",
                        Metadata = new Dictionary<string, string>
                        {
                            ["registration_id"] = registrationId.ToString(),
                            ["payment_item_id"] = item.PaymentItemId.ToString(),
                        }
                    },
                    new RequestOptions { IdempotencyKey = $"trs_refund_{refund.RefundId}" });

                refund.GatewayRefundId = stripeRefund.Id;
                refund.RefundSource = "System";
                refund.RefundMethod = "Gateway";
                refund.RefundStatus = stripeRefund.Status == "failed" ? StatusCodesEx.Refund.Failed : StatusCodesEx.Refund.Success;
                refund.ProcessedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
            else
            {
                refund.RefundSource = "System";
                refund.RefundMethod = "Gateway";
                refund.RefundStatus = StatusCodesEx.Refund.Success;
                refund.ProcessedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
        }
        catch (StripeException ex)
        {
            refund.RefundStatus = StatusCodesEx.Refund.Failed;
            refund.ProcessedAt = DateTime.UtcNow;
            _db.PaymentAuditLogs.Add(new PaymentAuditLog
            {
                EntityType = "Refund",
                EntityId = refund.RefundId,
                Action = refundOnly ? "RefundOnlyFailed" : "RefundFailed",
                Reason = refundReason,
                PerformedBy = User.Identity?.Name ?? "admin",
                Notes = ex.StripeError?.Message ?? ex.Message,
                CreatedAt = DateTime.UtcNow,
            });
            await _db.SaveChangesAsync();
            return RefundOperationResult.Fail(
                ex.StripeError?.Code ?? "REFUND_FAILED",
                ex.StripeError?.Message ?? "Refund failed.");
        }

        if (refund.RefundStatus != StatusCodesEx.Refund.Success)
        {
            _db.PaymentAuditLogs.Add(new PaymentAuditLog
            {
                EntityType = "Refund",
                EntityId = refund.RefundId,
                Action = refundOnly ? "RefundOnlyFailed" : "RefundFailed",
                Reason = refundReason,
                PerformedBy = User.Identity?.Name ?? "admin",
                Notes = $"PaymentItemId={item.PaymentItemId}, Status={refund.RefundStatus}",
                CreatedAt = DateTime.UtcNow,
            });
            await _db.SaveChangesAsync();
            return RefundOperationResult.Fail("REFUND_FAILED", "Refund did not complete successfully.");
        }

        await ReconcileSuccessfulRefundAsync(payment, item, refund, refundReason, refundOnly: refundOnly);
        return RefundOperationResult.Ok(refund);
    }

    private async Task ReconcileSuccessfulRefundAsync(
        Payment payment,
        PaymentItem item,
        TRS_Data.Models.Refund refund,
        string? refundReason,
        ExternalRefundDetails? externalRefund = null,
        bool refundOnly = false)
    {
        await ReconcileRefundedAmountsAsync(payment, item);
        _db.PaymentAuditLogs.Add(new PaymentAuditLog
        {
            EntityType = "Refund",
            EntityId = refund.RefundId,
            Action = refundOnly
                ? externalRefund != null ? "ExternalRefundOnlyRecorded" : "RefundOnlyInitiated"
                : externalRefund != null ? "ExternalRefundRecorded" : "RefundInitiated",
            Reason = refundReason,
            PerformedBy = User.Identity?.Name ?? "admin",
            Notes = externalRefund != null
                ? $"PaymentItemId={item.PaymentItemId}, Amount={refund.RefundAmount}, Method={externalRefund.Method}, Reference={externalRefund.Reference}, AdminNote={externalRefund.AdminNote}"
                : $"PaymentItemId={item.PaymentItemId}, Amount={refund.RefundAmount}, Reference={refund.GatewayRefundId}",
            CreatedAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync();
    }

    private async Task ReconcileRefundedAmountsAsync(Payment payment, PaymentItem item)
    {
        var itemRefundedAmount = await _db.Refunds
            .Where(r => r.PaymentItemId == item.PaymentItemId && r.RefundStatus == StatusCodesEx.Refund.Success)
            .SumAsync(r => (decimal?)r.RefundAmount) ?? 0m;

        var newItemStatus = itemRefundedAmount >= item.Amount
            ? StatusCodesEx.PaymentItem.Refunded
            : item.ItemStatus == StatusCodesEx.PaymentItem.Cancelled ? StatusCodesEx.PaymentItem.Cancelled : StatusCodesEx.PaymentItem.Success;
        if (item.ItemStatus != newItemStatus)
        {
            item.ItemStatus = newItemStatus;
            item.UpdatedAt = DateTime.UtcNow;
        }

        var paymentRefundedAmount = await _db.Refunds
            .Where(r => r.PaymentId == payment.PaymentId && r.RefundStatus == StatusCodesEx.Refund.Success)
            .SumAsync(r => (decimal?)r.RefundAmount) ?? 0m;

        payment.PaymentStatus = paymentRefundedAmount switch
        {
            <= 0m => StatusCodesEx.Payment.Success,
            var amount when amount >= payment.Amount => StatusCodesEx.Payment.FullyRefunded,
            _ => StatusCodesEx.Payment.PartiallyRefunded,
        };
        payment.UpdatedAt = DateTime.UtcNow;
    }

    private static void ApplyRegistrationStatus(EventRegistration reg, string status)
    {
        reg.RegStatus = status;
        reg.RegistrationStatus = RegistrationStatusToDb(status);
        if (status == StatusCodesEx.Registration.Confirmed) reg.ConfirmedAt = DateTime.UtcNow;
        reg.UpdatedAt = DateTime.UtcNow;
        foreach (var group in reg.ParticipantGroups)
        {
            group.GroupStatus = status;
            group.UpdatedAt = DateTime.UtcNow;
        }
    }

    private static bool CanRefundPaymentItem(Payment payment, PaymentItem item, bool refundOnly)
    {
        var paymentWasMade = payment.PaymentStatus == StatusCodesEx.Payment.Success ||
            payment.PaymentStatus == StatusCodesEx.Payment.PartiallyRefunded ||
            payment.PaymentStatus == StatusCodesEx.Payment.FullyRefunded;
        return paymentWasMade && (item.ItemStatus == StatusCodesEx.PaymentItem.Success ||
            (refundOnly && item.ItemStatus == StatusCodesEx.PaymentItem.Cancelled));
    }

    private static void ApplyRegistrationWorkflowStatus(EventRegistration reg, string status)
    {
        reg.RegStatus = status;
        reg.RegistrationStatus = RegistrationStatusToDb(status);
        reg.UpdatedAt = DateTime.UtcNow;
    }

    private static string RegistrationStatusToDb(string status)
    {
        if (status == StatusCodesEx.Registration.Cancelled)
            return StatusCodesEx.Registration.Cancelled;
        if (status == StatusCodesEx.Registration.Confirmed ||
            status == StatusCodesEx.Registration.CancelPending ||
            status == StatusCodesEx.Registration.RefundFailed)
            return StatusCodesEx.Registration.Confirmed;
        return StatusCodesEx.Registration.Pending;
    }

    private static string? StatusToAuditCode(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return status;
        var code = status.Trim();
        return code.Length <= 5 ? code : "UNK";
    }

    private static string? AppendAuditStatusContext(string? notes, string? oldStatus, string? newStatus)
    {
        if (string.IsNullOrWhiteSpace(oldStatus) && string.IsNullOrWhiteSpace(newStatus))
            return notes;

        var context = $"OldStatus={oldStatus ?? ""}, NewStatus={newStatus ?? ""}";
        return string.IsNullOrWhiteSpace(notes) ? context : $"{notes}; {context}";
    }

    private static ExternalRefundDetails? BuildExternalRefundDetails(
        string? refundSource,
        string? refundMethod,
        string? refundReference,
        string? adminNote,
        string? reason,
        out object? validationError)
    {
        validationError = null;
        if (!string.Equals(refundSource, "External", StringComparison.OrdinalIgnoreCase))
            return null;

        if (string.IsNullOrWhiteSpace(reason))
        {
            validationError = new { code = "REASON_REQUIRED", message = "Refund reason is required." };
            return null;
        }

        var method = NormalizeExternalRefundMethod(refundMethod);
        if (method == null)
        {
            validationError = new { code = "REFUND_METHOD_REQUIRED", message = "Refund method is required." };
            return null;
        }

        var reference = refundReference?.Trim();
        if (RequiresExternalRefundReference(method) && string.IsNullOrWhiteSpace(reference))
        {
            validationError = new { code = "REFUND_REFERENCE_REQUIRED", message = "Refund reference / ID is required for this refund method." };
            return null;
        }

        return new ExternalRefundDetails(method, reference, adminNote?.Trim());
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

    private sealed record ExternalRefundDetails(string Method, string? Reference, string? AdminNote);

    private sealed class RefundOperationResult
    {
        public bool Success { get; private init; }
        public string? Code { get; private init; }
        public string? Message { get; private init; }
        public TRS_Data.Models.Refund? Refund { get; private init; }

        public static RefundOperationResult Ok(TRS_Data.Models.Refund refund) => new()
        {
            Success = true,
            Refund = refund,
        };

        public static RefundOperationResult Fail(string code, string message) => new()
        {
            Success = false,
            Code = code,
            Message = message,
        };
    }

    private static bool CanAdminSetPaymentStatus(string currentStatus, string targetStatus)
    {
        if (currentStatus == targetStatus) return true;
        if (currentStatus == StatusCodesEx.Payment.PartiallyRefunded ||
            currentStatus == StatusCodesEx.Payment.FullyRefunded ||
            currentStatus == StatusCodesEx.Payment.Failed ||
            currentStatus == StatusCodesEx.Payment.Cancelled) return false;
        if (currentStatus == StatusCodesEx.Payment.Success) return targetStatus == StatusCodesEx.Payment.Success;
        if (currentStatus == StatusCodesEx.Payment.Waived) return targetStatus == StatusCodesEx.Payment.Waived;
        var currentCanMove = currentStatus == StatusCodesEx.Payment.Pending ||
            currentStatus == StatusCodesEx.Payment.PendingCollection;
        var targetAllowed = targetStatus == StatusCodesEx.Payment.Success ||
            targetStatus == StatusCodesEx.Payment.Waived ||
            targetStatus == StatusCodesEx.Payment.PendingCollection;
        return currentCanMove && targetAllowed;
    }

    // -- Map helpers ----------------------------------------------------------
    private static object MapPayment(Payment p) => new
    {
        id = p.PaymentId.ToString(),
        registrationId = p.RegistrationId.ToString(),
        eventId = p.EventId.ToString(),
        gateway = p.PaymentGateway,
        method = p.PaymentMethod,
        amount = p.Amount,
        currency = p.Currency,
        paymentStatus = p.PaymentStatus,
        receiptNo = p.ReceiptNumber,
        gatewaySessionId = p.GatewaySessionId,
        gatewayPaymentId = p.GatewayPaymentId,
        gatewayChargeId = p.GatewayChargeId,
        createdAt = p.CreatedAt,
        paidAt = p.PaidAt,
        adminNote = p.AdminNote,
        items = p.Items.Select(i => new {
            id = i.PaymentItemId.ToString(),
            paymentId = i.PaymentId.ToString(),
            participantGroupId = i.GroupId.ToString(),
            participantId = i.ParticipantId?.ToString(),
            i.ProgramName,
            i.Description,
            i.PlayerName,
            i.Amount,
            itemStatus = i.ItemStatus,
        }).ToList()
    };

    private static object MapReg(EventRegistration r)
    {
        var payment = r.Payments.FirstOrDefault();
        return new
        {
            id = r.RegistrationId.ToString(),
            eventId = r.EventId.ToString(),
            eventName = r.Event?.Name ?? r.EventName,
            snapshotEventName = r.EventName,
            submittedAt = r.SubmittedAt,
            regStatus = r.RegStatus,
            contactName = r.ContactName,
            contactEmail = r.ContactEmail,
            contactPhone = r.ContactPhone,
            groups = r.ParticipantGroups.Select(g => new {
                id = g.GroupId.ToString(),
                registrationId = r.RegistrationId.ToString(),
                eventId = g.EventId.ToString(),
                programId = g.ProgramId.ToString(),
                g.ProgramName,
                g.Fee,
                groupStatus = g.GroupStatus,
                g.Seed,
                clubDisplay = g.ClubDisplay ?? "",
                namesDisplay = g.NamesDisplay ?? "",
                participants = g.Participants.Select(p => new {
                    id = p.ParticipantId.ToString(),
                    participantGroupId = g.GroupId.ToString(),
                    p.FullName,
                    dob = p.DateOfBirth?.ToString("yyyy-MM-dd") ?? "",
                    p.Gender,
                    p.Nationality,
                    p.ClubSchoolCompany,
                    p.Email,
                    p.ContactNumber,
                    p.TshirtSize,
                    p.SbaId,
                    p.GuardianName,
                    p.GuardianContact,
                    p.DocumentUrl,
                    p.Remark,
                    participantStatus = p.ParticipantStatus,
                    customFieldValues = MapCustomFieldValues(p.CustomFieldValues),
                }).ToList()
            }).ToList(),
            payment = payment == null ? null : MapPayment(payment)
        };
    }

    private static Dictionary<string, string> MapCustomFieldValues(IEnumerable<ParticipantCustomFieldValue> values)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var cf in values)
        {
            result[cf.CustomFieldId.ToString()] = cf.FieldValue ?? "";
        }
        return result;
    }

    private static ProgramCustomField? ResolveCustomField(IEnumerable<ProgramCustomField> customFields, string key)
    {
        return int.TryParse(key, out var customFieldId)
            ? customFields.FirstOrDefault(cf => cf.CustomFieldId == customFieldId)
            : null;
    }
}
