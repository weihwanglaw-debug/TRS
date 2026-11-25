using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

/// <summary>Read-only operational setup export; excludes registration and payment details.</summary>
[EnableRateLimiting("event-integration")]
[ApiController, Route("api/tls-export"), TlsExportAccess]
public sealed class TlsExportController(TRSDbContext db, IConfiguration configuration) : ControllerBase
{
    [HttpGet("events")]
    public async Task<IActionResult> Events(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var events = await db.Events.AsNoTracking().Where(e=>e.IsActive && e.IsSports && e.ReadyForEventIntegration && !db.Fixtures.Any(f => f.EventId == e.EventId))
            .Include(e => e.Programs).OrderByDescending(e=>e.EventStartDate).ToListAsync(ct);
        return Ok(events.Where(e => RegistrationWorkflowService.ComputeRegistrationStatus(e, e.Programs.Count(p => p.IsActive)) == StatusCodesEx.EventRegistration.Closed)
            .Select(e=>new {id=e.EventId,name=e.Name,startDate=e.EventStartDate,venue=e.Venue}));
    }

    [HttpGet("events/{id:int}")]
    public async Task<IActionResult> Download(int id,CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        // One transaction prevents mixing separately edited program and participant snapshots.
        await using var tx=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable,ct);
        var ev=await db.Events.AsNoTracking().SingleOrDefaultAsync(e=>e.EventId==id && e.IsActive && e.IsSports,ct);
        if(ev==null)return NotFound(new {message="Active sports event not found."});
        if (!ev.ReadyForEventIntegration) return Conflict(new { message="Mark this event Ready for Event Integration in TRS first." });
        var readinessErrors = await EventIntegrationRules.ValidateAsync(db, ev, ct);
        if (readinessErrors.Count > 0) return Conflict(new { message="The event is no longer ready for integration. Unmark it and resolve the readiness issues.", errors=readinessErrors });
        var programs=await db.Programs.AsNoTracking().Where(p=>p.EventId==id && p.IsActive).ToListAsync(ct);
        var programIds=programs.Select(p=>p.ProgramId).ToList();
        if (await db.Fixtures.AnyAsync(f => f.EventId == id, ct))
            return BadRequest(new { message = "Remove the event's TRS fixtures before transferring it to TLS." });
        if (RegistrationWorkflowService.ComputeRegistrationStatus(ev, programs.Count) != StatusCodesEx.EventRegistration.Closed)
            return BadRequest(new { message = "Close event registration before transferring it to TLS." });
        var groups=await db.ParticipantGroups.AsNoTracking().Include(g=>g.Participants).Include(g=>g.Registration)
            .Where(g=>g.EventId==id && programIds.Contains(g.ProgramId)
                && g.GroupStatus==StatusCodesEx.Registration.Confirmed && g.Registration.RegStatus==StatusCodesEx.Registration.Confirmed)
            .OrderBy(g=>g.GroupId).ToListAsync(ct);
        var zone=await db.SystemConfigs.AsNoTracking().Where(c=>c.ConfigKey=="displayTimeZone").Select(c=>c.ConfigValue).FirstOrDefaultAsync(ct) ?? "+08:00";
        var package=CreatePackage(ev,programs,groups,zone,configuration["TlsIntegration:SourceSystemId"] ?? "TRS");
        await tx.CommitAsync(ct);
        return Ok(package);
    }

    [NonAction]
    public static object CreatePackage(Event ev,List<TrsProgram> programs,List<ParticipantGroup> groups,string zone,string sourceSystemId = "TRS")
    {
        string EventId()=>"event:"+ev.EventId;
        static string Gender(string? value)=>value?.Trim().ToLowerInvariant() switch {"male" or "m"=>"M","female" or "f"=>"F","mixed" or "x"=>"X",_=>"O"};
        static string PersonKey(Participant p) => p.FullName.Trim().ToUpperInvariant() + "|" + (p.DateOfBirth?.ToString("yyyy-MM-dd") ?? "id:" + p.ParticipantId);
        var people = groups.SelectMany(g => g.Participants).Where(p => p.ParticipantStatus != StatusCodesEx.Participant.Cancelled)
            .OrderBy(p => p.ParticipantId).GroupBy(PersonKey).ToDictionary(g => g.Key, g => g.First());
        return new
        {
            schemaVersion=2,source="TRS",sourceSystemId,sourceTimeZone=zone,exportedAt=DateTimeOffset.UtcNow,
            registrationClosed=RegistrationWorkflowService.ComputeRegistrationStatus(ev,programs.Count)==StatusCodesEx.EventRegistration.Closed,hasFixtures=false,
            events=new[] {new {id=EventId(),name=ev.Name,venue=ev.Venue,startDate=ev.EventStartDate,endDate=ev.EventEndDate??ev.EventStartDate,maxProgramsPerParticipant=ev.MaxProgramsPerParticipant,status="D"}},
            programs=programs.Select(p=>new {
                id="program:"+p.ProgramId,eventId=EventId(),name=p.Name,sport=ev.SportType??"Other",
                entryType=p.MinPlayers==1 && p.MaxPlayers==1?"S":p.MinPlayers==2 && p.MaxPlayers==2?"D":"T",
                minPlayers=p.MinPlayers,maxPlayers=p.MaxPlayers,minAge=p.MinAge,maxAge=p.MaxAge,gender=Gender(p.Gender),
                minCapacity=p.MinParticipants,maxCapacity=p.MaxParticipants,capacityUnit=p.FeeStructure=="per_player"?"P":"E",status="A"
            }).ToArray(),
            // TLS uses one person across program entries; preserve the earliest TRS participant identity.
            participants=people.Values.Select(p=>new {
                id="participant:"+p.ParticipantId,eventId=EventId(),name=p.FullName,dob=p.DateOfBirth,
                gender=Gender(p.Gender),email=p.Email??"",mobile=p.ContactNumber??"",club=p.ClubSchoolCompany??"",nationality=p.Nationality??"",sbaId=p.SbaId??""
            }).ToArray(),
            entries=groups.Select(g=>new {id="entry:"+g.GroupId,eventId=EventId(),programId="program:"+g.ProgramId,
                participantIds=g.Participants.Where(p=>p.ParticipantStatus!=StatusCodesEx.Participant.Cancelled).OrderBy(p=>p.ParticipantId).Select(p=>"participant:"+people[PersonKey(p)].ParticipantId).ToArray(),
                name=g.NamesDisplay??"",seed=g.Seed,status="A"}).ToArray()
        };
    }
}
