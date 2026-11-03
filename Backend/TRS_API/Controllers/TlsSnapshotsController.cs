using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/tls/events"), RequestSizeLimit(5_000_000)]
public sealed class TlsSnapshotsController(TRSDbContext db, IConfiguration configuration) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [HttpPut("{eventId:int}/live")]
    public Task<IActionResult> Live(int eventId, [FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(eventId, null, snapshot, true, ct);

    [HttpPut("{eventId:int}/programs/{programId:int}/results")]
    public Task<IActionResult> Results(int eventId, int programId, [FromBody] ScoreSnapshot snapshot, CancellationToken ct)
        => Receive(eventId, programId, snapshot, false, ct);

    private async Task<IActionResult> Receive(int eventId, int? programId, ScoreSnapshot snapshot, bool live, CancellationToken ct)
    {
        var expected = configuration[$"TlsIntegration:Events:{eventId}:ApiKey"];
        var supplied = Request.Headers["X-TLS-Key"].ToString();
        if (string.IsNullOrEmpty(expected) || expected.Length < 32 || supplied.Length > 512
            || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(expected)), SHA256.HashData(Encoding.UTF8.GetBytes(supplied))))
            return Unauthorized(new { message = "Invalid integration credential for this event." });
        var error = ScoreSnapshotRules.Validate(snapshot, eventId, programId, live);
        if (error is not null) return BadRequest(new { message = error });
        if (!await db.Events.AnyAsync(e => e.EventId == eventId && e.IsActive && e.IsSports, ct)) return NotFound();
        var ids = snapshot.Matches.Select(m => m.ProgramId).Append(programId ?? 0).Where(id => id > 0).Distinct().ToArray();
        if (await db.Programs.CountAsync(p => ids.Contains(p.ProgramId) && p.EventId == eventId && p.IsActive, ct) != ids.Length)
            return BadRequest(new { message = "A program does not belong to this event or is inactive." });
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
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
