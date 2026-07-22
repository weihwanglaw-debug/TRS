using System.Reflection;
using TRS_API.Models;
using TRS_API.Services;

var tests = new List<(string Name, Action Test)>
{
    ("knockout auto-completes BYE matches", KnockoutAutoCompletesByeMatches),
    ("knockout seed line protects top seeds", KnockoutSeedLineProtectsTopSeeds),
    ("group draw score is accepted", GroupDrawScoreIsAccepted),
    ("knockout draw score is rejected", KnockoutDrawScoreIsRejected),
    ("group knockout uses unique qualifiers", GroupKnockoutUsesUniqueQualifiers),
    ("group knockout reseeds qualifiers by standings", GroupKnockoutReseedsQualifiersByStandings),
    ("round robin knockout reseeds by final standings", RoundRobinKnockoutReseedsByFinalStandings),
    ("three-way standings use game difference after primary tie", ThreeWayStandingsUseGameDifference),
};

var failures = 0;
foreach (var (name, test) in tests)
{
    try
    {
        test();
        Console.WriteLine($"PASS {name}");
    }
    catch (Exception ex)
    {
        failures++;
        Console.WriteLine($"FAIL {name}: {ex.Message}");
    }
}

if (failures > 0)
    Environment.Exit(1);

static FixtureGenerationService Service() => new(null!);

static object? Invoke(FixtureGenerationService service, string methodName, params object?[] args)
{
    var method = typeof(FixtureGenerationService).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException($"Method {methodName} not found.");
    return method.Invoke(service, args);
}

static void AssertTrue(bool condition, string message)
{
    if (!condition)
        throw new InvalidOperationException(message);
}

static FixtureGenerationService.FixtureTeam Team(string id, int? seed = null) => new()
{
    Id = id,
    Label = $"Team {id}",
    Participants = new List<string> { $"Player {id}" },
    Seed = seed,
};

static FixtureGenerationService.FixtureMatch Match(
    FixtureGenerationService.FixtureTeam team1,
    FixtureGenerationService.FixtureTeam team2,
    string phase,
    string? winner,
    params (string P1, string P2)[] games) => new()
{
    Id = $"M-{Guid.NewGuid():N}",
    Phase = phase,
    Round = 1,
    Team1 = team1,
    Team2 = team2,
    Winner = winner,
    Status = StatusCodesEx.Match.Completed,
    Games = games.Select(g => new FixtureGenerationService.GameScore { P1 = g.P1, P2 = g.P2 }).ToList(),
};

static SaveFixtureScoreRequest ScoreRequest(string? winner, params (string P1, string P2)[] games) => new()
{
    Winner = winner,
    Walkover = false,
    Games = games.Select(g => new FixtureGameScoreRequest { P1 = g.P1, P2 = g.P2 }).ToList(),
};

static void KnockoutAutoCompletesByeMatches()
{
    var service = Service();
    var matches = (List<FixtureGenerationService.FixtureMatch>)Invoke(
        service,
        "GenerateKnockoutMatches",
        new List<FixtureGenerationService.FixtureTeam> { Team("1", 1), Team("2", 2), Team("3", 3) })!;

    var byeMatches = matches.Where(m => m.Team1.Id.StartsWith("bye-") || m.Team2.Id.StartsWith("bye-")).ToList();
    AssertTrue(byeMatches.Count > 0, "Expected at least one BYE match.");
    AssertTrue(byeMatches.All(m => m.Status == StatusCodesEx.Match.Completed && (m.Winner == "team1" || m.Winner == "team2")), "BYE matches must be completed with a winner.");
}

static void KnockoutSeedLineProtectsTopSeeds()
{
    var service = Service();
    var seedLine = (List<int>)Invoke(service, "BuildSeedLine", 8)!;
    var expected = new[] { 1, 8, 4, 5, 3, 6, 2, 7 };
    AssertTrue(seedLine.SequenceEqual(expected), $"Unexpected seed line: {string.Join(",", seedLine)}");
}

static void GroupDrawScoreIsAccepted()
{
    var service = Service();
    var match = Match(Team("1"), Team("2"), "group", null, ("1", "1"));
    var result = Invoke(service, "ValidateScoreRequest", match, ScoreRequest(null, ("1", "1")));
    AssertTrue(result == null, "Group draw score should be accepted.");
}

static void KnockoutDrawScoreIsRejected()
{
    var service = Service();
    var match = Match(Team("1"), Team("2"), "knockout", null, ("1", "1"));
    var result = (FixtureGenerationService.FixtureGenerationResult?)Invoke(service, "ValidateScoreRequest", match, ScoreRequest(null, ("1", "1")));
    AssertTrue(result?.Success == false && result.Code == "INVALID_WINNER", "Knockout draw score should be rejected.");
}

static void GroupKnockoutUsesUniqueQualifiers()
{
    var service = Service();
    var groups = new List<FixtureGenerationService.FixtureGroup>
    {
        Group("G1", Team("A1"), Team("A2")),
        Group("G2", Team("B1"), Team("B2")),
        Group("G3", Team("C1"), Team("C2")),
    };
    var config = new FixtureGenerationService.FixtureConfig { Format = "group_knockout", AdvancePerGroup = 1 };
    var matches = (List<FixtureGenerationService.FixtureMatch>)Invoke(service, "GenerateKnockoutFromGroups", groups, config)!;
    var realTeams = matches.SelectMany(m => new[] { m.Team1, m.Team2 })
        .Where(t => !t.Id.StartsWith("bye-"))
        .Select(t => t.Id)
        .ToList();

    AssertTrue(realTeams.Count == realTeams.Distinct().Count(), "Qualifiers must not be duplicated.");
    AssertTrue(realTeams.OrderBy(x => x).SequenceEqual(new[] { "A1", "B1", "C1" }), "Expected each group winner once.");
}

