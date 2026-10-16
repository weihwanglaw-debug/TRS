namespace TRS_API.Services.Payments;

public sealed record GatewayCheckoutRequest(
    decimal Amount,
    string Currency,
    string PaymentMethod,
    int AttemptId,
    int EventId,
    string? ContactEmail,
    string? ContactName,
    string? ContactPhone,
    string IdempotencyKey);

// ClientToken is checkout initialization data, never a server API credential.
public sealed record HostedCheckout(string Url, IReadOnlyDictionary<string, string> Fields);
public sealed record GatewayCheckout(string PaymentReference, string ClientToken,
    string? PublishableKey = null, HostedCheckout? Hosted = null, string? OrderReference = null);

// Internal provider lifecycle states, not persisted statuses or public API values.
public enum GatewayPaymentState
{
    Unknown,
    AwaitingPaymentMethod,
    AwaitingConfirmation,
    AwaitingAction,
    AwaitingCapture,
    Processing,
    Succeeded,
    Canceled,
}

// Construct only from an authenticated provider lookup or a signature-verified event.
public sealed record GatewayPayment(
    string PaymentReference,
    GatewayPaymentState State,
    decimal Amount,
    decimal AmountReceived,
    string? Currency,
    int? AttemptId,
    string? ContactName,
    string? ContactEmail,
    string? ContactPhone,
    string? FailureMessage,
    string ProviderPayloadJson,
    string GatewayCode = "Stripe",
    string? OrderReference = null,
    string? TransactionReference = null,
    string? VerifiedPaymentMethod = null)
{
    public decimal EffectiveAmount => AmountReceived > 0 ? AmountReceived : Amount;
}

public sealed record GatewayRefundRequest(
    string PaymentReference,
    decimal Amount,
    Dictionary<string, string> Metadata,
    string IdempotencyKey,
    int? LocalRefundId = null);

// RefundStatus uses the existing TRS P/S/F codes.
public sealed record GatewayRefund(string? RefundReference, string RefundStatus, string? ProviderErrorCode = null, string? ProviderErrorMessage = null)
{
    public bool IsTerminal => RefundStatus == StatusCodesEx.Refund.Success || RefundStatus == StatusCodesEx.Refund.Failed;
}

public sealed record GatewayRefundPayment(string PaymentReference, decimal Amount, string? ValidationError);

public sealed class PaymentGatewayException : Exception
{
    public string Code { get; }
    public string? ProviderErrorCode { get; }
    public string? ProviderErrorMessage { get; }

    public string RefundFailureDetails(string gateway) =>
        $"{gateway}\nGateway error code: {ProviderErrorCode ?? "[not provided]"}\nGateway message: "
        + (ProviderErrorMessage == null || ProviderErrorMessage.Length == 0
            ? "[not provided]\nTRS: " + Message : ProviderErrorMessage);

    public PaymentGatewayException(string code, string message, Exception innerException,
        string? providerErrorCode = null, string? providerErrorMessage = null)
        : base(message, innerException)
    {
        Code = code;
        ProviderErrorCode = providerErrorCode;
        ProviderErrorMessage = providerErrorMessage;
    }
}
