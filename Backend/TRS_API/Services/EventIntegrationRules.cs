using Microsoft.EntityFrameworkCore;
using TRS_Data.Models;

namespace TRS_API.Services;

public static class EventIntegrationRules
{
    public static bool Eligible(ParticipantGroup group) => group.GroupStatus == StatusCodesEx.Registration.Confirmed
        && group.Registration.RegStatus == StatusCodesEx.Registration.Confirmed;

    public static List<string> Validate(Event ev, List<TrsProgram> programs, List<EventRegistration> registrations, List<ParticipantGroup> groups, bool hasFixtures)
    {
        var errors = new List<string>();
        var active = programs.Where(p => p.IsActive).ToList();
        if (!ev.IsActive || !ev.IsSports) errors.Add("The event must be an active sports event.");
        if (RegistrationWorkflowService.ComputeRegistrationStatus(ev, active.Count) != StatusCodesEx.EventRegistration.Closed)
            errors.Add("Close event registration first.");
        if (hasFixtures) errors.Add("Remove existing TRS fixtures first.");
        if (active.Count == 0) errors.Add("Add at least one active program.");
        var pendingRegistrations = registrations.Count(r => r.RegStatus == StatusCodesEx.Registration.Pending);
        if (pendingRegistrations > 0) errors.Add($"Resolve {pendingRegistrations} pending registration(s).");
        var pendingGroups = groups.Count(g => g.GroupStatus == StatusCodesEx.Registration.Pending && g.Registration.RegStatus is StatusCodesEx.Registration.Pending or StatusCodesEx.Registration.Confirmed);
        if (pendingGroups > 0) errors.Add($"Resolve {pendingGroups} pending entry/entries.");
        foreach (var program in active)
        {
            var entries = groups.Where(g => g.ProgramId == program.ProgramId && Eligible(g)).ToList();
            var count = program.FeeStructure == "per_player" ? entries.Sum(g => g.Participants.Count(p => p.ParticipantStatus == StatusCodesEx.Participant.Active)) : entries.Count;
            if (count < program.MinParticipants) errors.Add($"{program.Name}: requires at least {program.MinParticipants} {(program.FeeStructure == "per_player" ? "players" : "entries")}; currently {count}.");
            foreach (var entry in entries)
            {
                var players = entry.Participants.Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled).ToList();
                if (players.Count < program.MinPlayers || players.Count > program.MaxPlayers)
                    errors.Add($"{program.Name}, entry #{entry.GroupId}: requires {program.MinPlayers}–{program.MaxPlayers} active player(s); currently {players.Count}.");
                if (players.Any(p => p.ParticipantStatus != StatusCodesEx.Participant.Active || string.IsNullOrWhiteSpace(p.FullName) || p.DateOfBirth is null))
                    errors.Add($"{program.Name}, entry #{entry.GroupId}: resolve participant status, name or date of birth.");
            }
        }
        return errors;
    }

    public static async Task<List<string>> ValidateAsync(TRSDbContext db, Event ev, CancellationToken ct)
    {
        var programs = await db.Programs.AsNoTracking().Where(p => p.EventId == ev.EventId).ToListAsync(ct);
        var registrations = await db.EventRegistrations.AsNoTracking().Where(r => r.EventId == ev.EventId).ToListAsync(ct);
        var groups = await db.ParticipantGroups.AsNoTracking().Include(g => g.Registration).Include(g => g.Participants).Where(g => g.EventId == ev.EventId).ToListAsync(ct);
        return Validate(ev, programs, registrations, groups, await db.Fixtures.AnyAsync(f => f.EventId == ev.EventId, ct));
    }
}
