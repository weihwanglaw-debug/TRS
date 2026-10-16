using Microsoft.EntityFrameworkCore;
using TRS_Data.Models;

namespace TRS_API.Services.Payments;

// Shared by admin requests, callbacks and recovery. Session ownership leaves existing transactions intact.
public sealed class FiuuRefundOperationLock(TRSDbContext db) : IAsyncDisposable
{
    private string? resource;
    public static string Registration(int id) => "TRS:FiuuRefund:registration:" + id;
    public static string Orphan(string reference) => "TRS:FiuuRefund:orphan:" + reference;

    public async Task AcquireAsync(string key, CancellationToken ct)
    {
        await db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@key, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=10000; SELECT @result;";
            var parameter = command.CreateParameter(); parameter.ParameterName = "@key"; parameter.Value = key;
            command.Parameters.Add(parameter);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) < 0)
                throw FiuuSignatureValidator.Invalid("REFUND_BUSY", "Another refund operation is in progress. Check its status before retrying.");
            resource = key;
        }
        catch { await db.Database.CloseConnectionAsync(); throw; }
    }

    public async ValueTask DisposeAsync()
    {
        if (resource == null) return;
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "EXEC sys.sp_releaseapplock @Resource=@key, @LockOwner='Session';";
            var parameter = command.CreateParameter(); parameter.ParameterName = "@key"; parameter.Value = resource;
            command.Parameters.Add(parameter);
            await command.ExecuteNonQueryAsync(CancellationToken.None);
        }
        finally { resource = null; await db.Database.CloseConnectionAsync(); }
    }
}
