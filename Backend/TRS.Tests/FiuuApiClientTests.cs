using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TRS_API.Services.Payments;

namespace TRS.Tests;

public class FiuuApiClientTests
{
    private static IOptions<FiuuOptions> Settings() => Options.Create(new FiuuOptions
    { MerchantId = "SB_test", VerifyKey = new string('1', 32), SecretKey = new string('2', 32) });
    private static FiuuSignatureValidator Signatures() => new(Settings());
    [Theory]
    [InlineData("Sandbox", "SB_test", "sandbox-api.fiuu.com", "sandbox-payment.fiuu.com")]
    [InlineData("Production", "live_test", "api.fiuu.com", "pay.fiuu.com")]
    public async Task Refund_and_acknowledgement_use_configured_mode(string mode, string merchant, string apiHost, string paymentHost)
    {
        var options = Settings(); options.Value.Mode = mode; options.Value.MerchantId = merchant;
        var handler = new FakeHandler("{\"error_code\":\"PR020\",\"error_desc\":\"Test rejection\"}");
        var client = new FiuuApiClient(new HttpClient(handler), options, new(options));
        await Assert.ThrowsAsync<PaymentGatewayException>(() => client.SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal(apiHost, handler.Uri!.Host);
        await client.AcknowledgeAsync(new Dictionary<string, string> { ["tranID"] = "12345" });
        Assert.Equal(paymentHost, handler.Uri!.Host);
    }
    private static Dictionary<string, string> Notification() => new()
    {
        ["tranID"] = "12345", ["orderid"] = "order1", ["domain"] = "SB_test", ["amount"] = "12.34",
        ["currency"] = "SGD", ["status"] = "00", ["paydate"] = "2026-10-08 10:00:00", ["appcode"] = "ABC",
        ["skey"] = "6b773f9941f82e9f0473d5e5644c2f76",
    };
    private const string QueryJson = """
        {"TranID":"12345","OrderID":"order1","Domain":"SB_test","Amount":"12.34","Currency":"SGD",
         "StatCode":"00","StatName":"captured","VrfKey":"37a753c6c3124a0bd86518c8f73f55c3"}
        """;
    private const string RefundJson = """
        {"RefundType":"P","MerchantID":"SB_test","RefID":"refund1","RefundID":"987","TxnID":"12345",
         "Amount":"12.34","Status":"22","Signature":"b16a69cdfbabb2c6caeba1b75bfee6a5"}
        """;

    [Theory]
    [InlineData(false, "9ffc09aa9e4c58bc95a2ee1ad4defee2")]
    [InlineData(true, "152f34c105bec9c4e745feb6d47e124b")]
    public void Checkout_signatures_match_independent_vectors_under_non_English_culture(bool extended, string expected)
    {
        var previous = CultureInfo.CurrentCulture;
        try {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            Assert.Equal(expected, Signatures().CreateCheckoutSignature("order1", 12.34m, "SGD", extended));
        } finally { CultureInfo.CurrentCulture = previous; }
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("12.345")]
    [InlineData("100000000")]
    public void Invalid_amounts_are_rejected_without_rounding(string amount)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Signatures().CreateCheckoutSignature("order1",
            decimal.Parse(amount, CultureInfo.InvariantCulture), "SGD", true));
    }

    [Fact]
    public void Valid_notification_is_bound_to_expected_order_amount_currency_and_merchant()
    {
        var result = Signatures().ValidatePaymentNotification(Notification(), "order1", 12.34m, "SGD");
        Assert.Equal("S", result.PaymentStatus);
        Assert.Equal("12345", result.TransactionId);
        Assert.Equal(12.34m, result.Amount);
    }

    [Theory]
    [InlineData("amount", "99.99")]
    [InlineData("orderid", "order2")]
    [InlineData("domain", "SB_other")]
    [InlineData("status", "11")]
    [InlineData("currency", "MYR")]
    [InlineData("appcode", "DEF")]
    [InlineData("skey", "bad")]
    public void Tampered_notification_is_rejected(string key, string value)
    {
        var fields = Notification(); fields[key] = value;
        Assert.Throws<PaymentGatewayException>(() => Signatures().ValidatePaymentNotification(fields, "order1", 12.34m, "SGD"));
    }

    [Theory]
    [InlineData("order2", "12.34", "SGD")]
    [InlineData("order1", "13.34", "SGD")]
    [InlineData("order1", "12.34", "MYR")]
    public void Signed_notification_cannot_be_applied_to_a_different_purchase(string order, string amount, string currency)
    {
        var error = Assert.Throws<PaymentGatewayException>(() => Signatures().ValidatePaymentNotification(Notification(), order,
            decimal.Parse(amount, CultureInfo.InvariantCulture), currency));
        Assert.Equal("FIUU_RESPONSE_MISMATCH", error.Code);
    }

    [Fact]
    public async Task Payment_query_sends_documented_fields_and_checks_signed_response()
    {
        var handler = new FakeHandler(QueryJson);
        var result = await Client(handler).QueryPaymentAsync("12345", "order1", 12.34m, "SGD");
        Assert.Equal("https://sandbox-api.fiuu.com/RMS/q_by_tid.php", handler.Uri!.AbsoluteUri);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("application/x-www-form-urlencoded", handler.ContentType);
        Assert.Contains("skey=4db1e8f4556f0e1608bd7ee369298dcd", handler.Body);
        Assert.Contains("amount=12.34", handler.Body);
        Assert.Contains("type=2", handler.Body);
        Assert.Equal("S", result.PaymentStatus);
    }

    [Theory]
    [InlineData("Currency", "MYR")]
    [InlineData("OrderID", "other")]
    [InlineData("TranID", "99")]
    [InlineData("VrfKey", "wrong")]
    public async Task Payment_query_rejects_mismatched_or_unsigned_response(string field, string value)
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string,string>>(QueryJson)!; fields[field] = value;
        await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(new FakeHandler(JsonSerializer.Serialize(fields)))
            .QueryPaymentAsync("12345", "order1", 12.34m, "SGD"));
    }

    [Fact]
    public async Task Refund_submission_returns_pending_and_preserves_reference_for_later_query()
    {
        var handler = new FakeHandler(RefundJson);
        var result = await Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m);
        Assert.Equal("https://sandbox-api.fiuu.com/RMS/API/refundAPI/index.php", handler.Uri!.AbsoluteUri);
        Assert.Contains("Signature=c805f7619d28ec6d039694f16fadcf98", handler.Body);
        Assert.Contains("RefID=refund1", handler.Body);
        Assert.Contains("RefundType=P", handler.Body);
        Assert.Equal("P", result.RefundStatus);
        Assert.Equal("987", result.RefundId);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("Status", "00")]
    [InlineData("RefID", "other")]
    [InlineData("Amount", "99.99")]
    [InlineData("MerchantID", "other")]
    public async Task Refund_submission_rejects_tampered_response(string field, string value)
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string,string>>(RefundJson)!; fields[field] = value;
        await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(new FakeHandler(JsonSerializer.Serialize(fields)))
            .SubmitRefundAsync("refund1", "12345", 12.34m));
    }

    [Theory]
    [InlineData("pending", "P")]
    [InlineData("processing", "P")]
    [InlineData("success", "S")]
    [InlineData("rejected", "F")]
    public async Task Refund_query_maps_documented_statuses(string status, string expected)
    {
        var handler = new FakeHandler(JsonSerializer.Serialize(new { RefID = "refund1", TxnID = "12345", RefundID = "987", Status = status }));
        var result = await Client(handler).QueryRefundAsync("refund1", "12345");
        Assert.Equal(expected, result.RefundStatus);
        Assert.Equal("/RMS/API/refundAPI/q_by_refID.php", handler.Uri!.AbsolutePath);
        Assert.Contains("Signature=00effb684ee472f20245e5958ca5ead5", handler.Body);
    }

    [Theory]
    [InlineData("{\"RefID\":\"other\",\"TxnID\":\"12345\",\"RefundID\":\"987\",\"Status\":\"success\"}")]
    [InlineData("{\"RefID\":\"refund1\",\"TxnID\":\"other\",\"RefundID\":\"987\",\"Status\":\"success\"}")]
    [InlineData("{\"RefID\":\"refund1\",\"TxnID\":\"12345\",\"RefundID\":\"987\",\"Status\":\"future\"}")]
    [InlineData("[]")]
    [InlineData("{}")] 
    [InlineData("not json")]
    [InlineData("{\"RefID\":\"refund1\",\"RefID\":\"refund1\"}")]
    public async Task Invalid_refund_query_never_becomes_success(string json)
    {
        await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(new FakeHandler(json)).QueryRefundAsync("refund1", "12345"));
    }

    [Fact]
    public async Task Duplicate_refund_reference_is_not_automatically_retried()
    {
        var handler = new FakeHandler("{\"error_code\":\"PR016\",\"error_desc\":\"sensitive provider content\"}");
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal("FIUU_PR016", error.Code);
        Assert.Equal("PR016", error.ProviderErrorCode);
        Assert.Equal("sensitive provider content", error.ProviderErrorMessage);
        Assert.DoesNotContain("sensitive", error.ToString());
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("PR020", "Insufficient balance to refund")]
    [InlineData("PR014", "  Provider wording, unchanged.\nSecond line.  ")]
    [InlineData("UNKNOWN", "<b>Do not interpret as HTML</b>")]
    [InlineData("PR020", null)]
    [InlineData("PR020", "")]
    public async Task Refund_error_preserves_provider_fields_without_rewriting(string code, string? message)
    {
        var json = JsonSerializer.Serialize(new { error_code = code, error_desc = message });
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(new FakeHandler(json))
            .SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal(code, error.ProviderErrorCode);
        Assert.Equal(message ?? "", error.ProviderErrorMessage);
        var details = error.RefundFailureDetails("Fiuu");
        Assert.Contains("Gateway error code: " + code, details);
        if (!string.IsNullOrEmpty(message)) Assert.EndsWith(message, details);
        else Assert.Contains("Gateway message: [not provided]\nTRS:", details);
    }

    [Fact]
    public void Signed_refund_rejection_preserves_reason()
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string, string>>(RefundJson)!;
        fields["Status"] = "11";
        fields["Signature"] = "04d7e54bacd9af442b6a2519deef0034";
        fields["reason"] = "  Exact provider reason.  ";
        Assert.Equal(fields["reason"], Signatures().ValidateRefundNotification(fields, "refund1", "12345", 12.34m).Reason);
    }

    [Theory]
    [InlineData("Stripe", "balance_insufficient")]
    [InlineData("OtherGateway", "ERR-123")]
    public void Shared_refund_details_preserve_other_gateway_messages(string gateway, string code)
    {
        const string message = "  Original gateway wording.\nNo TRS explanation.  ";
        var error = new PaymentGatewayException("INTERNAL", "Internal fallback", new Exception(), code, message);
        Assert.Equal($"{gateway}\nGateway error code: {code}\nGateway message: {message}", error.RefundFailureDetails(gateway));
    }

    [Theory]
    [InlineData(302)]
    [InlineData(429)]
    [InlineData(500)]
    public async Task Http_failure_does_not_confirm_refund_or_retry(int status)
    {
        var handler = new FakeHandler("", (HttpStatusCode)status);
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal("FIUU_REQUEST_UNCERTAIN", error.Code);
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Transport_failure_preserves_uncertainty()
    {
        var handler = new FakeHandler("") { Error = new HttpRequestException("private transport details") };
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal("FIUU_REQUEST_UNCERTAIN", error.Code);
        Assert.DoesNotContain("private", error.ToString());
    }

    [Fact]
    public async Task Caller_cancellation_is_not_reported_as_provider_failure()
    {
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Client(new FakeHandler(QueryJson))
            .QueryPaymentAsync("12345", "order1", 12.34m, "SGD", cancellation.Token));
    }

    [Theory]
    [InlineData("00", "ef63a51b71facaf6d29c3ac00bfcabe8", "S")]
    [InlineData("11", "04d7e54bacd9af442b6a2519deef0034", "F")]
    [InlineData("22", "b16a69cdfbabb2c6caeba1b75bfee6a5", "P")]
    public void Signed_refund_notification_maps_final_and_pending_outcomes(string status, string signature, string expected)
    {
        var fields = JsonSerializer.Deserialize<Dictionary<string,string>>(RefundJson)!;
        fields["Status"] = status; fields["Signature"] = signature;
        Assert.Equal(expected, Signatures().ValidateRefundNotification(fields, "refund1", "12345", 12.34m).RefundStatus);
    }

    [Theory]
    [InlineData("00", "6b773f9941f82e9f0473d5e5644c2f76", "S")]
    [InlineData("11", "840e46b2b2eb77ba71490e535c68d792", "F")]
    [InlineData("22", "d19b954df8fec2935fcd6e4576c04b29", "P")]
    public void Signed_payment_notification_maps_statuses(string status, string signature, string expected)
    {
        var fields = Notification(); fields["status"] = status; fields["skey"] = signature;
        Assert.Equal(expected, Signatures().ValidatePaymentNotification(fields, "order1", 12.34m, "SGD").PaymentStatus);
    }

    [Fact]
    public void Unknown_but_signed_status_stays_unresolved()
    {
        var fields = Notification(); fields["status"] = "99"; fields["skey"] = "e5ee5d58da2faa18e48aadda7cd337db";
        var error = Assert.Throws<PaymentGatewayException>(() => Signatures().ValidatePaymentNotification(fields, "order1", 12.34m, "SGD"));
        Assert.Equal("FIUU_UNKNOWN_STATUS", error.Code);
    }

    [Fact]
    public async Task Non_card_bank_fields_are_form_encoded_and_callback_requires_https()
    {
        var handler = new FakeHandler(RefundJson);
        await Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m,
            new FiuuRefundBankDetails("TEST", "SG", "Test Name", "123456"), new Uri("https://example.test/refund"));
        Assert.Contains("BeneficiaryName=Test+Name", handler.Body);
        Assert.Contains("BankCountry=SG", handler.Body);
        Assert.Contains("notify_url=https%3A%2F%2Fexample.test%2Frefund", handler.Body);
        await Assert.ThrowsAsync<ArgumentException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m,
            notificationUrl: new Uri("http://example.test/refund")));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Unreadable_large_refund_response_is_not_accepted()
    {
        var handler = new FakeHandler(new string('x', 65537));
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal("FIUU_INVALID_RESPONSE", error.Code);
    }

    [Fact]
    public async Task Provider_timeout_is_uncertain_and_is_not_retried()
    {
        var handler = new FakeHandler("") { Error = new TaskCanceledException() };
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => Client(handler).SubmitRefundAsync("refund1", "12345", 12.34m));
        Assert.Equal("FIUU_REQUEST_UNCERTAIN", error.Code);
        Assert.Equal(1, handler.Calls);
    }

    private static FiuuApiClient Client(FakeHandler handler) => new(new HttpClient(handler), Settings(), Signatures());
    private sealed class FakeHandler(string response, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        public HttpMethod? Method { get; private set; }
        public string? ContentType { get; private set; }
        public string Body { get; private set; } = "";
        public int Calls { get; private set; }
        public Exception? Error { get; init; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Calls++; Uri = request.RequestUri; Method = request.Method;
            ContentType = request.Content?.Headers.ContentType?.MediaType;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            if (Error != null) throw Error;
            return new(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }
}
