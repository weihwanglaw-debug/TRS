using TRS_API.Services;
using TRS_Data.Models;
namespace TRS.Tests;
public class HiddenProgramTests
{
    [Theory]
    [InlineData("H", true, EventRegistrationGateMode.StrictPublic, false)]
    [InlineData("H", true, EventRegistrationGateMode.AlreadyPaidFinalization, true)]
    [InlineData("H", true, EventRegistrationGateMode.AdminAssisted, true)]
    [InlineData("CL", true, EventRegistrationGateMode.StrictPublic, false)]
    [InlineData("CL", true, EventRegistrationGateMode.AlreadyPaidFinalization, false)]
    [InlineData("O", true, EventRegistrationGateMode.StrictPublic, true)]
    [InlineData("H", false, EventRegistrationGateMode.AlreadyPaidFinalization, false)]
    public void RegistrationGatePreservesPaidHiddenEntries(string status, bool active,
        EventRegistrationGateMode mode, bool expected)
    {
        var program = new TrsProgram { Status = status, IsActive = active };
        Assert.Equal(expected, RegistrationWorkflowService.CanRegisterProgram(program, mode));
    }
}
