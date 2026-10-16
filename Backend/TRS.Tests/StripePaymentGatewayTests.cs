using Stripe;
using System.Text.Json;
using TRS_API.Services.Payments;

namespace TRS.Tests;

public sealed class StripePaymentGatewayTests
{
    [Fact]
    public void Method_capabilities_preserve_cards_and_sgd_paynow()
    {
        var gateway = CreateGateway(new RecordingStripeClient());
        Assert.Equal(new[] { "card", "paynow" }, gateway.GetSupportedPaymentMethods("SGD"));
        Assert.Equal(new[] { "card" }, gateway.GetSupportedPaymentMethods("USD"));
    }

    [Theory]
    [InlineData("CreditCard", "card")]
    [InlineData("PayNow", "paynow")]
    public async Task Create_preserves_payment_parameters_metadata_and_idempotency(string method, string stripeMethod)
    {
        var client = new RecordingStripeClient();
        var gateway = CreateGateway(client);
        using var cancellation = new CancellationTokenSource();

        var result = await gateway.CreateCheckoutAsync(new GatewayCheckoutRequest(
            12.345m, "SGD", method, 42, 7, "payer@example.test", "Payer", "12345678", "embedded_attempt_test"), cancellation.Token);

        Assert.Equal(HttpMethod.Post, client.Method);
        Assert.Equal("/v1/payment_intents", client.Path);
        var options = Assert.IsType<PaymentIntentCreateOptions>(client.Options);
        Assert.Equal(1235L, options.Amount);
        Assert.Equal("sgd", options.Currency);
        Assert.Equal(new[] { stripeMethod }, options.PaymentMethodTypes);
        Assert.Equal("payer@example.test", options.ReceiptEmail);
        Assert.Equal(7, options.Metadata.Count);
        Assert.Equal("embedded_attempt", options.Metadata["flow"]);
        Assert.Equal("42", options.Metadata["attempt_id"]);
        Assert.Equal("7", options.Metadata["event_id"]);
        Assert.Equal(method, options.Metadata["payment_method"]);
        Assert.Equal("payer@example.test", options.Metadata["contact_email"]);
        Assert.Equal("Payer", options.Metadata["contact_name"]);
        Assert.Equal("12345678", options.Metadata["contact_phone"]);
        Assert.Equal("embedded_attempt_test", client.RequestOptions?.IdempotencyKey);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.Equal("pi_test", result.PaymentReference);
        Assert.Equal("pi_test_secret", result.ClientToken);
    }

    [Fact]
    public async Task Create_preserves_empty_contact_metadata()
    {
        var client = new RecordingStripeClient();
        var gateway = CreateGateway(client);
        await gateway.CreateCheckoutAsync(new GatewayCheckoutRequest(10m, "SGD", "CreditCard", 1, 2, null, null, null, "key"));
        var options = Assert.IsType<PaymentIntentCreateOptions>(client.Options);
        Assert.Null(options.ReceiptEmail);
        Assert.Equal("", options.Metadata["contact_email"]);
        Assert.Equal("", options.Metadata["contact_name"]);
        Assert.Equal("", options.Metadata["contact_phone"]);
    }

