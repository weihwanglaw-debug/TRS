using Stripe;
using System.Text.Json;

namespace TRS_API.Services.Payments;

public sealed class StripePaymentGateway : IPaymentGateway
{
    public string Code => "Stripe";
    public IReadOnlyList<string> GetSupportedPaymentMethods(string currency) =>
        currency.Equals("SGD", StringComparison.OrdinalIgnoreCase) ? new[] { "card", "paynow" } : new[] { "card" };
    private readonly IConfiguration _configuration;
    public string? NewCheckoutUnavailableReason
    {
        get
        {
            var secret = _configuration["Stripe:SecretKey"] ?? "";
            var publishable = _configuration["Stripe:PublishableKey"] ?? "";
            var webhook = _configuration["Stripe:WebhookSecret"] ?? "";
            var matchingMode = (secret.StartsWith("sk_test_") && publishable.StartsWith("pk_test_"))
                || (secret.StartsWith("sk_live_") && publishable.StartsWith("pk_live_"));
            return matchingMode && webhook.StartsWith("whsec_") && webhook.Length > 6
                ? null : "Stripe server credentials are missing or inconsistent.";
        }
    }
    private readonly PaymentIntentService _paymentIntents;
    private readonly RefundService _refunds;
    private readonly Stripe.Checkout.SessionService _sessions;

    public StripePaymentGateway(PaymentIntentService paymentIntents, RefundService refunds,
        Stripe.Checkout.SessionService sessions, IConfiguration configuration)
    {
        _paymentIntents = paymentIntents;
        _refunds = refunds;
        _sessions = sessions;
        _configuration = configuration;
    }

    public async Task<GatewayCheckout> CreateCheckoutAsync(GatewayCheckoutRequest request, CancellationToken ct = default)
    {
        try
        {
            var intent = await _paymentIntents.CreateAsync(
                new PaymentIntentCreateOptions
                {
                    Amount = decimal.ToInt64(decimal.Round(request.Amount * 100m, 0, MidpointRounding.AwayFromZero)),
                    Currency = request.Currency.ToLowerInvariant(),
                    PaymentMethodTypes = new List<string> { request.PaymentMethod == "PayNow" ? "paynow" : "card" },
                    ReceiptEmail = request.ContactEmail,
                    Metadata = new Dictionary<string, string>
                    {
                        ["flow"] = "embedded_attempt",
                        ["attempt_id"] = request.AttemptId.ToString(),
                        ["event_id"] = request.EventId.ToString(),
                        ["payment_method"] = request.PaymentMethod,
                        ["contact_email"] = request.ContactEmail ?? "",
                        ["contact_name"] = request.ContactName ?? "",
                        ["contact_phone"] = request.ContactPhone ?? "",
                    },
                },
                new RequestOptions { IdempotencyKey = request.IdempotencyKey },
                ct);

            return new GatewayCheckout(intent.Id, intent.ClientSecret, _configuration["Stripe:PublishableKey"]);
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    public async Task<GatewayCheckout> GetCheckoutAsync(string paymentReference, CancellationToken ct = default)
    {
        try
        {
            var intent = await _paymentIntents.GetAsync(paymentReference, cancellationToken: ct);
            return new GatewayCheckout(intent.Id, intent.ClientSecret, _configuration["Stripe:PublishableKey"]);
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    public async Task<GatewayPayment> GetPaymentAsync(string paymentReference, CancellationToken ct = default)
    {
        try
        {
            return NormalizePayment(await _paymentIntents.GetAsync(paymentReference, cancellationToken: ct));
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    public async Task CancelPaymentAsync(string paymentReference, CancellationToken ct = default)
    {
        try
        {
            await _paymentIntents.CancelAsync(paymentReference, cancellationToken: ct);
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    public async Task<GatewayRefund> CreateRefundAsync(GatewayRefundRequest request, CancellationToken ct = default)
    {
        try
        {
            var refund = await _refunds.CreateAsync(new RefundCreateOptions
            {
                PaymentIntent = request.PaymentReference,
                Amount = (long)(request.Amount * 100m),
                Reason = "requested_by_customer",
                Metadata = request.Metadata,
            }, new RequestOptions { IdempotencyKey = request.IdempotencyKey }, ct);
            return new GatewayRefund(refund.Id, StripeRefundStatusMapper.ToLocalStatus(refund.Status),
                refund.Status == "failed" ? refund.FailureReason : null);
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    public async Task<GatewayRefundPayment> GetRefundPaymentAsync(string reference, CancellationToken ct = default)
    {
        try
        {
            if (reference.StartsWith("pi_", StringComparison.OrdinalIgnoreCase))
            {
                var intent = await _paymentIntents.GetAsync(reference, cancellationToken: ct);
                return new GatewayRefundPayment(intent.Id,
                    (intent.AmountReceived > 0 ? intent.AmountReceived : intent.Amount) / 100m,
                    intent.Status == "succeeded" ? null :
                        $"PaymentIntent status is '{intent.Status}' - only 'succeeded' intents can be refunded here.");
            }

            // Preserve the legacy hosted-session lookup behavior.
            var session = await _sessions.GetAsync(reference, cancellationToken: ct);
            return new GatewayRefundPayment(session.PaymentIntentId, (session.AmountTotal ?? 0) / 100m, null);
        }
        catch (StripeException ex)
        {
            throw Translate(ex);
        }
    }

    // This translates trusted data; signature verification stays in the webhook controller.
    public static GatewayPayment NormalizePayment(PaymentIntent intent)
    {
        ArgumentNullException.ThrowIfNull(intent);
        var state = intent.Status switch
        {
            "requires_payment_method" => GatewayPaymentState.AwaitingPaymentMethod,
            "requires_confirmation" => GatewayPaymentState.AwaitingConfirmation,
            "requires_action" => GatewayPaymentState.AwaitingAction,
            "requires_capture" => GatewayPaymentState.AwaitingCapture,
            "processing" => GatewayPaymentState.Processing,
            "succeeded" => GatewayPaymentState.Succeeded,
            "canceled" => GatewayPaymentState.Canceled,
            _ => GatewayPaymentState.Unknown,
        };
        int? attemptId = int.TryParse(intent.Metadata?.GetValueOrDefault("attempt_id"), out var id) ? id : null;
        return new GatewayPayment(
            intent.Id,
            state,
            intent.Amount / 100m,
            intent.AmountReceived / 100m,
            intent.Currency?.ToUpperInvariant(),
            attemptId,
            intent.Metadata?.GetValueOrDefault("contact_name"),
            intent.Metadata?.GetValueOrDefault("contact_email"),
            intent.Metadata?.GetValueOrDefault("contact_phone"),
            intent.LastPaymentError?.Message,
            JsonSerializer.Serialize(intent));
    }

    private static PaymentGatewayException Translate(StripeException ex) =>
        new(ex.StripeError?.Code ?? "STRIPE_ERROR", ex.StripeError?.Message ?? ex.Message, ex,
            ex.StripeError?.Code, ex.StripeError?.Message);
}
