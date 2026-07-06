namespace TRS_Data.Models;

public class PaymentAttempt
{
    public int PaymentAttemptId { get; set; }
    public string AttemptKey { get; set; } = null!;
    public int EventId { get; set; }
    public string ContactName { get; set; } = "";
    public string ContactEmail { get; set; } = "";
    public string ContactPhone { get; set; } = "";
    public string PaymentMethod { get; set; } = "CreditCard";
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "SGD";
    public string? GatewayPaymentIntentId { get; set; }
    public string Status { get; set; } = "Created";
    public string PayloadJson { get; set; } = null!;
    public string? LineItemsJson { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public DateTime? SucceededAt { get; set; }
    public DateTime? FinalizedAt { get; set; }
    public DateTime? CanceledAt { get; set; }
    public DateTime? FailedAt { get; set; }
    public int? RegistrationId { get; set; }
    public int? PaymentId { get; set; }
    public string? ReconciliationReason { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public byte[] RowVersion { get; set; } = Array.Empty<byte>();
}
