using System.Text.Json;
using TRS_API.Models;

namespace TRS_API.Services;

public static class PublicResults
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };

    public static FixtureGenerationService.FixtureState? ReadFixture(string? json) => string.IsNullOrWhiteSpace(json)
        ? null : JsonSerializer.Deserialize<FixtureGenerationService.FixtureState>(json, Json);

    public static List<FixtureGenerationService.FixtureMatch> Matches(FixtureGenerationService.FixtureState? state) => state is null
        ? [] : state.Groups.SelectMany(g => g.Matches).Concat(state.Matches).DistinctBy(m => m.Id).ToList();

    public static bool HasTrsResults(FixtureGenerationService.FixtureState? state) => Matches(state).Any(m =>
        m.Status is "C" or "W" && !IsBye(m)) || state?.HeatRounds?.Any(r => r.IsComplete) == true;

    public static List<PublicScoreMatch> Project(FixtureGenerationService.FixtureState state, int programId, string programName)
        => Matches(state).Where(m => m.Status is "C" or "W" || IsBye(m)).Select(m => new PublicScoreMatch {
            Id = m.Id, ProgramId = programId, ProgramName = programName, Phase = m.Phase == "group" ? "G" : "K",
            Round = Math.Max(1, m.Round), RoundLabel = m.Phase == "group" ? "Group Stage" : m.RoundLabel,
            Group = state.Groups.FirstOrDefault(g => g.Id == m.GroupId)?.Name ?? m.GroupId ?? "",
            Team1 = Team(m.Team1), Team2 = Team(m.Team2),
            Games = m.Games.Where(g => int.TryParse(g.P1, out _) && int.TryParse(g.P2, out _)).Select(g => new PublicGameScore(int.Parse(g.P1), int.Parse(g.P2))).ToList(),
            Winner = m.Winner == "team1" ? "A" : m.Winner == "team2" ? "B" : null,
            Outcome = IsBye(m) ? "BY" : m.Walkover ? "WO" : "N", Remark = m.Remark,
            MatchDate = m.MatchDate, StartTime = m.StartTime, EndTime = m.EndTime, Court = m.CourtNo, Status = m.Status,
        }).ToList();

    private static PublicScoreEntry Team(FixtureGenerationService.FixtureTeam t) => new() { Id = t.Id, Name = t.Label, Players = t.Participants, Seed = t.Seed };
    private static bool IsBye(FixtureGenerationService.FixtureMatch m) => m.Team1.Label == "BYE" || m.Team2.Label == "BYE"
        || m.Team1.Id.StartsWith("bye-", StringComparison.Ordinal) || m.Team2.Id.StartsWith("bye-", StringComparison.Ordinal);
}
