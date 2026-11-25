using TRS_API.Services;
namespace TRS.Tests;
public class FixtureGenerationStatusTests
{
    [Fact]
    public void ClosedAllowsExistingFixtureValidation() =>
        Assert.Null(FixtureGenerationService.GenerationStatusError("CL"));

    [Theory]
    [InlineData("O", "still open for registration")]
    [InlineData("H", "publicly visible")]
    [InlineData("", "Close it")]
    public void OtherStatusesRequireExplicitClosure(string status, string message) =>
        Assert.Contains(message, FixtureGenerationService.GenerationStatusError(status));
}
