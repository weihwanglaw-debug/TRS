using System.Net;
using System.Net.Http.Headers;
using System.Net.Mail;
using System.Text;
using System.Text.Json;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using TRS_Data.Models;
using MailKitSmtpClient = MailKit.Net.Smtp.SmtpClient;

namespace TRS_API.Services;

public class EmailService
{
    private readonly IConfiguration _config;
    private readonly ILogger<EmailService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;

    public EmailService(IConfiguration config, ILogger<EmailService> logger, IHttpClientFactory httpClientFactory)
        => (_config, _logger, _httpClientFactory) = (config, logger, httpClientFactory);

    public async Task SendPaymentConfirmationAsync(
        TRSDbContext db,
        int registrationId,
        byte[] receiptPdf,
        byte[]? registrationDetailsPdf = null,
        CancellationToken ct = default)
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

        var appName = await GetAppNameAsync(db, ct);
        var email = GetEmailSettings(appName);

        if (!email.IsConfigured)
        {
            _logger.LogWarning(
                "Skipping payment confirmation email for registration {RegistrationId}: email provider {Provider} is not configured",
                registrationId,
                email.Provider);
            return;
        }

        if (email.IsPlaceholder)
        {
            _logger.LogWarning(
                "Skipping payment confirmation email for registration {RegistrationId}: email provider {Provider} is configured as placeholder only",
                registrationId,
                email.Provider);
            return;
        }

        var receiptNo = reg.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault()?.ReceiptNumber
            ?? ReceiptNumberGenerator.FallbackRegistrationReference(registrationId);

        using var message = new MailMessage
        {
            From = new MailAddress(email.FromAddress!, email.FromName),
            Subject = $"{appName} registration confirmed ({receiptNo})",
            Body =
                $"Hello {reg.ContactName},\n\n" +
                $"Your registration for {reg.EventName} has been confirmed.\n" +
                $"Receipt number: {receiptNo}\n\n" +
                "Your receipt and registration details are attached to this email.\n\n" +
                $"Regards,\n{appName}",
            IsBodyHtml = false,
        };
        message.To.Add(reg.ContactEmail);
        message.Attachments.Add(new Attachment(new MemoryStream(receiptPdf), $"Receipt-{receiptNo}.pdf", "application/pdf"));
        if (registrationDetailsPdf is { Length: > 0 })
        {
            message.Attachments.Add(new Attachment(
                new MemoryStream(registrationDetailsPdf),
                $"RegistrationDetails-{ReceiptNumberGenerator.FallbackRegistrationReference(registrationId)}.pdf",
                "application/pdf"));
        }

        await SendMailAsync(message, email, ct);
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

        var appName = await GetAppNameAsync(db, ct);
        var email = GetEmailSettings(appName);

        if (!email.IsConfigured)
        {
            _logger.LogWarning(
                "Skipping payment reconciliation alert for webhook log {WebhookLogId}: email provider {Provider} is not configured",
                log.WebhookLogId,
                email.Provider);
            return;
        }

        if (email.IsPlaceholder)
        {
            _logger.LogWarning(
                "Skipping payment reconciliation alert for webhook log {WebhookLogId}: email provider {Provider} is configured as placeholder only",
                log.WebhookLogId,
                email.Provider);
            return;
        }

        var amount = log.Amount.HasValue
            ? $"{log.Currency ?? "SGD"} {log.Amount.Value:0.00}"
            : log.Currency ?? "Unknown amount";

