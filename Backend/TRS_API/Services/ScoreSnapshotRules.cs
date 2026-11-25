using System.Globalization;
using TRS_API.Models;

namespace TRS_API.Services;

public static class ScoreSnapshotRules
{
    public static string? Validate(ScoreSnapshot s, int eventId, int? programId, bool live)
    {
        if (s.SchemaVersion != 1) return "Snapshot schema version must be 1.";
        if (s.EventId != eventId || s.ProgramId != programId) return "Snapshot event/program identity does not match the destination.";
        if (s.Version <= 0) return "Snapshot version must be positive.";
        if (s.GeneratedAt == default) return "Snapshot generatedAt timestamp is required.";
        if (!Text(s.EventName, 300)) return "Snapshot event name is required and must not exceed 300 characters.";
        if (s.ProgramName is null || s.ProgramName.Length > 300) return "Snapshot program name must not exceed 300 characters.";
        if (!Text(s.TimeZone, 100)) return "Snapshot timezone is required and must not exceed 100 characters.";
        if (s.RefreshSeconds is < 2 or > 120) return "Snapshot refresh interval must be between 2 and 120 seconds.";
        if (s.Matches is null || s.Matches.Count > 10000 || s.Matches.Any(m => m is null))
            return "Provide a complete match list with no more than 10000 matches.";
        if (s.Matches.Select(m => m.Id).Distinct(StringComparer.Ordinal).Count() != s.Matches.Count)
            return "Match references must be unique within the snapshot.";
        if (s.Heats is null || s.Heats.Count > 0)
            return "TLS snapshots cannot contain TRS heat results.";
        if (!live && !programId.HasValue)
        {
            if (s.Programs is not { Count: > 0 and <= 1000 } ||
                s.Programs.Any(p => p is null || p.Id <= 0 || !Text(p.Name, 300) || p.Reference?.Length > 160) ||
                s.Programs.Select(p => p.Id).Distinct().Count() != s.Programs.Count)
                return "Provide the complete event program list with unique program IDs.";
            var programs = s.Programs.ToDictionary(p => p.Id);
            if (s.Matches.Any(m => !programs.TryGetValue(m.ProgramId, out var p) || p.Name != m.ProgramName))
                return "Each result must identify a program in the event program list.";
        }
        foreach (var m in s.Matches)
        {
            if (!Text(m.Id, 160)) return "Match reference is required and must not exceed 160 characters.";
            if (m.ProgramId <= 0 || programId.HasValue && m.ProgramId != programId
                || !Text(m.ProgramName, 300) || m.Phase is not ("G" or "K") || m.Round < 1
                || !Text(m.RoundLabel, 100) || m.Group is null || m.Group.Length > 100)
                return $"Match {m.Id}: invalid program, round or group information.";
            if (!Entry(m.Team1) || !Entry(m.Team2) || m.Team1.Id == m.Team2.Id)
                return $"Match {m.Id}: identify two distinct entries with player names.";
            if (m.Games is null || m.Games.Count > 15 || m.Games.Any(g => g is null || g.A is < 0 or > 999 || g.B is < 0 or > 999))
                return $"Match {m.Id}: game scores must be between 0 and 999, with at most 15 games.";
            if (m.Winner is not (null or "A" or "B") || !Text(m.Outcome, 16)) return $"Match {m.Id}: invalid winner or outcome code.";
            if (m.Remark is null || m.Remark.Length > 4000) return $"Match {m.Id}: remark must not exceed 4000 characters.";
            if (m.Court is null || m.Court.Length > 100) return $"Match {m.Id}: invalid court.";
            if (!Date(m.MatchDate)) return $"Match {m.Id}: match date must use yyyy-MM-dd.";
            if (!Time(m.StartTime) || !Time(m.EndTime)) return $"Match {m.Id}: start/end times must use HH:mm or HH:mm:ss.";
            if (live)
            {
                if ((m.Status is not ("IP" or "RC") && !(m.Status == "SC" && m.GamePhase == "WU")) || m.ScoreA is null or < 0 or > 999 || m.ScoreB is null or < 0 or > 999
                    || m.ServerSide is not (null or "A" or "B")) return $"Match {m.Id}: invalid live scores, serving side or state.";
            }
            else if (m.Status is not ("C" or "W" or "BY") || m.Winner is null && m.Outcome == "N")
                return $"Match {m.Id}: only organiser-confirmed results may be published.";
            if (live && (m.GamePhase is not (null or "WU" or "IP" or "IN" or "BG" or "TP" or "MP" or "PP" or "RS" or "RC")
                || m.GameNumber is < 1 or > 15 || m.GamePhase == "WU" && m.Status != "SC"
                || m.PhaseUntil.HasValue && m.GamePhase is not ("WU" or "IN" or "BG")))
                return $"Match {m.Id}: invalid game phase.";
            // TLS free-text reasons are private; public remarks are derived only from outcome codes.
            m.Remark = "";
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