    [Fact]
    public async Task Retrieval_reuses_existing_payment_without_creating_another()
    {
        var client = new RecordingStripeClient();
        var gateway = CreateGateway(client);
        using var cancellation = new CancellationTokenSource();
        var result = await gateway.GetCheckoutAsync("pi_test", cancellation.Token);

        Assert.Equal(1, client.RequestCount);
        Assert.Equal(HttpMethod.Get, client.Method);
        Assert.Equal("/v1/payment_intents/pi_test", client.Path);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.Equal("pi_test_secret", result.ClientToken);
        Assert.Equal("pi_test", result.PaymentReference);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, true)]
    [InlineData(false, false)]
    [InlineData(true, false)]
    public async Task Provider_errors_preserve_existing_codes_and_messages(bool lookup, bool hasErrorDetails)
    {
        var original = new StripeException(System.Net.HttpStatusCode.BadRequest,
            hasErrorDetails ? new StripeError { Code = "resource_missing", Message = "Payment was not found." } : null,
            "Provider request failed.");
        var client = new RecordingStripeClient { Error = original };
        var gateway = CreateGateway(client);

        var error = await Assert.ThrowsAsync<PaymentGatewayException>(() => lookup
            ? gateway.GetCheckoutAsync("pi_test")
            : gateway.CreateCheckoutAsync(new GatewayCheckoutRequest(10m, "SGD", "CreditCard", 1, 2, null, null, null, "key")));

        Assert.Equal(hasErrorDetails ? "resource_missing" : "STRIPE_ERROR", error.Code);
        Assert.Equal(hasErrorDetails ? "Payment was not found." : original.Message, error.Message);
        Assert.Same(original, error.InnerException);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Cancellation_is_not_translated_into_payment_failure(bool lookup)
    {
        var client = new RecordingStripeClient();
        var gateway = CreateGateway(client);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => lookup
            ? gateway.GetCheckoutAsync("pi_test", cancellation.Token)
            : gateway.CreateCheckoutAsync(new GatewayCheckoutRequest(10m, "SGD", "CreditCard", 1, 2, null, null, null, "key"), cancellation.Token));
    }

    [Theory]
    [InlineData("requires_payment_method", GatewayPaymentState.AwaitingPaymentMethod)]
    [InlineData("requires_confirmation", GatewayPaymentState.AwaitingConfirmation)]
    [InlineData("requires_action", GatewayPaymentState.AwaitingAction)]
    [InlineData("requires_capture", GatewayPaymentState.AwaitingCapture)]
    [InlineData("processing", GatewayPaymentState.Processing)]
    [InlineData("succeeded", GatewayPaymentState.Succeeded)]
    [InlineData("canceled", GatewayPaymentState.Canceled)]
    [InlineData("future_provider_state", GatewayPaymentState.Unknown)]
    [InlineData(null, GatewayPaymentState.Unknown)]
    public void Normalization_preserves_distinct_recovery_states(string? status, GatewayPaymentState expected)
    {
        var payment = StripePaymentGateway.NormalizePayment(new PaymentIntent { Id = "pi_test", Status = status });
        Assert.Equal(expected, payment.State);
    }

    [Theory]
    [InlineData(10000, 10000, "42", 42, 100)]
    [InlineData(10000, 0, "42", 42, 100)]
    [InlineData(10000, 7500, "invalid", null, 75)]
    [InlineData(10000, 10000, null, null, 100)]
    public void Normalization_preserves_amount_identity_and_reconciliation_payload(
        long amount, long received, string? attemptId, int? expectedAttemptId, decimal effectiveAmount)
    {
        var intent = new PaymentIntent
        {
            Id = "pi_test",
            Amount = amount,
            AmountReceived = received,
            Currency = "sgd",
            Status = "succeeded",
            LastPaymentError = new StripeError { Message = "Earlier decline" },
            Metadata = new Dictionary<string, string>
            {
                ["contact_name"] = "Test payer",
                ["contact_email"] = "payer@example.test",
                ["contact_phone"] = "12345678",
            },
        };
        if (attemptId != null) intent.Metadata["attempt_id"] = attemptId;

        var payment = StripePaymentGateway.NormalizePayment(intent);
        Assert.Equal("pi_test", payment.PaymentReference);
        Assert.Equal(expectedAttemptId, payment.AttemptId);
        Assert.Equal(amount / 100m, payment.Amount);
        Assert.Equal(received / 100m, payment.AmountReceived);
        Assert.Equal(effectiveAmount, payment.EffectiveAmount);
        Assert.Equal("SGD", payment.Currency);
        Assert.Equal("Test payer", payment.ContactName);
        Assert.Equal("payer@example.test", payment.ContactEmail);
        Assert.Equal("12345678", payment.ContactPhone);
        Assert.Equal("Earlier decline", payment.FailureMessage);
        // Existing reconciliation consumers must still see the Stripe payload, not the new DTO.
        Assert.Equal(JsonSerializer.Serialize(intent), payment.ProviderPayloadJson);
    }

    [Fact]
    public void Missing_metadata_and_currency_are_not_invented()
    {
        var payment = StripePaymentGateway.NormalizePayment(new PaymentIntent { Id = "pi_test", Metadata = null });
        Assert.Null(payment.AttemptId);
        Assert.Null(payment.Currency);
        Assert.Null(payment.ContactName);
        Assert.Null(payment.ContactEmail);
        Assert.Null(payment.ContactPhone);
        Assert.Null(payment.FailureMessage);
    }

    [Fact]
    public async Task Lookup_returns_normalized_verified_provider_data()
    {
        var client = new RecordingStripeClient
        {
            Response = new PaymentIntent { Id = "pi_test", Status = "processing", Amount = 12345, Currency = "sgd" },
        };
        var gateway = CreateGateway(client);
        using var cancellation = new CancellationTokenSource();
        var payment = await gateway.GetPaymentAsync("pi_test", cancellation.Token);
        Assert.Equal(HttpMethod.Get, client.Method);
        Assert.Equal("/v1/payment_intents/pi_test", client.Path);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.Equal(GatewayPaymentState.Processing, payment.State);
        Assert.Equal(123.45m, payment.Amount);
    }

    [Fact]
    public async Task Cancel_targets_original_payment_and_forwards_cancellation_token()
    {
        var client = new RecordingStripeClient();
        var gateway = CreateGateway(client);
        using var cancellation = new CancellationTokenSource();
        await gateway.CancelPaymentAsync("pi_test", cancellation.Token);
        Assert.Equal(HttpMethod.Post, client.Method);
        Assert.Equal("/v1/payment_intents/pi_test/cancel", client.Path);
        Assert.Equal(1, client.RequestCount);
        Assert.Equal(cancellation.Token, client.CancellationToken);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Recovery_provider_errors_remain_errors_not_unpaid_results(bool cancel)
    {
        var original = new StripeException(System.Net.HttpStatusCode.BadRequest,
            new StripeError { Code = "payment_intent_unexpected_state", Message = "Cannot cancel this payment." }, "Request failed");
        var gateway = CreateGateway(new RecordingStripeClient { Error = original });
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(async () =>
        {
            if (cancel) await gateway.CancelPaymentAsync("pi_test");
            else await gateway.GetPaymentAsync("pi_test");
        });
        Assert.Equal("payment_intent_unexpected_state", error.Code);
        Assert.Same(original, error.InnerException);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Recovery_request_cancellation_is_not_a_provider_failure(bool cancel)
    {
        var gateway = CreateGateway(new RecordingStripeClient());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            if (cancel) await gateway.CancelPaymentAsync("pi_test", cancellation.Token);
            else await gateway.GetPaymentAsync("pi_test", cancellation.Token);
        });
    }

    [Theory]
    [InlineData("succeeded", "S", true)]
    [InlineData("pending", "P", false)]
    [InlineData("requires_action", "P", false)]
    [InlineData("failed", "F", true)]
    [InlineData("canceled", "F", true)]
    [InlineData("future_status", "P", false)]
    [InlineData(null, "P", false)]
    public async Task Refund_preserves_request_and_maps_provider_outcome(string? status, string expected, bool terminal)
    {
        var client = new RecordingStripeClient { Response = new Refund { Id = "re_test", Status = status } };
        using var cancellation = new CancellationTokenSource();
        var metadata = new Dictionary<string, string> { ["registration_id"] = "1336", ["payment_item_id"] = "1374" };
        var result = await CreateGateway(client).CreateRefundAsync(
            new GatewayRefundRequest("pi_original", 12.34m, metadata, "trs_refund_190"), cancellation.Token);
        Assert.Equal("/v1/refunds", client.Path);
        Assert.Equal(HttpMethod.Post, client.Method);
        var options = Assert.IsType<RefundCreateOptions>(client.Options);
        Assert.Equal("pi_original", options.PaymentIntent);
        Assert.Equal(1234L, options.Amount);
        Assert.Equal("requested_by_customer", options.Reason);
        Assert.Equal(metadata, options.Metadata);
        Assert.Equal("trs_refund_190", client.RequestOptions!.IdempotencyKey);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.Equal("re_test", result.RefundReference);
        Assert.Equal(expected, result.RefundStatus);
        Assert.Equal(terminal, result.IsTerminal);
        Assert.Equal(1, client.RequestCount);
    }

    [Fact]
    public async Task Orphan_refund_preserves_distinct_metadata_and_idempotency()
    {
        var client = new RecordingStripeClient { Response = new Refund { Id = "re_test", Status = "pending" } };
        var metadata = new Dictionary<string, string> { ["webhook_log_id"] = "10", ["admin_note"] = "Reviewed" };
        await CreateGateway(client).CreateRefundAsync(new GatewayRefundRequest("pi_original", 100m, metadata, "orphan_refund_cs_original"));
        var options = Assert.IsType<RefundCreateOptions>(client.Options);
        Assert.Equal(10000L, options.Amount);
        Assert.Equal(metadata, options.Metadata);
        Assert.Equal("orphan_refund_cs_original", client.RequestOptions!.IdempotencyKey);
    }

    [Theory]
    [InlineData("succeeded", 1200, 12)]
    [InlineData("succeeded", 0, 20)]
    [InlineData("processing", 0, 20)]
    [InlineData("canceled", 0, 20)]
    public async Task Reconciliation_embedded_lookup_preserves_paid_check_and_amount_fallback(string status, long received, decimal expected)
    {
        var client = new RecordingStripeClient
        {
            Response = new PaymentIntent { Id = "pi_original", Status = status, Amount = 2000, AmountReceived = received },
        };
        using var cancellation = new CancellationTokenSource();
        var result = await CreateGateway(client).GetRefundPaymentAsync("pi_original", cancellation.Token);
        Assert.Equal("/v1/payment_intents/pi_original", client.Path);
        Assert.Equal(HttpMethod.Get, client.Method);
        Assert.Equal(cancellation.Token, client.CancellationToken);
        Assert.Equal("pi_original", result.PaymentReference);
        Assert.Equal(expected, result.Amount);
        if (status == "succeeded") Assert.Null(result.ValidationError);
        else Assert.Equal($"PaymentIntent status is '{status}' - only 'succeeded' intents can be refunded here.", result.ValidationError);
    }

    [Theory]
    [InlineData(1234L, 12.34)]
    [InlineData(null, 0)]
    public async Task Reconciliation_hosted_lookup_preserves_reference_and_missing_amount(long? amount, decimal expected)
    {
        var client = new RecordingStripeClient
        {
            Response = new Stripe.Checkout.Session { Id = "cs_original", PaymentIntentId = "pi_original", AmountTotal = amount },
        };
        using var cancellation = new CancellationTokenSource();
        var result = await CreateGateway(client).GetRefundPaymentAsync("cs_original", cancellation.Token);
        Assert.Equal("/v1/checkout/sessions/cs_original", client.Path);
        Assert.Equal("pi_original", result.PaymentReference);
        Assert.Equal(expected, result.Amount);
        Assert.Null(result.ValidationError);
        Assert.Equal(cancellation.Token, client.CancellationToken);
    }

    [Theory]
    [InlineData("refund")]
    [InlineData("pi_original")]
    [InlineData("cs_original")]
    public async Task Refund_and_reconciliation_preserve_provider_error_details(string operation)
    {
        var original = new StripeException(System.Net.HttpStatusCode.BadRequest,
            new StripeError { Code = "resource_missing", Message = "Original provider message" }, "Request failed");
        var gateway = CreateGateway(new RecordingStripeClient { Error = original });
        var error = await Assert.ThrowsAsync<PaymentGatewayException>(async () =>
        {
            if (operation == "refund") await gateway.CreateRefundAsync(new GatewayRefundRequest("pi_original", 10m, new(), "retry_key"));
            else await gateway.GetRefundPaymentAsync(operation);
        });
        Assert.Equal("resource_missing", error.ProviderErrorCode);
        Assert.Equal("Original provider message", error.ProviderErrorMessage);
        Assert.Same(original, error.InnerException);
    }

    [Theory]
    [InlineData("refund")]
    [InlineData("pi_original")]
    [InlineData("cs_original")]
    public async Task Refund_and_reconciliation_cancellation_remains_cancellation(string operation)
    {
        var gateway = CreateGateway(new RecordingStripeClient());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            if (operation == "refund") await gateway.CreateRefundAsync(new GatewayRefundRequest("pi_original", 10m, new(), "retry_key"), cancellation.Token);
            else await gateway.GetRefundPaymentAsync(operation, cancellation.Token);
        });
    }

    private static StripePaymentGateway CreateGateway(IStripeClient client) =>
        new(new PaymentIntentService(client), new RefundService(client), new Stripe.Checkout.SessionService(client),
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());

    private sealed class RecordingStripeClient : IStripeClient
    {
        public string ApiBase => "https://api.stripe.test";
        public string ApiKey => "sk_test_gateway_unit";
        public string ClientId => "ca_test";
        public string ConnectBase => "https://connect.stripe.test";
        public string FilesBase => "https://files.stripe.test";
        public string MeterEventsBase => "https://meter-events.stripe.test";
        public HttpMethod? Method { get; private set; }
        public string? Path { get; private set; }
        public BaseOptions? Options { get; private set; }
        public RequestOptions? RequestOptions { get; private set; }
        public CancellationToken CancellationToken { get; private set; }
        public int RequestCount { get; private set; }
        public Exception? Error { get; init; }
        public IStripeEntity Response { get; init; } = new PaymentIntent { Id = "pi_test", ClientSecret = "pi_test_secret" };

        public Task<T> RequestAsync<T>(HttpMethod method, string path, BaseOptions options,
            RequestOptions requestOptions, CancellationToken cancellationToken = default) where T : IStripeEntity
        {
            cancellationToken.ThrowIfCancellationRequested();
            Method = method;
            Path = path;
            Options = options;
            RequestOptions = requestOptions;
            CancellationToken = cancellationToken;
            RequestCount++;
            if (Error != null) throw Error;
            Assert.IsType<T>(Response);
            return Task.FromResult((T)(object)Response);
        }

        public Task<Stream> RequestStreamingAsync(HttpMethod method, string path, BaseOptions options,
            RequestOptions requestOptions, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
