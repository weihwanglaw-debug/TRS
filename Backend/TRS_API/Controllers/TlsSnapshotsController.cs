using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[EnableRateLimiting("event-integration")]
[ApiController, Route("api/tls/events"), RequestSizeLimit(5_000_000), TlsReceiveAccess]
public sealed class TlsSnapshotsController(TRSDbContext db, IConfiguration configuration) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [HttpPut("{eventId:int}/live")]
    public Task<IActionResult> Live(int eventId, [FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(eventId, null, snapshot, true, ct);

    [HttpPut("{eventId:int}/programs/{programId:int}/results")]
    public Task<IActionResult> Results(int eventId, int programId, [FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(eventId, programId, snapshot, false, ct);

    [HttpPut("~/api/integration/live-scores")]
    public Task<IActionResult> ReceiveLive([FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(snapshot.EventId, null, snapshot, true, ct);

    [HttpPut("{eventId:int}/results")]
    public Task<IActionResult> EventResults(int eventId, [FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(eventId, null, snapshot, false, ct);

    [HttpPut("~/api/integration/event-results")]
    public Task<IActionResult> ReceiveEventResults([FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(snapshot.EventId, null, snapshot, false, ct);

    [HttpPut("~/api/integration/results")]
    public Task<IActionResult> ReceiveResults([FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(snapshot.EventId, snapshot.ProgramId, snapshot, false, ct);

    private async Task<IActionResult> Receive(int eventId, int? programId, ScoreSnapshot snapshot, bool live, CancellationToken ct)
    {
        if (!TlsIntegrationCredential.Matches(configuration, Request))
            return Unauthorized(new { message = "Invalid integration credential." });
        if (eventId <= 0 || programId is <= 0)
            return BadRequest(new { message = "Provide a positive event ID and a positive program ID when publishing program results." });
        var error = ScoreSnapshotRules.Validate(snapshot, eventId, programId, live);
        if (error is not null) return BadRequest(new { message = error });
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        if (!await db.Events.AnyAsync(e => e.EventId == eventId && e.IsActive, ct)) return NotFound();
        if (!live && programId is null)
        {
            var current = await EventResultSnapshots.LockAsync(db, eventId, ct);
            if (current?.Source == EventResultSnapshots.Trs || current is null &&
                await EventResultSnapshots.BuildManualAsync(db, eventId, ct) is { } manual && EventResultSnapshots.HasResults(manual))
                return Conflict(new { message = "This event publishes results from TRS manual entry." });

            var previousVersion = current?.Version ?? 0;
            if (snapshot.Version > previousVersion)
            {
                var activeProgramIds = await db.Programs.Where(p => p.EventId == eventId && p.IsActive)
                    .Select(p => p.ProgramId).ToArrayAsync(ct);
                var links = await db.TlsResultSnapshots.Where(r => r.EventId == eventId).ToDictionaryAsync(r => r.ProgramId, ct);
                if (EventResultSnapshots.ProgramsMatch(activeProgramIds, snapshot.Programs!))
                {
                    foreach (var program in snapshot.Programs!)
                    {
                        if (!links.Remove(program.Id, out var link))
                        {
                            link = new() { EventId = eventId, ProgramId = program.Id };
                            db.TlsResultSnapshots.Add(link);
                        }
                        link.Version = snapshot.Version;
                        link.ReceivedAt = DateTimeOffset.UtcNow;
                        link.PayloadJson = JsonSerializer.Serialize(new ScoreSnapshot
                        {
                            EventId = eventId, EventName = snapshot.EventName, ProgramId = program.Id, ProgramName = program.Name,
                            Version = snapshot.Version, GeneratedAt = snapshot.GeneratedAt, TimeZone = snapshot.TimeZone,
                            RefreshSeconds = snapshot.RefreshSeconds, Matches = snapshot.Matches.Where(m => m.ProgramId == program.Id).ToList()
                        }, Json);
                    }
                }
                db.TlsResultSnapshots.RemoveRange(links.Values);
                EventResultSnapshots.Save(db, current, snapshot, EventResultSnapshots.Tls);
                await db.SaveChangesAsync(ct);
            }
            await tx.CommitAsync(ct);
            return Ok(new { accepted = snapshot.Version > previousVersion, version = Math.Max(previousVersion, snapshot.Version) });
        }
        if (!live)
        {
            var current = await EventResultSnapshots.LockAsync(db, eventId, ct);
            if (current is not null)
                return Conflict(new { message = "Use event-level results for this event." });
            if (!await db.Programs.AnyAsync(p => p.ProgramId == programId && p.EventId == eventId && p.IsActive, ct))
                return BadRequest(new { message = "The program does not belong to this event or is inactive." });
        }
        long previous;
        var now = DateTimeOffset.UtcNow;
        if (live)
        {
            var row = await db.TlsLiveSnapshots.FromSqlInterpolated($"SELECT * FROM dbo.TlsLiveSnapshots WITH (UPDLOCK,HOLDLOCK) WHERE EventId={eventId}").SingleOrDefaultAsync(ct);
            previous = row?.Version ?? 0;
            if (snapshot.Version > previous)
            {
                if (row is null) { row = new() { EventId = eventId }; db.TlsLiveSnapshots.Add(row); }
                row.Version = snapshot.Version; row.PayloadJson = JsonSerializer.Serialize(snapshot, Json);
                row.MatchCount = snapshot.Matches.Count; row.ReceivedAt = now;
            }
        }
        else
        {
            var row = await db.TlsResultSnapshots.FromSqlInterpolated($"SELECT * FROM dbo.TlsResultSnapshots WITH (UPDLOCK,HOLDLOCK) WHERE ProgramId={programId!.Value}").SingleOrDefaultAsync(ct);
            previous = row?.Version ?? 0;
            if (snapshot.Version > previous)
            {
                if (row is null) { row = new() { EventId = eventId, ProgramId = programId.Value }; db.TlsResultSnapshots.Add(row); }
                row.Version = snapshot.Version; row.PayloadJson = JsonSerializer.Serialize(snapshot, Json); row.ReceivedAt = now;
            }
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Ok(new { accepted = snapshot.Version > previous, version = Math.Max(previous, snapshot.Version) });
    }
}
