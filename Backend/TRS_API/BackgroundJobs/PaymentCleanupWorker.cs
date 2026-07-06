using Microsoft.EntityFrameworkCore;
using TRS_Data.Models;

public class PaymentCleanupWorker : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<PaymentCleanupWorker> _logger;

    public PaymentCleanupWorker(IServiceProvider services, ILogger<PaymentCleanupWorker> logger)
        => (_services, _logger) = (services, logger);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.WhenAll(
                RunPaymentAttemptSweepLoop(stoppingToken),
                RunPendingCheckoutPruneLoop(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Payment cleanup worker stopped.");
        }
    }

    private async Task RunPaymentAttemptSweepLoop(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _services.CreateScope();
                var paymentAttempts = scope.ServiceProvider.GetRequiredService<TRS_API.Services.PaymentAttemptService>();
                await paymentAttempts.SweepAsync(stoppingToken);
                // Timeout is not failure. The sweep checks Stripe directly before
                // finalising or surfacing attempts that missed normal webhook flow.
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sweeping embedded payment attempts");
            }

            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        }
    }

    private async Task RunPendingCheckoutPruneLoop(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using (var scope = _services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<TRSDbContext>();
                await PruneExpiredPendingCheckouts(db, stoppingToken);
            }

            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }

    // A PendingCheckout row is safe to delete when its Stripe session has expired
    // and no successful Payment exists for that session.
    private async Task PruneExpiredPendingCheckouts(TRSDbContext db, CancellationToken ct)
    {
        try
        {
            var now = DateTime.UtcNow;

            var expiredSessionIds = await db.PendingCheckouts
                .Where(p => p.ExpiresAt < now)
                .Select(p => p.GatewaySessionId)
                .ToListAsync(ct);

            if (!expiredSessionIds.Any()) return;

            var toDelete = await db.PendingCheckouts
                .Where(p => expiredSessionIds.Contains(p.GatewaySessionId))
                .ToListAsync(ct);

            if (toDelete.Any())
            {
                db.PendingCheckouts.RemoveRange(toDelete);
                await db.SaveChangesAsync(ct);
                _logger.LogInformation(
                    "Pruned {Count} expired PendingCheckout rows", toDelete.Count);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error pruning expired PendingCheckout rows");
        }
    }
}
