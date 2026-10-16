using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS_API.Controllers;

/// <summary>Read-only operational setup export; excludes registration and payment details.</summary>
[ApiController, Route("api/tls-export"), Authorize(Roles = "superadmin,eventadmin")]
public sealed class TlsExportController(TRSDbContext db) : ControllerBase
{
    [HttpGet("events")]
    public async Task<IActionResult> Events(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await db.Events.AsNoTracking().Where(e=>e.IsActive && e.IsSports)
            .OrderByDescending(e=>e.EventStartDate)
            .Select(e=>new {id=e.EventId,name=e.Name,startDate=e.EventStartDate,venue=e.Venue}).ToListAsync(ct));
    }

    [HttpGet("events/{id:int}")]
    public async Task<IActionResult> Download(int id,CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        // One transaction prevents mixing separately edited program and participant snapshots.
        await using var tx=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable,ct);
        var ev=await db.Events.AsNoTracking().SingleOrDefaultAsync(e=>e.EventId==id && e.IsActive && e.IsSports,ct);
        if(ev==null)return NotFound(new {message="Active sports event not found."});
        var programs=await db.Programs.AsNoTracking().Where(p=>p.EventId==id && p.IsActive).ToListAsync(ct);
        var programIds=programs.Select(p=>p.ProgramId).ToList();
        var groups=await db.ParticipantGroups.AsNoTracking().Include(g=>g.Participants).Include(g=>g.Registration)
            .Where(g=>g.EventId==id && programIds.Contains(g.ProgramId)
                && g.GroupStatus!=StatusCodesEx.Registration.Cancelled && g.Registration.RegStatus!=StatusCodesEx.Registration.Cancelled)
            .OrderBy(g=>g.GroupId).ToListAsync(ct);
        var zone=await db.SystemConfigs.AsNoTracking().Where(c=>c.ConfigKey=="displayTimeZone").Select(c=>c.ConfigValue).FirstOrDefaultAsync(ct) ?? "+08:00";
        var package=CreatePackage(ev,programs,groups,zone);
        await tx.CommitAsync(ct);
        return Ok(package);
    }

    [NonAction]
    public static object CreatePackage(Event ev,List<TrsProgram> programs,List<ParticipantGroup> groups,string zone)
    {
        string EventId()=>"event:"+ev.EventId;
        static string Gender(string? value)=>value?.Trim().ToLowerInvariant() switch {"male" or "m"=>"M","female" or "f"=>"F","mixed" or "x"=>"X",_=>"O"};
        return new
        {
            schemaVersion=1,source="TRS",sourceTimeZone=zone,exportedAt=DateTimeOffset.UtcNow,
            events=new[] {new {id=EventId(),name=ev.Name,venue=ev.Venue,startDate=ev.EventStartDate,endDate=ev.EventEndDate??ev.EventStartDate,maxProgramsPerParticipant=ev.MaxProgramsPerParticipant,status="D"}},
            programs=programs.Select(p=>new {
                id="program:"+p.ProgramId,eventId=EventId(),name=p.Name,sport=ev.SportType??"Other",
                entryType=p.MinPlayers==1 && p.MaxPlayers==1?"S":p.MinPlayers==2 && p.MaxPlayers==2?"D":"T",
                minPlayers=p.MinPlayers,maxPlayers=p.MaxPlayers,minAge=p.MinAge,maxAge=p.MaxAge,gender=Gender(p.Gender),
                minCapacity=p.MinParticipants,maxCapacity=p.MaxParticipants,capacityUnit=p.FeeStructure=="per_player"?"P":"E",status="A"
            }).ToArray(),
            // Preserve source identities. TLS asks the organiser to link matching people across programs.
            participants=groups.SelectMany(g=>g.Participants.Where(p=>p.ParticipantStatus!=StatusCodesEx.Participant.Cancelled)).Select(p=>new {
                id="participant:"+p.ParticipantId,eventId=EventId(),name=p.FullName,dob=p.DateOfBirth,
                gender=Gender(p.Gender),email=p.Email??"",mobile=p.ContactNumber??"",club=p.ClubSchoolCompany??"",nationality=p.Nationality??"",sbaId=p.SbaId??""
            }).ToArray(),
            entries=groups.Select(g=>new {id="entry:"+g.GroupId,eventId=EventId(),programId="program:"+g.ProgramId,
                participantIds=g.Participants.Where(p=>p.ParticipantStatus!=StatusCodesEx.Participant.Cancelled).OrderBy(p=>p.ParticipantId).Select(p=>"participant:"+p.ParticipantId).ToArray(),
                name=g.NamesDisplay??"",seed=g.Seed,status="A"}).ToArray()
        };
    }
}
