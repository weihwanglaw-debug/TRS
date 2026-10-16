using System.Data;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using TRS_Data.Models;

namespace TRS_API.Services.Payments;

public sealed record PaymentGatewayOption(string Code, string DisplayName, bool Selectable, string? UnavailableReason);
public sealed record PaymentGatewayConfiguration(string ActiveGateway, string Version, IReadOnlyList<PaymentGatewayOption> Gateways);
public sealed record ChangePaymentGatewayRequest(string GatewayCode, string ExpectedVersion);

public sealed class GatewayConfigurationException(string code, string message, int status = 400) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}

public sealed class PaymentGatewayConfigurationService(
    TRSDbContext db, PaymentGatewayResolver resolver, AdminAuditService audit)
{
    public const string ActiveKey = "activePaymentGateway";

    public static bool IsProtectedKey(string key) =>
        key.Trim().Equals(ActiveKey, StringComparison.OrdinalIgnoreCase);

    public static PaymentGatewayOption Describe(PaymentGateway row, IPaymentGateway? adapter)
    {
        var reason = adapter == null ? "Integration is not available yet."
            : !row.EnabledForNewPayments ? "Not enabled for new payments."
            : adapter.NewCheckoutUnavailableReason;
        return new(row.Code, row.DisplayName, reason == null, reason);
    }

    public async Task<PaymentGatewayConfiguration> GetAsync(CancellationToken ct = default)
    {
        var setting = await db.SystemConfigs.AsNoTracking().SingleOrDefaultAsync(s => s.ConfigKey == ActiveKey, ct)
            ?? throw new GatewayConfigurationException("GATEWAY_SETUP_REQUIRED", "The payment gateway database setup has not been completed.", 503);
        var catalog = await db.PaymentGateways.AsNoTracking().OrderBy(g => g.DisplayName).ToListAsync(ct);
        return new(setting.ConfigValue, setting.UpdatedAt.ToString("O"),
            catalog.Select(g => Describe(g, resolver.Find(g.Code))).ToList());
    }

    public async Task<object> GetPaymentMethodsAsync(string currency, CancellationToken ct = default)
    {
        var gateway = await GetActiveAsync(ct);
        return new { paymentGateway = gateway.Code, methods = gateway.GetSupportedPaymentMethods(currency) };
    }

    public async Task<IPaymentGateway> GetActiveAsync(CancellationToken ct = default)
    {
        var setting = await GetAsync(ct);
        var option = setting.Gateways.SingleOrDefault(g => g.Code.Equals(setting.ActiveGateway, StringComparison.OrdinalIgnoreCase));
        if (option == null || !option.Selectable)
            throw new GatewayConfigurationException("GATEWAY_UNAVAILABLE", option?.UnavailableReason ?? "The selected gateway is not available.", 503);
        return resolver.Resolve(option.Code);
    }

    public async Task<PaymentGatewayConfiguration> ChangeAsync(ChangePaymentGatewayRequest request,
        ClaimsPrincipal user, string? ipAddress, CancellationToken ct = default)
    {
        if (!user.IsInRole("superadmin"))
            throw new GatewayConfigurationException("FORBIDDEN", "Only superadmin can change the payment gateway.", 403);
        if (string.IsNullOrWhiteSpace(request.GatewayCode) || string.IsNullOrWhiteSpace(request.ExpectedVersion))
            throw new GatewayConfigurationException("INVALID_GATEWAY_REQUEST", "Gateway and configuration version are required.");

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var setting = await db.SystemConfigs
            .FromSqlInterpolated($"SELECT * FROM SystemConfig WITH (UPDLOCK, HOLDLOCK) WHERE ConfigKey = {ActiveKey}")
            .SingleOrDefaultAsync(ct)
            ?? throw new GatewayConfigurationException("GATEWAY_SETUP_REQUIRED", "The payment gateway database setup has not been completed.", 503);
        if (setting.UpdatedAt.ToString("O") != request.ExpectedVersion)
            throw new GatewayConfigurationException("CONFIG_CHANGED", "The gateway setting changed. Reload it before saving.", 409);
        var code = request.GatewayCode.Trim();
        var catalog = await db.PaymentGateways.AsNoTracking().ToListAsync(ct);
        var row = catalog.SingleOrDefault(g => g.Code.Equals(code, StringComparison.OrdinalIgnoreCase))
            ?? throw new GatewayConfigurationException("UNKNOWN_GATEWAY", "Unknown payment gateway.");
        var option = Describe(row, resolver.Find(row.Code));
        if (!option.Selectable)
            throw new GatewayConfigurationException("GATEWAY_UNAVAILABLE", option.UnavailableReason!);
        if (setting.ConfigValue != row.Code)
        {
            var oldValue = setting.ConfigValue;
            setting.ConfigValue = row.Code;
            // Match the seeded datetime2(7) column and invalidate every successful change.
            setting.UpdatedAt = DateTime.SpecifyKind(new DateTime(Math.Max(DateTime.UtcNow.Ticks, setting.UpdatedAt.Ticks + 1)), DateTimeKind.Unspecified);
            setting.UpdatedBy = user.Identity?.Name;
            await audit.LogAsync(user, ipAddress, "PaymentGatewayChanged", "SystemConfig", ActiveKey,
                new { activePaymentGateway = oldValue }, new { activePaymentGateway = row.Code });
        }
        await tx.CommitAsync(ct);
        return await GetAsync(ct);
    }
}
