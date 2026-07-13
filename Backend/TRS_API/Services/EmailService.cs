using System.Net;
using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using TRS_Data.Models;

namespace TRS_API.Services;

public class EmailService
{
    private readonly IConfiguration _config;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration config, ILogger<EmailService> logger)
        => (_config, _logger) = (config, logger);

    public async Task SendPaymentConfirmationAsync(TRSDbContext db, int registrationId, byte[] receiptPdf, CancellationToken ct = default)
    {
        var reg = await db.EventRegistrations
            .Include(r => r.Payments)
            .FirstOrDefaultAsync(r => r.RegistrationId == registrationId, ct);

        if (reg == null)
        {
            _logger.LogWarning("Unable to send confirmation email: registration {RegistrationId} not found", registrationId);
            return;
        }

        if (string.IsNullOrWhiteSpace(reg.ContactEmail))
        {
            _logger.LogWarning("Unable to send confirmation email: registration {RegistrationId} has no contact email", registrationId);
            return;
        }

        var host = _config["Email:Smtp:Host"];
        var port = _config.GetValue<int?>("Email:Smtp:Port") ?? 587;
        var username = _config["Email:Smtp:Username"];
        var password = _config["Email:Smtp:Password"];
        var appName = await GetAppNameAsync(db, ct);
        var fromAddress = _config["Email:FromAddress"] ?? username;
        var fromName = _config["Email:FromName"] ?? appName;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(fromAddress))
        {
            _logger.LogWarning(
                "Skipping payment confirmation email for registration {RegistrationId}: SMTP is not configured",
                registrationId);
            return;
        }

        var receiptNo = reg.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault()?.ReceiptNumber
            ?? ReceiptNumberGenerator.FallbackRegistrationReference(registrationId);

        using var message = new MailMessage
        {
            From = new MailAddress(fromAddress, fromName),
            Subject = $"{appName} registration confirmed ({receiptNo})",
            Body =
                $"Hello {reg.ContactName},\n\n" +
                $"Your registration for {reg.EventName} has been confirmed.\n" +
                $"Receipt number: {receiptNo}\n\n" +
                "Your receipt is attached to this email.\n\n" +
                $"Regards,\n{appName}",
            IsBodyHtml = false,
        };
        message.To.Add(reg.ContactEmail);
        message.Attachments.Add(new Attachment(new MemoryStream(receiptPdf), $"Receipt-{receiptNo}.pdf", "application/pdf"));

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = _config.GetValue("Email:Smtp:EnableSsl", true),
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };

        if (!string.IsNullOrWhiteSpace(username))
        {
            client.Credentials = new NetworkCredential(username, password);
        }

        await client.SendMailAsync(message, ct);
        _logger.LogInformation("Payment confirmation email sent for registration {RegistrationId} to {Email}", registrationId, reg.ContactEmail);
    }

    public async Task SendPaymentReconciliationAlertAsync(TRSDbContext db, WebhookLog log, CancellationToken ct = default)
    {
        var adminEmails = await db.AdminUsers
            .AsNoTracking()
            .Where(u => u.IsActive && (u.Role == "superadmin" || u.Role == "eventadmin"))
            .Select(u => u.Email)
            .ToListAsync(ct);

        var recipients = adminEmails
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(IsValidEmailAddress)
            .ToArray();

        if (recipients.Length == 0)
        {
            _logger.LogWarning(
                "Skipping payment reconciliation alert for webhook log {WebhookLogId}: no active admin recipients with valid email addresses",
                log.WebhookLogId);
            return;
        }

        var host = _config["Email:Smtp:Host"];
        var port = _config.GetValue<int?>("Email:Smtp:Port") ?? 587;
        var username = _config["Email:Smtp:Username"];
        var password = _config["Email:Smtp:Password"];
        var appName = await GetAppNameAsync(db, ct);
        var fromAddress = _config["Email:FromAddress"] ?? username;
        var fromName = _config["Email:FromName"] ?? appName;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(fromAddress))
        {
            _logger.LogWarning(
                "Skipping payment reconciliation alert for webhook log {WebhookLogId}: SMTP is not configured",
                log.WebhookLogId);
            return;
        }

        var amount = log.Amount.HasValue
            ? $"{log.Currency ?? "SGD"} {log.Amount.Value:0.00}"
            : log.Currency ?? "Unknown amount";

        using var message = new MailMessage
        {
            From = new MailAddress(fromAddress, fromName),
            Subject = $"{appName} payment reconciliation required ({log.GatewaySessionId})",
            Body =
                "A payment needs organiser review in the system.\n\n" +
                $"Reason: {log.ErrorMessage}\n" +
                $"Gateway: {log.PaymentGateway}\n" +
                $"Event type: {log.EventType}\n" +
                $"Reference: {log.GatewaySessionId}\n" +
                $"Amount: {amount}\n" +
                $"Contact: {log.ContactName ?? "-"}\n" +
                $"Email: {log.ContactEmail ?? "-"}\n" +
                $"Phone: {log.ContactPhone ?? "-"}\n" +
                $"Received at UTC: {log.ReceivedAt:yyyy-MM-dd HH:mm:ss}\n\n" +
                "Please review this in Admin > Payment Reconciliation.",
            IsBodyHtml = false,
        };

        foreach (var recipient in recipients)
        {
            message.To.Add(recipient);
        }

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = _config.GetValue("Email:Smtp:EnableSsl", true),
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };

        if (!string.IsNullOrWhiteSpace(username))
        {
            client.Credentials = new NetworkCredential(username, password);
        }

        await client.SendMailAsync(message, ct);
        _logger.LogInformation(
            "Payment reconciliation alert sent for webhook log {WebhookLogId} to {RecipientCount} recipient(s)",
            log.WebhookLogId,
            recipients.Length);
    }

    public async Task SendCancellationNotificationAsync(
        TRSDbContext db,
        int registrationId,
        string scope,
        string reason,
        bool includesRefund,
        byte[]? updatedReceiptPdf,
        CancellationToken ct = default)
    {
        var reg = await db.EventRegistrations
            .Include(r => r.Payments)
            .FirstOrDefaultAsync(r => r.RegistrationId == registrationId, ct);

        if (reg == null)
        {
            _logger.LogWarning("Unable to send cancellation email: registration {RegistrationId} not found", registrationId);
            return;
        }

        if (string.IsNullOrWhiteSpace(reg.ContactEmail))
        {
            _logger.LogWarning("Unable to send cancellation email: registration {RegistrationId} has no contact email", registrationId);
            return;
        }

        var host = _config["Email:Smtp:Host"];
        var port = _config.GetValue<int?>("Email:Smtp:Port") ?? 587;
        var username = _config["Email:Smtp:Username"];
        var password = _config["Email:Smtp:Password"];
        var appName = await GetAppNameAsync(db, ct);
        var fromAddress = _config["Email:FromAddress"] ?? username;
        var fromName = _config["Email:FromName"] ?? appName;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(fromAddress))
        {
            _logger.LogWarning(
                "Skipping cancellation email for registration {RegistrationId}: SMTP is not configured",
                registrationId);
            return;
        }

        var receiptNo = reg.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault()?.ReceiptNumber
            ?? ReceiptNumberGenerator.FallbackRegistrationReference(registrationId);
        var scopeLabel = scope switch
        {
            "participant" => "participant",
            "entry" => "entry",
            _ => "registration",
        };

        using var message = new MailMessage
        {
            From = new MailAddress(fromAddress, fromName),
            Subject = includesRefund
                ? $"{appName} {scopeLabel} cancelled with refund ({receiptNo})"
                : $"{appName} {scopeLabel} cancelled ({receiptNo})",
            Body =
                $"Hello {reg.ContactName},\n\n" +
                $"Your {scopeLabel} for {reg.EventName} has been cancelled.\n" +
                $"Reason: {reason}\n\n" +
                (includesRefund
                    ? "A refund has been processed. Your updated receipt, including refund information, is attached.\n\n"
                    : "No refund was processed for this cancellation.\n\n") +
                $"Regards,\n{appName}",
            IsBodyHtml = false,
        };
        message.To.Add(reg.ContactEmail);

        if (includesRefund && updatedReceiptPdf is { Length: > 0 })
        {
            message.Attachments.Add(new Attachment(
                new MemoryStream(updatedReceiptPdf),
                $"Receipt-{receiptNo}.pdf",
                "application/pdf"));
        }

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = _config.GetValue("Email:Smtp:EnableSsl", true),
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };

        if (!string.IsNullOrWhiteSpace(username))
        {
            client.Credentials = new NetworkCredential(username, password);
        }

        await client.SendMailAsync(message, ct);
        _logger.LogInformation(
            "Cancellation email sent for registration {RegistrationId} to {Email}",
            registrationId,
            reg.ContactEmail);
    }

    public async Task SendLandingMessageAsync(
        TRSDbContext db,
        string name,
        string contact,
        string topic,
        string body,
        CancellationToken ct = default)
    {
        var configs = await db.SystemConfigs.AsNoTracking().ToListAsync(ct);
        var cfg = configs.ToDictionary(c => c.ConfigKey, c => c.ConfigValue);
        var appName = cfg.GetValueOrDefault("appName", "System");
        if (string.IsNullOrWhiteSpace(appName)) appName = "System";

        var recipient = cfg.GetValueOrDefault("contactEmail", "");
        if (string.IsNullOrWhiteSpace(recipient) || !IsValidEmailAddress(recipient))
            throw new InvalidOperationException("Contact email is not configured.");

        var host = _config["Email:Smtp:Host"];
        var port = _config.GetValue<int?>("Email:Smtp:Port") ?? 587;
        var username = _config["Email:Smtp:Username"];
        var password = _config["Email:Smtp:Password"];
        var fromAddress = _config["Email:FromAddress"] ?? username;
        var fromName = _config["Email:FromName"] ?? appName;

        if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(fromAddress))
            throw new InvalidOperationException("SMTP is not configured.");

        using var message = new MailMessage
        {
            From = new MailAddress(fromAddress, fromName),
            Subject = $"[{appName}] {topic.Trim()}",
            Body =
                "A message was submitted from the landing page.\n\n" +
                $"Name: {name.Trim()}\n" +
                $"Email or phone: {contact.Trim()}\n" +
                $"Topic: {topic.Trim()}\n\n" +
                body.Trim(),
            IsBodyHtml = false,
        };
        message.To.Add(recipient.Trim());

        if (IsValidEmailAddress(contact.Trim()))
            message.ReplyToList.Add(new MailAddress(contact.Trim(), name.Trim()));

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = _config.GetValue("Email:Smtp:EnableSsl", true),
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };

        if (!string.IsNullOrWhiteSpace(username))
            client.Credentials = new NetworkCredential(username, password);

        await client.SendMailAsync(message, ct);
        _logger.LogInformation("Landing message sent to configured contact email {Email}", recipient);
    }

    private static bool IsValidEmailAddress(string email)
    {
        try
        {
            _ = new MailAddress(email);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static async Task<string> GetAppNameAsync(TRSDbContext db, CancellationToken ct)
    {
        var appName = await db.SystemConfigs
            .AsNoTracking()
            .Where(c => c.ConfigKey == "appName")
            .Select(c => c.ConfigValue)
            .FirstOrDefaultAsync(ct);

        return string.IsNullOrWhiteSpace(appName) ? "System" : appName.Trim();
    }
}
