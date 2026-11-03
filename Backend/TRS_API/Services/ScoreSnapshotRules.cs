using System.Globalization;
using TRS_API.Models;

namespace TRS_API.Services;

public static class ScoreSnapshotRules
{
    public static string? Validate(ScoreSnapshot s, int eventId, int? programId, bool live)
    {
        if (s.SchemaVersion != 1 || s.EventId != eventId || s.ProgramId != programId || s.Version <= 0)
            return "Snapshot schema, event/program identity or version is invalid.";
        if (s.GeneratedAt == default || s.GeneratedAt > DateTimeOffset.UtcNow.AddMinutes(5)
            || !Text(s.EventName, 300) || s.ProgramName is null || s.ProgramName.Length > 300
            || !Text(s.TimeZone, 100) || s.RefreshSeconds is < 2 or > 120)
            return "Snapshot names, timestamp, timezone or refresh interval is invalid.";
        if (s.Matches is null || s.Matches.Count > 10000 || s.Matches.Any(m => m is null))
            return "Provide a complete match list with no more than 10000 matches.";
        if (s.Matches.Select(m => m.Id).Distinct(StringComparer.Ordinal).Count() != s.Matches.Count)
            return "Match references must be unique within the snapshot.";
        foreach (var m in s.Matches)
        {
            if (!Text(m.Id, 160) || m.ProgramId <= 0 || programId.HasValue && m.ProgramId != programId
                || !Text(m.ProgramName, 300) || m.Phase is not ("G" or "K") || m.Round < 1
                || !Text(m.RoundLabel, 100) || m.Group is null || m.Group.Length > 100)
                return "A match has invalid program, round or group information.";
            if (!Entry(m.Team1) || !Entry(m.Team2) || m.Team1.Id == m.Team2.Id)
                return "Each match must identify its two distinct entries and player names.";
            if (m.Games is null || m.Games.Count > 15 || m.Games.Any(g => g is null || g.A is < 0 or > 999 || g.B is < 0 or > 999)
                || m.Winner is not (null or "A" or "B") || !Text(m.Outcome, 16)
                || m.Remark is null || m.Remark.Length > 4000 || m.Court is null || m.Court.Length > 100
                || !Date(m.MatchDate) || !Time(m.StartTime) || !Time(m.EndTime))
                return "A match has invalid scores, outcome, date/time or remarks.";
            if (live)
            {
                if (m.Status is not ("IP" or "RC") || m.ScoreA is null or < 0 or > 999 || m.ScoreB is null or < 0 or > 999
                    || m.ServerSide is not (null or "A" or "B")) return "A live match has invalid current scores or state.";
            }
            else if (m.Status is not ("C" or "W" or "BY") || m.Winner is null && m.Outcome == "N")
                return "Only organiser-confirmed results may be published.";
            if (m.Outcome is not ("N" or "WO" or "BY"))
            {
                var label = m.Outcome switch { "R" => "Retirement", "D" => "Disqualification", "M" => "Admin decision", _ => m.Outcome };
                var note = $"Outcome: {label}";
                if (!m.Remark.Contains(note, StringComparison.Ordinal)) m.Remark = string.IsNullOrWhiteSpace(m.Remark) ? note : note + ". " + m.Remark;
            }
        }
        return null;
    }

    private static bool Text(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max;
    private static bool Entry(PublicScoreEntry? e) => e is not null && Text(e.Id, 160) && Text(e.Name, 600)
        && e.Players is not null && e.Players.Count <= 100 && e.Players.All(p => Text(p, 200)) && e.Seed is null or > 0;
    private static bool Date(string? value) => value == "" || DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    private static bool Time(string? value) => value == "" || TimeOnly.TryParseExact(value, ["HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
}
