namespace TRS_API.Services;

public static class ReceiptNumberGenerator
{
    public static string Generate(int? eventId, int? programId)
    {
        var prefix = eventId.HasValue
            ? programId.HasValue
                ? $"E{eventId.Value}-P{programId.Value}"
                : $"E{eventId.Value}"
            : "REG";

        return $"{prefix}-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(10000, 99999):D5}";
    }

    public static string FallbackRegistrationReference(int registrationId) =>
        $"REG-{registrationId:D6}";
}
