using System.Text.Json;
using TRS_API.Models;
using TRS_API.Services;

namespace TRS.Tests;

public sealed class ScoreSnapshotTests
{
    public static ScoreSnapshot Snapshot(bool live = false) => new() {
        EventId = 7, EventName = "Open", ProgramId = live ? null : 12, ProgramName = live ? "" : "Doubles", Version = 1,
        GeneratedAt = DateTimeOffset.UtcNow,
        Matches = [new() { Id = "M1", ProgramId = 12, ProgramName = "Doubles", Phase = "G", Round = 1, RoundLabel = "Group Stage", Group = "Group A",
            Team1 = new() { Id = "entry:1", Name = "A / B", Players = ["A", "B"] }, Team2 = new() { Id = "entry:2", Name = "C / D", Players = ["C", "D"] },
            Games = [new(21, 19), new(21, 18)], Winner = live ? null : "A", Status = live ? "IP" : "C", ScoreA = live ? 3 : null, ScoreB = live ? 4 : null,
            MatchDate = "2026-11-03", StartTime = "14:00", EndTime = "14:40" }]
    };

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public void Accepts_complete_results_and_live_snapshots(bool live)
    {
        Assert.Null(ScoreSnapshotRules.Validate(Snapshot(live), 7, live ? null : 12, live));
    }

    [Fact]
    public void Rejects_wrong_identity_duplicates_nulls_and_unconfirmed_results()
    {
        var s = Snapshot();
        Assert.NotNull(ScoreSnapshotRules.Validate(s, 8, 12, false));
        s.Matches.Add(s.Matches[0]); Assert.NotNull(ScoreSnapshotRules.Validate(s, 7, 12, false));
        s.Matches.RemoveAt(1); s.Matches[0].Games = null!; Assert.NotNull(ScoreSnapshotRules.Validate(s, 7, 12, false));
        s = Snapshot(); s.Matches[0].Status = "RC"; Assert.NotNull(ScoreSnapshotRules.Validate(s, 7, 12, false));
        s = Snapshot(); s.Matches[0].Team1 = null!; Assert.NotNull(ScoreSnapshotRules.Validate(s, 7, 12, false));
    }

    [Fact]
    public void Allows_empty_snapshot_and_preserves_exceptional_outcome_in_remark()
    {
        var s = Snapshot(); s.Matches.Clear(); Assert.Null(ScoreSnapshotRules.Validate(s, 7, 12, false));
        s = Snapshot(); s.Matches[0].Outcome = "R"; s.Matches[0].Games = [new(8, 3)]; s.Matches[0].Remark = "Injury";
        Assert.Null(ScoreSnapshotRules.Validate(s, 7, 12, false));
        Assert.Contains("Retirement", s.Matches[0].Remark); Assert.Contains("Injury", s.Matches[0].Remark);
    }

    [Fact]
    public void Trs_priority_requires_a_recorded_result_and_not_only_byes()
    {
        var state = new FixtureGenerationService.FixtureState { Matches = [new() { Id = "1", Status = "SC", Team1 = new() { Id = "1", Label = "A" }, Team2 = new() { Id = "2", Label = "B" } }] };
        Assert.False(PublicResults.HasTrsResults(state));
        state.Matches[0].Status = "C"; Assert.True(PublicResults.HasTrsResults(state));
        state.Matches[0].Team2.Label = "BYE"; Assert.False(PublicResults.HasTrsResults(state));
    }

    [Fact]
    public void Unknown_optional_tls_fields_are_ignored_and_never_exposed()
    {
        var json = JsonSerializer.Serialize(Snapshot(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        json = json.Insert(json.Length - 1, ",\"rallies\":[{\"server\":\"player1\"}],\"tabletToken\":\"never-public\"");
        var s = JsonSerializer.Deserialize<ScoreSnapshot>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Null(ScoreSnapshotRules.Validate(s, 7, 12, false));
        Assert.DoesNotContain("never-public", JsonSerializer.Serialize(s));
    }
}
