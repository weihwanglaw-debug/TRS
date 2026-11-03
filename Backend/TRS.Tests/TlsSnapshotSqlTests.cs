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
            await db.Database.ExecuteSqlRawAsync("DROP TABLE dbo.TlsResultSnapshots; DROP TABLE dbo.TlsLiveSnapshots;");
            var root = new DirectoryInfo(AppContext.BaseDirectory);
            while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "Backend", "TRS_API"))) root = root.Parent;
            var script = await File.ReadAllTextAsync(Path.Combine(root!.FullName, "Backend", "TRS_Data", "Sql", "20261103_create_tls_snapshots.sql"));
            await db.Database.ExecuteSqlRawAsync(script);
            await db.Database.ExecuteSqlRawAsync(script);
            var ev = new Event { Name = "Test event", Venue = "Hall", IsActive = true, IsSports = true, EventStartDate = new(2026, 11, 3), OpenDate = new(2026, 1, 1), CloseDate = new(2026, 1, 2) };
            var other = new Event { Name = "Other event", Venue = "Hall", IsActive = true, IsSports = true, EventStartDate = ev.EventStartDate, OpenDate = ev.OpenDate, CloseDate = ev.CloseDate };
            db.Events.AddRange(ev, other); await db.SaveChangesAsync();
            var p = new TrsProgram { EventId = ev.EventId, Name = "Doubles", Type = "doubles", Gender = "Mixed", IsActive = true };
            db.Programs.Add(p); await db.SaveChangesAsync();
            var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [$"TlsIntegration:Events:{ev.EventId}:ApiKey"] = new('k', 40) }).Build();
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
