using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using TRS_API.Models;
using TRS_Data.Models;

namespace TRS_API.Services;

public class FixtureGenerationService
{
    private readonly TRSDbContext _db;
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public FixtureGenerationService(TRSDbContext db) => _db = db;

    public async Task<FixtureGenerationResult> GenerateAsync(int eventId, int programId, GenerateFixtureRequest req)
    {
        var program = await _db.Programs
            .Include(p => p.Event)
            .FirstOrDefaultAsync(p => p.ProgramId == programId && p.EventId == eventId);
        if (program == null)
            return FixtureGenerationResult.Fail("PROGRAM_NOT_FOUND", "Program not found.");

        var groups = await _db.ParticipantGroups
            .Include(g => g.Participants)
            .Where(g => g.EventId == eventId && g.ProgramId == programId && g.GroupStatus != "Cancelled")
            .OrderBy(g => g.GroupId)
            .ToListAsync();

        if (groups.Count < 2)
            return FixtureGenerationResult.Fail("NOT_ENOUGH", "At least 2 registered entries are required.");

        var normalizedSeeds = NormalizeSeeds(groups, req.Seeds);
        if (!normalizedSeeds.Success)
            return normalizedSeeds;
        var seedEntries = normalizedSeeds.State!.Seeds;

        var config = NormalizeConfig(req.Config);
        if (!config.Success)
            return config;
        var fixtureConfig = config.State!.Config;

        FixtureState state;
        if (!string.IsNullOrWhiteSpace(req.PreviewBracketJson))
        {
            var preview = ValidatePreview(req.PreviewBracketJson!, seedEntries, fixtureConfig);
            if (!preview.Success)
                return preview;
            state = preview.State!;
        }
        else
        {
            state = GenerateState(seedEntries, fixtureConfig);
        }

        foreach (var group in groups)
        {
            var seed = seedEntries.First(s => s.Id == group.GroupId.ToString());
            group.Seed = seed.Seed;
            group.UpdatedAt = DateTime.UtcNow;
        }

        var fixture = await _db.Fixtures.FirstOrDefaultAsync(f => f.EventId == eventId && f.ProgramId == programId);
        if (fixture != null && ExistingFixtureLocked(fixture))
            return FixtureGenerationResult.Fail("LOCKED", "Cannot regenerate a fixture after results have been entered.");

        if (fixture == null)
        {
            fixture = new Fixture
            {
                EventId = eventId,
                ProgramId = programId,
                FixtureMode = program.Event?.FixtureMode ?? "internal",
                CreatedAt = DateTime.UtcNow,
            };
            _db.Fixtures.Add(fixture);
        }

        var stateJson = JsonSerializer.Serialize(state, _jsonOptions);
        fixture.BracketStateJson = stateJson;
        fixture.FixtureFormat = state.Format;
        fixture.Phase = state.Phase;
        fixture.IsLocked = state.Locked;
        fixture.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return FixtureGenerationResult.Ok(state, stateJson);
    }