        using var message = new MailMessage
        {
            From = new MailAddress(email.FromAddress!, email.FromName),
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

        await SendMailAsync(message, email, ct);
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
        byte[]? registrationDetailsPdf = null,
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

        var appName = await GetAppNameAsync(db, ct);
        var email = GetEmailSettings(appName);

        if (!email.IsConfigured)
        {
            _logger.LogWarning(
                "Skipping cancellation email for registration {RegistrationId}: email provider {Provider} is not configured",
                registrationId,
                email.Provider);
            return;
        }

        if (email.IsPlaceholder)
        {
            _logger.LogWarning(
                "Skipping cancellation email for registration {RegistrationId}: email provider {Provider} is configured as placeholder only",
                registrationId,
                email.Provider);
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
            From = new MailAddress(email.FromAddress!, email.FromName),
            Subject = includesRefund
                ? $"{appName} {scopeLabel} cancelled with refund ({receiptNo})"
                : $"{appName} {scopeLabel} cancelled ({receiptNo})",
            Body =
                $"Hello {reg.ContactName},\n\n" +
                $"Your {scopeLabel} for {reg.EventName} has been cancelled.\n" +
                $"Reason: {reason}\n\n" +
                (includesRefund
                    ? "A refund has been processed. Your updated receipt and registration details are attached.\n\n"
                    : "No refund was processed for this cancellation. Your updated registration details are attached.\n\n") +
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
        if (registrationDetailsPdf is { Length: > 0 })
        {
            message.Attachments.Add(new Attachment(
                new MemoryStream(registrationDetailsPdf),
                $"RegistrationDetails-{ReceiptNumberGenerator.FallbackRegistrationReference(registrationId)}.pdf",
                "application/pdf"));
        }

        await SendMailAsync(message, email, ct);
        _logger.LogInformation(
            "Cancellation email sent for registration {RegistrationId} to {Email}",
            registrationId,
            reg.ContactEmail);
    }

    public async Task SendRefundNotificationAsync(
        TRSDbContext db,
        int registrationId,
        byte[] updatedReceiptPdf,
        CancellationToken ct = default)
    {
        var reg = await db.EventRegistrations
            .Include(r => r.Payments)
            .FirstOrDefaultAsync(r => r.RegistrationId == registrationId, ct);

        if (reg == null)
        {
            _logger.LogWarning("Unable to send refund email: registration {RegistrationId} not found", registrationId);
            return;
        }

        if (string.IsNullOrWhiteSpace(reg.ContactEmail))
        {
            _logger.LogWarning("Unable to send refund email: registration {RegistrationId} has no contact email", registrationId);
            return;
        }

        var appName = await GetAppNameAsync(db, ct);
        var email = GetEmailSettings(appName);

        if (!email.IsConfigured)
        {
            _logger.LogWarning(
                "Skipping refund email for registration {RegistrationId}: email provider {Provider} is not configured",
                registrationId,
                email.Provider);
            return;
        }

        if (email.IsPlaceholder)
        {
            _logger.LogWarning(
                "Skipping refund email for registration {RegistrationId}: email provider {Provider} is configured as placeholder only",
                registrationId,
                email.Provider);
            return;
        }

        var receiptNo = reg.Payments.OrderByDescending(p => p.CreatedAt).FirstOrDefault()?.ReceiptNumber
            ?? ReceiptNumberGenerator.FallbackRegistrationReference(registrationId);

        using var message = new MailMessage
        {
            From = new MailAddress(email.FromAddress!, email.FromName),
            Subject = $"{appName} refund processed ({receiptNo})",
            Body =
                $"Hello {reg.ContactName},\n\n" +
                $"A refund has been processed for your registration for {reg.EventName}.\n" +
                "Your updated receipt is attached.\n\n" +
                $"Regards,\n{appName}",
            IsBodyHtml = false,
        };
        message.To.Add(reg.ContactEmail);
        message.Attachments.Add(new Attachment(new MemoryStream(updatedReceiptPdf), $"Receipt-{receiptNo}.pdf", "application/pdf"));

        await SendMailAsync(message, email, ct);
        _logger.LogInformation("Refund email sent for registration {RegistrationId} to {Email}", registrationId, reg.ContactEmail);
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

        var email = GetEmailSettings(appName);

        if (!email.IsConfigured)
            throw new InvalidOperationException($"Email provider {email.Provider} is not configured.");

        if (email.IsPlaceholder)
            throw new InvalidOperationException($"Email provider {email.Provider} is configured as placeholder only.");

        using var message = new MailMessage
        {
            From = new MailAddress(email.FromAddress!, email.FromName),
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

        await SendMailAsync(message, email, ct);
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

    private EmailSettings GetEmailSettings(string appName)
    {
        var provider = _config["Email:Provider"]?.Trim();
        if (string.IsNullOrWhiteSpace(provider))
            provider = "Smtp";

        var username = _config["Email:Smtp:Username"]?.Trim();
        var fromAddress = _config["Email:FromAddress"]?.Trim();

        if (string.IsNullOrWhiteSpace(fromAddress))
            fromAddress = username;

        return new EmailSettings(
            Provider: provider,
            Host: _config["Email:Smtp:Host"]?.Trim(),
            Port: _config.GetValue<int?>("Email:Smtp:Port") ?? 587,
            Username: username,
            Password: _config["Email:Smtp:Password"],
            EnableSsl: _config.GetValue("Email:Smtp:EnableSsl", true),
            SmtpAuthMode: _config["Email:Smtp:AuthMode"]?.Trim(),
            SmtpOAuth2: new SmtpOAuth2Settings(
                GrantType: _config["Email:Smtp:OAuth2:GrantType"]?.Trim(),
                TenantId: _config["Email:Smtp:OAuth2:TenantId"]?.Trim(),
                TokenEndpoint: _config["Email:Smtp:OAuth2:TokenEndpoint"]?.Trim(),
                ClientId: _config["Email:Smtp:OAuth2:ClientId"]?.Trim(),
                ClientSecret: _config["Email:Smtp:OAuth2:ClientSecret"],
                Scope: _config["Email:Smtp:OAuth2:Scope"]?.Trim(),
                RefreshToken: _config["Email:Smtp:OAuth2:RefreshToken"]),
            FromAddress: fromAddress,
            FromName: string.IsNullOrWhiteSpace(_config["Email:FromName"])
                ? appName
                : _config["Email:FromName"]!.Trim(),
            Graph: new MicrosoftGraphSettings(
                TenantId: _config["Email:MicrosoftGraph:TenantId"]?.Trim(),
                ClientId: _config["Email:MicrosoftGraph:ClientId"]?.Trim(),
                ClientSecret: _config["Email:MicrosoftGraph:ClientSecret"],
                SenderUserId: _config["Email:MicrosoftGraph:SenderUserId"]?.Trim(),
                SaveToSentItems: _config.GetValue("Email:MicrosoftGraph:SaveToSentItems", true)),
            Gmail: new GmailApiSettings(
                ClientId: _config["Email:GmailApi:ClientId"]?.Trim(),
                ClientSecret: _config["Email:GmailApi:ClientSecret"],
                RefreshToken: _config["Email:GmailApi:RefreshToken"],
                UserId: _config["Email:GmailApi:UserId"]?.Trim()));
    }

    private async Task SendMailAsync(MailMessage message, EmailSettings email, CancellationToken ct)
    {
        switch (NormalizeProvider(email.Provider))
        {
            case "smtp":
                if (email.UsesSmtpOAuth2)
                {
                    await SendSmtpOAuth2Async(message, email, ct);
                }
                else
                {
                    using var client = CreateSmtpClient(email);
                    await client.SendMailAsync(message, ct);
                }
                return;

            case "microsoftgraph":
            case "graph":
                await SendMicrosoftGraphAsync(message, email, ct);
                return;

            case "gmailapi":
            case "gmail":
                await SendGmailApiAsync(message, email, ct);
                return;

            case "transactional":
            case "transactionalhttp":
                throw new NotSupportedException("Transactional email providers are not implemented yet. Use Smtp, MicrosoftGraph, or GmailApi.");

            default:
                throw new InvalidOperationException($"Unsupported Email:Provider '{email.Provider}'.");
        }
    }

    private static SmtpClient CreateSmtpClient(EmailSettings email)
    {
        var client = new SmtpClient(email.Host!, email.Port)
        {
            EnableSsl = email.EnableSsl,
            DeliveryMethod = SmtpDeliveryMethod.Network,
        };

        if (!string.IsNullOrWhiteSpace(email.Username))
        {
            client.Credentials = new NetworkCredential(email.Username, email.Password);
        }

        return client;
    }

    private async Task SendSmtpOAuth2Async(MailMessage message, EmailSettings email, CancellationToken ct)
    {
        var token = await GetSmtpOAuth2AccessTokenAsync(email.SmtpOAuth2!, ct);
        var mimeMessage = await BuildMimeKitMessageAsync(message, ct);

        using var client = new MailKitSmtpClient();
        await client.ConnectAsync(email.Host!, email.Port, SmtpSecureSocketOptions(email), ct);
        try
        {
            await client.AuthenticateAsync(new SaslMechanismOAuth2(email.Username!, token), ct);
            await client.SendAsync(mimeMessage, ct);
        }
        finally
        {
            await client.DisconnectAsync(true, ct);
        }
    }

    private async Task<string> GetSmtpOAuth2AccessTokenAsync(SmtpOAuth2Settings oauth, CancellationToken ct)
    {
        var grantType = NormalizeGrantType(oauth.GrantType, oauth.RefreshToken);
        var tokenEndpoint = ResolveSmtpOAuth2TokenEndpoint(oauth, grantType);
        var form = new Dictionary<string, string>
        {
            ["client_id"] = oauth.ClientId!,
            ["client_secret"] = oauth.ClientSecret!,
            ["grant_type"] = grantType,
        };

        if (grantType == "refresh_token")
        {
            form["refresh_token"] = oauth.RefreshToken!;
        }
        else
        {
            form["scope"] = string.IsNullOrWhiteSpace(oauth.Scope)
                ? "https://outlook.office365.com/.default"
                : oauth.Scope!;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, tokenEndpoint)
        {
            Content = new FormUrlEncodedContent(form),
        };

        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"SMTP OAuth2 token request failed with {(int)response.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("SMTP OAuth2 token response did not include access_token.");
    }

    private static SecureSocketOptions SmtpSecureSocketOptions(EmailSettings email)
    {
        if (!email.EnableSsl)
            return SecureSocketOptions.None;

        return email.Port == 465
            ? SecureSocketOptions.SslOnConnect
            : SecureSocketOptions.StartTls;
    }

    private async Task SendMicrosoftGraphAsync(MailMessage message, EmailSettings email, CancellationToken ct)
    {
        var graph = email.Graph!;
        var token = await GetMicrosoftGraphTokenAsync(graph, ct);
        var sender = Uri.EscapeDataString(graph.SenderUserId!);
        var url = $"https://graph.microsoft.com/v1.0/users/{sender}/sendMail";

        var attachments = new List<Dictionary<string, object?>>();
        foreach (var attachment in await ReadAttachmentsAsync(message, ct))
        {
            attachments.Add(new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.fileAttachment",
                ["name"] = attachment.FileName,
                ["contentType"] = attachment.ContentType,
                ["contentBytes"] = Convert.ToBase64String(attachment.Content),
            });
        }

        var graphMessage = new Dictionary<string, object?>
        {
            ["subject"] = message.Subject,
            ["body"] = new
            {
                contentType = message.IsBodyHtml ? "HTML" : "Text",
                content = message.Body ?? "",
            },
            ["toRecipients"] = ToGraphRecipients(message.To),
        };

        var ccRecipients = ToGraphRecipients(message.CC);
        if (ccRecipients.Count > 0)
            graphMessage["ccRecipients"] = ccRecipients;

        var bccRecipients = ToGraphRecipients(message.Bcc);
        if (bccRecipients.Count > 0)
            graphMessage["bccRecipients"] = bccRecipients;

        var replyTo = ToGraphRecipients(message.ReplyToList);
        if (replyTo.Count > 0)
            graphMessage["replyTo"] = replyTo;

        if (attachments.Count > 0)
            graphMessage["attachments"] = attachments;

        var payload = new Dictionary<string, object?>
        {
            ["message"] = graphMessage,
            ["saveToSentItems"] = graph.SaveToSentItems,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent(payload),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Microsoft Graph sendMail failed with {(int)response.StatusCode}: {body}");
        }
    }

    private async Task<string> GetMicrosoftGraphTokenAsync(MicrosoftGraphSettings graph, CancellationToken ct)
    {
        var tokenUrl = $"https://login.microsoftonline.com/{Uri.EscapeDataString(graph.TenantId!)}/oauth2/v2.0/token";
        using var request = new HttpRequestMessage(HttpMethod.Post, tokenUrl)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = graph.ClientId!,
                ["client_secret"] = graph.ClientSecret!,
                ["scope"] = "https://graph.microsoft.com/.default",
                ["grant_type"] = "client_credentials",
            }),
        };

        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Microsoft Graph token request failed with {(int)response.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Microsoft Graph token response did not include access_token.");
    }

