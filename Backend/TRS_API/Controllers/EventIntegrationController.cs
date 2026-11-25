using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/events/{eventId:int}/integration"), Authorize(Roles = "superadmin,eventadmin")]
public sealed class EventIntegrationController(TRSDbContext db, AdminAuditService audit) : ControllerBase
{
    public sealed record ReadyRequest(bool Ready);

    [HttpGet]
    public async Task<IActionResult> Get(int eventId, CancellationToken ct)
    {
        var ev = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventId == eventId, ct);
        if (ev is null) return NotFound();
        return Ok(new { ready = ev.ReadyForEventIntegration, errors = await EventIntegrationRules.ValidateAsync(db, ev, ct) });
    }

    [HttpPut]
    public async Task<IActionResult> Set(int eventId, ReadyRequest request, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var ev = await db.Events.FromSqlInterpolated($"SELECT * FROM dbo.Events WITH (UPDLOCK,ROWLOCK) WHERE EventID={eventId}").SingleOrDefaultAsync(ct);
        if (ev is null) return NotFound();
        if (request.Ready)
        {
            var errors = await EventIntegrationRules.ValidateAsync(db, ev, ct);
            if (errors.Count > 0) return BadRequest(new { code = "EVENT_INTEGRATION_NOT_READY", message = "Resolve the listed issues before marking Ready for Event Integration.", errors });
        }
        var before = ev.ReadyForEventIntegration;
        ev.ReadyForEventIntegration = request.Ready;
        ev.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(User, HttpContext.Connection.RemoteIpAddress?.ToString(), "EVENT_INTEGRATION_READINESS", "Event", eventId.ToString(), new { ready = before }, new { ready = request.Ready }, "Changed event integration readiness.");
        await tx.CommitAsync(ct);
        return Ok(new { ready = request.Ready });
    }
}
