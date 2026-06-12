using System;
using System.Collections.Generic;

namespace TRS_Data.Models;

public class AppLog
{
    public int Id { get; set; }
    public string Level { get; set; } = "";
    public string Message { get; set; } = "";
    public string? Exception { get; set; }
    public string? SourceContext { get; set; }
    public DateTime Timestamp { get; set; }
}