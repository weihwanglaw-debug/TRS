using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public static class EventResultSnapshots
{
    public const string Tls = "TLS";
    public const string Trs = "TRS";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static bool ProgramsMatch(IEnumerable<int> trsIds, IEnumerable<SnapshotProgram> tlsPrograms)
    {
        var published = tlsPrograms.ToArray();
        return published.Length > 0 && published.All(p => p.CanLink)
            && trsIds.ToHashSet().SetEquals(published.Select(p => p.Id));
    }

    public static Task<EventResultSnapshot?> LockAsync(TRSDbContext db, int eventId, CancellationToken ct = default) =>
        db.EventResultSnapshots.FromSqlInterpolated($"SELECT * FROM dbo.EventResultSnapshots WITH (UPDLOCK,HOLDLOCK) WHERE EventId={eventId}")
            .SingleOrDefaultAsync(ct);

    public static void Save(TRSDbContext db, EventResultSnapshot? row, ScoreSnapshot snapshot, string source)
    {
        if (row is null)
        {
            row = new() { EventId = snapshot.EventId };
            db.EventResultSnapshots.Add(row);
        }
        row.Version = snapshot.Version;
        row.Source = source;
        row.ReceivedAt = DateTimeOffset.UtcNow;
        row.PayloadJson = JsonSerializer.Serialize(snapshot, Json);
    }

    public static ScoreSnapshot Read(EventResultSnapshot row) =>
        JsonSerializer.Deserialize<ScoreSnapshot>(row.PayloadJson, Json)!;

    public static async Task RefreshManualAsync(TRSDbContext db, int eventId)
    {
        var row = await LockAsync(db, eventId);
        if (row?.Source == Tls) return;
        var snapshot = await BuildManualAsync(db, eventId);
        if (snapshot is null || row is null && !HasResults(snapshot)) return;
        snapshot.Version = checked((row?.Version ?? 0) + 1);
        Save(db, row, snapshot, Trs);
        await db.SaveChangesAsync();
    }

    public static bool HasResults(ScoreSnapshot snapshot) => snapshot.Matches.Count > 0 || snapshot.Heats.Count > 0;

    public static async Task<ScoreSnapshot?> BuildManualAsync(TRSDbContext db, int eventId, CancellationToken ct = default)
    {
        var name = await db.Events.Where(e => e.EventId == eventId).Select(e => e.Name).SingleOrDefaultAsync(ct);
        if (name is null) return null;
        var programs = await db.Programs.Where(p => p.EventId == eventId && p.IsActive)
            .OrderBy(p => p.ProgramId).Select(p => new SnapshotProgram(p.ProgramId, p.Name, null, true)).ToListAsync(ct);
        var fixtures = await db.Fixtures.AsNoTracking().Where(f => f.EventId == eventId).ToDictionaryAsync(f => f.ProgramId, ct);
        var snapshot = new ScoreSnapshot { EventId = eventId, EventName = name, GeneratedAt = DateTimeOffset.UtcNow, Programs = programs };
        foreach (var program in programs)
        {
            var state = PublicResults.ReadFixture(fixtures.GetValueOrDefault(program.Id)?.BracketStateJson);
            if (state is null || !PublicResults.HasTrsResults(state)) continue;
            snapshot.Matches.AddRange(PublicResults.Project(state, program.Id, program.Name));
            snapshot.Heats.AddRange(state.HeatRounds?.Where(r => r.IsComplete).Select(r => new SnapshotHeat(program.Id, r.Label, r.RoundNumber,
                r.Results.Select(v => new SnapshotHeatResult(
                    state.Seeds.FirstOrDefault(s => s.Id == v.TeamId)?.Participants is { Count: > 0 } players ? string.Join(" / ", players) : v.TeamId,
                    v.Result, v.Place, v.Advanced)).ToArray())) ?? []);
        }
        return snapshot;
    }
}
