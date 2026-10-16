using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TRS_API.Services.Payments;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class FiuuHostedCheckoutTests
{
    private static FiuuOptions Settings() => new()
    {
        MerchantId = "SB_test", VerifyKey = new string('1', 32), SecretKey = new string('2', 32),
        PublicApiBaseUrl = "https://api.example.com", FrontendBaseUrl = "https://www.example.com", CardChannel = "creditT", UseHostedMethodSelection = false,
    };
    private static PaymentAttempt Attempt() => new()
    {
        PaymentAttemptId = 12, EventId = 34, AttemptKey = new string('a', 64), PaymentGateway = "Fiuu",
        ContactName = "Test Customer", ContactEmail = "test@example.com", ContactPhone = "+6512345678",
        Amount = 12.34m, Currency = "SGD", ExpiresAt = DateTime.UtcNow.AddMinutes(5),
    };
    private static FiuuPaymentGateway Gateway(FiuuOptions settings, Microsoft.Extensions.Hosting.IHostEnvironment? environment = null) => new(
        new TRSDbContext(new DbContextOptionsBuilder<TRSDbContext>().UseSqlServer("Server=unused;Database=unused;Integrated Security=true").Options),
        Options.Create(settings), new(Options.Create(settings)), new(new HttpClient(), Options.Create(settings), new(Options.Create(settings))), environment: environment);
    private sealed class TestEnvironment(string name) : Microsoft.Extensions.Hosting.IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "TRS.Tests";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    [Theory]
    [InlineData("Development", true, true)]
    [InlineData("Development", false, false)]
    [InlineData("Production", true, false)]
    [InlineData("Staging", true, false)]
    public void Sandbox_selection_requires_development_and_explicit_opt_in(string env, bool enabled, bool available)
    {
        var settings = Settings(); settings.EnableSandboxCheckout = enabled; settings.CardChannel = "";
        Assert.Equal(available, Gateway(settings, new TestEnvironment(env)).NewCheckoutUnavailableReason == null);
    }

    [Fact]
    public void Invalid_urls_block_even_opted_in_development_selection()
    {
        var settings = Settings(); settings.EnableSandboxCheckout = true; settings.PublicApiBaseUrl = "http://localhost";
        Assert.NotNull(Gateway(settings, new TestEnvironment("Development")).NewCheckoutUnavailableReason);
    }

    [Theory]
    [InlineData("")]
    [InlineData("unconfirmed")]
    public void Missing_card_channel_allows_paynow_but_rejects_cards(string cardChannel)
    {
        var settings = Settings(); settings.CardChannel = cardChannel;
        var gateway = Gateway(settings);
        Assert.Equal(new[] { "paynow" }, gateway.GetSupportedPaymentMethods("SGD"));
        var attempt = Attempt(); attempt.PaymentMethod = "PayNow";
        Assert.Equal("PayNow", gateway.BuildCheckout(attempt).Hosted!.Fields["channel"]);
        attempt.PaymentMethod = "CreditCard";
        Assert.Throws<PaymentGatewayException>(() => gateway.BuildCheckout(attempt));
    }

    [Fact]
    public void Confirmed_card_channel_advertises_both_methods_only_for_supported_currency()
    {
        var gateway = Gateway(Settings());
        Assert.Equal(new[] { "card", "paynow" }, gateway.GetSupportedPaymentMethods("SGD"));
        Assert.Empty(gateway.GetSupportedPaymentMethods("USD"));
    }

    private static string Md5(string value) => Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    [Theory]
    [InlineData("Staging", "Sandbox", "SB_test", true)]
    [InlineData("UAT", "Sandbox", "SB_test", true)]
    [InlineData("Production", "Production", "live_test", true)]
    [InlineData("Production", "Sandbox", "SB_test", false)]
    [InlineData("Staging", "Production", "live_test", false)]
    [InlineData("Production", "Production", "SB_test", false)]
    [InlineData("Staging", "Sandbox", "live_test", false)]
    [InlineData("Production", "Production", "merchant_Dev", false)]
    [InlineData("Production", "Typo", "live_test", false)]
    public void Explicit_checkout_mode_validates_environment_and_merchant(string env, string mode, string merchant, bool allowed)
    {
        var settings = Settings(); settings.EnableCheckout = true; settings.Mode = mode; settings.MerchantId = merchant;
        Assert.Equal(allowed, Gateway(settings, new TestEnvironment(env)).NewCheckoutUnavailableReason == null);
    }

    [Fact]
    public void Production_form_uses_production_origin_and_missing_keys_remain_unselectable()
    {
        var settings = Settings(); settings.EnableCheckout = true; settings.Mode = "Production"; settings.MerchantId = "live_test";
        var gateway = Gateway(settings, new TestEnvironment("Production"));
        var attempt = Attempt(); attempt.PaymentMethod = "Others";
        Assert.Equal("https://pay.fiuu.com/RMS/pay/live_test/", gateway.BuildCheckout(attempt).Hosted!.Url);
        settings.SecretKey = "";
        Assert.NotNull(gateway.NewCheckoutUnavailableReason);
    }

    [Fact]
    public void Default_hosted_selection_needs_no_card_route_and_omits_channel()
    {
        Assert.True(new FiuuOptions().UseHostedMethodSelection);
        var settings = Settings(); settings.UseHostedMethodSelection = true; settings.CardChannel = "";
        var gateway = Gateway(settings);
        Assert.Equal(new[] { "hosted" }, gateway.GetSupportedPaymentMethods("SGD"));
        Assert.Empty(gateway.GetSupportedPaymentMethods("USD"));
        var attempt = Attempt(); attempt.PaymentMethod = "Others";
        var checkout = gateway.BuildCheckout(attempt);
        Assert.False(checkout.Hosted!.Fields.ContainsKey("channel"));
        Assert.Equal("SGD", checkout.Hosted.Fields["currency"]);
        Assert.Equal("12.34", checkout.Hosted.Fields["amount"]);
        Assert.Equal(Md5("12.34SB_test" + checkout.OrderReference + settings.VerifyKey), checkout.Hosted.Fields["vcode"]);
        Assert.DoesNotContain(settings.SecretKey, JsonSerializer.Serialize(checkout));
        attempt.PaymentMethod = "PayNow";
        Assert.Equal("PayNow", gateway.BuildCheckout(attempt).Hosted!.Fields["channel"]);
    }

    [Theory]
    [InlineData("CIL_Visa", "CreditCard")]
    [InlineData("CIL_Mastercard", "CreditCard")]
    [InlineData("creditT", "CreditCard")]
    [InlineData("PayNow", "PayNow")]
    [InlineData("GrabPay_SG", "Others")]
    public void Hosted_selection_records_the_verified_actual_method(string channel, string expected)
    {
        var attempt = Attempt(); attempt.PaymentMethod = "Others";
        var result = new FiuuPaymentResult("12345", "order1", 12.34m, "SGD", "S", "00", "captured", channel);
        var payment = FiuuPaymentGateway.Normalize(result, attempt);
        Assert.Equal(GatewayPaymentState.Succeeded, payment.State);
        Assert.Equal(expected, payment.VerifiedPaymentMethod);
        Assert.Contains(channel, payment.ProviderPayloadJson!);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("PayNow\n")]
    public void Hosted_selection_requires_a_valid_verified_channel(string? channel)
    {
        var attempt = Attempt(); attempt.PaymentMethod = "Others";
        var result = new FiuuPaymentResult("12345", "order1", 12.34m, "SGD", "S", "00", "captured", channel);
        Assert.Throws<PaymentGatewayException>(() => FiuuPaymentGateway.Normalize(result, attempt));
    }

    [Theory]
    [InlineData("CreditCard", "creditT")]
    [InlineData("PayNow", "PayNow")]
    public void Hosted_form_is_signed_scoped_to_sandbox_and_contains_no_server_keys(string method, string channel)
    {
        var settings = Settings();
        var attempt = Attempt(); attempt.PaymentMethod = method;
        var gateway = Gateway(settings);
        var checkout = gateway.BuildCheckout(attempt);
        Assert.Equal("https://sandbox-payment.fiuu.com/RMS/pay/SB_test/", checkout.Hosted!.Url);
        Assert.Equal(channel, checkout.Hosted.Fields["channel"]);
        Assert.Equal("SALS", checkout.Hosted.Fields["tcctype"]);
        Assert.Equal("12.34", checkout.Hosted.Fields["amount"]);
        Assert.Equal(32, checkout.OrderReference!.Length);
        Assert.Equal(checkout.OrderReference, gateway.BuildCheckout(attempt).OrderReference);
        Assert.Equal(Md5("12.34SB_test" + checkout.OrderReference + settings.VerifyKey), checkout.Hosted.Fields["vcode"]);
        var json = JsonSerializer.Serialize(checkout);
        Assert.DoesNotContain(settings.VerifyKey, json);
        Assert.DoesNotContain(settings.SecretKey, json);
        Assert.DoesNotContain(attempt.AttemptKey, json);
        Assert.Null(checkout.PublishableKey);
        Assert.NotNull(gateway.NewCheckoutUnavailableReason);
        Assert.False(gateway.SupportsCancellation);
    }

    [Theory]
    [InlineData("http://api.example.com")]
    [InlineData("https://localhost")]
    [InlineData("https://user:password@api.example.com")]
    [InlineData("https://api.example.com?redirect=other")]
    public void Invalid_checkout_origin_is_rejected(string origin)
    {
        var settings = Settings(); settings.PublicApiBaseUrl = origin;
        Assert.Equal("FIUU_CONFIGURATION", Assert.Throws<PaymentGatewayException>(() => Gateway(settings).BuildCheckout(Attempt())).Code);
    }

    [Theory]
    [InlineData("SB")]
    [InlineData("S")]
    [InlineData("EX")]
    [InlineData("NR")]
    public void Submitted_or_terminal_attempt_cannot_be_reopened(string status)
    {
        var attempt = Attempt(); attempt.Status = status;
        Assert.Throws<PaymentGatewayException>(() => Gateway(Settings()).BuildCheckout(attempt));
    }

    [Fact]
    public void Expired_attempt_and_unconfirmed_card_channel_are_rejected()
    {
        var attempt = Attempt(); attempt.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
        Assert.Throws<PaymentGatewayException>(() => Gateway(Settings()).BuildCheckout(attempt));
        var settings = Settings(); settings.CardChannel = "";
        Assert.Throws<PaymentGatewayException>(() => Gateway(settings).BuildCheckout(Attempt()));
    }

    [Theory]
    [InlineData("S", "authorized", GatewayPaymentState.AwaitingCapture)]
    [InlineData("S", "captured", GatewayPaymentState.Succeeded)]
    [InlineData("S", "settled", GatewayPaymentState.Succeeded)]
    [InlineData("S", "unknown", GatewayPaymentState.Processing)]
    [InlineData("S", null, GatewayPaymentState.Processing)]
    [InlineData("P", "Pending", GatewayPaymentState.Processing)]
    [InlineData("F", "failed", GatewayPaymentState.Canceled)]
    public void Only_verified_capture_or_settlement_confirms_payment(string status, string? name, GatewayPaymentState expected)
    {
        var payment = FiuuPaymentGateway.Normalize(new("12345", "order1", 12.34m, "SGD", status, "00", name, "creditT"), Attempt());
        Assert.Equal(expected, payment.State);
        Assert.Equal(expected == GatewayPaymentState.Succeeded ? 12.34m : 0, payment.AmountReceived);
        Assert.Equal("fiuu:12345", payment.PaymentReference);
        Assert.Equal("12345", payment.TransactionReference);
        Assert.Equal("order1", payment.OrderReference);
    }

    [Fact]
    public async Task Order_recovery_independently_verifies_the_transaction_before_accepting_it()
    {
        var handler = new QueryHandler();
        var options = Options.Create(Settings());
        var client = new FiuuApiClient(new HttpClient(handler), options, new(options));
        var result = await client.QueryOrderAsync("order1", 12.34m, "SGD");
        Assert.Equal("12345", result.TransactionId);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains("q_by_oid.php", handler.Requests[0].Url);
        Assert.Contains("oID=order1", handler.Requests[0].Body);
        Assert.Contains("skey=" + Md5("order1SB_test" + new string('1', 32) + "12.34"), handler.Requests[0].Body);
        Assert.Contains("q_by_tid.php", handler.Requests[1].Url);
        Assert.Contains("txID=12345", handler.Requests[1].Body);
    }

    [Theory]
    [InlineData("CreditCard", "PayNow")]
    [InlineData("PayNow", "creditT")]
    [InlineData("CreditCard", null)]
    public void Unexpected_payment_channel_cannot_finalize_the_requested_method(string method, string? channel)
    {
        var attempt = Attempt(); attempt.PaymentMethod = method;
        var result = new FiuuPaymentResult("12345", "order1", 12.34m, "SGD", "S", "00", "captured", channel);
        Assert.Equal("FIUU_CHANNEL_MISMATCH", Assert.Throws<PaymentGatewayException>(() => FiuuPaymentGateway.Normalize(result, attempt)).Code);
    }

    [Fact]
    public async Task Tampered_transaction_query_cannot_confirm_order_recovery()
    {
        var options = Options.Create(Settings());
        var client = new FiuuApiClient(new HttpClient(new QueryHandler { TamperTransaction = true }), options, new(options));
        Assert.Equal("FIUU_INVALID_SIGNATURE", (await Assert.ThrowsAsync<PaymentGatewayException>(() => client.QueryOrderAsync("order1", 12.34m, "SGD"))).Code);
    }

    [Fact]
    public async Task Notification_ack_uses_sandbox_form_post_and_sets_treq()
    {
        var handler = new QueryHandler(); var options = Options.Create(Settings());
        var client = new FiuuApiClient(new HttpClient(handler), options, new(options));
        await client.AcknowledgeAsync(new Dictionary<string, string> { ["tranID"] = "12345", ["treq"] = "0" });
        Assert.Single(handler.Requests);
        Assert.Equal("https://sandbox-payment.fiuu.com/RMS/API/chkstat/returnipn.php", handler.Requests[0].Url);
        Assert.Contains("treq=1", handler.Requests[0].Body);
    }

    private sealed class QueryHandler : HttpMessageHandler
    {
        public bool TamperTransaction { get; init; }
        public List<(string Url, string Body)> Requests { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.AbsoluteUri;
            Requests.Add((url, await request.Content!.ReadAsStringAsync(ct)));
            var orderQuery = url.Contains("q_by_oid");
            var signature = Md5("12.34" + new string('2', 32) + "SB_test" + (orderQuery ? "order1" : "12345") + "00");
            var payload = new Dictionary<string, string>
            {
                ["Amount"] = TamperTransaction && !orderQuery ? "99.99" : "12.34", ["Domain"] = "SB_test",
                ["OrderID"] = "order1", ["TranID"] = "12345", ["StatCode"] = "00", ["StatName"] = "captured",
                ["Currency"] = "SGD", ["VrfKey"] = signature,
            };
            return new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(payload)) };
        }
    }
}
