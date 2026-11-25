using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using TRS_API.Services;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace TRS.Tests;

public sealed class TlsIntegrationCredentialTests
{
    [Theory]
    [InlineData("superadmin", true, false, true)]
    [InlineData("eventadmin", true, false, true)]
    [InlineData("viewer", true, false, false)]
    [InlineData("superadmin", false, false, false)]
    [InlineData("", false, true, true)]
    [InlineData("", false, false, false)]
    public void Export_accepts_an_authenticated_admin_or_the_shared_key(string role, bool authenticated, bool withKey, bool allowed)
    {
        var key = new string('k', 40);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["TlsIntegration:ApiKey"] = key }).Build();
        using var services = new ServiceCollection().AddSingleton<IConfiguration>(configuration).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services, User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], authenticated ? "test" : null)) };
        if (withKey) http.Request.Headers["X-TLS-Key"] = key;
        var context = new AuthorizationFilterContext(new ActionContext(http, new RouteData(), new ActionDescriptor()), []);
        new TlsExportAccessAttribute().OnAuthorization(context);
        if (allowed) Assert.Null(context.Result);
        else Assert.IsType<UnauthorizedObjectResult>(context.Result);
    }

    [Theory]
    [InlineData(null, "", false)]
    [InlineData("short", "short", false)]
    [InlineData("01234567890123456789012345678901", "", false)]
    [InlineData("01234567890123456789012345678901", "wrong", false)]
    [InlineData("01234567890123456789012345678901", "01234567890123456789012345678901", true)]
    public void Requires_a_configured_matching_shared_key(string? expected, string supplied, bool valid)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["TlsIntegration:ApiKey"] = expected }).Build();
        var context = new DefaultHttpContext();
        context.Request.Headers["X-TLS-Key"] = supplied;
        Assert.Equal(valid, TlsIntegrationCredential.Matches(configuration, context.Request));
    }
}
