namespace TRS_Data.Models;

public partial class AdminAuditLogDetail
{
    public long AuditDetailId { get; set; }
    public long AuditId { get; set; }
    public string FieldName { get; set; } = null!;
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? ValueType { get; set; }
    public DateTime CreatedAt { get; set; }

    public virtual AdminAuditLog Audit { get; set; } = null!;
}
