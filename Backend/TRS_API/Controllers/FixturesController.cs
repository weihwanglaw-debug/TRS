using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

[ApiController, Route("api/fixtures"), Authorize(Roles = "superadmin,eventadmin")]
public class FixturesController : ControllerBase
{
    private readonly TRSDbContext _db;
    private readonly AuthService _auth;
    private readonly FixtureGenerationService _fixtureGeneration;
    private readonly AdminAuditService _audit;
    private readonly JsonSerializerOptions _fixtureJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public FixturesController(TRSDbContext db, AuthService auth, FixtureGenerationService fixtureGeneration, AdminAuditService audit)
        => (_db, _auth, _fixtureGeneration, _audit) = (db, auth, fixtureGeneration, audit);

    [HttpGet("status")]
    public async Task<IActionResult> GetStatus([FromQuery] string? programIds)
    {
        if (string.IsNullOrWhiteSpace(programIds))
            return Ok(new Dictionary<string, bool>());

        var ids = programIds
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var n) ? n : 0)
            .Where(n => n > 0)
            .Distinct()
            .ToList();

        if (!ids.Any())
            return Ok(new Dictionary<string, bool>());

        var existing = await _db.Fixtures
            .Where(f => ids.Contains(f.ProgramId))
            .Select(f => f.ProgramId)
            .ToListAsync();

        var result = ids.ToDictionary(id => id.ToString(), id => existing.Contains(id));
        return Ok(result);
    }

    [HttpGet("{eventId:int}/{programId:int}")]
    public async Task<IActionResult> Get(int eventId, int programId)
    {
        var f = await _db.Fixtures.FirstOrDefaultAsync(x => x.EventId == eventId && x.ProgramId == programId);
        if (f == null) return Ok(new { fixture = (object?)null });

        return Ok(new
        {
            eventId,
            programId,
            f.FixtureMode,
            f.FixtureFormat,
            f.IsLocked,
            f.Phase,
            bracketStateJson = f.BracketStateJson,
            f.UpdatedAt,
        });
    }

    [HttpPost("{eventId:int}/{programId:int}/generate")]
    public async Task<IActionResult> Generate(int eventId, int programId, [FromBody] GenerateFixtureRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.GenerateAsync(eventId, programId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_Generate",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureSnapshot(oldState),
            FixtureSnapshot(result.State),
            "Generated fixture.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/swap")]
    public async Task<IActionResult> Swap(int eventId, int programId, [FromBody] SwapFixtureTeamsRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.SwapTeamsAsync(eventId, programId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_SwapTeams",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureTeamOrderSnapshot(oldState, req.IdA, req.IdB),
            FixtureTeamOrderSnapshot(result.State, req.IdA, req.IdB),
            $"Swapped fixture entries {req.IdA} and {req.IdB}.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/advance-to-knockout")]
    public async Task<IActionResult> AdvanceToKnockout(int eventId, int programId)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.AdvanceToKnockoutAsync(eventId, programId);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_AdvanceToKnockout",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureSnapshot(oldState),
            FixtureSnapshot(result.State),
            "Generated knockout bracket from group standings.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/advance-round")]
    public async Task<IActionResult> AdvanceRound(int eventId, int programId)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.AdvanceKnockoutRoundAsync(eventId, programId);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_AdvanceRound",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureSnapshot(oldState),
            FixtureSnapshot(result.State),
            "Generated next knockout round.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/reset-latest-round")]
    public async Task<IActionResult> ResetLatestRound(int eventId, int programId)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.ResetLatestKnockoutRoundAsync(eventId, programId);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_ResetLatestRound",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureSnapshot(oldState),
            FixtureSnapshot(result.State),
            "Reset latest knockout round.");

        return Ok(result.State);
    }

    [HttpPatch("{eventId:int}/{programId:int}/score/{matchId}")]
    public async Task<IActionResult> SaveScore(int eventId, int programId, string matchId, [FromBody] SaveFixtureScoreRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.SaveScoreAsync(eventId, programId, matchId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_SaveScore",
            "FixtureMatch",
            MatchEntityId(eventId, programId, matchId),
            MatchSnapshot(FindMatch(oldState, matchId)),
            MatchSnapshot(FindMatch(result.State, matchId)),
            "Saved match result.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/score/{matchId}/clear")]
    public async Task<IActionResult> ClearScore(int eventId, int programId, string matchId)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.ClearScoreAsync(eventId, programId, matchId);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_ClearScore",
            "FixtureMatch",
            MatchEntityId(eventId, programId, matchId),
            MatchSnapshot(FindMatch(oldState, matchId)),
            MatchSnapshot(FindMatch(result.State, matchId)),
            "Cleared match result.");

        return Ok(result.State);
    }

    [HttpPatch("{eventId:int}/{programId:int}/schedule/{matchId}")]
    public async Task<IActionResult> UpdateSchedule(int eventId, int programId, string matchId, [FromBody] UpdateFixtureScheduleRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.UpdateScheduleAsync(eventId, programId, matchId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_UpdateMatchDetails",
            "FixtureMatch",
            MatchEntityId(eventId, programId, matchId),
            MatchScheduleSnapshot(FindMatch(oldState, matchId)),
            MatchScheduleSnapshot(FindMatch(result.State, matchId)),
            "Updated match court/date/time.");

        return Ok(result.State);
    }

    [HttpPatch("{eventId:int}/{programId:int}/heats/result")]
    public async Task<IActionResult> SaveHeatResult(int eventId, int programId, [FromBody] SaveHeatResultRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.SaveHeatResultAsync(eventId, programId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_SaveHeatResult",
            "HeatResult",
            HeatResultEntityId(eventId, programId, req.RoundNumber, req.TeamId),
            HeatResultSnapshot(FindHeatResult(oldState, req.RoundNumber, req.TeamId)),
            HeatResultSnapshot(FindHeatResult(result.State, req.RoundNumber, req.TeamId)),
            "Saved heat result.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/heats/advance")]
    public async Task<IActionResult> AdvanceHeatsRound(int eventId, int programId, [FromBody] AdvanceHeatsRoundRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.AdvanceHeatsRoundAsync(eventId, programId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_AdvanceHeatsRound",
            "HeatRound",
            HeatRoundEntityId(eventId, programId, req.FromRound),
            HeatRoundSnapshot(FindHeatRound(oldState, req.FromRound)),
            HeatRoundSnapshot(FindHeatRound(result.State, req.FromRound)),
            "Advanced heat round.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}/heats/places")]
    public async Task<IActionResult> AssignHeatPlaces(int eventId, int programId, [FromBody] AssignHeatPlacesRequest req)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var result = await _fixtureGeneration.AssignHeatPlacesAsync(eventId, programId, req);
        if (!result.Success)
            return BadRequest(new { code = result.Code, message = result.Message });

        await AuditAsync(
            "Fixture_AssignHeatPlaces",
            "Fixture",
            FixtureEntityId(eventId, programId),
            HeatPlacesSnapshot(oldState),
            HeatPlacesSnapshot(result.State),
            "Assigned final heat places.");

        return Ok(result.State);
    }

    [HttpPost("{eventId:int}/{programId:int}")]
    public async Task<IActionResult> Save(int eventId, int programId, [FromBody] SaveFixtureRequest req)
    {
        var rawSaveValidation = ValidateRawFixtureSave(req.BracketStateJson);
        if (rawSaveValidation != null)
            return BadRequest(rawSaveValidation);

        var oldState = await LoadFixtureStateAsync(eventId, programId);
        await using var tx = await _db.Database.BeginTransactionAsync();
        var f = await _db.Fixtures
            .FromSqlInterpolated($@"
                SELECT *
                FROM dbo.Fixtures WITH (UPDLOCK, ROWLOCK)
                WHERE EventID = {eventId} AND ProgramID = {programId}")
            .AsTracking()
            .FirstOrDefaultAsync();
        if (f?.IsLocked == true)
            return BadRequest(new { code = "LOCKED", message = "Cannot overwrite fixture state after results have been entered." });

        if (f == null)
        {
            f = new Fixture
            {
                EventId = eventId,
                ProgramId = programId,
                CreatedAt = DateTime.UtcNow,
                GeneratedBy = _auth.GetUserId(User),
            };
            _db.Fixtures.Add(f);
        }

        f.BracketStateJson = req.BracketStateJson;
        f.FixtureFormat = req.FixtureFormat;
        f.Phase = req.Phase;
        f.IsLocked = req.IsLocked;
        f.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        var newState = ParseFixtureState(req.BracketStateJson);
        await AuditAsync(
            "Fixture_SaveRawState",
            "Fixture",
            FixtureEntityId(eventId, programId),
            FixtureSnapshot(oldState),
            FixtureSnapshot(newState),
            "Saved fixture state.");

        return Ok(new { eventId, programId, f.FixtureFormat, f.IsLocked, f.Phase });
    }

    [HttpDelete("{eventId:int}/{programId:int}")]
    public async Task<IActionResult> Delete(int eventId, int programId)
    {
        var oldState = await LoadFixtureStateAsync(eventId, programId);
        var f = await _db.Fixtures.FirstOrDefaultAsync(x => x.EventId == eventId && x.ProgramId == programId);
        if (f != null)
        {
            if (f.IsLocked)
                return BadRequest(new { code = "LOCKED", message = "Cannot reset a fixture after results have been entered." });

            _db.Fixtures.Remove(f);
            await _db.SaveChangesAsync();

            await AuditAsync(
                "Fixture_Reset",
                "Fixture",
                FixtureEntityId(eventId, programId),
                FixtureSnapshot(oldState),
                null,
                "Reset fixture.");
        }

        return Ok();
    }

    private static object? ValidateRawFixtureSave(string bracketStateJson)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bracketStateJson);
        }
        catch
        {
            return new { code = "INVALID_STATE", message = "Fixture state is invalid JSON." };
        }

        using (document)
        {
            var root = document.RootElement;
            if (HasResultBearingMatches(root, "matches") || HasResultBearingGroupMatches(root))
                return new { code = "INVALID_STATE", message = "Raw fixture save cannot include match results." };
            if (HasResultBearingHeatRounds(root))
                return new { code = "INVALID_STATE", message = "Raw fixture save cannot include heat results or placements." };
        }

        return null;
    }

    private static bool HasResultBearingGroupMatches(JsonElement root)
    {
        if (!root.TryGetProperty("groups", out var groups) || groups.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var group in groups.EnumerateArray())
        {
            if (HasResultBearingMatches(group, "matches"))
                return true;
        }

        return false;
    }

    private static bool HasResultBearingMatches(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var matches) || matches.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var match in matches.EnumerateArray())
        {
            if (HasNonBlankString(match, "winner") ||
                HasTrueBoolean(match, "walkover") ||
                HasNonBlankString(match, "walkoverWinner") ||
                HasStatusResult(match) ||
                HasFilledGame(match))
                return true;
        }

        return false;
    }

    private static bool HasResultBearingHeatRounds(JsonElement root)
    {
        if (!root.TryGetProperty("heatRounds", out var rounds) || rounds.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var round in rounds.EnumerateArray())
        {
            if (HasTrueBoolean(round, "isComplete"))
                return true;

            if (!round.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
                continue;

            foreach (var result in results.EnumerateArray())
            {
                if (HasNonBlankString(result, "result") ||
                    HasTrueBoolean(result, "advanced") ||
                    (result.TryGetProperty("place", out var place) && place.ValueKind != JsonValueKind.Null && place.ValueKind != JsonValueKind.Undefined))
                    return true;
            }
        }

        return false;
    }

    private static bool HasStatusResult(JsonElement match)
    {
        if (!match.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String)
            return false;

        var value = status.GetString();
        return !string.IsNullOrWhiteSpace(value) && value != StatusCodesEx.Match.Scheduled;
    }

    private static bool HasFilledGame(JsonElement match)
    {
        if (!match.TryGetProperty("games", out var games) || games.ValueKind != JsonValueKind.Array)
            return false;

        foreach (var game in games.EnumerateArray())
        {
            if (HasNonBlankString(game, "p1") || HasNonBlankString(game, "p2"))
                return true;
        }

        return false;
    }

    private static bool HasNonBlankString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) &&
        property.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(property.GetString());

    private static bool HasTrueBoolean(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) &&
        property.ValueKind == JsonValueKind.True;

    private async Task AuditAsync(string action, string entityType, string entityId, object? oldValue, object? newValue, string notes) =>
        await _audit.LogAsync(
            User,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            action,
            entityType,
            entityId,
            oldValue,
            newValue,
            notes);

    private async Task<FixtureGenerationService.FixtureState?> LoadFixtureStateAsync(int eventId, int programId)
    {
        var json = await _db.Fixtures
            .AsNoTracking()
            .Where(f => f.EventId == eventId && f.ProgramId == programId)
            .Select(f => f.BracketStateJson)
            .FirstOrDefaultAsync();

        return ParseFixtureState(json);
    }

    private FixtureGenerationService.FixtureState? ParseFixtureState(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<FixtureGenerationService.FixtureState>(json, _fixtureJsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private static string FixtureEntityId(int eventId, int programId) => $"{eventId}:{programId}";
    private static string MatchEntityId(int eventId, int programId, string matchId) => $"{eventId}:{programId}:{matchId}";
    private static string HeatRoundEntityId(int eventId, int programId, int roundNumber) => $"{eventId}:{programId}:{roundNumber}";
    private static string HeatResultEntityId(int eventId, int programId, int roundNumber, string teamId) => $"{eventId}:{programId}:{roundNumber}:{teamId}";

    private static object? FixtureSnapshot(FixtureGenerationService.FixtureState? state)
    {
        if (state == null) return null;
        var allMatches = state.Groups.SelectMany(g => g.Matches).Concat(state.Matches).ToList();
        return new
        {
            state.Format,
            state.Phase,
            state.Locked,
            GroupCount = state.Groups.Count,
            MatchCount = allMatches.Count,
            CompletedMatchCount = allMatches.Count(m => m.Status == StatusCodesEx.Match.Completed || m.Status == StatusCodesEx.Match.Walkover),
            HeatRoundCount = state.HeatRounds?.Count ?? 0,
            CompletedHeatRoundCount = state.HeatRounds?.Count(r => r.IsComplete) ?? 0,
        };
    }

    private static object? FixtureTeamOrderSnapshot(FixtureGenerationService.FixtureState? state, string idA, string idB)
    {
        if (state == null) return null;
        var teams = new List<FixtureGenerationService.FixtureTeam>();
        teams.AddRange(state.Groups.SelectMany(g => g.Teams));
        teams.AddRange(state.Matches.SelectMany(m => new[] { m.Team1, m.Team2 }));

        return new
        {
            state.Format,
            state.Phase,
            SwappedIds = new[] { idA, idB },
            Teams = teams
                .Where(t => !string.IsNullOrWhiteSpace(t.Id) && !t.Id.StartsWith("bye-", StringComparison.OrdinalIgnoreCase))
                .GroupBy(t => t.Id)
                .Select(g => g.First())
                .Select(t => new { t.Id, t.Label, t.Seed, t.Participants })
                .ToList(),
        };
    }

    private static FixtureGenerationService.FixtureMatch? FindMatch(FixtureGenerationService.FixtureState? state, string matchId)
    {
        if (state == null) return null;
        return state.Groups.SelectMany(g => g.Matches)
            .Concat(state.Matches)
            .FirstOrDefault(m => string.Equals(m.Id, matchId, StringComparison.Ordinal));
    }

    private static object? MatchSnapshot(FixtureGenerationService.FixtureMatch? match)
    {
        if (match == null) return null;
        return new
        {
            match.Id,
            match.Phase,
            match.Round,
            match.RoundLabel,
            match.GroupId,
            Team1 = TeamSnapshot(match.Team1),
            Team2 = TeamSnapshot(match.Team2),
            match.Status,
            match.Winner,
            match.Walkover,
            match.WalkoverWinner,
            match.Games,
            match.CourtNo,
            match.MatchDate,
            match.StartTime,
            match.EndTime,
            match.Officials,
            match.Remark,
        };
    }

    private static object? MatchScheduleSnapshot(FixtureGenerationService.FixtureMatch? match)
    {
        if (match == null) return null;
        return new
        {
            match.Id,
            match.Round,
            match.RoundLabel,
            Team1 = TeamSnapshot(match.Team1),
            Team2 = TeamSnapshot(match.Team2),
            match.CourtNo,
            match.MatchDate,
            match.StartTime,
            match.EndTime,
        };
    }

    private static object TeamSnapshot(FixtureGenerationService.FixtureTeam team) => new
    {
        team.Id,
        team.Label,
        team.Seed,
        team.Participants,
    };

    private static FixtureGenerationService.HeatRound? FindHeatRound(FixtureGenerationService.FixtureState? state, int roundNumber) =>
        state?.HeatRounds?.FirstOrDefault(r => r.RoundNumber == roundNumber);

    private static FixtureGenerationService.HeatParticipantResult? FindHeatResult(FixtureGenerationService.FixtureState? state, int roundNumber, string teamId) =>
        FindHeatRound(state, roundNumber)?.Results.FirstOrDefault(r => string.Equals(r.TeamId, teamId, StringComparison.Ordinal));

    private static object? HeatResultSnapshot(FixtureGenerationService.HeatParticipantResult? result)
    {
        if (result == null) return null;
        return new
        {
            result.TeamId,
            result.Result,
            result.Advanced,
            result.Place,
        };
    }

    private static object? HeatRoundSnapshot(FixtureGenerationService.HeatRound? round)
    {
        if (round == null) return null;
        return new
        {
            round.Id,
            round.RoundNumber,
            round.Label,
            round.IsFinal,
            round.IsComplete,
            round.Results,
        };
    }

    private static object? HeatPlacesSnapshot(FixtureGenerationService.FixtureState? state)
    {
        var finalRound = state?.HeatRounds?.FirstOrDefault(r => r.IsFinal);
        if (finalRound == null) return null;
        return new
        {
            finalRound.RoundNumber,
            Places = finalRound.Results
                .Where(r => r.Place.HasValue)
                .OrderBy(r => r.Place)
                .Select(r => new { r.TeamId, r.Place, r.Result })
                .ToList(),
        };
    }
}
