using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/events")]
public sealed class PublicScoresController(TRSDbContext db) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [HttpGet("live-status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await db.TlsLiveSnapshots.AsNoTracking().Where(s => s.MatchCount > 0 && db.Events.Any(e => e.EventId == s.EventId && e.IsActive && e.IsSports))
            .Select(s => new { s.EventId, s.ReceivedAt }).ToListAsync(ct));
    }

    [HttpGet("{eventId:int}/score-availability")]
    public async Task<IActionResult> Availability(int eventId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await db.Events.AnyAsync(e => e.EventId == eventId && e.IsActive && e.IsSports, ct)) return NotFound();
        var programIds = await db.Programs.AsNoTracking().Where(p => p.EventId == eventId && p.IsActive).Select(p => p.ProgramId).ToListAsync(ct);
        var fixtures = await db.Fixtures.AsNoTracking().Where(f => f.EventId == eventId && programIds.Contains(f.ProgramId)).ToListAsync(ct);
        var snapshots = await db.TlsResultSnapshots.AsNoTracking().Where(s => s.EventId == eventId && programIds.Contains(s.ProgramId)).ToListAsync(ct);
        var available = programIds.Where(id => PublicResults.HasTrsResults(PublicResults.ReadFixture(fixtures.FirstOrDefault(f => f.ProgramId == id)?.BracketStateJson))
            || snapshots.FirstOrDefault(s => s.ProgramId == id) is { } row && JsonSerializer.Deserialize<ScoreSnapshot>(row.PayloadJson, Json)!.Matches.Count > 0).ToArray();
        var live = await db.TlsLiveSnapshots.AsNoTracking().SingleOrDefaultAsync(s => s.EventId == eventId, ct);
        var interval = live is null ? 5 : JsonSerializer.Deserialize<ScoreSnapshot>(live.PayloadJson, Json)!.RefreshSeconds;
        return Ok(new { hasLiveScores = live?.MatchCount > 0, resultProgramIds = available, refreshSeconds = interval });
    }

    [HttpGet("{eventId:int}/live")]
    public async Task<IActionResult> Live(int eventId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var ev = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventId == eventId && e.IsActive && e.IsSports, ct);
        if (ev is null) return NotFound();
        var row = await db.TlsLiveSnapshots.AsNoTracking().SingleOrDefaultAsync(s => s.EventId == eventId, ct);
        var snapshot = row is null ? new ScoreSnapshot { EventId = eventId, EventName = ev.Name } : JsonSerializer.Deserialize<ScoreSnapshot>(row.PayloadJson, Json)!;
        return Ok(new { eventId, eventName = ev.Name, receivedAt = row?.ReceivedAt, snapshot.RefreshSeconds, snapshot.TimeZone, snapshot.Matches });
    }

    [HttpGet("{eventId:int}/results")]
    public async Task<IActionResult> Results(int eventId, [FromQuery] int? programId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var ev = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventId == eventId && e.IsActive && e.IsSports, ct);
        if (ev is null) return NotFound();
        var programs = await db.Programs.AsNoTracking().Where(p => p.EventId == eventId && p.IsActive).OrderBy(p => p.ProgramId).Select(p => new { id = p.ProgramId, p.Name }).ToListAsync(ct);
        var selected = programId.HasValue ? programs.SingleOrDefault(p => p.id == programId) : programs.FirstOrDefault();
        if (programId.HasValue && selected is null) return NotFound();
        string source = "", zone = "Asia/Singapore"; DateTimeOffset? receivedAt = null;
        List<PublicScoreMatch> matches = [];
        object[] heats = [];
        if (selected is not null)
        {
            var fixture = await db.Fixtures.AsNoTracking().FirstOrDefaultAsync(f => f.EventId == eventId && f.ProgramId == selected.id, ct);
            var state = PublicResults.ReadFixture(fixture?.BracketStateJson);
            if (PublicResults.HasTrsResults(state))
            {
                source = "TRS"; matches = PublicResults.Project(state!, selected.id, selected.Name);
                heats = state!.HeatRounds?.Where(r => r.IsComplete).Select(r => (object)new { r.Label, r.RoundNumber,
                    results = r.Results.Select(v => new { name = state.Seeds.FirstOrDefault(s => s.Id == v.TeamId)?.Participants is { Count: > 0 } players ? string.Join(" / ", players) : v.TeamId, v.Result, v.Place, v.Advanced }) }).ToArray() ?? [];
            }
            else
            {
                var row = await db.TlsResultSnapshots.AsNoTracking().SingleOrDefaultAsync(s => s.ProgramId == selected.id && s.EventId == eventId, ct);
                if (row is not null)
                {
                    var snapshot = JsonSerializer.Deserialize<ScoreSnapshot>(row.PayloadJson, Json)!;
                    source = "TLS"; matches = snapshot.Matches; zone = snapshot.TimeZone; receivedAt = row.ReceivedAt;
                }
            }
        }
        return Ok(new { eventId, eventName = ev.Name, programs, programId = selected?.id, source, timeZone = zone, receivedAt, matches, heats });
    }
}
