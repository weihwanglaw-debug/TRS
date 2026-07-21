using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/contact")]
public class ContactController : ControllerBase
{
    private readonly TRSDbContext _db;
    private readonly EmailService _email;
    private readonly ILogger<ContactController> _logger;

    public ContactController(TRSDbContext db, EmailService email, ILogger<ContactController> logger)
        => (_db, _email, _logger) = (db, email, logger);

    [EnableRateLimiting("payment")]
    [HttpPost("message")]
    public async Task<IActionResult> SendMessage([FromBody] LandingMessageRequest req, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(req.Website))
            return Ok(new { message = "Message sent." });

        if (!IsValidCaptcha(req))
        {
            return BadRequest(new
            {
                code = "CAPTCHA_FAILED",
                message = "Please answer the verification question correctly."
            });
        }

        try
        {
            await _email.SendLandingMessageAsync(_db, req.Name, req.Contact, req.Topic, req.Message, ct);
            return Ok(new { message = "Message sent." });
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Landing message could not be sent because email is not configured");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                code = "EMAIL_NOT_CONFIGURED",
                message = ex.Message
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Landing message send failed");
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                code = "EMAIL_SEND_FAILED",
                message = "Message could not be sent. Please try again later."
            });
        }
    }

    private static bool IsValidCaptcha(LandingMessageRequest req)
    {
        if (req.CaptchaA < 1 || req.CaptchaA > 20 || req.CaptchaB < 1 || req.CaptchaB > 20)
            return false;

        return req.CaptchaAnswer == req.CaptchaA + req.CaptchaB;
    }
}
