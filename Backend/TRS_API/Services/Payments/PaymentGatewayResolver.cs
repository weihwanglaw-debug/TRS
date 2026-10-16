namespace TRS_API.Services.Payments;

public sealed class PaymentGatewayResolver
{
    private readonly IReadOnlyDictionary<string, IPaymentGateway> _gateways;

    public PaymentGatewayResolver(IEnumerable<IPaymentGateway> gateways)
    {
        _gateways = gateways.ToDictionary(g => g.Code, StringComparer.OrdinalIgnoreCase);
    }

    public IPaymentGateway? Find(string? code) =>
        code != null && _gateways.TryGetValue(code.Trim(), out var gateway) ? gateway : null;

    // Existing transactions must remain serviceable even when disabled for NEW payments.
    public IPaymentGateway Resolve(string? originalGateway) => Find(originalGateway)
        ?? throw new PaymentGatewayException("UNSUPPORTED_GATEWAY",
            "The payment's original gateway is not available. No provider request was sent.",
            new InvalidOperationException("No gateway adapter registered."));
}
