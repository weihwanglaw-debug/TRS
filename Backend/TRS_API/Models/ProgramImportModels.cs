using System.ComponentModel.DataAnnotations;

namespace TRS_API.Models;

public sealed class ProgramImportPreviewResponse
{
    public bool Valid { get; set; }
    public string? ImportToken { get; set; }
    public int EventId { get; set; }
    public int ProgramId { get; set; }
    public string EventName { get; set; } = "";
    public string ProgramName { get; set; } = "";
    public int RowCount { get; set; }
    public int EntryCount { get; set; }
    public int ParticipantCount { get; set; }
    public decimal TotalAmount { get; set; }
    public List<ProgramImportPreviewEntry> Entries { get; set; } = new();
    public List<ProgramImportIssue> Errors { get; set; } = new();
    public List<ProgramImportIssue> Warnings { get; set; } = new();
}

public sealed class ProgramImportPreviewEntry
{
    public string EntryNo { get; set; } = "";
    public int ParticipantCount { get; set; }
    public string Names { get; set; } = "";
    public decimal Fee { get; set; }
}

public sealed class ProgramImportIssue
{
    public int? Row { get; set; }
    public string? EntryNo { get; set; }
    public string? Field { get; set; }
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
}

public sealed class ProgramImportConfirmRequest
{
    [Required]
    public string ImportToken { get; set; } = "";

    [Required]
    public string PaymentStatus { get; set; } = "";

    public string? Method { get; set; }
    public string? PaymentReference { get; set; }

    [Required, MinLength(3)]
    public string AdminNote { get; set; } = "";
}

public sealed class ProgramImportConfirmResponse
{
    public int RegistrationId { get; set; }
    public int PaymentId { get; set; }
    public int EntryCount { get; set; }
    public int ParticipantCount { get; set; }
    public string PaymentStatus { get; set; } = "";
}
