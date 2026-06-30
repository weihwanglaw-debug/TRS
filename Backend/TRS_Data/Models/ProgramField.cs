namespace TRS_Data.Models;
public partial class ProgramField
{
    public int ProgramId { get; set; }
    public bool EnableSbaId { get; set; }
    public bool EnableDocumentUpload { get; set; }
    public bool EnableGuardianInfo { get; set; }
    public bool EnableRemark { get; set; }
    public bool EnableTshirt { get; set; }
    public bool RequireSbaId { get; set; }
    public bool RequireDocumentUpload { get; set; }
    public bool RequireGuardianInfo { get; set; }
    public bool RequireRemark { get; set; }
    public bool RequireTshirt { get; set; }
    public virtual TrsProgram Program { get; set; } = null!;
}
