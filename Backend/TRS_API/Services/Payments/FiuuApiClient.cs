using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace TRS_API.Services.Payments;

public sealed record FiuuPaymentResult(string TransactionId, string OrderId, decimal Amount, string Currency,
    string PaymentStatus, string ProviderStatus, string? ProviderStatusName, string? Channel = null);
public sealed record FiuuRefundResult(string Reference, string RefundId, string TransactionId, string RefundStatus, string ProviderStatus, string? Reason = null);
public sealed record FiuuRefundBankDetails(string BankCode, string BankCountry, string BeneficiaryName, string BeneficiaryAccountNumber);

// Protocol client only: no database writes, checkout activation, or automatic refund retries.
public sealed class FiuuApiClient(HttpClient http, IOptions<FiuuOptions> options, FiuuSignatureValidator signatures)
{
    public async Task<FiuuPaymentResult> QueryOrderAsync(string orderId, decimal amount, string currency, CancellationToken ct = default)
    {
        options.Value.Validate();
        FiuuSignatureValidator.Reference(orderId, 32);
        FiuuSignatureValidator.Currency(currency);
        using var response = await PostAsync("RMS/query/q_by_oid.php", new Dictionary<string, string>
        {
            ["oID"] = orderId, ["domain"] = options.Value.MerchantId,
            ["amount"] = FiuuSignatureValidator.Amount(amount), ["type"] = "2",
            ["skey"] = signatures.OrderQuerySignature(orderId, amount),
        }, false, ct);
        var fields = ObjectFields(response.RootElement);
        CheckError(fields);
        var transactionId = signatures.ValidateOrderQuery(fields, orderId, amount, currency);
        // The order-query signature does not bind TranID. Independently verify the transaction.
        return await QueryPaymentAsync(transactionId, orderId, amount, currency, ct);
    }

    public async Task AcknowledgeAsync(IReadOnlyDictionary<string, string> verifiedFields, CancellationToken ct = default)
    {
        var fields = new Dictionary<string, string>(verifiedFields) { ["treq"] = "1" };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var request = new HttpRequestMessage(HttpMethod.Post, options.Value.PaymentBase + "RMS/API/chkstat/returnipn.php")
            { Content = new FormUrlEncodedContent(fields) };
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        response.EnsureSuccessStatusCode();
    }

    public async Task<FiuuPaymentResult> QueryPaymentAsync(string transactionId, string orderId,
        decimal amount, string currency, CancellationToken ct = default)
    {
        options.Value.Validate();
        FiuuSignatureValidator.Reference(transactionId, 20, true);
        FiuuSignatureValidator.Reference(orderId, 40);
        FiuuSignatureValidator.Currency(currency);
        var fields = new Dictionary<string, string>
        {
            ["txID"] = transactionId, ["domain"] = options.Value.MerchantId,
            ["amount"] = FiuuSignatureValidator.Amount(amount), ["type"] = "2",
            ["skey"] = signatures.QuerySignature(transactionId, amount),
        };
        using var response = await PostAsync("RMS/q_by_tid.php", fields, false, ct);
        var result = ObjectFields(response.RootElement);
        CheckError(result);
        return signatures.ValidateQuery(result, transactionId, orderId, amount, currency);
    }

    public async Task<FiuuRefundResult> SubmitRefundAsync(string reference, string transactionId, decimal amount,
        FiuuRefundBankDetails? bank = null, Uri? notificationUrl = null, CancellationToken ct = default)
    {
        options.Value.Validate();
        FiuuSignatureValidator.Reference(reference, 100);
        FiuuSignatureValidator.Reference(transactionId, 20, true);
        var fields = new Dictionary<string, string>
        {
            ["RefundType"] = "P", ["MerchantID"] = options.Value.MerchantId,
            ["RefID"] = reference, ["TxnID"] = transactionId, ["Amount"] = FiuuSignatureValidator.Amount(amount),
            ["Signature"] = signatures.RefundRequestSignature(reference, transactionId, amount),
        };
        if (bank != null)
        {
            if (!Regex.IsMatch(bank.BankCode, @"\A[A-Za-z0-9]{1,8}\z")
                || !Regex.IsMatch(bank.BankCountry, @"\A[A-Z]{2}\z")
                || string.IsNullOrWhiteSpace(bank.BeneficiaryName) || bank.BeneficiaryName.Length > 100
                || bank.BeneficiaryName.Any(char.IsControl)) throw new ArgumentException("Invalid refund bank details.");
            FiuuSignatureValidator.Reference(bank.BeneficiaryAccountNumber, 100);
            fields["BankCode"] = bank.BankCode; fields["BankCountry"] = bank.BankCountry;
            fields["BeneficiaryName"] = bank.BeneficiaryName; fields["BeneficiaryAccNo"] = bank.BeneficiaryAccountNumber;
        }
        if (notificationUrl != null)
        {
            if (!notificationUrl.IsAbsoluteUri || notificationUrl.Scheme != "https" || notificationUrl.UserInfo.Length != 0)
                throw new ArgumentException("Refund notification URL must use HTTPS.");
            fields["notify_url"] = notificationUrl.AbsoluteUri;
        }
        using var response = await PostAsync("RMS/API/refundAPI/index.php", fields, true, ct);
        var result = ObjectFields(response.RootElement);
        CheckError(result);
        return signatures.ValidateRefundNotification(result, reference, transactionId, amount);
    }

