using TRS_API.Services;

namespace TRS.Tests;

public sealed class EventSbaRestrictionServiceTests
{
    [Theory]
    [InlineData(" sba-123 ", "SBA-123")]
    [InlineData("Member42", "MEMBER42")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void NormalizeSbaId_trims_and_normalizes_case(string? input, string expected)
    {
        Assert.Equal(expected, EventSbaRestrictionService.NormalizeSbaId(input));
    }

    [Fact]
    public void Public_message_does_not_disclose_restriction_details()
    {
        Assert.Equal(
            "Unable to complete registration. Please contact the event administrator.",
            EventSbaRestrictionService.RestrictedPublicMessage);
    }

    [Theory]
    [InlineData(true, "Badminton", true)]
    [InlineData(true, " badminton ", true)]
    [InlineData(true, "Non Badminton", false)]
    [InlineData(false, "Badminton", false)]
    [InlineData(false, null, false)]
    public void SupportsRestrictions_requires_a_sports_badminton_event(
        bool isSports,
        string? sportType,
        bool expected)
    {
        Assert.Equal(expected, EventSbaRestrictionService.SupportsRestrictions(isSports, sportType));
    }
}
