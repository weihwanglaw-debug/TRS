using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TRS_API.Services;
using TRS_API.Services.Payments;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController]
[Route("api/webhooks/fiuu")]
[RequestSizeLimit(65536)]
[RequestFormLimits(ValueCountLimit = 64, ValueLengthLimit = 32768)]
public sealed class FiuuWebhookController(TRSDbContext db, FiuuSignatureValidator signatures,
    FiuuApiClient api, PaymentAttemptService attempts, IOptions<FiuuOptions> options,
    ILogger<FiuuWebhookController> logger) : ControllerBase
{
    [HttpPost]
    public Task<IActionResult> Notification(CancellationToken ct) => ReceiveAsync(false, ct);

    [HttpPost("return")]
    public Task<IActionResult> Return(CancellationToken ct) => ReceiveAsync(true, ct);

    [HttpPost("refund")]
    public async Task<IActionResult> Refund([FromServices] FiuuRefundService refunds, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            Dictionary<string, string> fields;
            if (Request.HasFormContentType)
            {
                var form = await Request.ReadFormAsync(ct);
                if (form.Any(p => p.Value.Count != 1)) return BadRequest(new { code = "DUPLICATE_FIELD" });
                fields = form.ToDictionary(p => p.Key, p => p.Value.ToString(), StringComparer.Ordinal);
            }
            else
            {
                using var json = await System.Text.Json.JsonDocument.ParseAsync(Request.Body, new System.Text.Json.JsonDocumentOptions { MaxDepth = 8 }, ct);
                fields = new(StringComparer.Ordinal);
                if (json.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object) return BadRequest();
                foreach (var p in json.RootElement.EnumerateObject())
                {
                    if (p.Value.ValueKind is not (System.Text.Json.JsonValueKind.String or System.Text.Json.JsonValueKind.Number)) return BadRequest();
                    if (!fields.TryAdd(p.Name, p.Value.ValueKind == System.Text.Json.JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText()))
                        return BadRequest(new { code = "DUPLICATE_FIELD" });
                }
            }
            await refunds.ReceiveAsync(fields, ct);
            return Content("OK", "text/plain");
        }
        catch (PaymentGatewayException ex) when (ex.Code is "FIUU_INVALID_SIGNATURE" or "FIUU_INVALID_RESPONSE" or "FIUU_RESPONSE_MISMATCH" or "FIUU_REFUND_NOT_FOUND")
        { return BadRequest(new { code = ex.Code }); }
        catch (System.Text.Json.JsonException) { return BadRequest(new { code = "INVALID_JSON" }); }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            logger.LogWarning("Fiuu refund callback remains unprocessed ({Type}).", ex.GetType().Name);
            return StatusCode(503, new { code = "REFUND_PROCESSING_UNCONFIRMED" });
        }
    }

    private async Task<IActionResult> ReceiveAsync(bool browserReturn, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        PaymentAttempt? attempt = null;
        try
        {
            if (!Request.HasFormContentType) return BadRequest(new { code = "FORM_REQUIRED" });
            var form = await Request.ReadFormAsync(ct);
            if (form.Any(pair => pair.Value.Count != 1)) return BadRequest(new { code = "DUPLICATE_FIELD" });
            var fields = form.ToDictionary(pair => pair.Key, pair => pair.Value.ToString(), StringComparer.Ordinal);
            if (!fields.TryGetValue("orderid", out var order) || order.Length > 32) return BadRequest(new { code = "INVALID_ORDER" });
            attempt = await db.PaymentAttempts.AsNoTracking().SingleOrDefaultAsync(a => a.PaymentGateway == "Fiuu" && a.GatewayOrderId == order, ct);
            if (attempt == null) return BadRequest(new { code = "INVALID_ORDER" });
            FiuuPaymentResult notification;
            try { notification = signatures.ValidatePaymentNotification(fields, order, attempt.Amount, attempt.Currency); }
            catch (PaymentGatewayException ex) { return BadRequest(new { code = ex.Code }); }
            // Verify current capture state. The signed notification status alone cannot distinguish AUTH from SALS.
            var verified = await api.QueryPaymentAsync(notification.TransactionId, order, attempt.Amount, attempt.Currency, ct);
            await attempts.ApplyHostedPaymentAsync(FiuuPaymentGateway.Normalize(verified, attempt), ct);
            if (fields.GetValueOrDefault("nbcb") != "1")
                await api.AcknowledgeAsync(fields, ct);
            if (browserReturn) return ReturnToTrs(attempt);
            return Content(fields.GetValueOrDefault("nbcb") == "1" ? "CBTOKEN:MPSTATOK" : "OK", "text/plain");
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // No payload, signature or credentials in application logs. Non-2xx asks Fiuu to retry.
            logger.LogWarning("Fiuu notification processing is unconfirmed ({Code}).",
                ex is PaymentGatewayException gatewayError ? gatewayError.Code : ex.GetType().Name);
            if (browserReturn && attempt != null) return ReturnToTrs(attempt);
            return StatusCode(503, new { code = "FIUU_PROCESSING_UNCONFIRMED" });
        }
    }

    private IActionResult ReturnToTrs(PaymentAttempt attempt)
    {
        FiuuOptions.ValidateBaseUrl(options.Value.FrontendBaseUrl);
        // No access key or provider success claim is copied into the browser URL.
        Response.Headers.Location = options.Value.FrontendBaseUrl.TrimEnd('/')
            + "/payment/result?gatewayReturn=1&attempt=" + attempt.PaymentAttemptId + "&event=" + attempt.EventId;
        return StatusCode(303);
    }
}
