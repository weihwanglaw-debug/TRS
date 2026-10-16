using System.Reflection;
using Microsoft.EntityFrameworkCore;
using TRS_API.Services;
using TRS_Data.Models;

namespace TRS.Tests;

public sealed class RegistrationRollbackTrackingTests
{
    private static TRSDbContext CreateDb() => new(new DbContextOptionsBuilder<TRSDbContext>()
        .UseSqlServer("Server=unused;Database=unused;Integrated Security=True;TrustServerCertificate=True").Options);

    private static Action Capture(TRSDbContext db) => (Action)typeof(RegistrationWorkflowService)
        .GetMethod("CaptureTrackingForRollback", BindingFlags.NonPublic | BindingFlags.Static)!
        .Invoke(null, new object[] { db })!;

    [Fact]
    public void Rollback_discards_accepted_inserts_and_restores_attempt_concurrency_token()
    {
        using var db = CreateDb();
        var attempt = new PaymentAttempt { PaymentAttemptId = 47, AttemptKey = "test", PayloadJson = "{}",
            Status = "SB", RowVersion = new byte[] { 1 }, PaymentGateway = "Fiuu" };
        db.Attach(attempt);
        var rollback = Capture(db);
        // Earlier SaveChanges succeeded inside a transaction, then the payment insert failed.
        var registration = new EventRegistration { RegistrationId = 100 };
        db.Attach(registration);
        attempt.Status = "S";
        attempt.RowVersion = new byte[] { 2 };
        db.ChangeTracker.AcceptAllChanges();
        db.Add(new Payment { PaymentId = 101, RegistrationId = 100, PaymentGateway = "Fiuu" });

        rollback();

        Assert.Equal(EntityState.Detached, db.Entry(registration).State);
        Assert.Empty(db.ChangeTracker.Entries<Payment>());
        Assert.Same(attempt, Assert.Single(db.ChangeTracker.Entries<PaymentAttempt>()).Entity);
        Assert.Equal("SB", attempt.Status);
        Assert.Equal(new byte[] { 1 }, attempt.RowVersion);
        Assert.Equal(new byte[] { 1 }, db.Entry(attempt).Property(a => a.RowVersion).OriginalValue);
        // A subsequent reconciliation update uses the original persisted token only.
        attempt.ReconciliationReason = "CREATE_FAILED";
        db.ChangeTracker.DetectChanges();
        Assert.Equal(EntityState.Modified, db.Entry(attempt).State);
        Assert.False(db.Entry(attempt).Property(a => a.Status).IsModified);
    }

    [Fact]
    public void Rollback_preserves_caller_log_and_pending_changes_for_retry()
    {
        using var db = CreateDb();
        var attempt = new PaymentAttempt { PaymentAttemptId = 48, AttemptKey = "test", PayloadJson = "{}", Status = "SB" };
        db.Attach(attempt);
        attempt.ErrorMessage = "Caller pending change";
        var log = new WebhookLog { WebhookLogId = 12, GatewayEventId = "fiuu_test_Succeeded", ProcessingStatus = "P" };
        db.Attach(log);
        var rollback = Capture(db);
        attempt.Status = "S";
        log.ProcessingStatus = "S";
        db.ChangeTracker.AcceptAllChanges();
        rollback();
        Assert.Equal("P", log.ProcessingStatus);
        Assert.Equal("SB", attempt.Status);
        Assert.Equal("Caller pending change", attempt.ErrorMessage);
        Assert.True(db.Entry(attempt).Property(a => a.ErrorMessage).IsModified);
        Assert.False(db.Entry(attempt).Property(a => a.Status).IsModified);
        Assert.Equal(EntityState.Unchanged, db.Entry(log).State);
    }
}
