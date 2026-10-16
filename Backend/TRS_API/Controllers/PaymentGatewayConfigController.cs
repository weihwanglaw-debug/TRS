using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TRS_API.Services.Payments;

namespace TRS_API.Controllers;

[ApiController, Route("api/admin/payment-gateway-config")]
[Authorize(Roles = "superadmin")]
public sealed class PaymentGatewayConfigController(PaymentGatewayConfigurationService configuration) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        try { return Ok(await configuration.GetAsync(ct)); }
        catch (GatewayConfigurationException ex) { return StatusCode(ex.Status, new { code = ex.Code, message = ex.Message }); }
    }

    [HttpPut]
    public async Task<IActionResult> Update(ChangePaymentGatewayRequest request, CancellationToken ct)
    {
        try { return Ok(await configuration.ChangeAsync(request, User, HttpContext.Connection.RemoteIpAddress?.ToString(), ct)); }
        catch (GatewayConfigurationException ex) { return StatusCode(ex.Status, new { code = ex.Code, message = ex.Message }); }
    }
}
