namespace TRS_API.Services;

public static class StripeRefundStatusMapper
{
    public static string ToLocalStatus(string? stripeStatus) => stripeStatus switch
    {
        "succeeded" => StatusCodesEx.Refund.Success,
        "failed" or "canceled" => StatusCodesEx.Refund.Failed,
        _ => StatusCodesEx.Refund.Pending,
    };

    public static bool IsTerminal(string localStatus) =>
        localStatus == StatusCodesEx.Refund.Success ||
        localStatus == StatusCodesEx.Refund.Failed;

    public static string MergeLocalStatus(string currentStatus, string incomingStatus) =>
        IsTerminal(currentStatus) ? currentStatus : incomingStatus;

    public static string ResolveCancellationRegistrationStatus(
        string currentRegistrationStatus,
        bool allGroupsCancelled,
        bool isWholeRegistrationCancellation,
        IEnumerable<string> cancellationRefundStatuses)
    {
        var statuses = cancellationRefundStatuses.ToList();
        if (statuses.Count == 0) return currentRegistrationStatus;
        if (statuses.Any(status => status == StatusCodesEx.Refund.Failed))
            return StatusCodesEx.Registration.RefundFailed;
        if (statuses.Any(status => status == StatusCodesEx.Refund.Pending))
        {
            return isWholeRegistrationCancellation
                ? StatusCodesEx.Registration.CancelPending
                : StatusCodesEx.Registration.Confirmed;
        }
        if (allGroupsCancelled) return StatusCodesEx.Registration.Cancelled;

        // A whole-registration cancellation starts in CP. If all refunds are now
        // successful but active groups remain, surface the inconsistent state.
        return isWholeRegistrationCancellation
            ? StatusCodesEx.Registration.RefundFailed
            : StatusCodesEx.Registration.Confirmed;
    }
}
