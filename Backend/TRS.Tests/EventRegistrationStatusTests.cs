using TRS_API.Services;
using TRS_Data.Models;

namespace TRS.Tests;

public class EventRegistrationStatusTests
{
    private static readonly DateOnly Today = new(2026, 9, 22);

    [Fact]
    public void InactiveEvent_IsClosed()
    {
        var ev = BuildEvent(isActive: false);

        Assert.Equal(StatusCodesEx.EventRegistration.Closed,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 1, Today));
    }

    [Fact]
    public void EventWithoutActivePrograms_IsDraft()
    {
        var ev = BuildEvent();

        Assert.Equal(StatusCodesEx.EventRegistration.Draft,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 0, Today));
    }

    [Fact]
    public void ClosingDateOverridesManualPause()
    {
        var ev = BuildEvent(
            registrationStatus: StatusCodesEx.EventRegistration.Paused,
            closeDate: Today.AddDays(-1));

        Assert.Equal(StatusCodesEx.EventRegistration.Closed,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 1, Today));
    }

    [Fact]
    public void ManualPauseAppliesDuringRegistrationWindow()
    {
        var ev = BuildEvent(registrationStatus: StatusCodesEx.EventRegistration.Paused);

        Assert.Equal(StatusCodesEx.EventRegistration.Paused,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 1, Today));
    }

    [Fact]
    public void EventBeforeOpeningDate_IsUpcoming()
    {
        var ev = BuildEvent(openDate: Today.AddDays(1));

        Assert.Equal(StatusCodesEx.EventRegistration.Upcoming,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 1, Today));
    }

    [Fact]
    public void EventRemainsOpenOnClosingDate()
    {
        var ev = BuildEvent(closeDate: Today);

        Assert.Equal(StatusCodesEx.EventRegistration.Open,
            RegistrationWorkflowService.ComputeRegistrationStatus(ev, 1, Today));
    }

    private static Event BuildEvent(
        bool isActive = true,
        string registrationStatus = StatusCodesEx.EventRegistration.Open,
        DateOnly? openDate = null,
        DateOnly? closeDate = null) => new()
    {
        Name = "Test Event",
        Venue = "Test Venue",
        IsActive = isActive,
        RegistrationStatus = registrationStatus,
        OpenDate = openDate ?? Today.AddDays(-1),
        CloseDate = closeDate ?? Today.AddDays(1),
        EventStartDate = Today.AddDays(10),
    };
}
