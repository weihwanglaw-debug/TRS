using TRS_API.Services;

namespace TRS.Tests;

public class StripeRefundStatusMapperTests
{
    [Theory]
    [InlineData("succeeded", StatusCodesEx.Refund.Success)]
    [InlineData("failed", StatusCodesEx.Refund.Failed)]
    [InlineData("canceled", StatusCodesEx.Refund.Failed)]
    [InlineData("pending", StatusCodesEx.Refund.Pending)]
    [InlineData("requires_action", StatusCodesEx.Refund.Pending)]
    [InlineData(null, StatusCodesEx.Refund.Pending)]
    public void ToLocalStatus_UsesOnlyTerminalStripeStatusesAsTerminal(string? stripeStatus, string expected)
    {
        Assert.Equal(expected, StripeRefundStatusMapper.ToLocalStatus(stripeStatus));
    }

    [Theory]
    [InlineData(StatusCodesEx.Refund.Success, StatusCodesEx.Refund.Pending, StatusCodesEx.Refund.Success)]
    [InlineData(StatusCodesEx.Refund.Failed, StatusCodesEx.Refund.Success, StatusCodesEx.Refund.Failed)]
    [InlineData(StatusCodesEx.Refund.Pending, StatusCodesEx.Refund.Success, StatusCodesEx.Refund.Success)]
    public void MergeLocalStatus_DoesNotRegressTerminalState(string current, string incoming, string expected)
    {
        Assert.Equal(expected, StripeRefundStatusMapper.MergeLocalStatus(current, incoming));
    }

    [Fact]
    public void ResolveCancellationRegistrationStatus_IsIndependentOfRefundOrder()
    {
        var failedThenSucceeded = StripeRefundStatusMapper.ResolveCancellationRegistrationStatus(
            StatusCodesEx.Registration.CancelPending,
            allGroupsCancelled: false,
            isWholeRegistrationCancellation: true,
            new[] { StatusCodesEx.Refund.Failed, StatusCodesEx.Refund.Success });
        var succeededThenFailed = StripeRefundStatusMapper.ResolveCancellationRegistrationStatus(
            StatusCodesEx.Registration.CancelPending,
            allGroupsCancelled: false,
            isWholeRegistrationCancellation: true,
            new[] { StatusCodesEx.Refund.Success, StatusCodesEx.Refund.Failed });

        Assert.Equal(StatusCodesEx.Registration.RefundFailed, failedThenSucceeded);
        Assert.Equal(failedThenSucceeded, succeededThenFailed);
    }

    [Theory]
    [InlineData(StatusCodesEx.Registration.CancelPending, false, true, StatusCodesEx.Registration.CancelPending)]
    [InlineData(StatusCodesEx.Registration.Confirmed, false, false, StatusCodesEx.Registration.Confirmed)]
    public void ResolveCancellationRegistrationStatus_PreservesPendingScope(
        string currentRegistrationStatus,
        bool allGroupsCancelled,
        bool isWholeRegistrationCancellation,
        string expected)
    {
        var actual = StripeRefundStatusMapper.ResolveCancellationRegistrationStatus(
            currentRegistrationStatus,
            allGroupsCancelled,
            isWholeRegistrationCancellation,
            new[] { StatusCodesEx.Refund.Pending });

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void ResolveCancellationRegistrationStatus_CancelsOnlyWhenAllGroupsAreCancelled()
    {
        var actual = StripeRefundStatusMapper.ResolveCancellationRegistrationStatus(
            StatusCodesEx.Registration.CancelPending,
            allGroupsCancelled: true,
            isWholeRegistrationCancellation: true,
            new[] { StatusCodesEx.Refund.Success, StatusCodesEx.Refund.Success });

        Assert.Equal(StatusCodesEx.Registration.Cancelled, actual);
    }
}
