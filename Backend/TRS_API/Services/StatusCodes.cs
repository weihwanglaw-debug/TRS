namespace TRS_API.Services;

public static class StatusCodesEx
{
    public static class Registration
    {
        public const string Pending = "P";
        public const string Confirmed = "C";
        public const string Cancelled = "X";
        public const string CancelPending = "CP";
        public const string RefundFailed = "RF";
    }

    public static class Participant
    {
        public const string Active = "A";
        public const string Cancelled = "X";
    }

    public static class Payment
    {
        public const string Pending = "P";
        public const string Success = "S";
        public const string PartiallyRefunded = "PR";
        public const string FullyRefunded = "FR";
        public const string Failed = "F";
        public const string Cancelled = "X";
        public const string Waived = "W";
        public const string PendingCollection = "PC";
    }

    public static class PaymentItem
    {
        public const string Pending = "P";
        public const string Success = "S";
        public const string Refunded = "R";
        public const string Cancelled = "X";
    }

    public static class Refund
    {
        public const string Pending = "P";
        public const string Success = "S";
        public const string Failed = "F";
    }

    public static class EventRegistration
    {
        public const string Open = "O";
        public const string Paused = "PA";
        public const string Closed = "CL";
        public const string Draft = "D";
        public const string Upcoming = "U";
    }

    public static class Program
    {
        public const string Open = "O";
        public const string Closed = "CL";
        public const string Upcoming = "U";
        public const string Full = "F";
        public const string NearlyFull = "NF";
    }

    public static class Match
    {
        public const string Scheduled = "SC";
        public const string InProgress = "IP";
        public const string Completed = "C";
        public const string Walkover = "W";
    }

    public static class PaymentAttempt
    {
        public const string Created = "CR";
        public const string Submitted = "SB";
        public const string Succeeded = "S";
        public const string Failed = "F";
        public const string Canceled = "X";
        public const string Expired = "EX";
        public const string NeedsReconciliation = "NR";
    }

    public static class Processing
    {
        public const string Pending = "P";
        public const string Success = "S";
        public const string Failed = "F";
        public const string Ignored = "I";
    }
}
