namespace TRS_Data.Models;

public class BadmintonClub
{
    public int     ClubId        { get; set; }
    public string  Name          { get; set; } = null!;
    public string? ContactNumber { get; set; }
    public string? Email         { get; set; }
    public string? Address       { get; set; }
    public string? Country       { get; set; }
    public bool    IsActive      { get; set; }
    public DateTime CreatedAt    { get; set; }
    public DateTime? UpdatedAt   { get; set; }
}

