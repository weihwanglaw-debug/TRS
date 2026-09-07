using System.Security.Cryptography;
using System.Text;

namespace TRS_API.Services;

public static class PaymentAttemptAccessKey
{
    public const string HeaderName = "X-Payment-Attempt-Key";
    public const string ClientTokenHeaderName = "X-TRS-Client-Token";
    public const int MinimumLength = 32;
    public const int MaximumLength = 120;

    public static string NormalizeOrGenerate(string? value)
    {
        var normalized = value?.Trim();
        return IsWellFormed(normalized)
            ? normalized!
            : Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    }

    public static bool Matches(string storedKey, string? suppliedKey)
    {
        var normalized = suppliedKey?.Trim();
        if (!IsWellFormed(normalized) || string.IsNullOrWhiteSpace(storedKey))
            return false;

        var storedHash = SHA256.HashData(Encoding.UTF8.GetBytes(storedKey));
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized!));
        return CryptographicOperations.FixedTimeEquals(storedHash, suppliedHash);
    }

    public static string PartitionKey(string? value, string fallback)
    {
        var normalized = value?.Trim();
        if (!IsWellFormed(normalized)) return fallback;

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized!));
        return Convert.ToHexString(hash);
    }

    private static bool IsWellFormed(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Length >= MinimumLength &&
        value.Length <= MaximumLength;
}