    public async Task<FiuuRefundResult> QueryRefundAsync(string reference, string expectedTransactionId, CancellationToken ct = default)
    {
        options.Value.Validate();
        FiuuSignatureValidator.Reference(reference, 100);
        FiuuSignatureValidator.Reference(expectedTransactionId, 20, true);
        using var response = await PostAsync("RMS/API/refundAPI/q_by_refID.php", new Dictionary<string, string>
        {
            ["RefID"] = reference, ["MerchantID"] = options.Value.MerchantId,
            ["Signature"] = signatures.RefundQuerySignature(reference),
        }, false, ct);
        // The documented inquiry response has no signature: trust TLS and match the requested identity.
        var root = response.RootElement;
        if (root.ValueKind == JsonValueKind.Array)
        {
            if (root.GetArrayLength() != 1) throw FiuuSignatureValidator.Invalid("FIUU_INVALID_RESPONSE", "Refund inquiry did not return exactly one matching refund.");
            root = root[0];
        }
        var result = ObjectFields(root);
        CheckError(result);
        FiuuSignatureValidator.Match(FiuuSignatureValidator.Required(result, "RefID"), reference);
        FiuuSignatureValidator.Match(FiuuSignatureValidator.Required(result, "TxnID"), expectedTransactionId);
        var refundId = FiuuSignatureValidator.Required(result, "RefundID");
        FiuuSignatureValidator.Reference(refundId, 20, true);
        var status = FiuuSignatureValidator.Required(result, "Status");
        return new(reference, refundId, expectedTransactionId, FiuuSignatureValidator.RefundStatus(status), status, result.GetValueOrDefault("reason"));
    }

    private async Task<JsonDocument> PostAsync(string path, Dictionary<string, string> fields, bool submission, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.ApiBase), path))
                { Content = new FormUrlEncodedContent(fields) };
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
                throw FiuuSignatureValidator.Invalid(submission ? "FIUU_REQUEST_UNCERTAIN" : "FIUU_HTTP_ERROR",
                    submission ? "Fiuu refund outcome is unconfirmed. Query the original reference before retrying."
                        : $"Fiuu status request failed (HTTP {(int)response.StatusCode}).");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[4096];
            int count;
            while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + count > 65536)
                    throw FiuuSignatureValidator.Invalid("FIUU_INVALID_RESPONSE", "Fiuu response exceeded the allowed size.");
                buffer.Write(chunk, 0, count);
            }
            return JsonDocument.Parse(buffer.ToArray(), new JsonDocumentOptions { MaxDepth = 16 });
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw FiuuSignatureValidator.Invalid(submission ? "FIUU_REQUEST_UNCERTAIN" : "FIUU_TIMEOUT",
                "Fiuu request timed out. The provider outcome is unconfirmed.");
        }
        catch (HttpRequestException)
        {
            throw FiuuSignatureValidator.Invalid(submission ? "FIUU_REQUEST_UNCERTAIN" : "FIUU_TRANSPORT_ERROR",
                "Fiuu could not be reached. The provider outcome is unconfirmed.");
        }
        catch (JsonException)
        {
            throw FiuuSignatureValidator.Invalid("FIUU_INVALID_RESPONSE", "Fiuu returned an invalid response. No final outcome is confirmed.");
        }
    }

    private static Dictionary<string, string> ObjectFields(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw FiuuSignatureValidator.Invalid("FIUU_INVALID_RESPONSE", "Fiuu response must be an object.");
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var property in element.EnumerateObject())
        {
            var value = property.Value.ValueKind switch
            {
                JsonValueKind.String => property.Value.GetString()!,
                JsonValueKind.Number => property.Value.GetRawText(),
                JsonValueKind.Null => "",
                _ => "",
            };
            if (!fields.TryAdd(property.Name, value))
                throw FiuuSignatureValidator.Invalid("FIUU_INVALID_RESPONSE", "Fiuu response contains duplicate fields.");
        }
        return fields;
    }

    private static void CheckError(IReadOnlyDictionary<string, string> fields)
    {
        if (!fields.TryGetValue("error_code", out var code) || string.IsNullOrEmpty(code)) return;
        // Preserve only the provider's error fields, not its full response body.
        var safeCode = Regex.IsMatch(code, @"\A[A-Z0-9]{1,20}\z") ? code : "PROVIDER_ERROR";
        fields.TryGetValue("error_desc", out var description);
        throw new PaymentGatewayException("FIUU_" + safeCode, "Fiuu returned an API error.",
            new InvalidOperationException("Fiuu API error"), code, description);
    }
}
