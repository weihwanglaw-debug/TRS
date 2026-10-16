using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using TRS_API.Controllers;
using TRS_API.Models;
using TRS_API.Services.Payments;
using TRS_Data.Models;

namespace TRS.Tests;

public class PaymentGatewayConfigurationTests
{
    [Theory]
    [InlineData("stripe")]
    [InlineData("Stripe")]
    [InlineData(" STRIPE ")]
    public void Original_provider_resolution_handles_legacy_casing(string code)
    {
        var stripe = new TestGateway("Stripe");
        var resolver = new PaymentGatewayResolver(new[] { stripe, new TestGateway("Third") });
        Assert.Same(stripe, resolver.Resolve(code));
    }

    [Fact]
    public void Disabling_new_payments_does_not_disable_existing_provider_operations()
    {
        var stripe = new TestGateway("Stripe", "Credentials unavailable for new payments.");
        var resolver = new PaymentGatewayResolver(new[] { stripe, new TestGateway("Third") });
        var option = PaymentGatewayConfigurationService.Describe(new PaymentGateway
            { Code = "Stripe", DisplayName = "Stripe", EnabledForNewPayments = false }, stripe);
        Assert.False(option.Selectable);
        Assert.Same(stripe, resolver.Resolve("Stripe"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Fiuu")]
    [InlineData("Unknown")]
    public void Unknown_original_provider_never_falls_back_to_stripe(string? code)
    {
        var error = Assert.Throws<PaymentGatewayException>(() => new PaymentGatewayResolver(new[] { new TestGateway("Stripe") }).Resolve(code));
        Assert.Equal("UNSUPPORTED_GATEWAY", error.Code);
    }

    [Theory]
    [InlineData(false, false, null, false)]
    [InlineData(true, false, null, false)]
    [InlineData(false, true, null, false)]
    [InlineData(true, true, "Not configured", false)]
    [InlineData(true, true, null, true)]
    public void Selection_requires_enabled_implemented_configured_gateway(bool enabled, bool implemented, string? reason, bool selectable)
    {
        var option = PaymentGatewayConfigurationService.Describe(new PaymentGateway
            { Code = "Third", DisplayName = "Third", EnabledForNewPayments = enabled },
            implemented ? new TestGateway("Third", reason) : null);
        Assert.Equal(selectable, option.Selectable);
        Assert.Equal(selectable, option.UnavailableReason == null);
    }

    [Theory]
    [InlineData("activePaymentGateway")]
    [InlineData("ACTIVEPAYMENTGATEWAY")]
    [InlineData(" activePaymentGateway ")]
    public async Task General_config_rejects_gateway_updates_before_any_database_write(string key)
    {
        var controller = new ConfigController(null!);
        var result = await controller.Update(new UpdateConfigRequest
        {
            Updates = new Dictionary<string, string> { ["appName"] = "Unchanged", [key] = "Fiuu" },
        });
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Gateway_endpoint_requires_superadmin_for_both_read_and_update()
    {
        var authorization = typeof(PaymentGatewayConfigController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal("superadmin", authorization!.Roles);
        Assert.DoesNotContain(typeof(PaymentGatewayConfigController).GetMethods(),
            m => m.GetCustomAttribute<AllowAnonymousAttribute>() != null);
        Assert.Equal("superadmin", typeof(ConfigController).GetMethod("Update")!.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }

    [Theory]
    [InlineData("eventadmin")]
    [InlineData("")]
    public async Task Configuration_service_rejects_non_superadmin_before_database_access(string role)
    {
        var service = new PaymentGatewayConfigurationService(null!, null!, null!);
        var user = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role) }, "test"));
        var error = await Assert.ThrowsAsync<GatewayConfigurationException>(() =>
            service.ChangeAsync(new ChangePaymentGatewayRequest("Stripe", "version"), user, null));
        Assert.Equal(403, error.Status);
    }

    [Theory]
    [InlineData("sk_test_example", "pk_test_example", "whsec_example", true)]
    [InlineData("sk_live_example", "pk_live_example", "whsec_example", true)]
    [InlineData("sk_live_example", "pk_test_example", "whsec_example", false)]
    [InlineData("", "pk_test_example", "whsec_example", false)]
    [InlineData("sk_test_example", "pk_test_example", "", false)]
    public void Stripe_readiness_is_local_and_never_exposes_credentials(string secret, string publishable, string webhook, bool ready)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Stripe:SecretKey"] = secret, ["Stripe:PublishableKey"] = publishable, ["Stripe:WebhookSecret"] = webhook }).Build();
        var stripe = new StripePaymentGateway(null!, null!, null!, config);
        var option = PaymentGatewayConfigurationService.Describe(new PaymentGateway
            { Code = "Stripe", DisplayName = "Stripe", EnabledForNewPayments = true }, stripe);
        Assert.Equal(ready, option.Selectable);
        var json = JsonSerializer.Serialize(option);
        Assert.DoesNotContain("sk_", json);
        Assert.DoesNotContain("pk_", json);
        Assert.DoesNotContain("whsec_", json);
    }

    private sealed class TestGateway(string code, string? unavailable = null) : IPaymentGateway
    {
        public string Code => code;
        public string? NewCheckoutUnavailableReason => unavailable;
        public Task<GatewayCheckout> CreateCheckoutAsync(GatewayCheckoutRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<GatewayCheckout> GetCheckoutAsync(string reference, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<GatewayPayment> GetPaymentAsync(string reference, CancellationToken ct = default) => throw new NotSupportedException();
        public Task CancelPaymentAsync(string reference, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<GatewayRefund> CreateRefundAsync(GatewayRefundRequest request, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<GatewayRefundPayment> GetRefundPaymentAsync(string reference, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
