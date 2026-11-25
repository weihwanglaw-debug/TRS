using System.Reflection;
using TRS_API.Models;
using TRS_API.Services;
using TRS_Data.Models;
namespace TRS.Tests;
public class NonSportAffiliationTests
{
    [Theory]
    [InlineData(false, "singles", true)]
    [InlineData(false, "doubles", true)]
    [InlineData(false, "team", false)]
    [InlineData(true, "singles", false)]
    public void Participant_validation_allows_blank_only_for_non_sport_non_team(bool isSports, string type, bool expected)
    {
        var result = Validate(isSports, type, false);
        Assert.Equal(expected, result.Success);
        if (!expected) Assert.Contains("Club / school / company", result.Message);
    }
    [Fact]
    public void Custom_company_remains_required_for_non_sport()
    {
        var result = Validate(false, "singles", true);
        Assert.False(result.Success);
        Assert.Contains("Company", result.Message);
    }
    private static RegistrationWorkflowResult<object> Validate(bool isSports, string type, bool custom)
    {
        var service = new RegistrationWorkflowService(null!, null!, null!, null!, null!, null!);
        var program = new TrsProgram {Type=type, Name="Social",MinPlayers=1,MaxPlayers=2,MinAge=0,MaxAge=99,Gender="Open"};
        if(custom) program.CustomFields.Add(new ProgramCustomField {CustomFieldId=1,Label="Company",IsRequired=true});
        var group = new CreateGroupDto { Participants = new() { new CreateParticipantDto {
            FullName="Test Player",Dob="2000-01-01",Gender="Male",Email="test@example.com",ContactNumber="91234567",Nationality="SG"
        } } };
        var method = typeof(RegistrationWorkflowService).GetMethod("ValidateParticipants",BindingFlags.Instance|BindingFlags.NonPublic)!;
        var existing = Activator.CreateInstance(method.GetParameters()[2].ParameterType)!;
        return (RegistrationWorkflowResult<object>)method.Invoke(service,new object[]{group,program,existing,isSports})!;
    }
}
