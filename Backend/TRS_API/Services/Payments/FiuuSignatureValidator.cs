using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace TRS_API.Services.Payments;

public sealed class FiuuSignatureValidator(IOptions<FiuuOptions> options)
{
    private FiuuOptions Settings { get { options.Value.Validate(); return options.Value; } }

    // MD5 is required by the Fiuu protocol, not used here for password storage.
    internal static string Hash(string value) => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    internal static string Amount(decimal value)
    {
        if (value <= 0 || value > 99999999.99m || decimal.Round(value, 2) != value)
            throw new ArgumentOutOfRangeException(nameof(value), "Amount must be positive with at most two decimal places.");
        return value.ToString("F2", CultureInfo.InvariantCulture);
    }

    internal static void Reference(string value, int maximum, bool numeric = false)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximum || value.Any(c => c < 33 || c > 126)
            || (numeric && value.Any(c => c < '0' || c > '9')))
            throw new ArgumentException("Invalid Fiuu reference.");
    }

    internal static void Currency(string value)
    {
        if (!Regex.IsMatch(value ?? "", @"\A[A-Z]{3}\z")) throw new ArgumentException("Currency must be an uppercase ISO currency code.");
    }

    public string CreateCheckoutSignature(string orderId, decimal amount, string currency, bool extendedFormat)
    {
        Reference(orderId, 32); Currency(currency);
        var config = Settings;
        return Hash(Amount(amount) + config.MerchantId + orderId + config.VerifyKey + (extendedFormat ? currency : ""));
    }

    internal string QuerySignature(string transactionId, decimal amount) =>
        Hash(transactionId + Settings.MerchantId + Settings.VerifyKey + Amount(amount));
    internal string OrderQuerySignature(string orderId, decimal amount) => QuerySignature(orderId, amount);

    internal string ValidateOrderQuery(IReadOnlyDictionary<string, string> fields, string orderId, decimal amount, string currency)
    {
        var config = Settings;
        Verify(Required(fields, "VrfKey"), Hash(Required(fields, "Amount") + config.SecretKey
            + Required(fields, "Domain") + Required(fields, "OrderID") + Required(fields, "StatCode")));
        Match(Required(fields, "Domain"), config.MerchantId);
        Match(Required(fields, "OrderID"), orderId);
        Match(Required(fields, "Currency"), currency);
        MatchAmount(Required(fields, "Amount"), amount);
        var transactionId = Required(fields, "TranID");
        Reference(transactionId, 20, true);
        return transactionId;
    }
    internal string RefundRequestSignature(string reference, string transactionId, decimal amount) =>
        Hash("P" + Settings.MerchantId + reference + transactionId + Amount(amount) + Settings.SecretKey);
    internal string RefundQuerySignature(string reference) => Hash(reference + Settings.MerchantId + Settings.VerifyKey);

    public FiuuPaymentResult ValidatePaymentNotification(IReadOnlyDictionary<string, string> fields,
        string expectedOrderId, decimal expectedAmount, string expectedCurrency)
    {
        Reference(expectedOrderId, 40); Currency(expectedCurrency); Amount(expectedAmount);
        var config = Settings;
        var txn = Required(fields, "tranID");
        var order = Required(fields, "orderid");
        var merchant = Required(fields, "domain");
        var amount = Required(fields, "amount");
        var currency = Required(fields, "currency");
        var status = Required(fields, "status");
        var date = Required(fields, "paydate");
        var approval = fields.GetValueOrDefault("appcode") ?? "";
        var first = Hash(txn + order + status + merchant + amount + currency);
        Verify(Required(fields, "skey"), Hash(date + merchant + first + approval + config.SecretKey));
        Match(merchant, config.MerchantId); Match(order, expectedOrderId); Match(currency, expectedCurrency);
        MatchAmount(amount, expectedAmount);
        Reference(txn, 20, true);
        return new(txn, order, expectedAmount, currency, PaymentStatus(status), status, null);
    }

    internal FiuuPaymentResult ValidateQuery(IReadOnlyDictionary<string, string> fields,
        string expectedTransactionId, string expectedOrderId, decimal expectedAmount, string expectedCurrency)
    {
        var config = Settings;
        var amount = Required(fields, "Amount");
        var merchant = Required(fields, "Domain");
        var txn = Required(fields, "TranID");
        var status = Required(fields, "StatCode");
        Verify(Required(fields, "VrfKey"), Hash(amount + config.SecretKey + merchant + txn + status));
        Match(merchant, config.MerchantId); Match(txn, expectedTransactionId);
        Match(Required(fields, "OrderID"), expectedOrderId); Match(Required(fields, "Currency"), expectedCurrency);
        MatchAmount(amount, expectedAmount);
        return new(txn, expectedOrderId, expectedAmount, expectedCurrency, PaymentStatus(status), status,
            fields.GetValueOrDefault("StatName"), fields.GetValueOrDefault("Channel"));
    }

    public FiuuRefundResult ValidateRefundNotification(IReadOnlyDictionary<string, string> fields,
        string expectedReference, string expectedTransactionId, decimal expectedAmount)
    {
        Reference(expectedReference, 100); Reference(expectedTransactionId, 20, true); Amount(expectedAmount);
        var config = Settings;
        var type = Required(fields, "RefundType");
        var merchant = Required(fields, "MerchantID");
        var reference = Required(fields, "RefID");
        var refundId = Required(fields, "RefundID");
        var txn = Required(fields, "TxnID");
        var amount = Required(fields, "Amount");
        var status = Required(fields, "Status");
        Verify(Required(fields, "Signature"), Hash(type + merchant + reference + refundId + txn + amount + status + config.SecretKey));
        Match(type, "P"); Match(merchant, config.MerchantId); Match(reference, expectedReference); Match(txn, expectedTransactionId);
        MatchAmount(amount, expectedAmount); Reference(refundId, 20, true);
        return new(reference, refundId, txn, RefundStatus(status), status, fields.GetValueOrDefault("reason"));
    }

    internal static string PaymentStatus(string status) => status switch
    {
        "00" => StatusCodesEx.Payment.Success,
        "11" => StatusCodesEx.Payment.Failed,
        "22" => StatusCodesEx.Payment.Pending,
        _ => throw Invalid("FIUU_UNKNOWN_STATUS", "Fiuu returned an unrecognized payment status."),
    };
    internal static string RefundStatus(string status) => status switch
    {
        "00" or "success" => StatusCodesEx.Refund.Success,
        "11" or "rejected" => StatusCodesEx.Refund.Failed,
        "22" or "pending" or "processing" => StatusCodesEx.Refund.Pending,
        _ => throw Invalid("FIUU_UNKNOWN_STATUS", "Fiuu returned an unrecognized refund status."),
    };
    internal static void Verify(string provided, string expected)
    {
        if (!Regex.IsMatch(provided, @"\A[0-9a-fA-F]{32}\z")
            || !CryptographicOperations.FixedTimeEquals(Convert.FromHexString(provided), Convert.FromHexString(expected)))
            throw Invalid("FIUU_INVALID_SIGNATURE", "Fiuu response signature could not be verified.");
    }
    internal static string Required(IReadOnlyDictionary<string, string> fields, string key) =>
        fields.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value
        : throw Invalid("FIUU_INVALID_RESPONSE", "Fiuu response is missing a required field.");
    internal static void Match(string actual, string expected)
    {
        if (!string.Equals(actual, expected, StringComparison.Ordinal))
            throw Invalid("FIUU_RESPONSE_MISMATCH", "Fiuu response does not match the expected transaction.");
    }
    private static void MatchAmount(string actual, decimal expected)
    {
        if (!Regex.IsMatch(actual, @"\A[0-9]+\.[0-9]{2}\z")
            || !decimal.TryParse(actual, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value) || value != expected)
            throw Invalid("FIUU_RESPONSE_MISMATCH", "Fiuu response amount does not match the expected amount.");
    }
    internal static PaymentGatewayException Invalid(string code, string message) => new(code, message, new InvalidOperationException(message));
}
