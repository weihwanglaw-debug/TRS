namespace TRS_Data.Models;

public sealed class TlsLiveSnapshot
{
    public int EventId { get; set; }
    public long Version { get; set; }
    public string PayloadJson { get; set; } = "";
    public int MatchCount { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
}

public sealed class TlsResultSnapshot
{
    public int ProgramId { get; set; }
    public int EventId { get; set; }
    public long Version { get; set; }
    public string PayloadJson { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
}

public sealed class EventResultSnapshot
{
    public int EventId { get; set; }
    public long Version { get; set; }
    public string Source { get; set; } = "";
    public string PayloadJson { get; set; } = "";
    public DateTimeOffset ReceivedAt { get; set; }
}
