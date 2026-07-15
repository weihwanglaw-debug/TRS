namespace TRS_API.Services;

public static class ProgramTypeRules
{
    public const string Team = "team";

    public static bool IsTeamProgram(string? type) =>
        string.Equals(type, Team, StringComparison.OrdinalIgnoreCase);
}
