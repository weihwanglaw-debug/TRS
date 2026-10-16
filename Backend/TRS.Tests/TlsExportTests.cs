using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using TRS_API.Controllers;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class TlsExportTests
{
    [Fact]
    public void Export_requires_existing_administrator_roles()
    {
        var attribute=typeof(TlsExportController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.NotNull(attribute);
        Assert.Equal("superadmin,eventadmin",attribute.Roles);
        Assert.DoesNotContain(typeof(TlsExportController).GetMethods(),m=>m.GetCustomAttribute<AllowAnonymousAttribute>()!=null);
    }

    [Fact]
    public void Package_preserves_dates_source_ids_capacity_and_optional_sba_without_payment_data()
    {
        var ev=new Event { EventId=7,Name="Example",Venue="Hall",SportType="Badminton",EventStartDate=new(2026,10,9),MaxProgramsPerParticipant=2 };
        var programs=new List<TrsProgram> { new() {ProgramId=12,EventId=7,Name="Mixed",Gender="Mixed",MinPlayers=2,MaxPlayers=2,MinAge=10,MaxAge=40,MinParticipants=2,MaxParticipants=32,FeeStructure="per_player",Fee=99} };
        var group=new ParticipantGroup {GroupId=20,EventId=7,ProgramId=12,Fee=99,Seed=3};
        group.Participants.Add(new Participant {ParticipantId=101,FullName="Alex",DateOfBirth=new(2000,2,29),Gender="Male",Email="alex@example.com",ContactNumber="+6581234567",SbaId=null});
        group.Participants.Add(new Participant {ParticipantId=102,FullName="Withdrawn",ParticipantStatus="X"});
        var package=JsonSerializer.SerializeToElement(TlsExportController.CreatePackage(ev,programs,[group],"+08:00"));
        Assert.Equal("+08:00",package.GetProperty("sourceTimeZone").GetString());
        var e=package.GetProperty("events")[0];
        Assert.Equal("2026-10-09",e.GetProperty("startDate").GetString());
        Assert.Equal("2026-10-09",e.GetProperty("endDate").GetString());
        var p=package.GetProperty("programs")[0];
        Assert.Equal("P",p.GetProperty("capacityUnit").GetString());
        Assert.Equal("X",p.GetProperty("gender").GetString());
        Assert.False(p.TryGetProperty("fee",out _));
        var people=package.GetProperty("participants");
        Assert.Equal(1,people.GetArrayLength());
        Assert.Equal("participant:101",people[0].GetProperty("id").GetString());
        Assert.Equal("2000-02-29",people[0].GetProperty("dob").GetString());
        Assert.Equal("",people[0].GetProperty("sbaId").GetString());
        Assert.False(people[0].TryGetProperty("guardianContact",out _));
        Assert.Single(package.GetProperty("entries")[0].GetProperty("participantIds").EnumerateArray());
        Assert.Equal(3,package.GetProperty("entries")[0].GetProperty("seed").GetInt32());
    }
}
