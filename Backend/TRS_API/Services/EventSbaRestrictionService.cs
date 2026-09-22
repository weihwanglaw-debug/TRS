using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public sealed class EventSbaRestrictionService
{
    public const string RestrictedCode = StatusCodesEx.Validation.RestrictedSbaPlayer;
    public const string RestrictedPublicMessage =
        "Unable to complete registration. Please contact the event administrator.";

    private static readonly JsonSerializerOptions PayloadJsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly TRSDbContext _db;
    private readonly ILogger<EventSbaRestrictionService> _log;

    public EventSbaRestrictionService(
        TRSDbContext db,
        ILogger<EventSbaRestrictionService> log)
        => (_db, _log) = (db, log);

    public async Task<bool> AcquireEventWriteLockAsync(int eventId, CancellationToken ct = default)
    {
        if (_db.Database.ProviderName?.Contains("SqlServer", StringComparison.OrdinalIgnoreCase) == true)
        {
            var lockedEventId = await _db.Events
                .FromSqlRaw(
                    "SELECT * FROM dbo.Events WITH (UPDLOCK, ROWLOCK) WHERE EventID = {0}",
                    eventId)
                .AsNoTracking()
                .Select(e => e.EventId)
                .SingleOrDefaultAsync(ct);
            return lockedEventId != 0;
        }

        return await _db.Events.AsNoTracking().AnyAsync(e => e.EventId == eventId, ct);
    }

    public async Task<RestrictionValidationResult> ValidatePublicRegistrationAsync(
        CreateRegistrationRequest request,
        CancellationToken ct = default)
    {
        var submittedIds = GetSubmittedSbaIds(request);
        if (submittedIds.Count == 0)
            return RestrictionValidationResult.Ok();

        var blocked = await _db.EventRestrictedSbaPlayers
            .AsNoTracking()
            .AnyAsync(r =>
                r.EventId == request.EventId &&
                r.Event.IsSports &&
                r.Event.SportType != null &&
                r.Event.SportType.Trim().ToUpper() == "BADMINTON" &&
                submittedIds.Contains(r.SbaId),
                ct);

        return blocked
            ? RestrictionValidationResult.Fail(RestrictedCode, RestrictedPublicMessage)
            : RestrictionValidationResult.Ok();
    }

    public async Task<RestrictionValidationResult> ReconcileAsync(
        Event eventEntity,
        IReadOnlyCollection<RestrictedSbaPlayerRequest>? requestedPlayers,
        CancellationToken ct = default)
    {
        if (requestedPlayers == null)
            return RestrictionValidationResult.Ok();

        var invalidId = requestedPlayers
            .Select(p => p.SbaId?.Trim() ?? "")
            .FirstOrDefault(id => id.Length == 0 || id.Length > 20);
        if (invalidId != null)
        {
            return RestrictionValidationResult.Fail(
                "INVALID_SBA_ID",
                "Every restricted player must have an SBA ID of 20 characters or fewer.");
        }

        var requestedIds = requestedPlayers
            .Select(p => NormalizeSbaId(p.SbaId))
            .ToHashSet(StringComparer.Ordinal);
        var currentById = eventEntity.RestrictedSbaPlayers
            .ToDictionary(p => NormalizeSbaId(p.SbaId), StringComparer.Ordinal);
        var addedIds = requestedIds.Except(currentById.Keys, StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);

        if (addedIds.Count > 0)
        {
            var conflicts = await FindConflictsAsync(eventEntity.EventId, addedIds, ct);
            if (conflicts.Count > 0)
            {
                return RestrictionValidationResult.Fail(
                    StatusCodesEx.Validation.RestrictedSbaPlayerConflict,
                    BuildConflictMessage(conflicts),
                    conflicts);
            }

            var rankingRows = await _db.SbaRankings
                .AsNoTracking()
                .Where(r => addedIds.Contains(r.Player1SbaId) ||
                            (r.Player2SbaId != null && addedIds.Contains(r.Player2SbaId)))
                .ToListAsync(ct);
            var namesById = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var row in rankingRows)
            {
                var player1Id = NormalizeSbaId(row.Player1SbaId);
                if (addedIds.Contains(player1Id))
                    namesById.TryAdd(player1Id, row.Player1Name);

                if (!string.IsNullOrWhiteSpace(row.Player2SbaId))
                {
                    var player2Id = NormalizeSbaId(row.Player2SbaId);
                    if (addedIds.Contains(player2Id) && !string.IsNullOrWhiteSpace(row.Player2Name))
                        namesById.TryAdd(player2Id, row.Player2Name!);
                }
            }

            var missingIds = addedIds.Where(id => !namesById.ContainsKey(id)).OrderBy(id => id).ToList();
            if (missingIds.Count > 0)
            {
                return RestrictionValidationResult.Fail(
                    "SBA_MEMBER_NOT_FOUND",
                    $"The following SBA member ID(s) are no longer available in the SBA ranking data: {string.Join(", ", missingIds)}.");
            }

            foreach (var id in addedIds.OrderBy(id => id))
            {
                eventEntity.RestrictedSbaPlayers.Add(new EventRestrictedSbaPlayer
                {
                    EventId = eventEntity.EventId,
                    SbaId = id,
                    PlayerNameSnapshot = namesById[id],
                    CreatedAt = DateTime.UtcNow,
                });
            }
        }

        var removed = eventEntity.RestrictedSbaPlayers
            .Where(player => !requestedIds.Contains(NormalizeSbaId(player.SbaId)))
            .ToList();
        if (removed.Count > 0)
            _db.EventRestrictedSbaPlayers.RemoveRange(removed);

        return RestrictionValidationResult.Ok();
    }

    public static string NormalizeSbaId(string? value) =>
        value?.Trim().ToUpperInvariant() ?? "";

    public static bool SupportsRestrictions(bool isSports, string? sportType) =>
        isSports && string.Equals(sportType?.Trim(), "Badminton", StringComparison.OrdinalIgnoreCase);

    private async Task<List<EventSbaRestrictionConflict>> FindConflictsAsync(
        int eventId,
        HashSet<string> addedIds,
        CancellationToken ct)
    {
        var registrationConflicts = await _db.ParticipantGroups
            .AsNoTracking()
            .Where(g =>
                g.EventId == eventId &&
                g.GroupStatus != StatusCodesEx.Registration.Cancelled &&
                g.Registration.RegStatus != StatusCodesEx.Registration.Cancelled)
            .SelectMany(g => g.Participants
                .Where(p =>
                    p.ParticipantStatus != StatusCodesEx.Participant.Cancelled &&
                    p.SbaId != null &&
                    addedIds.Contains(p.SbaId.Trim().ToUpper()))
                .Select(p => new EventSbaRestrictionConflict
                {
                    SbaId = p.SbaId!.Trim().ToUpper(),
                    ConflictType = "registration",
                    RegistrationId = g.RegistrationId,
                    GroupId = g.GroupId,
                    ParticipantName = p.FullName,
                    ProgramName = g.ProgramName,
                }))
            .ToListAsync(ct);

        var now = DateTime.UtcNow;
        var paymentAttempts = await _db.PaymentAttempts
            .AsNoTracking()
            .Where(a =>
                a.EventId == eventId &&
                (((a.Status == StatusCodesEx.PaymentAttempt.Created ||
                   a.Status == StatusCodesEx.PaymentAttempt.Submitted) && a.ExpiresAt > now) ||
                 (a.Status == StatusCodesEx.PaymentAttempt.NeedsReconciliation && a.ResolvedAt == null) ||
                 (a.Status == StatusCodesEx.PaymentAttempt.Succeeded && a.RegistrationId == null)))
            .Select(a => new { a.PaymentAttemptId, a.PayloadJson })
            .ToListAsync(ct);

        var pendingCheckouts = await _db.PendingCheckouts
            .AsNoTracking()
            .Where(p => p.EventId == eventId && p.ExpiresAt > now)
            .Select(p => new { p.GatewaySessionId, p.PayloadJson })
            .ToListAsync(ct);

        var conflicts = new List<EventSbaRestrictionConflict>(registrationConflicts);
        foreach (var attempt in paymentAttempts)
        {
            AddPaymentConflicts(
                conflicts,
                addedIds,
                attempt.PayloadJson,
                "paymentAttempt",
                attempt.PaymentAttemptId,
                null);
        }

        foreach (var checkout in pendingCheckouts)
        {
            AddPaymentConflicts(
                conflicts,
                addedIds,
                checkout.PayloadJson,
                "pendingCheckout",
                null,
                checkout.GatewaySessionId);
        }

        return conflicts
            .GroupBy(c => new { c.SbaId, c.ConflictType, c.RegistrationId, c.GroupId, c.PaymentAttemptId, c.GatewaySessionId })
            .Select(g => g.First())
            .OrderBy(c => c.SbaId)
            .ThenBy(c => c.ConflictType)
            .ToList();
    }

    private void AddPaymentConflicts(
        ICollection<EventSbaRestrictionConflict> conflicts,
        HashSet<string> addedIds,
        string payloadJson,
        string conflictType,
        int? paymentAttemptId,
        string? gatewaySessionId)
    {
        CreateRegistrationRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<CreateRegistrationRequest>(payloadJson, PayloadJsonOptions);
        }
        catch (JsonException ex)
        {
            _log.LogWarning(ex, "Cannot inspect active {ConflictType} registration payload for SBA restrictions", conflictType);
            foreach (var id in addedIds)
            {
                conflicts.Add(new EventSbaRestrictionConflict
                {
                    SbaId = id,
                    ConflictType = conflictType,
                    PaymentAttemptId = paymentAttemptId,
                    GatewaySessionId = gatewaySessionId,
                });
            }
            return;
        }

        if (request == null)
        {
            foreach (var id in addedIds)
            {
                conflicts.Add(new EventSbaRestrictionConflict
                {
                    SbaId = id,
                    ConflictType = conflictType,
                    PaymentAttemptId = paymentAttemptId,
                    GatewaySessionId = gatewaySessionId,
                });
            }
            return;
        }

        foreach (var id in GetSubmittedSbaIds(request).Where(addedIds.Contains))
        {
            conflicts.Add(new EventSbaRestrictionConflict
            {
                SbaId = id,
                ConflictType = conflictType,
                PaymentAttemptId = paymentAttemptId,
                GatewaySessionId = gatewaySessionId,
            });
        }
    }

    private static HashSet<string> GetSubmittedSbaIds(CreateRegistrationRequest request) =>
        (request.Groups ?? [])
            .SelectMany(group => group.Participants ?? [])
            .Select(participant => NormalizeSbaId(participant.SbaId))
            .Where(id => id.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

    private static string BuildConflictMessage(IReadOnlyCollection<EventSbaRestrictionConflict> conflicts)
    {
        var registrationIds = conflicts
            .Where(c => c.RegistrationId.HasValue)
            .Select(c => c.RegistrationId!.Value)
            .Distinct()
            .OrderBy(id => id)
            .ToList();
        var hasPaymentInProgress = conflicts.Any(c => c.ConflictType != "registration");

        var parts = new List<string>();
        if (registrationIds.Count > 0)
        {
            parts.Add(
                $"Active registration(s) {string.Join(", ", registrationIds.Select(id => $"#{id}"))} contain one or more selected SBA IDs. " +
                "Cancel the affected participant or entry through the normal cancellation workflow, then try again.");
        }

        if (hasPaymentInProgress)
        {
            parts.Add(
                "One or more selected SBA IDs also have a payment in progress or awaiting reconciliation. " +
                "Wait for the payment to reach a final outcome before trying again.");
        }

        return string.Join(" ", parts);
    }
}

public sealed class RestrictionValidationResult
{
    public bool Success { get; private init; }
    public string? Code { get; private init; }
    public string Message { get; private init; } = "";
    public IReadOnlyList<EventSbaRestrictionConflict> Conflicts { get; private init; } = [];

    public static RestrictionValidationResult Ok() => new() { Success = true };

    public static RestrictionValidationResult Fail(
        string code,
        string message,
        IReadOnlyList<EventSbaRestrictionConflict>? conflicts = null) => new()
    {
        Success = false,
        Code = code,
        Message = message,
        Conflicts = conflicts ?? [],
    };
}

public sealed class EventSbaRestrictionConflict
{
    public string SbaId { get; init; } = "";
    public string ConflictType { get; init; } = "registration";
    public int? RegistrationId { get; init; }
    public int? GroupId { get; init; }
    public string? ParticipantName { get; init; }
    public string? ProgramName { get; init; }
    public int? PaymentAttemptId { get; init; }
    public string? GatewaySessionId { get; init; }
}
