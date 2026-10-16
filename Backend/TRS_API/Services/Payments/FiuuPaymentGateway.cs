using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TRS_Data.Models;

namespace TRS_API.Services.Payments;

public sealed class FiuuPaymentGateway(TRSDbContext db, IOptions<FiuuOptions> options,
    FiuuSignatureValidator signatures, FiuuApiClient api, FiuuRefundService? refunds = null, IHostEnvironment? environment = null) : IPaymentGateway, IRefundReconciliationGateway
{
    public string Code => "Fiuu";
    public bool SupportsCancellation => false;
    public string? NewCheckoutUnavailableReason
    {
        get
        {
            var config = options.Value;
            var developmentSandbox = environment?.IsDevelopment() == true && config.IsSandbox && config.EnableSandboxCheckout;
            if (!config.EnableCheckout && !developmentSandbox)
                return "Fiuu checkout is not enabled in server configuration.";
            if (environment?.IsProduction() == true && config.IsSandbox)
                return "Fiuu sandbox mode cannot be used in Production.";
            if (environment?.IsProduction() != true && !config.IsSandbox)
                return "Fiuu production mode requires the Production environment.";
            try { options.Value.ValidateCheckout(); return null; }
            catch (InvalidOperationException) { return "Fiuu mode, merchant credentials or public URLs are incomplete."; }
        }
    }

    public IReadOnlyList<string> GetSupportedPaymentMethods(string currency) =>
        !currency.Equals("SGD", StringComparison.OrdinalIgnoreCase) ? Array.Empty<string>()
        : options.Value.UseHostedMethodSelection ? new[] { "hosted" }
        : options.Value.HasCardChannel ? new[] { "card", "paynow" } : new[] { "paynow" };

    public async Task<GatewayCheckout> CreateCheckoutAsync(GatewayCheckoutRequest request, CancellationToken ct = default)
    {
        var attempt = await db.PaymentAttempts.SingleAsync(a => a.PaymentAttemptId == request.AttemptId && a.PaymentGateway == Code, ct);
        return BuildCheckout(attempt);
    }

    public async Task<GatewayCheckout> GetCheckoutAsync(string paymentReference, CancellationToken ct = default)
        => BuildCheckout(await FindAttemptAsync(paymentReference, ct));

    public GatewayCheckout BuildCheckout(PaymentAttempt attempt)
    {
        try { options.Value.ValidateCheckout(attempt.PaymentMethod); }
        catch (InvalidOperationException) { throw FiuuSignatureValidator.Invalid("FIUU_CONFIGURATION", "Fiuu checkout URLs or merchant settings are incomplete."); }
        if (attempt.Currency != "SGD" || attempt.Amount <= 1m)
            throw FiuuSignatureValidator.Invalid("FIUU_AMOUNT_CURRENCY", "Fiuu checkout currently supports SGD amounts greater than 1.00.");
        if (string.IsNullOrWhiteSpace(attempt.ContactName) || attempt.ContactName.Length > 128
            || string.IsNullOrWhiteSpace(attempt.ContactEmail) || attempt.ContactEmail.Length > 128
            || string.IsNullOrWhiteSpace(attempt.ContactPhone) || attempt.ContactPhone.Length > 32)
            throw FiuuSignatureValidator.Invalid("FIUU_CONTACT_DETAILS", "Contact details exceed the payment provider's supported limits.");
        if (attempt.Status != StatusCodesEx.PaymentAttempt.Created || attempt.ExpiresAt <= DateTime.UtcNow)
            throw FiuuSignatureValidator.Invalid("FIUU_CHECKOUT_UNAVAILABLE", "This payment attempt cannot be opened again. Check its payment status.");
        var config = options.Value;
        var channel = attempt.PaymentMethod switch
        {
            "CreditCard" => config.CardChannel,
            "PayNow" => "PayNow",
            "Others" => null,
            _ => throw FiuuSignatureValidator.Invalid("FIUU_PAYMENT_METHOD", "This payment method is not supported."),
        };
        // Stable, opaque and within Fiuu's 32-character order query limit.
        var order = attempt.GatewayOrderId ?? "TRS" + PaymentAttemptAccessKey.PartitionKey(attempt.AttemptKey, attempt.PaymentAttemptId.ToString())[..29];
        var apiBase = config.PublicApiBaseUrl.TrimEnd('/');
        var resultUrl = config.FrontendBaseUrl.TrimEnd('/') + "/payment/result?gatewayReturn=1&attempt=" + attempt.PaymentAttemptId
            + "&event=" + attempt.EventId;
        var fields = new Dictionary<string, string>
        {
            ["merchant_id"] = config.MerchantId, ["orderid"] = order,
            ["amount"] = FiuuSignatureValidator.Amount(attempt.Amount), ["currency"] = attempt.Currency,
            ["bill_name"] = attempt.ContactName,
            ["bill_email"] = attempt.ContactEmail, ["bill_mobile"] = attempt.ContactPhone,
            ["bill_desc"] = "TRS registration " + attempt.EventId,
            ["vcode"] = signatures.CreateCheckoutSignature(order, attempt.Amount, attempt.Currency, config.ExtendedVcode),
            ["returnurl"] = apiBase + "/api/webhooks/fiuu/return",
            ["callbackurl"] = apiBase + "/api/webhooks/fiuu",
            ["cancelurl"] = resultUrl,
            ["tcctype"] = "SALS", ["guest_checkout"] = "1", ["langcode"] = "en",
        };
        if (channel != null) fields["channel"] = channel;
        return new(order, "", Hosted: new(config.PaymentBase + "RMS/pay/" + config.MerchantId + "/", fields), OrderReference: order);
    }

    public async Task<GatewayPayment> GetPaymentAsync(string paymentReference, CancellationToken ct = default)
    {
        var attempt = await FindAttemptAsync(paymentReference, ct);
        var result = attempt.GatewayTransactionId is { } transaction
            ? await api.QueryPaymentAsync(transaction, attempt.GatewayOrderId!, attempt.Amount, attempt.Currency, ct)
            : await api.QueryOrderAsync(attempt.GatewayOrderId!, attempt.Amount, attempt.Currency, ct);
        return Normalize(result, attempt);
    }

    private async Task<PaymentAttempt> FindAttemptAsync(string reference, CancellationToken ct)
    {
        var transaction = reference.StartsWith("fiuu:", StringComparison.Ordinal) ? reference[5..] : null;
        return await db.PaymentAttempts.AsNoTracking().SingleOrDefaultAsync(a => a.PaymentGateway == Code
            && (a.GatewayOrderId == reference || (transaction != null && a.GatewayTransactionId == transaction)), ct)
            ?? throw FiuuSignatureValidator.Invalid("FIUU_ATTEMPT_MISSING", "Fiuu payment context could not be found.");
    }

    public static GatewayPayment Normalize(FiuuPaymentResult result, PaymentAttempt attempt)
    {
        var channel = result.Channel;
        if (string.IsNullOrWhiteSpace(channel) || channel.Length > 100 || channel.Any(char.IsControl))
            throw FiuuSignatureValidator.Invalid("FIUU_CHANNEL_MISMATCH", "The verified provider response is missing a valid payment channel.");
        var actualMethod = channel.Equals("PayNow", StringComparison.OrdinalIgnoreCase) ? "PayNow"
            : new[] { "credit", "creditT", "creditAI", "creditAN", "CIL_Visa", "CIL_Mastercard" }
                .Contains(channel, StringComparer.OrdinalIgnoreCase) ? "CreditCard" : "Others";
        // Existing attempts with explicit methods must retain their original restriction.
        if (attempt.PaymentMethod != "Others" && attempt.PaymentMethod != actualMethod)
            throw FiuuSignatureValidator.Invalid("FIUU_CHANNEL_MISMATCH", "The provider payment channel does not match this checkout. Review is required.");
        var state = result.PaymentStatus switch
        {
            "S" when string.Equals(result.ProviderStatusName, "authorized", StringComparison.OrdinalIgnoreCase) => GatewayPaymentState.AwaitingCapture,
            "S" when string.Equals(result.ProviderStatusName, "captured", StringComparison.OrdinalIgnoreCase)
                || string.Equals(result.ProviderStatusName, "settled", StringComparison.OrdinalIgnoreCase) => GatewayPaymentState.Succeeded,
            "F" => GatewayPaymentState.Canceled,
            _ => GatewayPaymentState.Processing,
        };
        return new("fiuu:" + result.TransactionId, state, result.Amount,
            state == GatewayPaymentState.Succeeded ? result.Amount : 0, result.Currency, attempt.PaymentAttemptId,
            attempt.ContactName, attempt.ContactEmail, attempt.ContactPhone, null,
            JsonSerializer.Serialize(result), "Fiuu", result.OrderId, result.TransactionId, actualMethod);
    }

    public Task CancelPaymentAsync(string paymentReference, CancellationToken ct = default)
        => throw FiuuSignatureValidator.Invalid("FIUU_CANCEL_UNSUPPORTED", "Closing checkout does not cancel a Fiuu payment. Confirm the provider status first.");

    public Task<GatewayRefund> CreateRefundAsync(GatewayRefundRequest request, CancellationToken ct = default)
        => Refunds.SubmitAsync(request, ct);

    public async Task<GatewayRefundPayment> GetRefundPaymentAsync(string reference, CancellationToken ct = default)
    {
        if (await db.Payments.AsNoTracking().AnyAsync(p => p.PaymentGateway == Code && p.GatewayPaymentId == reference, ct))
            return new(reference, 0, "This payment belongs to a registration. Use its normal refund action.");
        var payment = await Refunds.QueryPaymentAsync(reference, ct);
        return new(reference, payment.Amount, FiuuRefundService.IsCaptured(payment) ? null : "Fiuu has not confirmed a captured payment.");
    }

    private FiuuRefundService Refunds => refunds ?? throw new InvalidOperationException("Fiuu refund service is not configured.");
    public Task ResolveRefundReconciliationAsync(int refundId, string actor, CancellationToken ct = default)
        => Refunds.ResolveOrphanAsync(refundId, actor, ct);
}