    public async Task<FixtureGenerationResult> SwapTeamsAsync(int eventId, int programId, SwapFixtureTeamsRequest req)
    {
        if (req.IdA == req.IdB)
            return FixtureGenerationResult.Fail("INVALID_SWAP", "Choose two different teams to swap.");

        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (IsLocked(state))
            return FixtureGenerationResult.Fail("LOCKED", "Cannot swap after results have been entered.");

        if (!state.Seeds.Any(s => s.Id == req.IdA) || !state.Seeds.Any(s => s.Id == req.IdB))
            return FixtureGenerationResult.Fail("INVALID_TEAM", "One or more teams could not be found.");

        var seedA = state.Seeds.First(s => s.Id == req.IdA).Seed;
        var seedB = state.Seeds.First(s => s.Id == req.IdB).Seed;
        foreach (var seed in state.Seeds)
        {
            if (seed.Id == req.IdA) seed.Seed = seedB;
            else if (seed.Id == req.IdB) seed.Seed = seedA;
        }

        var seedsById = state.Seeds.ToDictionary(s => s.Id, StringComparer.Ordinal);
        FixtureTeam SwapTeam(FixtureTeam t)
        {
            if (t.Id == req.IdA) return ToTeam(seedsById[req.IdB]);
            if (t.Id == req.IdB) return ToTeam(seedsById[req.IdA]);
            return t;
        }

        foreach (var group in state.Groups)
        {
            group.Teams = group.Teams.Select(SwapTeam).ToList();
            foreach (var match in group.Matches)
            {
                match.Team1 = SwapTeam(match.Team1);
                match.Team2 = SwapTeam(match.Team2);
            }
        }

        foreach (var match in state.Matches)
        {
            match.Team1 = SwapTeam(match.Team1);
            match.Team2 = SwapTeam(match.Team2);
        }

        if (state.HeatRounds != null)
        {
            foreach (var round in state.HeatRounds)
            {
                foreach (var result in round.Results)
                {
                    if (result.TeamId == req.IdA) result.TeamId = req.IdB;
                    else if (result.TeamId == req.IdB) result.TeamId = req.IdA;
                }
            }
        }

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> AdvanceToKnockoutAsync(int eventId, int programId)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Phase, "group", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_PHASE", "Already in knockout phase.");

        if (!state.Groups.All(g => g.Matches.All(IsCompleted)))
            return FixtureGenerationResult.Fail("GROUP_NOT_DONE", "Complete all group matches before generating the knockout phase.");

        if (string.Equals(state.Format, "round_robin", StringComparison.OrdinalIgnoreCase) &&
            state.Config.AdvancePerGroup == null)
        {
            state.Config.AdvancePerGroup = state.Groups.FirstOrDefault()?.Teams.Count ?? 0;
        }

        state.Phase = "knockout";
        state.Matches = GenerateKnockoutFromGroups(state.Groups, state.Config);
        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> AdvanceKnockoutRoundAsync(int eventId, int programId)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Phase, "knockout", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_PHASE", "This fixture is not in knockout phase.");
        if (!state.Matches.Any())
            return FixtureGenerationResult.Fail("NOT_FOUND", "No knockout matches found.");

        var maxRound = state.Matches.Max(m => m.Round);
        var rounds = state.Matches.Select(m => m.Round).Distinct().OrderBy(r => r).ToList();
        if (!rounds.SequenceEqual(Enumerable.Range(1, rounds.Count)))
            return FixtureGenerationResult.Fail("INVALID_BRACKET", "Knockout rounds are not contiguous.");

        var currentRound = state.Matches.Where(m => m.Round == maxRound).ToList();
        foreach (var byeMatch in currentRound.Where(IsByeMatch))
            AutoCompleteBye(byeMatch);

        if (currentRound.Count <= 1)
            return FixtureGenerationResult.Fail("FINAL_ROUND", "No further knockout rounds remain.");
        if (currentRound.Count % 2 != 0)
            return FixtureGenerationResult.Fail("ODD_ROUND", "Current round has an odd number of matches - cannot pair winners. Check for missing BYE matches.");
        if (currentRound.Any(m => !IsCompleted(m)))
            return FixtureGenerationResult.Fail("ROUND_NOT_DONE", "Complete the current knockout round before advancing.");

        state.Matches.AddRange(GenerateNextKnockoutRound(state.Matches));
        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> ResetLatestKnockoutRoundAsync(int eventId, int programId)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Phase, "knockout", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_PHASE", "This fixture is not in knockout phase.");
        if (!state.Matches.Any())
            return FixtureGenerationResult.Fail("NOT_FOUND", "No knockout matches found.");

        var maxRound = state.Matches.Max(m => m.Round);
        if (maxRound <= 1)
            return FixtureGenerationResult.Fail("FIRST_ROUND", "No generated next round to reset.");

        var latestRound = state.Matches.Where(m => m.Round == maxRound).ToList();
        if (latestRound.Any(HasEnteredResult))
            return FixtureGenerationResult.Fail("ROUND_HAS_RESULTS", "Cannot reset a round after results have been entered.");

        state.Matches = state.Matches.Where(m => m.Round != maxRound).ToList();
        state.Locked = IsLocked(state);
        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> SaveScoreAsync(int eventId, int programId, string matchId, SaveFixtureScoreRequest req)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        var match = FindMatch(state, matchId);
        if (match == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Match not found.");

        var validation = ValidateScoreRequest(match, req);
        if (validation != null)
            return validation;

        match.Games = (req.Games ?? new List<FixtureGameScoreRequest>())
            .Select(g => new GameScore { P1 = g.P1, P2 = g.P2 })
            .ToList();
        if (!match.Games.Any()) match.Games = new List<GameScore> { new() };
        match.Walkover = req.Walkover;
        match.WalkoverWinner = req.Walkover ? req.WalkoverWinner : "";
        match.Winner = req.Walkover ? req.WalkoverWinner : req.Winner;
        match.Officials = req.Officials.Select(o => new OfficialEntry { Id = o.Id, Role = o.Role, Name = o.Name }).ToList();
        match.Remark = req.Remark?.Trim() ?? "";
        match.StartTime = req.StartTime ?? match.StartTime;
        match.EndTime = req.EndTime ?? match.EndTime;
        match.Status = req.Walkover ? "Walkover" : "Completed";
        state.Locked = true;

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> ClearScoreAsync(int eventId, int programId, string matchId)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        var match = FindMatch(state, matchId);
        if (match == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Match not found.");
        if (IsByeMatch(match))
            return FixtureGenerationResult.Fail("BYE_NO_SCORE", "BYE matches are advanced automatically and cannot be cleared.");
        if (string.Equals(match.Phase, "knockout", StringComparison.OrdinalIgnoreCase) &&
            state.Matches.Any(m => m.Round > match.Round))
            return FixtureGenerationResult.Fail("ROUND_ADVANCED", "Reset the later knockout round before clearing this result.");

        match.Games = new List<GameScore> { new() };
        match.Winner = null;
        match.Walkover = false;
        match.WalkoverWinner = "";
        match.Remark = "";
        match.Status = "Scheduled";
        state.Locked = IsLocked(state);

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> UpdateScheduleAsync(int eventId, int programId, string matchId, UpdateFixtureScheduleRequest req)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        var match = FindMatch(state, matchId);
        if (match == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Match not found.");

        match.CourtNo = req.CourtNo ?? "";
        match.MatchDate = req.MatchDate ?? "";
        match.StartTime = req.StartTime ?? "";
        match.EndTime = req.EndTime ?? "";

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> SaveHeatResultAsync(int eventId, int programId, SaveHeatResultRequest req)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Format, "heats", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_FORMAT", "This fixture is not using heats.");

        var round = (state.HeatRounds ?? new List<HeatRound>()).FirstOrDefault(r => r.RoundNumber == req.RoundNumber);
        if (round == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Heat round not found.");
        if (round.IsComplete)
            return FixtureGenerationResult.Fail("ROUND_COMPLETE", "Completed heat rounds cannot be edited.");

        var result = round.Results.FirstOrDefault(r => r.TeamId == req.TeamId);
        if (result == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Participant result not found.");

        result.Result = req.Result ?? "";

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> AdvanceHeatsRoundAsync(int eventId, int programId, AdvanceHeatsRoundRequest req)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Format, "heats", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_FORMAT", "This fixture is not using heats.");

        var rounds = state.HeatRounds ?? new List<HeatRound>();
        var round = rounds.FirstOrDefault(r => r.RoundNumber == req.FromRound);
        if (round == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Heat round not found.");
        if (round.IsComplete)
            return FixtureGenerationResult.Fail("ALREADY_COMPLETE", "This round has already been advanced.");
        if (round.IsFinal)
            return FixtureGenerationResult.Fail("FINAL_ROUND", "The final round uses assign-places, not advance.");
        if (round.Results.Any(r => string.IsNullOrWhiteSpace(r.Result)))
            return FixtureGenerationResult.Fail("RESULTS_REQUIRED", "Enter all heat results before advancing.");

        var nextRound = rounds.FirstOrDefault(r => r.RoundNumber == req.FromRound + 1);
        if (nextRound == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Next heat round not found.");

        var advancing = new HashSet<string>(req.AdvancingIds ?? new List<string>(), StringComparer.Ordinal);
        if (advancing.Count == 0)
            return FixtureGenerationResult.Fail("INVALID_ADVANCE", "Select at least one participant to advance.");
        if (advancing.Any(id => round.Results.All(r => r.TeamId != id)))
            return FixtureGenerationResult.Fail("INVALID_ADVANCE", "One or more advancing participants are invalid.");

        var expectedAdvanceCount = Math.Min(state.Config.HeatsConfig?.AdvancePerRound ?? advancing.Count, round.Results.Count);
        if (advancing.Count != expectedAdvanceCount)
            return FixtureGenerationResult.Fail("INVALID_ADVANCE", $"Select exactly {expectedAdvanceCount} participant(s) to advance.");

        round.IsComplete = true;
        foreach (var item in round.Results)
            item.Advanced = advancing.Contains(item.TeamId);

        nextRound.Results = round.Results
            .Where(r => advancing.Contains(r.TeamId))
            .Select(r => new HeatParticipantResult { TeamId = r.TeamId, Result = "", Advanced = false })
            .ToList();

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    public async Task<FixtureGenerationResult> AssignHeatPlacesAsync(int eventId, int programId, AssignHeatPlacesRequest req)
    {
        var loaded = await LoadExistingStateAsync(eventId, programId);
        if (!loaded.Success) return loaded;
        var state = loaded.State!;

        if (!string.Equals(state.Format, "heats", StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("WRONG_FORMAT", "This fixture is not using heats.");

        var finalRound = (state.HeatRounds ?? new List<HeatRound>()).FirstOrDefault(r => r.IsFinal);
        if (finalRound == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Final heat round not found.");

        var places = req.Places ?? new Dictionary<string, int>();
        if (places.Count == 0)
            return FixtureGenerationResult.Fail("INVALID_PLACES", "Assign at least one final place.");

        var finalTeamIds = finalRound.Results.Select(r => r.TeamId).ToHashSet(StringComparer.Ordinal);
        if (places.Keys.Any(id => !finalTeamIds.Contains(id)))
            return FixtureGenerationResult.Fail("INVALID_PLACES", "One or more placed participants are invalid.");

        var placesAwarded = state.Config.HeatsConfig?.PlacesAwarded ?? finalRound.Results.Count;
        if (places.Values.Any(place => place < 1 || place > placesAwarded))
            return FixtureGenerationResult.Fail("INVALID_PLACES", $"Places must be between 1 and {placesAwarded}.");
        if (places.Values.Count != places.Values.Distinct().Count())
            return FixtureGenerationResult.Fail("INVALID_PLACES", "Duplicate final places are not allowed.");

        foreach (var result in finalRound.Results)
        {
            if (places.TryGetValue(result.TeamId, out var place))
            {
                result.Place = place;
                result.Advanced = true;
            }
        }
        finalRound.IsComplete = true;

        await SaveStateAsync(loaded.Fixture!, state);
        return FixtureGenerationResult.Ok(state);
    }

    private FixtureGenerationResult NormalizeSeeds(List<ParticipantGroup> groups, List<FixtureSeedEntryRequest> requested)
    {
        var requestedById = requested.ToDictionary(s => s.Id, StringComparer.Ordinal);
        var actualIds = groups.Select(g => g.GroupId).OrderBy(x => x).ToList();
        var requestedIds = requestedById.Keys
            .Select(id => int.TryParse(id, out var parsed) ? parsed : -1)
            .OrderBy(x => x)
            .ToList();
        if (!actualIds.SequenceEqual(requestedIds))
            return FixtureGenerationResult.Fail("PARTICIPANTS_CHANGED", "Registered entries changed. Reload the page and try again.");

        var seeds = groups.Select(g =>
        {
            var req = requestedById[g.GroupId.ToString()];
            return new FixtureSeedEntry
            {
                Id = g.GroupId.ToString(),
                GroupId = g.GroupId.ToString(),
                RegistrationId = g.RegistrationId.ToString(),
                Club = g.ClubDisplay ?? "",
                Participants = g.Participants.Select(p => p.FullName).ToList(),
                Seed = req.Seed,
                SbaId = g.Participants.FirstOrDefault()?.SbaId,
            };
        }).ToList();

        var seedNums = seeds.Where(s => s.Seed.HasValue).Select(s => s.Seed!.Value).ToList();
        if (seedNums.Any(n => n < 1))
            return FixtureGenerationResult.Fail("INVALID_SEED", "Seed numbers must be positive.");
        if (seedNums.Count != seedNums.Distinct().Count())
            return FixtureGenerationResult.Fail("DUPLICATE_SEEDS", "Duplicate seed numbers are not allowed.");

        return FixtureGenerationResult.Ok(new FixtureState { Seeds = seeds });
    }

    private FixtureGenerationResult NormalizeConfig(FixtureConfigRequest req)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "knockout", "group_knockout", "round_robin", "heats"
        };
        if (!allowed.Contains(req.Format))
            return FixtureGenerationResult.Fail("INVALID_FORMAT", "Unsupported fixture format.");

        if (req.NumSeeds < 0)
            return FixtureGenerationResult.Fail("INVALID_CONFIG", "Number of seeds cannot be negative.");
        if (req.StandingPoints != null && (req.StandingPoints.Win < 0 || req.StandingPoints.Draw < 0 || req.StandingPoints.Loss < 0))
            return FixtureGenerationResult.Fail("INVALID_CONFIG", "Standing points cannot be negative.");

        if (string.Equals(req.Format, "group_knockout", StringComparison.OrdinalIgnoreCase))
        {
            if ((req.NumGroups ?? 0) < 2)
                return FixtureGenerationResult.Fail("INVALID_CONFIG", "Group knockout requires at least 2 groups.");
            if ((req.AdvancePerGroup ?? 0) < 1)
                return FixtureGenerationResult.Fail("INVALID_CONFIG", "At least 1 participant must advance per group.");
        }
        if (string.Equals(req.Format, "round_robin", StringComparison.OrdinalIgnoreCase) &&
            req.AdvancePerGroup.HasValue &&
            req.AdvancePerGroup.Value < 1)
        {
            return FixtureGenerationResult.Fail("INVALID_CONFIG", "At least 1 participant must advance from round robin.");
        }

        if (string.Equals(req.Format, "heats", StringComparison.OrdinalIgnoreCase) && req.HeatsConfig != null)
        {
            if (req.HeatsConfig.NumRounds < 2)
                return FixtureGenerationResult.Fail("INVALID_CONFIG", "Heats require at least 2 rounds.");
            if (req.HeatsConfig.AdvancePerRound < 1)
                return FixtureGenerationResult.Fail("INVALID_CONFIG", "At least 1 participant must advance per heat round.");
            if (req.HeatsConfig.PlacesAwarded < 1)
                return FixtureGenerationResult.Fail("INVALID_CONFIG", "At least 1 final place must be awarded.");
        }

        var config = new FixtureConfig
        {
            Format = req.Format,
            NumSeeds = req.NumSeeds,
            NumGroups = req.NumGroups,
            AdvancePerGroup = req.AdvancePerGroup,
            StandingPoints = req.StandingPoints == null ? null : new StandingPoints
            {
                Win = req.StandingPoints.Win,
                Draw = req.StandingPoints.Draw,
                Loss = req.StandingPoints.Loss,
            },
            HeatsConfig = req.HeatsConfig == null ? null : new HeatsConfig
            {
                NumRounds = req.HeatsConfig.NumRounds,
                AdvancePerRound = req.HeatsConfig.AdvancePerRound,
                ResultLabel = string.IsNullOrWhiteSpace(req.HeatsConfig.ResultLabel) ? "Result" : req.HeatsConfig.ResultLabel,
                PlacesAwarded = req.HeatsConfig.PlacesAwarded,
            },
        };

        return FixtureGenerationResult.Ok(new FixtureState { Config = config });
    }

    private FixtureGenerationResult ValidatePreview(string json, List<FixtureSeedEntry> seeds, FixtureConfig config)
    {
        FixtureState? state;
        try
        {
            state = JsonSerializer.Deserialize<FixtureState>(json, _jsonOptions);
        }
        catch
        {
            return FixtureGenerationResult.Fail("INVALID_PREVIEW", "Preview fixture data is invalid.");
        }

        if (state == null)
            return FixtureGenerationResult.Fail("INVALID_PREVIEW", "Preview fixture data is invalid.");

        if (!string.Equals(state.Format, config.Format, StringComparison.OrdinalIgnoreCase))
            return FixtureGenerationResult.Fail("FORMAT_MISMATCH", "Preview fixture format does not match the selected format.");

        state.Config = config;
        state.Seeds = seeds;
        state.Locked = false;

        var allowedIds = new HashSet<string>(seeds.Select(s => s.Id), StringComparer.Ordinal);
        bool IsAllowedTeamId(string id) => allowedIds.Contains(id) || id.StartsWith("bye-", StringComparison.Ordinal);

        foreach (var group in state.Groups)
        {
            foreach (var team in group.Teams)
            {
                if (!IsAllowedTeamId(team.Id))
                    return FixtureGenerationResult.Fail("INVALID_TEAM", "Preview references an unknown team.");
            }

            foreach (var match in group.Matches)
            {
                if (!IsAllowedTeamId(match.Team1.Id) || !IsAllowedTeamId(match.Team2.Id))
                    return FixtureGenerationResult.Fail("INVALID_TEAM", "Preview references an unknown team.");
            }
        }

        foreach (var match in state.Matches)
        {
            if (!IsAllowedTeamId(match.Team1.Id) || !IsAllowedTeamId(match.Team2.Id))
                return FixtureGenerationResult.Fail("INVALID_TEAM", "Preview references an unknown team.");
        }

        foreach (var round in state.HeatRounds ?? new List<HeatRound>())
        {
            if (round.Results.Any(r => !allowedIds.Contains(r.TeamId)))
                return FixtureGenerationResult.Fail("INVALID_TEAM", "Preview references an unknown team.");
        }

        foreach (var match in state.Groups.SelectMany(g => g.Matches).Concat(state.Matches))
        {
            match.Status = "Scheduled";
            match.Winner = null;
            match.Walkover = false;
            match.WalkoverWinner = "";
            match.Games = new List<GameScore> { new() };
        }

        foreach (var round in state.HeatRounds ?? new List<HeatRound>())
        {
            round.IsComplete = false;
            foreach (var result in round.Results)
            {
                result.Result = "";
                result.Advanced = false;
                result.Place = null;
            }
        }

        return FixtureGenerationResult.Ok(state, json);
    }

    private async Task<FixtureGenerationResult> LoadExistingStateAsync(int eventId, int programId)
    {
        var fixture = await _db.Fixtures.FirstOrDefaultAsync(f => f.EventId == eventId && f.ProgramId == programId);
        if (fixture == null)
            return FixtureGenerationResult.Fail("NOT_FOUND", "Fixture not found.");

        FixtureState? state;
        try
        {
            state = JsonSerializer.Deserialize<FixtureState>(fixture.BracketStateJson, _jsonOptions);
        }
        catch
        {
            return FixtureGenerationResult.Fail("PARSE_FAILED", "Fixture data is corrupted.");
        }

        if (state == null)
            return FixtureGenerationResult.Fail("PARSE_FAILED", "Fixture data is corrupted.");

        return new FixtureGenerationResult
        {
            Success = true,
            State = state,
            StateJson = fixture.BracketStateJson,
            Fixture = fixture,
        };
    }

    private async Task SaveStateAsync(Fixture fixture, FixtureState state)
    {
        fixture.BracketStateJson = JsonSerializer.Serialize(state, _jsonOptions);
        fixture.FixtureFormat = state.Format;
        fixture.Phase = state.Phase;
        fixture.IsLocked = state.Locked;
        fixture.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    private bool IsLocked(FixtureState state)
    {
        if (state.Format == "heats")
            return (state.HeatRounds ?? new List<HeatRound>()).Any(r => r.IsComplete);

        return state.Matches.Concat(state.Groups.SelectMany(g => g.Matches))
            .Any(m => !IsByeMatch(m) && !string.Equals(m.Status, "Scheduled", StringComparison.OrdinalIgnoreCase));
    }

    private bool IsCompleted(FixtureMatch match) =>
        string.Equals(match.Status, "Completed", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(match.Status, "Walkover", StringComparison.OrdinalIgnoreCase);

    private bool HasEnteredResult(FixtureMatch match)
    {
        if (IsByeMatch(match))
            return false;

        return IsCompleted(match) ||
            !string.IsNullOrWhiteSpace(match.Winner) ||
            match.Walkover ||
            !string.IsNullOrWhiteSpace(match.WalkoverWinner) ||
            match.Games.Any(g => !string.IsNullOrWhiteSpace(g.P1) || !string.IsNullOrWhiteSpace(g.P2));
    }

    private bool ExistingFixtureLocked(Fixture fixture)
    {
        if (fixture.IsLocked)
            return true;

        if (string.IsNullOrWhiteSpace(fixture.BracketStateJson))
            return false;

        try
        {
            var state = JsonSerializer.Deserialize<FixtureState>(fixture.BracketStateJson, _jsonOptions);
            return state != null && IsLocked(state);
        }
        catch
        {
            return false;
        }
    }

    private FixtureGenerationResult? ValidateScoreRequest(FixtureMatch match, SaveFixtureScoreRequest req)
    {
        if (IsByeMatch(match))
            return FixtureGenerationResult.Fail("BYE_NO_SCORE", "BYE matches are advanced automatically and cannot be scored.");

        static bool ValidWinner(string? winner) =>
            string.Equals(winner, "team1", StringComparison.Ordinal) ||
            string.Equals(winner, "team2", StringComparison.Ordinal);

        if (req.Walkover)
        {
            if (!ValidWinner(req.WalkoverWinner))
                return FixtureGenerationResult.Fail("INVALID_WINNER", "Choose a valid walkover winner.");
            return null;
        }

        var games = req.Games ?? new List<FixtureGameScoreRequest>();
        if (!games.Any())
            return FixtureGenerationResult.Fail("INVALID_SCORE", "Enter at least one game score.");

        var team1Games = 0;
        var team2Games = 0;
        var tiedGames = 0;
        foreach (var game in games)
        {
            if (!decimal.TryParse(game.P1, out var p1) || !decimal.TryParse(game.P2, out var p2))
                return FixtureGenerationResult.Fail("INVALID_SCORE", "Game scores must be numeric.");
            if (p1 < 0 || p2 < 0)
                return FixtureGenerationResult.Fail("INVALID_SCORE", "Game scores cannot be negative.");

            if (p1 > p2) team1Games++;
            else if (p2 > p1) team2Games++;
            else tiedGames++;
        }

        if (!ValidWinner(req.Winner))
        {
            if (string.Equals(match.Phase, "knockout", StringComparison.OrdinalIgnoreCase))
                return FixtureGenerationResult.Fail("INVALID_WINNER", "Knockout matches require a winner.");
            if (team1Games == team2Games)
                return null;

            return FixtureGenerationResult.Fail("INVALID_WINNER", "Choose a valid match winner or submit tied scores for a draw.");
        }

        if (tiedGames > 0)
            return FixtureGenerationResult.Fail("INVALID_SCORE", "Winner-based results cannot include tied game scores.");

        if (team1Games == team2Games)
            return FixtureGenerationResult.Fail("INVALID_SCORE", "The submitted games do not determine a match winner.");
        if (req.Winner == "team1" && team1Games < team2Games)
            return FixtureGenerationResult.Fail("WINNER_MISMATCH", "Selected winner does not match the submitted game scores.");
        if (req.Winner == "team2" && team2Games < team1Games)
            return FixtureGenerationResult.Fail("WINNER_MISMATCH", "Selected winner does not match the submitted game scores.");

        return null;
    }

    private int CompareHeadToHead(GroupStandingEntry a, GroupStandingEntry b, Dictionary<string, Dictionary<string, int>> headToHead)
    {
        if (headToHead.TryGetValue(a.Team.Id, out var opponents) &&
            opponents.TryGetValue(b.Team.Id, out var result))
            return result;

        return 0;
    }

    private List<GroupStandingEntry> OrderTiedStandingGroup(List<GroupStandingEntry> tied, Dictionary<string, Dictionary<string, int>> headToHead)
    {
        if (tied.Count == 2)
        {
            var h2h = CompareHeadToHead(tied[0], tied[1], headToHead);
            if (h2h < 0) return tied;
            if (h2h > 0) return new List<GroupStandingEntry> { tied[1], tied[0] };
        }

        return tied
            .OrderByDescending(s => s.GamesFor - s.GamesAgainst)
            .ThenByDescending(s => s.PointsFor - s.PointsAgainst)
            .ThenByDescending(s => s.PointsFor)
            .ThenBy(s => s.Team.Seed ?? int.MaxValue)
            .ThenBy(s => s.Team.Id, StringComparer.Ordinal)
            .ToList();
    }

    // Primary tie groups intentionally use points and wins only; draws/losses are reflected
    // by points and downstream BWF-style tie-break metrics.
    private static bool SamePrimaryStanding(GroupStandingEntry a, GroupStandingEntry b) =>
        a.Points == b.Points && a.Wins == b.Wins;

    private List<GroupStandingEntry> OrderGroupStandings(List<GroupStandingEntry> standings, Dictionary<string, Dictionary<string, int>> headToHead)
    {
        var primary = standings
            .OrderByDescending(s => s.Points)
            .ThenByDescending(s => s.Wins)
            .ToList();

        var ordered = new List<GroupStandingEntry>();
        for (var i = 0; i < primary.Count;)
        {
            var tied = new List<GroupStandingEntry> { primary[i] };
            var j = i + 1;
            while (j < primary.Count && SamePrimaryStanding(primary[i], primary[j]))
            {
                tied.Add(primary[j]);
                j++;
            }

            ordered.AddRange(OrderTiedStandingGroup(tied, headToHead));
            i = j;
        }

        return ordered;
    }

    private FixtureMatch? FindMatch(FixtureState state, string matchId)
    {
        foreach (var group in state.Groups)
        {
            var match = group.Matches.FirstOrDefault(m => m.Id == matchId);
            if (match != null) return match;
        }

        return state.Matches.FirstOrDefault(m => m.Id == matchId);
    }

    private List<FixtureMatch> GenerateKnockoutFromGroups(List<FixtureGroup> groups, FixtureConfig config)
    {
        var advance = config.AdvancePerGroup ?? 2;
        var advancers = groups
            .Select(g => ComputeGroupStandings(g, config).Take(advance).Select(s => s.Team).ToList())
            .ToList();

        if (groups.Count == 2)
        {
            var paired = new List<(FixtureTeam Team1, FixtureTeam Team2)>();
            var groupA = advancers.ElementAtOrDefault(0) ?? new List<FixtureTeam>();
            var groupB = advancers.ElementAtOrDefault(1) ?? new List<FixtureTeam>();
            for (var i = 0; i < advance; i++)
            {
                var t1 = groupA.ElementAtOrDefault(i);
                var t2 = groupB.ElementAtOrDefault(advance - 1 - i);
                if (t1 != null && t2 != null) paired.Add((t1, t2));
            }

            var matches = paired.Select(p => BlankMatch(p.Team1, p.Team2, 1, "knockout")).ToList();
            ApplyRoundLabels(matches);
            return matches;
        }

        var qualifiers = advancers
            .SelectMany(groupAdvancers => groupAdvancers)
            .GroupBy(team => team.Id, StringComparer.Ordinal)
            .Select(g => g.First())
            .ToList();

        return GenerateKnockoutMatches(qualifiers);
    }

    private List<FixtureMatch> GenerateNextKnockoutRound(List<FixtureMatch> matches)
    {
        var maxRound = matches.Max(m => m.Round);
        var currentRound = matches.Where(m => m.Round == maxRound).ToList();
        var winners = currentRound.Select(m =>
            m.Winner == "team1" ? m.Team1 :
            m.Winner == "team2" ? m.Team2 :
            m.Team1).ToList();

        var nextRound = new List<FixtureMatch>();
        for (var i = 0; i < winners.Count - 1; i += 2)
            nextRound.Add(BlankMatch(winners[i], winners[i + 1], maxRound + 1, "knockout"));

        var all = matches.Concat(nextRound).ToList();
        ApplyRoundLabels(all);
        return all.Where(m => m.Round > maxRound).ToList();
    }

    private List<GroupStandingEntry> ComputeGroupStandings(FixtureGroup group, FixtureConfig config)
    {
        var standings = group.Teams.ToDictionary(
            t => t.Id,
            t => new GroupStandingEntry { Team = t },
            StringComparer.Ordinal);

        var scoring = config.StandingPoints ?? new StandingPoints { Win = 2, Draw = 1, Loss = 0 };
        var headToHead = new Dictionary<string, Dictionary<string, int>>(StringComparer.Ordinal);

        foreach (var match in group.Matches.Where(IsCompleted))
        {
            if (!standings.TryGetValue(match.Team1.Id, out var s1) || !standings.TryGetValue(match.Team2.Id, out var s2))
                continue;

            s1.Played++;
            s2.Played++;

            foreach (var game in match.Games)
            {
                if (!decimal.TryParse(game.P1, out var p1) || !decimal.TryParse(game.P2, out var p2))
                    continue;

                s1.PointsFor += p1;
                s1.PointsAgainst += p2;
                s2.PointsFor += p2;
                s2.PointsAgainst += p1;

                if (p1 > p2)
                {
                    s1.GamesFor++;
                    s2.GamesAgainst++;
                }
                else if (p2 > p1)
                {
                    s2.GamesFor++;
                    s1.GamesAgainst++;
                }
            }

            if (match.Winner == "team1")
            {
                s1.Wins++;
                s1.Points += scoring.Win;
                s2.Losses++;
                s2.Points += scoring.Loss;
                RecordHeadToHead(headToHead, match.Team1.Id, match.Team2.Id, -1);
            }
            else if (match.Winner == "team2")
            {
                s2.Wins++;
                s2.Points += scoring.Win;
                s1.Losses++;
                s1.Points += scoring.Loss;
                RecordHeadToHead(headToHead, match.Team1.Id, match.Team2.Id, 1);
            }
            else
            {
                s1.Draws++;
                s2.Draws++;
                s1.Points += scoring.Draw;
                s2.Points += scoring.Draw;
                RecordHeadToHead(headToHead, match.Team1.Id, match.Team2.Id, 0);
            }
        }

        var ordered = OrderGroupStandings(standings.Values.ToList(), headToHead);

        for (var i = 0; i < ordered.Count; i++)
            ordered[i].Rank = i + 1;

        return ordered;
    }

    private void RecordHeadToHead(Dictionary<string, Dictionary<string, int>> headToHead, string teamA, string teamB, int compareResult)
    {
        if (!headToHead.TryGetValue(teamA, out var mapA))
        {
            mapA = new Dictionary<string, int>(StringComparer.Ordinal);
            headToHead[teamA] = mapA;
        }
        if (!headToHead.TryGetValue(teamB, out var mapB))
        {
            mapB = new Dictionary<string, int>(StringComparer.Ordinal);
            headToHead[teamB] = mapB;
        }

        mapA[teamB] = compareResult;
        mapB[teamA] = -compareResult;
    }

    private FixtureState GenerateState(List<FixtureSeedEntry> seeds, FixtureConfig config)
    {
        if (config.Format == "heats")
            return GenerateHeatsState(seeds, config);

        return config.Format switch
        {
            "knockout" => new FixtureState
            {
                Format = config.Format,
                Config = config,
                Locked = false,
                Phase = "knockout",
                Seeds = seeds,
                Matches = GenerateKnockoutMatches(ToTeams(SortedSeeds(seeds))),
            },
            "group_knockout" => new FixtureState
            {
                Format = config.Format,
                Config = config,
                Locked = false,
                Phase = "group",
                Seeds = seeds,
                Groups = GenerateGroupDraw(seeds, config.NumGroups ?? 2),
            },
            "round_robin" => new FixtureState
            {
                Format = config.Format,
                Config = config,
                Locked = false,
                Phase = "group",
                Seeds = seeds,
                Groups = GenerateGroupDraw(seeds, 1),
            },
            _ => new FixtureState
            {
                Format = config.Format,
                Config = config,
                Locked = false,
                Phase = "knockout",
                Seeds = seeds,
            },
        };
    }

    private FixtureState GenerateHeatsState(List<FixtureSeedEntry> seeds, FixtureConfig config)
    {
        var hc = config.HeatsConfig ?? new HeatsConfig
        {
            NumRounds = 2,
            AdvancePerRound = 4,
            ResultLabel = "Result",
            PlacesAwarded = 3,
        };

        var heatRounds = Enumerable.Range(1, hc.NumRounds).Select(i =>
        {
            var isFirst = i == 1;
            var isFinal = i == hc.NumRounds;
            var label = isFinal ? "Final" : hc.NumRounds == 2 ? "Heat" : i == 1 ? "Heat" : $"Round {i}";
            return new HeatRound
            {
                Id = $"HR-{i}",
                RoundNumber = i,
                Label = label,
                IsFinal = isFinal,
                IsComplete = false,
                Results = isFirst
                    ? seeds.Select(s => new HeatParticipantResult { TeamId = s.Id, Result = "", Advanced = false }).ToList()
                    : new List<HeatParticipantResult>(),
            };
        }).ToList();

        return new FixtureState
        {
            Format = "heats",
            Config = config,
            Locked = false,
            Phase = "knockout",
            Seeds = seeds,
            HeatRounds = heatRounds,
        };
    }

    private List<FixtureGroup> GenerateGroupDraw(List<FixtureSeedEntry> seeds, int numGroups)
    {
        var sorted = SortedSeeds(seeds);
        var groups = Enumerable.Range(0, numGroups).Select(i => new FixtureGroup
        {
            Id = $"G{i + 1}",
            Name = $"Group {(char)('A' + i)}",
        }).ToList();

        for (var i = 0; i < sorted.Count; i++)
        {
            var groupIndex = i % (numGroups * 2) < numGroups ? i % numGroups : numGroups - 1 - (i % numGroups);
            groups[groupIndex].Teams.Add(ToTeam(sorted[i]));
        }

        foreach (var group in groups)
        {
            for (var a = 0; a < group.Teams.Count - 1; a++)
            {
                for (var b = a + 1; b < group.Teams.Count; b++)
                {
                    group.Matches.Add(BlankMatch(group.Teams[a], group.Teams[b], 1, "group", group.Id));
                }
            }
        }

        return groups;
    }

    private List<FixtureMatch> GenerateKnockoutMatches(List<FixtureTeam> teams)
    {
        var pow = 1;
        while (pow < teams.Count) pow *= 2;
        var byeCount = pow - teams.Count;

        var slots = Enumerable.Repeat<FixtureTeam?>(null, pow).ToList();
        var seedLine = BuildSeedLine(pow);
        var placed = new HashSet<string>(StringComparer.Ordinal);
        var seededTeams = teams
            .Where(t => t.Seed.HasValue)
            .OrderBy(t => t.Seed)
            .ToList();

        foreach (var team in seededTeams)
        {
            var pos = seedLine.IndexOf(team.Seed!.Value);
            if (pos != -1 && slots[pos] == null)
            {
                slots[pos] = team;
                placed.Add(team.Id);
            }
        }

        var protectedByeSlots = seededTeams
            .Take(Math.Min(byeCount, seededTeams.Count))
            .Select(team =>
            {
                var pos = slots.FindIndex(s => s?.Id == team.Id);
                return pos == -1 ? -1 : PairedSlot(pos);
            })
            .Where(pos => pos >= 0)
            .ToHashSet();

        foreach (var team in teams.Where(t => !placed.Contains(t.Id)))
        {
            var empty = -1;
            for (var idx = 0; idx < slots.Count; idx++)
            {
                if (slots[idx] == null && !protectedByeSlots.Contains(idx))
                {
                    empty = idx;
                    break;
                }
            }
            if (empty == -1) empty = slots.FindIndex(s => s == null);
            if (empty != -1) slots[empty] = team;
        }

        var matches = new List<FixtureMatch>();
        for (var i = 0; i < pow; i += 2)
        {
            var match = BlankMatch(slots[i] ?? ByeTeam(), slots[i + 1] ?? ByeTeam(), 1, "knockout");
            AutoCompleteBye(match);
            matches.Add(match);
        }

        ApplyRoundLabels(matches);
        return matches;
    }

    private int PairedSlot(int index) => index % 2 == 0 ? index + 1 : index - 1;

    private List<int> BuildSeedLine(int size)
    {
        if (size <= 1) return new List<int> { 1 };
        if (size == 2) return new List<int> { 1, 2 };
        if (size == 4) return new List<int> { 1, 4, 3, 2 };

        var previous = BuildSeedLine(size / 2);
        var result = new List<int>();
        foreach (var seed in previous)
        {
            result.Add(seed);
            result.Add(size + 1 - seed);
        }
        return result;
    }

    private List<FixtureSeedEntry> SortedSeeds(List<FixtureSeedEntry> seeds)
    {
        var seeded = seeds.Where(s => s.Seed.HasValue).OrderBy(s => s.Seed).ToList();
        var unseeded = seeds.Where(s => !s.Seed.HasValue).OrderBy(_ => Random.Shared.Next()).ToList();
        return seeded.Concat(unseeded).ToList();
    }

    private List<FixtureTeam> ToTeams(List<FixtureSeedEntry> seeds) => seeds.Select(ToTeam).ToList();

    private FixtureTeam ToTeam(FixtureSeedEntry seed) => new()
    {
        Id = seed.Id,
        Label = seed.Club,
        Participants = seed.Participants,
        Seed = seed.Seed,
    };

    private FixtureMatch BlankMatch(FixtureTeam team1, FixtureTeam team2, int round, string phase, string? groupId = null) => new()
    {
        Id = $"M-{Guid.NewGuid():N}",
        Phase = phase,
        Round = round,
        RoundLabel = "",
        GroupId = groupId,
        Team1 = team1,
        Team2 = team2,
        Games = new List<GameScore> { new() },
        Winner = null,
        Walkover = false,
        WalkoverWinner = "",
        MatchDate = "",
        StartTime = "",
        EndTime = "",
        CourtNo = "",
        Officials = new List<OfficialEntry>(),
        Status = "Scheduled",
        Expanded = false,
    };

    private FixtureTeam ByeTeam() => new()
    {
        Id = $"bye-{Guid.NewGuid():N}",
        Label = "BYE",
        Participants = new List<string>(),
    };

    private bool IsByeTeam(FixtureTeam team) =>
        string.Equals(team.Label, "BYE", StringComparison.OrdinalIgnoreCase) ||
        team.Id.StartsWith("bye-", StringComparison.OrdinalIgnoreCase);

    private bool IsByeMatch(FixtureMatch match) =>
        IsByeTeam(match.Team1) || IsByeTeam(match.Team2);

    private void AutoCompleteBye(FixtureMatch match)
    {
        var team1Bye = IsByeTeam(match.Team1);
        var team2Bye = IsByeTeam(match.Team2);
        if (team1Bye == team2Bye)
            return;

        match.Winner = team1Bye ? "team2" : "team1";
        match.Status = "Completed";
    }

    private void ApplyRoundLabels(List<FixtureMatch> matches)
    {
        var rounds = matches.Select(m => m.Round).Distinct().OrderBy(r => r).ToList();
        var lastRound = rounds.LastOrDefault();
        foreach (var match in matches.Where(m => m.Phase == "knockout"))
        {
            var inRound = matches.Count(m => m.Round == match.Round && m.Phase == "knockout");
            match.RoundLabel = match.Round == lastRound && inRound == 1
                ? "Final"
                : inRound switch
                {
                    1 => "Final",
                    2 => "Semi-Final",
                    4 => "Quarter-Final",
                    _ => $"Round of {inRound * 2}",
                };
        }
    }

    public sealed class FixtureGenerationResult
    {
        public bool Success { get; init; }
        public string? Code { get; init; }
        public string Message { get; init; } = "";
        public FixtureState? State { get; init; }
        public string? StateJson { get; init; }
        public Fixture? Fixture { get; init; }

        public static FixtureGenerationResult Ok(FixtureState state, string? json = null) => new()
        {
            Success = true,
            State = state,
            StateJson = json,
        };

        public static FixtureGenerationResult Fail(string code, string message) => new()
        {
            Success = false,
            Code = code,
            Message = message,
        };
    }

    public sealed class FixtureState
    {
        public string Format { get; set; } = "knockout";
        public FixtureConfig Config { get; set; } = new();
        public bool Locked { get; set; }
        public string Phase { get; set; } = "knockout";
        public List<FixtureGroup> Groups { get; set; } = new();
        public List<FixtureMatch> Matches { get; set; } = new();
        public List<FixtureSeedEntry> Seeds { get; set; } = new();
        public List<HeatRound>? HeatRounds { get; set; }
    }

    public sealed class FixtureConfig
    {
        public string Format { get; set; } = "knockout";
        public int NumSeeds { get; set; }
        public int? NumGroups { get; set; }
        public int? AdvancePerGroup { get; set; }
        public StandingPoints? StandingPoints { get; set; }
        public HeatsConfig? HeatsConfig { get; set; }
    }

    public sealed class StandingPoints
    {
        public int Win { get; set; }
        public int Draw { get; set; }
        public int Loss { get; set; }
    }

    public sealed class HeatsConfig
    {
        public int NumRounds { get; set; }
        public int AdvancePerRound { get; set; }
        public string ResultLabel { get; set; } = "Result";
        public int PlacesAwarded { get; set; }
    }

    public sealed class FixtureSeedEntry
    {
        public string Id { get; set; } = "";
        public string Club { get; set; } = "";
        public List<string> Participants { get; set; } = new();
        public int? Seed { get; set; }
        public string? SbaId { get; set; }
        public string? RegistrationId { get; set; }
        public string? GroupId { get; set; }
    }

    public sealed class FixtureTeam
    {
        public string Id { get; set; } = "";
        public string Label { get; set; } = "";
        public List<string> Participants { get; set; } = new();
        public int? Seed { get; set; }
    }

    public sealed class FixtureGroup
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public List<FixtureTeam> Teams { get; set; } = new();
        public List<FixtureMatch> Matches { get; set; } = new();
    }

    public sealed class FixtureMatch
    {
        public string Id { get; set; } = "";
        public string Phase { get; set; } = "group";
        public int Round { get; set; }
        public string RoundLabel { get; set; } = "";
        public string? GroupId { get; set; }
        public FixtureTeam Team1 { get; set; } = new();
        public FixtureTeam Team2 { get; set; } = new();
        public List<GameScore> Games { get; set; } = new();
        public string? Winner { get; set; }
        public bool Walkover { get; set; }
        public string WalkoverWinner { get; set; } = "";
        public string MatchDate { get; set; } = "";
        public string StartTime { get; set; } = "";
        public string EndTime { get; set; } = "";
        public string CourtNo { get; set; } = "";
        public List<OfficialEntry> Officials { get; set; } = new();
        public string Remark { get; set; } = "";
        public string Status { get; set; } = "Scheduled";
        public bool Expanded { get; set; }
    }

    public sealed class GameScore
    {
        public string P1 { get; set; } = "";
        public string P2 { get; set; } = "";
    }

    public sealed class OfficialEntry
    {
        public string Id { get; set; } = "";
        public string Role { get; set; } = "";
        public string Name { get; set; } = "";
    }

    public sealed class HeatRound
    {
        public string Id { get; set; } = "";
        public int RoundNumber { get; set; }
        public string Label { get; set; } = "";
        public bool IsFinal { get; set; }
        public List<HeatParticipantResult> Results { get; set; } = new();
        public bool IsComplete { get; set; }
    }

    public sealed class HeatParticipantResult
    {
        public string TeamId { get; set; } = "";
        public string Result { get; set; } = "";
        public bool Advanced { get; set; }
        public int? Place { get; set; }
    }

    private sealed class GroupStandingEntry
    {
        public FixtureTeam Team { get; set; } = new();
        public int Played { get; set; }
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int Draws { get; set; }
        public int GamesFor { get; set; }
        public int GamesAgainst { get; set; }
        public decimal PointsFor { get; set; }
        public decimal PointsAgainst { get; set; }
        public int Points { get; set; }
        public int Rank { get; set; }
    }
}
