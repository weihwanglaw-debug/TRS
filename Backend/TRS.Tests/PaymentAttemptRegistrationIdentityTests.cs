using TRS_API.Models;
using TRS_API.Services;

namespace TRS.Tests;

public class PaymentAttemptRegistrationIdentityTests
{
    [Fact]
    public void Matches_IgnoresGroupAndParticipantOrdering()
    {
        var first = Registration(
            Group(2, Participant("Bob", "2000-02-02")),
            Group(1, Participant("Alice", "2000-01-01"), Participant("Cara", "2000-03-03")));
        var second = Registration(
            Group(1, Participant(" cara ", "2000-03-03"), Participant("ALICE", "2000-01-01")),
            Group(2, Participant("BOB", "2000-02-02")));

        Assert.True(PaymentAttemptRegistrationIdentity.Matches(first, second));
    }

    [Fact]
    public void Matches_RejectsDifferentParticipantOrProgram()
    {
        var original = Registration(Group(1, Participant("Alice", "2000-01-01")));
        var differentParticipant = Registration(Group(1, Participant("Alex", "2000-01-01")));
        var differentProgram = Registration(Group(2, Participant("Alice", "2000-01-01")));

        Assert.False(PaymentAttemptRegistrationIdentity.Matches(original, differentParticipant));
        Assert.False(PaymentAttemptRegistrationIdentity.Matches(original, differentProgram));
    }

    private static CreateRegistrationRequest Registration(params CreateGroupDto[] groups) => new()
    {
        EventId = 10,
        EventName = "Test Event",
        ContactName = "Contact",
        ContactEmail = "contact@example.com",
        Groups = groups.ToList(),
        Payment = new CreatePaymentDto { Amount = 10m },
    };

    private static CreateGroupDto Group(int programId, params CreateParticipantDto[] participants) => new()
    {
        ProgramId = programId,
        ProgramName = $"Program {programId}",
        Fee = 10m,
        Participants = participants.ToList(),
    };

    private static CreateParticipantDto Participant(string name, string dob) => new()
    {
        FullName = name,
        Dob = dob,
    };
}
