namespace TRS_API.Models;

public sealed class ScoreSnapshot
{
    public int SchemaVersion { get; set; } = 1;
    public int EventId { get; set; }
    public string EventName { get; set; } = "";
    public int? ProgramId { get; set; }
    public string ProgramName { get; set; } = "";
    public long Version { get; set; }
    public DateTimeOffset GeneratedAt { get; set; }
    public string TimeZone { get; set; } = "Asia/Singapore";
    public int RefreshSeconds { get; set; } = 5;
    public List<SnapshotProgram>? Programs { get; set; }
    public List<SnapshotHeat> Heats { get; set; } = [];
    public List<PublicScoreMatch> Matches { get; set; } = [];
}

public sealed record SnapshotProgram(int Id, string Name, string? Reference = null, bool CanLink = true);
public sealed record SnapshotHeat(int ProgramId, string Label, int RoundNumber, SnapshotHeatResult[] Results);
public sealed record SnapshotHeatResult(string Name, string Result, int? Place, bool Advanced);

public sealed class PublicScoreMatch
{
    public string Id { get; set; } = "";
    public int ProgramId { get; set; }
    public string ProgramName { get; set; } = "";
    public string Phase { get; set; } = "";
    public int Round { get; set; }
    public string RoundLabel { get; set; } = "";
    public string Group { get; set; } = "";
    public PublicScoreEntry Team1 { get; set; } = new();
    public PublicScoreEntry Team2 { get; set; } = new();
    public List<PublicGameScore> Games { get; set; } = [];
    public string? Winner { get; set; }
    public string Outcome { get; set; } = "N";
    public string Remark { get; set; } = "";
    public string MatchDate { get; set; } = "";
    public string StartTime { get; set; } = "";
    public string EndTime { get; set; } = "";
    public string Court { get; set; } = "";
    public string Status { get; set; } = "";
    public int? ScoreA { get; set; }
    public int? ScoreB { get; set; }
    public string? ServerSide { get; set; }
    public string? GamePhase { get; set; }
    public DateTimeOffset? PhaseUntil { get; set; }
    public int? GameNumber { get; set; }
}

public sealed class PublicScoreEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Players { get; set; } = [];
    public int? Seed { get; set; }
}

public sealed record PublicGameScore(int A, int B);
