using TRS_API.Services;

namespace TRS.Tests;

public class PaymentAttemptAccessKeyTests
{
    [Fact]
    public void NormalizeOrGenerate_PreservesWellFormedClientKey()
    {
        var supplied = $"trs_attempt_{Guid.NewGuid():N}";

        var actual = PaymentAttemptAccessKey.NormalizeOrGenerate($"  {supplied}  ");

        Assert.Equal(supplied, actual);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("too-short")]
    public void NormalizeOrGenerate_ReplacesMissingOrWeakKey(string? supplied)
    {
        var actual = PaymentAttemptAccessKey.NormalizeOrGenerate(supplied);

        Assert.InRange(actual.Length, PaymentAttemptAccessKey.MinimumLength, PaymentAttemptAccessKey.MaximumLength);
        Assert.NotEqual(supplied, actual);
    }

    [Fact]
    public void Matches_RequiresTheFullSecretKey()
    {
        var stored = $"trs_attempt_{Guid.NewGuid():N}";

        Assert.True(PaymentAttemptAccessKey.Matches(stored, stored));
        Assert.True(PaymentAttemptAccessKey.Matches(stored, $"  {stored}  "));
        Assert.False(PaymentAttemptAccessKey.Matches(stored, $"trs_attempt_{Guid.NewGuid():N}"));
        Assert.False(PaymentAttemptAccessKey.Matches(stored, null));
    }

    [Fact]
    public void PartitionKey_IsStableAndDoesNotExposeTheSecret()
    {
        var secret = $"trs_attempt_{Guid.NewGuid():N}";

        var first = PaymentAttemptAccessKey.PartitionKey(secret, "fallback");
        var second = PaymentAttemptAccessKey.PartitionKey(secret, "fallback");

        Assert.Equal(first, second);
        Assert.NotEqual(secret, first);
        Assert.Equal(64, first.Length);
    }
}