    private async Task SendGmailApiAsync(MailMessage message, EmailSettings email, CancellationToken ct)
    {
        var gmail = email.Gmail!;
        var token = await GetGmailAccessTokenAsync(gmail, ct);
        var userId = Uri.EscapeDataString(string.IsNullOrWhiteSpace(gmail.UserId) ? "me" : gmail.UserId!);
        var mime = await BuildMimeMessageAsync(message, ct);
        var raw = Base64UrlEncode(Encoding.UTF8.GetBytes(mime));

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://gmail.googleapis.com/gmail/v1/users/{userId}/messages/send")
        {
            Content = JsonContent(new { raw }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Gmail API send failed with {(int)response.StatusCode}: {body}");
        }
    }

    private async Task<string> GetGmailAccessTokenAsync(GmailApiSettings gmail, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = gmail.ClientId!,
                ["client_secret"] = gmail.ClientSecret!,
                ["refresh_token"] = gmail.RefreshToken!,
                ["grant_type"] = "refresh_token",
            }),
        };

        var client = _httpClientFactory.CreateClient();
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Gmail token request failed with {(int)response.StatusCode}: {body}");

        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("access_token").GetString()
            ?? throw new InvalidOperationException("Gmail token response did not include access_token.");
    }

    private static List<object> ToGraphRecipients(MailAddressCollection addresses) =>
        addresses
            .Cast<MailAddress>()
            .Select(address => new
            {
                emailAddress = new
                {
                    address = address.Address,
                    name = string.IsNullOrWhiteSpace(address.DisplayName) ? null : address.DisplayName,
                },
            })
            .Cast<object>()
            .ToList();

    private static async Task<List<OutboundAttachment>> ReadAttachmentsAsync(MailMessage message, CancellationToken ct)
    {
        var attachments = new List<OutboundAttachment>();
        foreach (Attachment attachment in message.Attachments)
        {
            if (attachment.ContentStream.CanSeek)
                attachment.ContentStream.Position = 0;

            using var ms = new MemoryStream();
            await attachment.ContentStream.CopyToAsync(ms, ct);
            attachments.Add(new OutboundAttachment(
                string.IsNullOrWhiteSpace(attachment.Name) ? "attachment" : attachment.Name,
                string.IsNullOrWhiteSpace(attachment.ContentType.MediaType) ? "application/octet-stream" : attachment.ContentType.MediaType,
                ms.ToArray()));
        }
        return attachments;
    }

    private static async Task<string> BuildMimeMessageAsync(MailMessage message, CancellationToken ct)
    {
        var attachments = await ReadAttachmentsAsync(message, ct);
        var sb = new StringBuilder();
        AppendHeader(sb, "From", FormatAddress(message.From));
        AppendHeader(sb, "To", FormatAddresses(message.To));
        AppendHeader(sb, "Cc", FormatAddresses(message.CC));
        AppendHeader(sb, "Bcc", FormatAddresses(message.Bcc));
        AppendHeader(sb, "Reply-To", FormatAddresses(message.ReplyToList));
        AppendHeader(sb, "Subject", EncodeHeader(message.Subject ?? ""));
        sb.AppendLine("MIME-Version: 1.0");

        if (attachments.Count == 0)
        {
            sb.AppendLine($"Content-Type: text/{(message.IsBodyHtml ? "html" : "plain")}; charset=utf-8");
            sb.AppendLine("Content-Transfer-Encoding: base64");
            sb.AppendLine();
            sb.AppendLine(ChunkBase64(Convert.ToBase64String(Encoding.UTF8.GetBytes(message.Body ?? ""))));
            return sb.ToString();
        }

        var boundary = $"trs-{Guid.NewGuid():N}";
        sb.AppendLine($"Content-Type: multipart/mixed; boundary=\"{boundary}\"");
        sb.AppendLine();
        sb.AppendLine($"--{boundary}");
        sb.AppendLine($"Content-Type: text/{(message.IsBodyHtml ? "html" : "plain")}; charset=utf-8");
        sb.AppendLine("Content-Transfer-Encoding: base64");
        sb.AppendLine();
        sb.AppendLine(ChunkBase64(Convert.ToBase64String(Encoding.UTF8.GetBytes(message.Body ?? ""))));

        foreach (var attachment in attachments)
        {
            sb.AppendLine($"--{boundary}");
            sb.AppendLine($"Content-Type: {attachment.ContentType}; name=\"{EscapeQuoted(attachment.FileName)}\"");
            sb.AppendLine("Content-Transfer-Encoding: base64");
            sb.AppendLine($"Content-Disposition: attachment; filename=\"{EscapeQuoted(attachment.FileName)}\"");
            sb.AppendLine();
            sb.AppendLine(ChunkBase64(Convert.ToBase64String(attachment.Content)));
        }

        sb.AppendLine($"--{boundary}--");
        return sb.ToString();
    }

    private static async Task<MimeMessage> BuildMimeKitMessageAsync(MailMessage message, CancellationToken ct)
    {
        var mime = new MimeMessage();
        if (message.From != null)
            mime.From.Add(ToMailboxAddress(message.From));

        AddMailboxAddresses(mime.To, message.To);
        AddMailboxAddresses(mime.Cc, message.CC);
        AddMailboxAddresses(mime.Bcc, message.Bcc);
        AddMailboxAddresses(mime.ReplyTo, message.ReplyToList);
        mime.Subject = message.Subject ?? "";

        var bodyBuilder = new BodyBuilder();
        if (message.IsBodyHtml)
            bodyBuilder.HtmlBody = message.Body ?? "";
        else
            bodyBuilder.TextBody = message.Body ?? "";

        foreach (var attachment in await ReadAttachmentsAsync(message, ct))
        {
            bodyBuilder.Attachments.Add(attachment.FileName, attachment.Content, MimeKit.ContentType.Parse(attachment.ContentType));
        }

        mime.Body = bodyBuilder.ToMessageBody();
        return mime;
    }

    private static void AppendHeader(StringBuilder sb, string name, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            sb.AppendLine($"{name}: {value}");
    }

    private static string FormatAddresses(MailAddressCollection addresses) =>
        string.Join(", ", addresses.Cast<MailAddress>().Select(FormatAddress).Where(v => !string.IsNullOrWhiteSpace(v)));

    private static string FormatAddress(MailAddress? address)
    {
        if (address == null) return "";
        return string.IsNullOrWhiteSpace(address.DisplayName)
            ? address.Address
            : $"\"{EscapeQuoted(address.DisplayName)}\" <{address.Address}>";
    }

    private static void AddMailboxAddresses(InternetAddressList target, MailAddressCollection source)
    {
        foreach (var address in source.Cast<MailAddress>())
            target.Add(ToMailboxAddress(address));
    }

    private static MailboxAddress ToMailboxAddress(MailAddress address) =>
        string.IsNullOrWhiteSpace(address.DisplayName)
            ? MailboxAddress.Parse(address.Address)
            : new MailboxAddress(address.DisplayName, address.Address);

    private static string EncodeHeader(string value) =>
        value.All(ch => ch <= 127)
            ? value
            : $"=?utf-8?B?{Convert.ToBase64String(Encoding.UTF8.GetBytes(value))}?=";

    private static string EscapeQuoted(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static string ChunkBase64(string value)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < value.Length; i += 76)
            sb.AppendLine(value.Substring(i, Math.Min(76, value.Length - i)));
        return sb.ToString();
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static StringContent JsonContent<T>(T value) =>
        new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static string NormalizeProvider(string provider) =>
        provider.Trim().Replace("_", "", StringComparison.OrdinalIgnoreCase).Replace("-", "", StringComparison.OrdinalIgnoreCase).ToLowerInvariant();

    private static string NormalizeAuthMode(string? authMode) =>
        string.IsNullOrWhiteSpace(authMode)
            ? "password"
            : authMode.Trim().Replace("_", "", StringComparison.OrdinalIgnoreCase).Replace("-", "", StringComparison.OrdinalIgnoreCase).ToLowerInvariant();

    private static string NormalizeGrantType(string? configuredGrantType, string? refreshToken)
    {
        var grantType = configuredGrantType?.Trim();
        if (string.IsNullOrWhiteSpace(grantType))
            grantType = string.IsNullOrWhiteSpace(refreshToken) ? "client_credentials" : "refresh_token";

        grantType = grantType.Replace("-", "_", StringComparison.OrdinalIgnoreCase).ToLowerInvariant();
        return grantType switch
        {
            "clientcredentials" => "client_credentials",
            "client_credentials" => "client_credentials",
            "refreshtoken" => "refresh_token",
            "refresh_token" => "refresh_token",
            _ => grantType,
        };
    }

    private static string ResolveSmtpOAuth2TokenEndpoint(SmtpOAuth2Settings oauth, string grantType)
    {
        if (!string.IsNullOrWhiteSpace(oauth.TokenEndpoint))
            return oauth.TokenEndpoint!;

        if (grantType == "refresh_token")
            return "https://oauth2.googleapis.com/token";

        if (!string.IsNullOrWhiteSpace(oauth.TenantId))
            return $"https://login.microsoftonline.com/{Uri.EscapeDataString(oauth.TenantId!)}/oauth2/v2.0/token";

        throw new InvalidOperationException("Email:Smtp:OAuth2:TokenEndpoint or TenantId is required for SMTP OAuth2 client credentials.");
    }

    private sealed record EmailSettings(
        string Provider,
        string? Host,
        int Port,
        string? Username,
        string? Password,
        bool EnableSsl,
        string? SmtpAuthMode,
        SmtpOAuth2Settings SmtpOAuth2,
        string? FromAddress,
        string FromName,
        MicrosoftGraphSettings Graph,
        GmailApiSettings Gmail)
    {
        public bool IsPlaceholder =>
            string.Equals(NormalizeProvider(Provider), "transactional", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(NormalizeProvider(Provider), "transactionalhttp", StringComparison.OrdinalIgnoreCase);

        public bool UsesSmtpOAuth2 => NormalizeAuthMode(SmtpAuthMode) == "oauth2";

        public bool IsConfigured => NormalizeProvider(Provider) switch
        {
            "smtp" =>
                !string.IsNullOrWhiteSpace(Host) &&
                !string.IsNullOrWhiteSpace(FromAddress) &&
                (!UsesSmtpOAuth2
                    ? true
                    : !string.IsNullOrWhiteSpace(Username) &&
                      !string.IsNullOrWhiteSpace(SmtpOAuth2.ClientId) &&
                      !string.IsNullOrWhiteSpace(SmtpOAuth2.ClientSecret) &&
                      (NormalizeGrantType(SmtpOAuth2.GrantType, SmtpOAuth2.RefreshToken) == "refresh_token"
                          ? !string.IsNullOrWhiteSpace(SmtpOAuth2.RefreshToken)
                          : !string.IsNullOrWhiteSpace(SmtpOAuth2.Scope) &&
                            (!string.IsNullOrWhiteSpace(SmtpOAuth2.TokenEndpoint) || !string.IsNullOrWhiteSpace(SmtpOAuth2.TenantId)))),
            "microsoftgraph" or "graph" =>
                !string.IsNullOrWhiteSpace(FromAddress) &&
                !string.IsNullOrWhiteSpace(Graph.TenantId) &&
                !string.IsNullOrWhiteSpace(Graph.ClientId) &&
                !string.IsNullOrWhiteSpace(Graph.ClientSecret) &&
                !string.IsNullOrWhiteSpace(Graph.SenderUserId),
            "gmailapi" or "gmail" =>
                !string.IsNullOrWhiteSpace(FromAddress) &&
                !string.IsNullOrWhiteSpace(Gmail.ClientId) &&
                !string.IsNullOrWhiteSpace(Gmail.ClientSecret) &&
                !string.IsNullOrWhiteSpace(Gmail.RefreshToken),
            "transactional" or "transactionalhttp" => true,
            _ => false,
        };
    }

    private sealed record SmtpOAuth2Settings(
        string? GrantType,
        string? TenantId,
        string? TokenEndpoint,
        string? ClientId,
        string? ClientSecret,
        string? Scope,
        string? RefreshToken);

    private sealed record MicrosoftGraphSettings(
        string? TenantId,
        string? ClientId,
        string? ClientSecret,
        string? SenderUserId,
        bool SaveToSentItems);

    private sealed record GmailApiSettings(
        string? ClientId,
        string? ClientSecret,
        string? RefreshToken,
        string? UserId);

    private sealed record OutboundAttachment(string FileName, string ContentType, byte[] Content);
}
