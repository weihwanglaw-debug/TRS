using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TRS_API.Models;
using TRS_API.Services;

namespace TRS_API.Controllers;

[ApiController]
[Authorize(Roles = "superadmin,eventadmin")]
[Route("api/events/{eventId:int}/programs/{programId:int}/import")]
public class ProgramImportController : ControllerBase
{
    private readonly ProgramImportService _importService;

    public ProgramImportController(ProgramImportService importService)
    {
        _importService = importService;
    }

    [HttpPost("preview")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<IActionResult> Preview(
        int eventId,
        int programId,
        [FromForm] IFormFile? file,
        CancellationToken ct)
    {
        if (file == null)
            return BadRequest(new { code = "FILE_REQUIRED", message = "Import template file is required." });

        var result = await _importService.PreviewAsync(eventId, programId, file, User, ct);
        return Ok(result);
    }

    [HttpPost("confirm")]
    public async Task<IActionResult> Confirm(
        int eventId,
        int programId,
        [FromBody] ProgramImportConfirmRequest req,
        CancellationToken ct)
    {
        var result = await _importService.ConfirmAsync(eventId, programId, req, ct);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        return Ok(result.Value);
    }
}
