using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TRS_API.Services;

public static class TlsIntegrationCredential
{
    public static bool Matches(IConfiguration configuration, HttpRequest request)
    {
        var expected = configuration["TlsIntegration:ApiKey"];
        var supplied = request.Headers["X-TLS-Key"].ToString();
        return expected is { Length: >= 32 and <= 512 } && supplied.Length <= 512
            && CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)), SHA256.HashData(Encoding.UTF8.GetBytes(supplied)));
    }
}

public sealed class TlsExportAccessAttribute : Attribute, IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated == true && (http.User.IsInRole("superadmin") || http.User.IsInRole("eventadmin"))) return;
        if (!TlsIntegrationCredential.Matches(http.RequestServices.GetRequiredService<IConfiguration>(), http.Request))
            context.Result = new UnauthorizedObjectResult(new { message = "Invalid integration credential." });
    }
}

public sealed class TlsReceiveAccessAttribute : Attribute, IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (!TlsIntegrationCredential.Matches(http.RequestServices.GetRequiredService<IConfiguration>(), http.Request))
            context.Result = new UnauthorizedObjectResult(new { message = "Invalid integration credential." });
    }
}
