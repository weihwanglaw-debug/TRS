using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using TRS_Data.Models;

namespace TRS_API.Services.Payments;

public sealed class FiuuRefundOperationFilter(TRSDbContext db, AdminAuditService audit) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var action = (context.ActionDescriptor as ControllerActionDescriptor)?.ActionName;
        if (action is not ("InitiateRefund" or "InitiateRefunds" or "CancelWithRefunds" or "CancelRegistration"
            or "CancelGroup" or "CancelParticipant" or "RefundOrphanedPayment" or "RecordExternalOrphanRefund" or "MarkRefundWebhookReviewed"))
        { await next(); return; }
        string? resource = null;
        int? registrationId = null;
        string? gatewayReference = null;
        if (!HttpMethods.IsGet(context.HttpContext.Request.Method))
        {
            if (context.ActionArguments.TryGetValue("id", out var idValue) && idValue is int id
                && await db.Payments.AsNoTracking().AnyAsync(p => p.RegistrationId == id && p.PaymentGateway == "Fiuu", context.HttpContext.RequestAborted))
            {
                registrationId = id;
                resource = FiuuRefundOperationLock.Registration(id);
            }
            if (context.ActionArguments.TryGetValue("webhookLogId", out var logValue) && logValue is int logId)
            {
                var log = await db.WebhookLogs.AsNoTracking().SingleOrDefaultAsync(w => w.WebhookLogId == logId && w.PaymentGateway == "Fiuu", context.HttpContext.RequestAborted);
                if (log?.GatewaySessionId != null)
                {
                    gatewayReference = log.GatewaySessionId;
                    registrationId = await db.Payments.Where(p => p.PaymentId == log.PaymentId).Select(p => (int?)p.RegistrationId).SingleOrDefaultAsync(context.HttpContext.RequestAborted);
                    resource = registrationId is int registration ? FiuuRefundOperationLock.Registration(registration) : FiuuRefundOperationLock.Orphan(gatewayReference);
                }
            }
        }
        if (resource == null) { await next(); return; }
        await using var operation = new FiuuRefundOperationLock(db);
        try { await operation.AcquireAsync(resource, context.HttpContext.RequestAborted); }
        catch (PaymentGatewayException ex) { context.Result = new ConflictObjectResult(new { code = ex.Code, message = ex.Message }); return; }
        var before = await SnapshotAsync(registrationId, gatewayReference);
        var executed = await next();
        if (executed.Exception != null && !executed.ExceptionHandled) return;
        var after = await SnapshotAsync(registrationId, gatewayReference);
        if (JsonSerializer.Serialize(before) != JsonSerializer.Serialize(after))
            await audit.LogAsync(context.HttpContext.User, context.HttpContext.Connection.RemoteIpAddress?.ToString(),
                action!, "FiuuRefundOperation", registrationId?.ToString() ?? gatewayReference!, before, after);
    }

    private async Task<object> SnapshotAsync(int? registrationId, string? reference) => new
    {
        Refunds = await db.Refunds.AsNoTracking().Where(r => r.PaymentGateway == "Fiuu"
            && ((registrationId != null && r.Payment != null && r.Payment.RegistrationId == registrationId)
                || (reference != null && r.GatewaySessionId == reference)))
            .OrderBy(r => r.RefundId).Select(r => new { r.RefundId, r.PaymentItemId, r.RefundAmount, r.RefundStatus, r.RefundReason, r.GatewayRequestId, r.GatewayRefundId }).ToListAsync(),
        Registration = await db.EventRegistrations.AsNoTracking().Where(r => r.RegistrationId == registrationId)
            .Select(r => new { r.RegStatus, r.RegistrationStatus }).SingleOrDefaultAsync(),
        Logs = await db.WebhookLogs.AsNoTracking().Where(w => reference != null && w.PaymentGateway == "Fiuu" && w.GatewaySessionId == reference)
            .OrderBy(w => w.WebhookLogId).Select(w => new { w.WebhookLogId, w.ProcessingStatus }).ToListAsync(),
    };
}
