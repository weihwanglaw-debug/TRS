namespace TRS_Data.Models;

public class EventRestrictedSbaPlayer
{
    public int EventRestrictedSbaPlayerId { get; set; }
    public int EventId { get; set; }
    public string SbaId { get; set; } = null!;
    public string PlayerNameSnapshot { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public virtual Event Event { get; set; } = null!;
}
