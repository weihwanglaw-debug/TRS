
using Serilog.Core;
using Serilog.Events;
using TRS_Data.Models;

public class EFCoreSink : ILogEventSink
{
    private readonly IServiceProvider _services;
    [ThreadStatic]
    private static bool _isEmitting;

    public EFCoreSink(IServiceProvider services)
    {
        _services = services;
    }

    public void Emit(LogEvent logEvent)
    {
        if (_isEmitting)
        {
            return;
        }

        if (IsFrameworkLog(logEvent) && logEvent.Level < LogEventLevel.Error)
        {
            return;
        }

        try
        {
            _isEmitting = true;

            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TRS_Data.Models.TRSDbContext>();

            db.AppLogs.Add(new AppLog
            {
                Level       = logEvent.Level.ToString(),
                Message     = logEvent.RenderMessage(),
                Exception   = logEvent.Exception?.ToString(),
                SourceContext = logEvent.Properties.TryGetValue("SourceContext", out var sc)
                                ? sc.ToString().Trim('"') : null,
                Timestamp   = logEvent.Timestamp.UtcDateTime,
            });

            db.SaveChanges();
        }
        catch
        {
            // never let logging throw — swallow silently
        }
        finally
        {
            _isEmitting = false;
        }
    }

    private static bool IsFrameworkLog(LogEvent logEvent)
    {
        if (!logEvent.Properties.TryGetValue("SourceContext", out var sourceContext))
        {
            return false;
        }

        var source = sourceContext.ToString().Trim('"');
        return source.StartsWith("Microsoft.", StringComparison.Ordinal)
            || source.StartsWith("System.", StringComparison.Ordinal);
    }
}
