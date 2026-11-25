using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[EnableRateLimiting("public-scores")]
[ApiController, Route("api/events")]
public sealed class PublicScoresController(TRSDbContext db) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [HttpGet("live-status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await db.TlsLiveSnapshots.AsNoTracking().Where(s => s.MatchCount > 0 && db.Events.Any(e => e.EventId == s.EventId && e.IsActive))
            .Select(s => new { s.EventId, s.ReceivedAt }).ToListAsync(ct));
    }

    [HttpGet("{eventId:int}/score-availability")]
    public async Task<IActionResult> Availability(int eventId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        if (!await db.Events.AnyAsync(e => e.EventId == eventId && e.IsActive, ct)) return NotFound();
        var (results, _, _) = await ReadResultsAsync(eventId, ct);
        var available = results is null ? [] : results.Matches.Select(m => m.ProgramId)
            .Concat(results.Heats.Select(h => h.ProgramId)).Distinct().ToArray();
        var live = await db.TlsLiveSnapshots.AsNoTracking().SingleOrDefaultAsync(s => s.EventId == eventId, ct);
        var interval = live is null ? 5 : JsonSerializer.Deserialize<ScoreSnapshot>(live.PayloadJson, Json)!.RefreshSeconds;
        return Ok(new { hasLiveScores = live?.MatchCount > 0, hasResults = available.Length > 0, resultProgramIds = available, refreshSeconds = interval });
    }

    [HttpGet("{eventId:int}/live")]
    public async Task<IActionResult> Live(int eventId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var ev = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventId == eventId && e.IsActive, ct);
        if (ev is null) return NotFound();
        var row = await db.TlsLiveSnapshots.AsNoTracking().SingleOrDefaultAsync(s => s.EventId == eventId, ct);
        var snapshot = row is null ? new ScoreSnapshot { EventId = eventId, EventName = ev.Name } : JsonSerializer.Deserialize<ScoreSnapshot>(row.PayloadJson, Json)!;
        return Ok(new { eventId, eventName = ev.Name, receivedAt = row?.ReceivedAt, snapshot.RefreshSeconds, snapshot.TimeZone, snapshot.GeneratedAt, snapshot.Matches });
    }

    [HttpGet("{eventId:int}/results")]
    public async Task<IActionResult> Results(int eventId, [FromQuery] int? programId, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var ev = await db.Events.AsNoTracking().SingleOrDefaultAsync(e => e.EventId == eventId && e.IsActive, ct);
        if (ev is null) return NotFound();
        var (snapshot, source, receivedAt) = await ReadResultsAsync(eventId, ct);
        var programs = snapshot?.Programs ?? [];
        if (programId.HasValue && programs.All(p => p.Id != programId)) return NotFound();
        return Ok(new
        {
            eventId, eventName = ev.Name, programs, programId, source, receivedAt,
            generatedAt = snapshot?.GeneratedAt,
            timeZone = snapshot?.TimeZone ?? "Asia/Singapore",
            matches = snapshot?.Matches.Where(m => !programId.HasValue || m.ProgramId == programId).ToArray() ?? [],
            heats = snapshot?.Heats.Where(h => !programId.HasValue || h.ProgramId == programId).ToArray() ?? []
        });
    }

    private async Task<(ScoreSnapshot? Snapshot, string Source, DateTimeOffset? ReceivedAt)> ReadResultsAsync(int eventId, CancellationToken ct)
    {
        var row = await db.EventResultSnapshots.AsNoTracking().SingleOrDefaultAsync(r => r.EventId == eventId, ct);
        if (row is not null) return (EventResultSnapshots.Read(row), row.Source, row.ReceivedAt);

        // Compatibility for events that already had results before event-level snapshots were introduced.
        var legacy = await EventResultSnapshots.BuildManualAsync(db, eventId, ct);
        if (legacy is null) return (null, "", null);
        var legacyPrograms = legacy.Programs!.Select(p => p.Id).ToArray();
        var manualPrograms = legacy.Matches.Select(m => m.ProgramId).Concat(legacy.Heats.Select(h => h.ProgramId)).ToHashSet();
        var oldRows = await db.TlsResultSnapshots.AsNoTracking()
            .Where(r => r.EventId == eventId && legacyPrograms.Contains(r.ProgramId)).ToListAsync(ct);
        DateTimeOffset? lastReceived = null;
        foreach (var old in oldRows.Where(r => !manualPrograms.Contains(r.ProgramId)))
        {
            var oldSnapshot = JsonSerializer.Deserialize<ScoreSnapshot>(old.PayloadJson, Json)!;
            legacy.Matches.AddRange(oldSnapshot.Matches);
            if (lastReceived is null || old.ReceivedAt > lastReceived) lastReceived = old.ReceivedAt;
        }
        return (legacy, manualPrograms.Count > 0 ? EventResultSnapshots.Trs : lastReceived.HasValue ? EventResultSnapshots.Tls : "", lastReceived);
    }
}
