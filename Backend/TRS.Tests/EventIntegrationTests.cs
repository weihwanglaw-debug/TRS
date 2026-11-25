using TRS_API.Services;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class EventIntegrationTests
{
    private static (Event Event, TrsProgram Program, List<EventRegistration> Registrations, List<ParticipantGroup> Groups) ReadyData()
    {
        var ev = new Event { EventId=1,Name="Open",IsActive=true,IsSports=true,RegistrationStatus="CL",EventStartDate=new(2026,12,1),CloseDate=new(2026,11,30) };
        var program = new TrsProgram { ProgramId=2,EventId=1,Name="Singles",IsActive=true,MinParticipants=2,MinPlayers=1,MaxPlayers=1,FeeStructure="per_entry" };
        var registrations = new List<EventRegistration>(); var groups = new List<ParticipantGroup>();
        for (var i=1;i<=2;i++)
        {
            var registration = new EventRegistration { RegistrationId=i,EventId=1,RegStatus="C" };
            var group = new ParticipantGroup { GroupId=i,ProgramId=2,EventId=1,GroupStatus="C",Registration=registration };
            group.Participants.Add(new Participant { ParticipantId=i,FullName="Player "+i,ParticipantStatus="A",DateOfBirth=new(2000,1,1) });
            registrations.Add(registration);groups.Add(group);
        }
        return (ev,program,registrations,groups);
    }

    [Fact]
    public void Readiness_uses_participation_without_requiring_payment_records()
    {
        var data=ReadyData();
        Assert.Empty(EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,false));
        Assert.All(data.Groups,g=>Assert.True(EventIntegrationRules.Eligible(g)));
    }

    [Theory]
    [InlineData("X")][InlineData("CP")][InlineData("RF")]
    public void Cancelled_and_cancellation_related_registrations_are_excluded_not_pending_blockers(string status)
    {
        var data=ReadyData(); data.Program.MinParticipants=1;data.Registrations[0].RegStatus=status;
        Assert.False(EventIntegrationRules.Eligible(data.Groups[0]));
        Assert.Empty(EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,false));
    }

    [Fact]
    public void Readiness_lists_pending_registration_group_and_roster_failures()
    {
        var data=ReadyData();data.Registrations[0].RegStatus="P";data.Groups[1].GroupStatus="P";
        var errors=EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,false);
        Assert.Contains(errors,e=>e.Contains("pending registration"));Assert.Contains(errors,e=>e.Contains("pending entry"));Assert.Contains(errors,e=>e.Contains("currently 0"));
        data=ReadyData();data.Groups[0].Participants.Single().ParticipantStatus="X";
        Assert.Contains(EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,false),e=>e.Contains("active player"));
        data=ReadyData();data.Groups[0].Participants.Single().DateOfBirth=null;
        Assert.Contains(EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,false),e=>e.Contains("date of birth"));
    }

    [Fact]
    public void Existing_fixtures_and_open_registration_block_readiness()
    {
        var data=ReadyData();data.Event.RegistrationStatus="O";data.Event.OpenDate=new(2026,1,1);data.Event.CloseDate=new(2099,1,1);
        var errors=EventIntegrationRules.Validate(data.Event,[data.Program],data.Registrations,data.Groups,true);
        Assert.Contains("Close event registration first.",errors);Assert.Contains("Remove existing TRS fixtures first.",errors);
    }

}
