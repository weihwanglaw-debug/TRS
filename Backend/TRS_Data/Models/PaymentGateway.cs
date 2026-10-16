namespace TRS_Data.Models;

public class PaymentGateway
{
    public string Code { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public bool EnabledForNewPayments { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
