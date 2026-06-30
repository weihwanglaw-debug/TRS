using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using TRS_Data.Models;

namespace TRS_API.Services;

public class AdminAuditService
{
    private readonly TRSDbContext _db;
    private readonly AuthService _auth;
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public AdminAuditService(TRSDbContext db, AuthService auth)
        => (_db, _auth) = (db, auth);

    public async Task LogAsync(
        ClaimsPrincipal user,
        string? ipAddress,
        string action,
        string entityType,
        string entityId,
        object? oldValue,
        object? newValue,
        string? notes = null)
    {
        var oldJson = SerializeSnapshot(oldValue);
        var newJson = SerializeSnapshot(newValue);
        var audit = new AdminAuditLog
        {
            UserId = _auth.GetUserId(user),
            UserEmail = user.FindFirst(JwtRegisteredClaimNames.Email)?.Value
                ?? user.FindFirst(ClaimTypes.Email)?.Value,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            OldValue = oldJson,
            NewValue = newJson,
            IpAddress = ipAddress,
            Notes = notes,
            CreatedAt = DateTime.UtcNow,
        };

        foreach (var detail in BuildDetails(oldJson, newJson))
            audit.Details.Add(detail);

        _db.AdminAuditLogs.Add(audit);
        await _db.SaveChangesAsync();
    }

    private string? SerializeSnapshot(object? snapshot) =>
        snapshot == null ? null : JsonSerializer.Serialize(snapshot, _jsonOptions);

    private List<AdminAuditLogDetail> BuildDetails(string? oldJson, string? newJson)
    {
        var oldMap = Flatten(oldJson);
        var newMap = Flatten(newJson);
        var keys = oldMap.Keys.Union(newMap.Keys).OrderBy(k => k, StringComparer.Ordinal);
        var rows = new List<AdminAuditLogDetail>();

        foreach (var key in keys)
        {
            oldMap.TryGetValue(key, out var oldValue);
            newMap.TryGetValue(key, out var newValue);
            if (oldValue.Value == newValue.Value)
                continue;

            rows.Add(new AdminAuditLogDetail
            {
                FieldName = key,
                OldValue = oldValue.Value,
                NewValue = newValue.Value,
                ValueType = newValue.Type ?? oldValue.Type,
                CreatedAt = DateTime.UtcNow,
            });
        }

        return rows;
    }

    private static Dictionary<string, AuditValue> Flatten(string? json)
    {
        var map = new Dictionary<string, AuditValue>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json))
            return map;

        using var doc = JsonDocument.Parse(json);
        FlattenElement(doc.RootElement, "", map);
        return map;
    }

    private static void FlattenElement(JsonElement element, string path, Dictionary<string, AuditValue> map)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in element.EnumerateObject())
                    FlattenElement(prop.Value, JoinPath(path, prop.Name), map);
                break;

            case JsonValueKind.Array:
                map[path] = new AuditValue(element.GetRawText(), "array");
                break;

            case JsonValueKind.String:
                map[path] = new AuditValue(element.GetString(), "string");
                break;

            case JsonValueKind.Number:
                map[path] = new AuditValue(element.GetRawText(), "number");
                break;

            case JsonValueKind.True:
            case JsonValueKind.False:
                map[path] = new AuditValue(element.GetRawText(), "boolean");
                break;

            case JsonValueKind.Null:
                map[path] = new AuditValue(null, "null");
                break;
        }
    }

    private static string JoinPath(string prefix, string name) =>
        string.IsNullOrWhiteSpace(prefix) ? name : $"{prefix}.{name}";

    private readonly record struct AuditValue(string? Value, string? Type);
}
