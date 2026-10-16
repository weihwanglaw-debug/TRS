using System.Text.RegularExpressions;

namespace TRS_API.Services.Payments;

// Credentials must never be serialized to the browser.
public sealed class FiuuOptions
{
    public const string SandboxApiBase = "https://sandbox-api.fiuu.com/";
    public const string SandboxPaymentBase = "https://sandbox-payment.fiuu.com/";
    public string Mode { get; set; } = "Sandbox";
    public bool EnableCheckout { get; set; }
    public bool IsSandbox => Mode.Equals("Sandbox", StringComparison.OrdinalIgnoreCase);
    public string ApiBase => IsSandbox ? SandboxApiBase : "https://api.fiuu.com/";
    public string PaymentBase => IsSandbox ? SandboxPaymentBase : "https://pay.fiuu.com/";
    public string MerchantId { get; set; } = "";
    public string VerifyKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string PublicApiBaseUrl { get; set; } = "";
    public string FrontendBaseUrl { get; set; } = "";
    // Set to the card channel enabled by Fiuu for this merchant (e.g. creditT).
    public string CardChannel { get; set; } = "";
    // Default hosted page offers the merchant-enabled methods; no card routing guess is needed.
    public bool UseHostedMethodSelection { get; set; } = true;
    public bool ExtendedVcode { get; set; }
    public bool EnableSandboxCheckout { get; set; }
    public bool HasCardChannel => CardChannel is "creditT" or "creditAI" or "creditAN";

    internal void ValidateCheckout(string? paymentMethod = null)
    {
        Validate();
        ValidateBaseUrl(PublicApiBaseUrl);
        ValidateBaseUrl(FrontendBaseUrl);
        if (paymentMethod == "CreditCard" && !HasCardChannel)
            throw new InvalidOperationException("Fiuu SGD card channel must be confirmed and configured.");
    }

    internal static void ValidateBaseUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0
            || uri.IsLoopback || uri.AbsolutePath != "/")
            throw new InvalidOperationException("Fiuu checkout requires public HTTPS API and frontend origins.");
    }

    internal void Validate()
    {
        if (!IsSandbox && !Mode.Equals("Production", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Fiuu mode must be Sandbox or Production.");
        if (!Regex.IsMatch(MerchantId ?? "", @"\A[A-Za-z0-9_]{1,32}\z") || (MerchantId?.StartsWith("SB_", StringComparison.OrdinalIgnoreCase) == true) != IsSandbox
            || (!IsSandbox && MerchantId?.EndsWith("_Dev", StringComparison.OrdinalIgnoreCase) == true)
            || !Regex.IsMatch(VerifyKey ?? "", @"\A[0-9a-fA-F]{32}\z") || !Regex.IsMatch(SecretKey ?? "", @"\A[0-9a-fA-F]{32}\z"))
            throw new InvalidOperationException("Fiuu merchant credentials are missing or do not match the configured mode.");
    }
}
