using TRS_Data.Models;

namespace TRS_API.BackgroundJobs
{
    using Microsoft.Extensions.Hosting;
    using TRS_API.Services;

    public class BackgroundJobWorker : BackgroundService
    {
        private readonly ILogger<BackgroundJobWorker> _logger;
        private readonly IBackgroundJobQueue _jobQueue;

        public BackgroundJobWorker(
            ILogger<BackgroundJobWorker> logger,
            IBackgroundJobQueue jobQueue)
        {
            _logger = logger;
            _jobQueue = jobQueue;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Background job worker started");

            try
            {
                while (!stoppingToken.IsCancellationRequested)
                {
                    var job = await _jobQueue.DequeueAsync(stoppingToken);

                    try
                    {
                        await job(stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        // Normal shutdown.
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Background job failed");
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                _logger.LogInformation("Background job worker stopped.");
            }
        }
    }


}
