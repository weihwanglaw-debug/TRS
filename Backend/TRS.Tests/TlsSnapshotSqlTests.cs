using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TRS_API.Controllers;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class SnapshotSqlFactAttribute : FactAttribute
{
    public SnapshotSqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("TRS_SNAPSHOT_TEST_CONNECTION")))
            Skip = "Set TRS_SNAPSHOT_TEST_CONNECTION to run against a new disposable SQL database.";
    }
}

public sealed class TlsSnapshotSqlTests
{
    private sealed class TestSchema(DbContextOptions<TRSDbContext> options) : TRSDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder mb)
        {
            base.OnModelCreating(mb);
            // Existing TRS tables are installed through SQL scripts; the model alone contains
            // multiple cascade paths. Keep test setup independent of those unrelated scripts.
            foreach (var fk in mb.Model.GetEntityTypes().SelectMany(t => t.GetForeignKeys())) fk.DeleteBehavior = DeleteBehavior.NoAction;
        }
    }
    [SnapshotSqlFact]
    public async Task Receiving_snapshots_is_atomic_versioned_event_scoped_and_trs_results_take_priority()
    {
        var name = "TRS_SnapshotTest_" + Guid.NewGuid().ToString("N");
        var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TRS_SNAPSHOT_TEST_CONNECTION")) { InitialCatalog = name };
        var options = new DbContextOptionsBuilder<TRSDbContext>().UseSqlServer(builder.ConnectionString).Options;
        try
        {
            await using (var schema = new TestSchema(options)) await schema.Database.EnsureCreatedAsync();
            await using var db = new TRSDbContext(options);
            await db.Database.ExecuteSqlRawAsync("DROP TABLE dbo.TlsResultSnapshots; DROP TABLE dbo.TlsLiveSnapshots; DROP TABLE dbo.EventResultSnapshots;");
            var root = new DirectoryInfo(AppContext.BaseDirectory);
            while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "Backend", "TRS_API"))) root = root.Parent;
            var script = await File.ReadAllTextAsync(Path.Combine(root!.FullName, "Backend", "TRS_Data", "Sql", "20261103_create_tls_snapshots.sql"));
            await db.Database.ExecuteSqlRawAsync(script);
            await db.Database.ExecuteSqlRawAsync(script);
            var eventScript = await File.ReadAllTextAsync(Path.Combine(root.FullName, "Backend", "TRS_Data", "Sql", "20261125_create_event_result_snapshots.sql"));
            await db.Database.ExecuteSqlRawAsync(eventScript);
            await db.Database.ExecuteSqlRawAsync(eventScript);
            var ev = new Event { Name = "Test event", Venue = "Hall", IsActive = true, IsSports = true, EventStartDate = new(2026, 11, 3), OpenDate = new(2026, 1, 1), CloseDate = new(2026, 1, 2) };
            var other = new Event { Name = "Other event", Venue = "Hall", IsActive = true, IsSports = true, EventStartDate = ev.EventStartDate, OpenDate = ev.OpenDate, CloseDate = ev.CloseDate };
            db.Events.AddRange(ev, other); await db.SaveChangesAsync();
            var p = new TrsProgram { EventId = ev.EventId, Name = "Doubles", Type = "doubles", Gender = "Mixed", IsActive = true };
            db.Programs.Add(p); await db.SaveChangesAsync();
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["TlsIntegration:ApiKey"] = new('k', 40) }).Build();
            var context = new DefaultHttpContext(); context.Request.Headers["X-TLS-Key"] = new string('k', 40);
            var receiver = new TlsSnapshotsController(db, configuration) { ControllerContext = new() { HttpContext = context } };
            var reader = new PublicScoresController(db) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
            async Task<JsonElement> Availability() => JsonSerializer.SerializeToElement(((OkObjectResult)await reader.Availability(ev.EventId, default)).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Empty((await Availability()).GetProperty("resultProgramIds").EnumerateArray());
            Assert.False((await Availability()).GetProperty("hasLiveScores").GetBoolean());
            var snapshot = ScoreSnapshotTests.Snapshot(); snapshot.EventId = ev.EventId; snapshot.ProgramId = p.ProgramId; snapshot.Matches[0].ProgramId = p.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.Results(ev.EventId, p.ProgramId, snapshot, default));
            Assert.Equal(p.ProgramId, (await Availability()).GetProperty("resultProgramIds")[0].GetInt32());
            var firstTime = (await db.TlsResultSnapshots.SingleAsync()).ReceivedAt;
            snapshot.Matches[0].Games = [new(99, 0)];
            await receiver.Results(ev.EventId, p.ProgramId, snapshot, default);
            Assert.Equal(firstTime, (await db.TlsResultSnapshots.SingleAsync()).ReceivedAt);
            using (var stored = JsonDocument.Parse((await db.TlsResultSnapshots.SingleAsync()).PayloadJson))
                Assert.Equal(21, stored.RootElement.GetProperty("matches")[0].GetProperty("games")[0].GetProperty("a").GetInt32());
            snapshot.Version = 2; snapshot.Matches[0].ProgramId = 99999;
            Assert.IsType<BadRequestObjectResult>(await receiver.Results(ev.EventId, p.ProgramId, snapshot, default));
            Assert.Equal(1, (await db.TlsResultSnapshots.SingleAsync()).Version);
            snapshot.Matches[0].ProgramId = p.ProgramId;
            var result = JsonSerializer.SerializeToElement(((OkObjectResult)await reader.Results(ev.EventId, p.ProgramId, default)).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Equal("TLS", result.GetProperty("source").GetString());
            var state = new FixtureGenerationService.FixtureState { Matches = [new() { Id = "manual", Status = "SC", Winner = null, Team1 = new() { Id = "1", Label = "A" }, Team2 = new() { Id = "2", Label = "B" } }] };
            var fixture = new Fixture { EventId = ev.EventId, ProgramId = p.ProgramId, BracketStateJson = JsonSerializer.Serialize(state), CreatedAt = DateTime.UtcNow };
            db.Fixtures.Add(fixture); await db.SaveChangesAsync();
            result = JsonSerializer.SerializeToElement(((OkObjectResult)await reader.Results(ev.EventId, p.ProgramId, default)).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Equal("TLS", result.GetProperty("source").GetString());
            state.Matches[0].Status = "C"; state.Matches[0].Winner = "team1";
            fixture.BracketStateJson = JsonSerializer.Serialize(state); await db.SaveChangesAsync();
            result = JsonSerializer.SerializeToElement(((OkObjectResult)await reader.Results(ev.EventId, p.ProgramId, default)).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Equal("TRS", result.GetProperty("source").GetString());
            Assert.Equal("manual", result.GetProperty("matches")[0].GetProperty("id").GetString());
            // Manual TRS results remain available even after the TLS result list is cleared.
            snapshot.Version = 3; snapshot.Matches.Clear(); await receiver.Results(ev.EventId, p.ProgramId, snapshot, default);
            Assert.Equal(p.ProgramId, (await Availability()).GetProperty("resultProgramIds")[0].GetInt32());
            state.Matches[0].Status = "SC"; state.Matches[0].Winner = null;
            fixture.BracketStateJson = JsonSerializer.Serialize(state); await db.SaveChangesAsync();
            Assert.Empty((await Availability()).GetProperty("resultProgramIds").EnumerateArray());
            var live = ScoreSnapshotTests.Snapshot(true); live.EventId = ev.EventId; live.Matches[0].ProgramId = p.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.Live(ev.EventId, live, default));
            var at = (await db.TlsLiveSnapshots.SingleAsync()).ReceivedAt;
            Assert.Equal(1, (await db.TlsLiveSnapshots.SingleAsync()).MatchCount);
            Assert.True((await Availability()).GetProperty("hasLiveScores").GetBoolean());
            live.Version = 2; live.Matches.Clear(); await receiver.Live(ev.EventId, live, default);
            Assert.Equal(0, (await db.TlsLiveSnapshots.SingleAsync()).MatchCount);
            Assert.False((await Availability()).GetProperty("hasLiveScores").GetBoolean());
            Assert.True((await db.TlsLiveSnapshots.SingleAsync()).ReceivedAt >= at);
            Assert.Single(await db.TlsResultSnapshots.ToListAsync());
            context.Request.Headers["X-TLS-Key"] = "wrong";
            Assert.IsType<UnauthorizedObjectResult>(await receiver.Live(ev.EventId, live, default));
            Assert.IsType<UnauthorizedObjectResult>(await receiver.Live(other.EventId, live, default));
            Assert.Equal(2, (await db.TlsLiveSnapshots.SingleAsync()).Version);
            // Generic endpoints choose the storage scope from payload identities.
            context.Request.Headers["X-TLS-Key"] = new string('k', 40);
            var otherProgram = new TrsProgram { EventId = other.EventId, Name = "Singles", Type = "singles", Gender = "Open", IsActive = true };
            db.Programs.Add(otherProgram); await db.SaveChangesAsync();
            var incoming = ScoreSnapshotTests.Snapshot(); incoming.EventId = other.EventId; incoming.ProgramId = otherProgram.ProgramId; incoming.Matches[0].ProgramId = otherProgram.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveResults(incoming, default));
            Assert.Equal(other.EventId, (await db.TlsResultSnapshots.SingleAsync(r => r.ProgramId == otherProgram.ProgramId)).EventId);
            Assert.Equal(3, (await db.TlsResultSnapshots.SingleAsync(r => r.ProgramId == p.ProgramId)).Version);
            var current = ScoreSnapshotTests.Snapshot(true); current.EventId = other.EventId; current.Matches[0].ProgramId = otherProgram.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveLive(current, default));
            Assert.Equal(1, (await db.TlsLiveSnapshots.SingleAsync(r => r.EventId == other.EventId)).MatchCount);
            current.Version = 2; current.Matches[0].ProgramId = p.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveLive(current, default));
            Assert.Equal(2, (await db.TlsLiveSnapshots.SingleAsync(r => r.EventId == other.EventId)).Version);
            incoming.EventId = ev.EventId; incoming.Version = 2;
            Assert.IsType<BadRequestObjectResult>(await receiver.ReceiveResults(incoming, default));
            incoming.ProgramId = null;
            Assert.IsType<BadRequestObjectResult>(await receiver.ReceiveResults(incoming, default));
            var eventResult = ScoreSnapshotTests.Snapshot();
            eventResult.EventId = other.EventId;
            eventResult.ProgramId = null;
            eventResult.Programs = [new(otherProgram.ProgramId, "Doubles")];
            eventResult.Matches[0].ProgramId = otherProgram.ProgramId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveEventResults(eventResult, default));
            Assert.Single(await db.TlsResultSnapshots.Where(x => x.EventId == other.EventId).ToListAsync());
            var admin = new FixturesController(db, null!, null!, null!);
            var linkedAdminResults = JsonSerializer.SerializeToElement(((OkObjectResult)await admin.Get(other.EventId, otherProgram.ProgramId)).Value);
            Assert.Single(linkedAdminResults.GetProperty("tlsResults").EnumerateArray());
            eventResult.Version = 2;
            eventResult.Programs.Add(new(500, "Singles", "T01", false));
            Assert.IsType<OkObjectResult>(await receiver.ReceiveEventResults(eventResult, default));
            Assert.Empty(await db.TlsResultSnapshots.Where(x => x.EventId == other.EventId).ToListAsync());
            var unmatchedAdminResults = JsonSerializer.SerializeToElement(((OkObjectResult)await admin.Get(other.EventId, otherProgram.ProgramId)).Value);
            Assert.Empty(unmatchedAdminResults.GetProperty("tlsResults").EnumerateArray());
            var publicEvent = JsonSerializer.SerializeToElement(((OkObjectResult)await reader.Results(other.EventId, null, default)).Value,
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Equal(2, publicEvent.GetProperty("programs").GetArrayLength());
            Assert.Single(publicEvent.GetProperty("matches").EnumerateArray());
            eventResult.Version = 1;
            eventResult.Matches.Clear();
            await receiver.ReceiveEventResults(eventResult, default);
            Assert.Equal(2, (await db.EventResultSnapshots.SingleAsync(x => x.EventId == other.EventId)).Version);
            var nonSport = new Event { Name = "Social event", Venue = "Hall", IsActive = true, IsSports = false,
                EventStartDate = ev.EventStartDate, OpenDate = ev.OpenDate, CloseDate = ev.CloseDate };
            db.Events.Add(nonSport); await db.SaveChangesAsync();
            current.EventId = nonSport.EventId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveLive(current, default));
            Assert.IsType<OkObjectResult>(await reader.Live(nonSport.EventId, default));
            eventResult.EventId = nonSport.EventId;
            Assert.IsType<OkObjectResult>(await receiver.ReceiveEventResults(eventResult, default));

            state.Matches[0].Status = "C"; state.Matches[0].Winner = "team1";
            fixture.BracketStateJson = JsonSerializer.Serialize(state); await db.SaveChangesAsync();
            await using (var tx = await db.Database.BeginTransactionAsync())
            {
                await EventResultSnapshots.RefreshManualAsync(db, ev.EventId);
                await tx.CommitAsync();
            }
            var manual = await db.EventResultSnapshots.SingleAsync(x => x.EventId == ev.EventId);
            Assert.Equal("TRS", manual.Source);
            Assert.Equal("manual", EventResultSnapshots.Read(manual).Matches.Single().Id);
            state.Matches.Clear();
            fixture.BracketStateJson = JsonSerializer.Serialize(state); await db.SaveChangesAsync();
            await using (var tx = await db.Database.BeginTransactionAsync())
            {
                await EventResultSnapshots.RefreshManualAsync(db, ev.EventId);
                await tx.CommitAsync();
            }
            Assert.False((await Availability()).GetProperty("hasResults").GetBoolean());
            current.EventId = 0;
            Assert.IsType<BadRequestObjectResult>(await receiver.ReceiveLive(current, default));
            context.Request.Headers["X-TLS-Key"] = "wrong";
            Assert.IsType<UnauthorizedObjectResult>(await receiver.ReceiveResults(incoming, default));

        }
        finally
        {
            SqlConnection.ClearAllPools();
            builder.InitialCatalog = "master";
            await using var connection = new SqlConnection(builder.ConnectionString); await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"IF DB_ID('{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END";
            await command.ExecuteNonQueryAsync();
        }
    }
}
