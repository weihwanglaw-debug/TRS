namespace TRS_API.Services.Payments;

// Provider operations; business validation and persistence stay in the workflows.
public interface IPaymentGateway
{
    string Code { get; }
    string? NewCheckoutUnavailableReason { get; }
    bool SupportsCancellation => true;
    IReadOnlyList<string> GetSupportedPaymentMethods(string currency) => Array.Empty<string>();
    Task<GatewayCheckout> CreateCheckoutAsync(GatewayCheckoutRequest request, CancellationToken ct = default);
    Task<GatewayCheckout> GetCheckoutAsync(string paymentReference, CancellationToken ct = default);
    Task<GatewayPayment> GetPaymentAsync(string paymentReference, CancellationToken ct = default);
    Task CancelPaymentAsync(string paymentReference, CancellationToken ct = default);
    Task<GatewayRefund> CreateRefundAsync(GatewayRefundRequest request, CancellationToken ct = default);
    Task<GatewayRefundPayment> GetRefundPaymentAsync(string reference, CancellationToken ct = default);
}

public interface IRefundReconciliationGateway
{
    Task ResolveRefundReconciliationAsync(int refundId, string actor, CancellationToken ct = default);
}