static void GroupKnockoutReseedsQualifiersByStandings()
{
    var service = Service();
    var groups = new List<FixtureGenerationService.FixtureGroup>
    {
        Group("G1", Team("A1", 99), Team("A2", 1)),
        Group("G2", Team("B1", 98), Team("B2", 2)),
        Group("G3", Team("C1", 97), Team("C2", 3)),
    };
    var originalSeeds = groups.SelectMany(g => g.Teams).ToDictionary(t => t.Id, t => t.Seed);
    var config = new FixtureGenerationService.FixtureConfig { Format = "group_knockout", AdvancePerGroup = 2 };

    var matches = (List<FixtureGenerationService.FixtureMatch>)Invoke(service, "GenerateKnockoutFromGroups", groups, config)!;
    var byeMatchTeamIds = matches
        .Where(m => m.Team1.Id.StartsWith("bye-") || m.Team2.Id.StartsWith("bye-"))
        .Select(m => m.Team1.Id.StartsWith("bye-") ? m.Team2.Id : m.Team1.Id)
        .OrderBy(id => id)
        .ToList();
    var groupSeedsAfter = groups.SelectMany(g => g.Teams).ToDictionary(t => t.Id, t => t.Seed);

    AssertTrue(byeMatchTeamIds.SequenceEqual(new[] { "B1", "C1" }), $"Expected top group winners to receive BYEs, got {string.Join(",", byeMatchTeamIds)}.");
    AssertTrue(groupSeedsAfter.All(kvp => originalSeeds[kvp.Key] == kvp.Value), "Original group team seeds must not be mutated.");
}

static void RoundRobinKnockoutReseedsByFinalStandings()
{
    var service = Service();
    var a = Team("A", 99);
    var b = Team("B", 1);
    var c = Team("C", 2);
    var d = Team("D", 3);
    var group = new FixtureGenerationService.FixtureGroup
    {
        Id = "G1",
        Name = "Group A",
        Teams = new List<FixtureGenerationService.FixtureTeam> { a, b, c, d },
        Matches = new List<FixtureGenerationService.FixtureMatch>
        {
            Match(a, b, "group", "team1", ("21", "10"), ("21", "10")),
            Match(a, c, "group", "team1", ("21", "10"), ("21", "10")),
            Match(a, d, "group", "team1", ("21", "10"), ("21", "10")),
            Match(b, c, "group", "team1", ("21", "10"), ("21", "10")),
            Match(b, d, "group", "team1", ("21", "10"), ("21", "10")),
            Match(c, d, "group", "team1", ("21", "10"), ("21", "10")),
        },
    };
    var config = new FixtureGenerationService.FixtureConfig { Format = "round_robin", AdvancePerGroup = 4 };

    var matches = (List<FixtureGenerationService.FixtureMatch>)Invoke(service, "GenerateKnockoutFromGroups", new List<FixtureGenerationService.FixtureGroup> { group }, config)!;
    var matchups = matches.Select(m => $"{m.Team1.Id}-{m.Team2.Id}").ToList();

    AssertTrue(matchups.SequenceEqual(new[] { "A-D", "C-B" }), $"Expected knockout seeding by round-robin standings, got {string.Join(",", matchups)}.");
    AssertTrue(group.Teams.First(t => t.Id == "A").Seed == 99, "Round-robin group team seeds must not be mutated.");
}

static FixtureGenerationService.FixtureGroup Group(string id, FixtureGenerationService.FixtureTeam first, FixtureGenerationService.FixtureTeam second) => new()
{
    Id = id,
    Name = id,
    Teams = new List<FixtureGenerationService.FixtureTeam> { first, second },
    Matches = new List<FixtureGenerationService.FixtureMatch>
    {
        Match(first, second, "group", "team1", ("21", "10"), ("21", "10")),
    },
};

static void ThreeWayStandingsUseGameDifference()
{
    var service = Service();
    var a = Team("A");
    var b = Team("B");
    var c = Team("C");
    var group = new FixtureGenerationService.FixtureGroup
    {
        Id = "G1",
        Name = "Group A",
        Teams = new List<FixtureGenerationService.FixtureTeam> { a, b, c },
        Matches = new List<FixtureGenerationService.FixtureMatch>
        {
            Match(a, b, "group", "team1", ("21", "10"), ("10", "21"), ("21", "10")),
            Match(b, c, "group", "team1", ("21", "10"), ("21", "10")),
            Match(c, a, "group", "team1", ("21", "10"), ("10", "21"), ("21", "10")),
        },
    };
    var config = new FixtureGenerationService.FixtureConfig
    {
        StandingPoints = new FixtureGenerationService.StandingPoints { Win = 1, Draw = 0, Loss = 0 },
    };

    var standings = (System.Collections.IEnumerable)Invoke(service, "ComputeGroupStandings", group, config)!;
    var ids = standings.Cast<object>()
        .Select(s => (string)s.GetType().GetProperty("Team", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!.GetValue(s)!.GetType().GetProperty("Id")!.GetValue(
            s.GetType().GetProperty("Team", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)!.GetValue(s)!)!)
        .ToList();

    AssertTrue(ids[0] == "B", $"Expected B first by game difference, got {ids[0]}.");
}
