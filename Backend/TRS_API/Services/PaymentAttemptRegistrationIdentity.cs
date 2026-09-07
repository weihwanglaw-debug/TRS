using TRS_API.Models;

namespace TRS_API.Services;

public static class PaymentAttemptRegistrationIdentity
{
    public static bool Matches(CreateRegistrationRequest first, CreateRegistrationRequest second)
    {
        if (first.EventId != second.EventId) return false;

        var firstGroups = BuildGroupIdentities(first);
        var secondGroups = BuildGroupIdentities(second);
        return firstGroups.SequenceEqual(secondGroups, StringComparer.Ordinal);
    }

    private static IEnumerable<string> BuildGroupIdentities(CreateRegistrationRequest request) =>
        (request.Groups ?? new List<CreateGroupDto>())
            .Select(group =>
            {
                var participants = (group.Participants ?? new List<CreateParticipantDto>())
                    .Select(participant =>
                        $"{Normalize(participant.FullName)}|{Normalize(participant.Dob)}")
                    .OrderBy(value => value, StringComparer.Ordinal);
                return $"{group.ProgramId}:{string.Join(",", participants)}";
            })
            .OrderBy(value => value, StringComparer.Ordinal);

    private static string Normalize(string? value) =>
        value?.Trim().ToUpperInvariant() ?? "";
}
