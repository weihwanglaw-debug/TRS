using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using TRS_API.Controllers;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class EventIntegrationSqlTests
{
    private sealed class Schema(DbContextOptions<TRSDbContext> options) : TRSDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder mb)
        {
            base.OnModelCreating(mb);
            foreach(var fk in mb.Model.GetEntityTypes().SelectMany(t=>t.GetForeignKeys())) fk.DeleteBehavior=DeleteBehavior.NoAction;
        }
    }

    [SnapshotSqlFact]
    public async Task Mark_validate_export_unmark_and_audit_use_real_sql_without_payment_requirements()
    {
        var name="TRS_IntegrationTest_"+Guid.NewGuid().ToString("N");
        var builder=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("TRS_SNAPSHOT_TEST_CONNECTION")){InitialCatalog=name};
        var options=new DbContextOptionsBuilder<TRSDbContext>().UseSqlServer(builder.ConnectionString).Options;
        try
        {
            await using(var schema=new Schema(options)) await schema.Database.EnsureCreatedAsync();
            await using var db=new TRSDbContext(options);
            var admin=new AdminUser { Email="integration@test.invalid",Name="Test admin",Role="superadmin",PasswordHash="not-used",IsActive=true };
            db.AdminUsers.Add(admin);
            var ev=new Event { Name="Open",Venue="Hall",IsActive=true,IsSports=true,SportType="Badminton",RegistrationStatus="CL",EventStartDate=new(2026,12,1),OpenDate=new(2026,1,1),CloseDate=new(2026,11,30) };
            db.Events.Add(ev);await db.SaveChangesAsync();
            var program=new TrsProgram { EventId=ev.EventId,Name="Singles",Type="Singles",Gender="Male",IsActive=true,MinPlayers=1,MaxPlayers=1,MinParticipants=2,MaxParticipants=32,MinAge=0,MaxAge=99,FeeStructure="per_entry",Status="O" };
            db.Programs.Add(program);await db.SaveChangesAsync();
            foreach(var status in new[]{"C","C","X","CP","RF"})
            {
                var reg=new EventRegistration { EventId=ev.EventId,EventName=ev.Name,ContactName="Test",ContactEmail="test@example.com",RegStatus=status,RegistrationStatus="C" };
                var group=new ParticipantGroup { EventId=ev.EventId,ProgramId=program.ProgramId,ProgramName=program.Name,Registration=reg,GroupStatus=status=="X"?"X":"C" };
                group.Participants.Add(new Participant { FullName="Player "+status+Guid.NewGuid(),DateOfBirth=new(2000,1,1),ParticipantStatus="A",Gender="Male",Email="test@example.com",ContactNumber="+6500000000" });
                db.ParticipantGroups.Add(group);
            }
            await db.SaveChangesAsync();
            var configuration=new ConfigurationBuilder().Build();var auth=new AuthService(configuration);
            var context=new DefaultHttpContext { User=new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier,admin.UserId.ToString()),new Claim(ClaimTypes.Role,"superadmin")],"test")) };
            var controller=new EventIntegrationController(db,new AdminAuditService(db,auth)){ControllerContext=new ControllerContext { HttpContext=context }};
            var exporter=new TlsExportController(db,configuration){ControllerContext=new ControllerContext { HttpContext=context }};
            Assert.IsType<ConflictObjectResult>(await exporter.Download(ev.EventId,default));
            Assert.IsType<OkObjectResult>(await controller.Set(ev.EventId,new(true),default));
            Assert.True((await db.Events.SingleAsync()).ReadyForEventIntegration);
            var export=Assert.IsType<OkObjectResult>(await exporter.Download(ev.EventId,default));
            var json=JsonSerializer.SerializeToElement(export.Value,new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.Equal(2,json.GetProperty("entries").GetArrayLength());Assert.Equal(2,json.GetProperty("participants").GetArrayLength());
            Assert.Empty(await db.Payments.ToListAsync());

            Assert.IsType<OkObjectResult>(await controller.Set(ev.EventId,new(false),default));
            Assert.IsType<ConflictObjectResult>(await exporter.Download(ev.EventId,default));
            Assert.Equal(2,await db.AdminAuditLogs.CountAsync(a=>a.Action=="EVENT_INTEGRATION_READINESS"));
            var pending=new EventRegistration { EventId=ev.EventId,EventName=ev.Name,ContactName="Pending",ContactEmail="pending@example.com",RegStatus="P" };
            db.EventRegistrations.Add(pending);await db.SaveChangesAsync();
            Assert.IsType<BadRequestObjectResult>(await controller.Set(ev.EventId,new(true),default));
            Assert.False((await db.Events.SingleAsync()).ReadyForEventIntegration);
        }
        finally
        {
            SqlConnection.ClearAllPools();builder.InitialCatalog="master";
            await using var connection=new SqlConnection(builder.ConnectionString);await connection.OpenAsync();await using var command=connection.CreateCommand();
            command.CommandText=$"IF DB_ID('{name}') IS NOT NULL BEGIN ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]; END";await command.ExecuteNonQueryAsync();
        }
    }
}
