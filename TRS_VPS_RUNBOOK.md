# TRS VPS Deployment Runbook

Last updated: 2026-09-03

This file records the TRS VPS hosting setup so future Codex sessions can quickly understand the environment.

## Server

- Vendor: SoftSys Hosting
- Plan: SFT.WIN.MEDIUM
- Location: Singapore (Asia)
- Public IPv4: `103.198.77.100`
- RDP endpoint: `103.198.77.100:58971`
- Windows host name: `app-unity-01`
- Operating system: Windows Server 2022
- Server role: IIS-hosted TRS UAT and production web/API applications
- Management access: RDP using the endpoint above
- VPS timezone: Singapore Standard Time

## Main Software Installed

- IIS 10
- IIS URL Rewrite Module 2.1
- ASP.NET Core 8 Windows Server Hosting Bundle
- SQL Server Express
- SQL Server Management Studio 22
- win-acme for Let's Encrypt SSL certificates

Useful verification commands on VPS:

```powershell
hostname
Get-TimeZone
dotnet --list-runtimes
& "$env:windir\system32\inetsrv\appcmd.exe" list modules | findstr /i rewrite
Get-Website
Get-WebAppPoolState "TRS-UAT-API"
Get-WebAppPoolState "TRS-UAT-Portal"
Get-WebAppPoolState "TRS-PROD-API"
Get-WebAppPoolState "TRS-PROD-Portal"
```

## Domain And DNS

Domain used for TRS:

- `wyseactive.com`

UAT DNS:

- Portal: `uat-trs.wyseactive.com` -> `103.198.77.100`
- API: `uat-api-trs.wyseactive.com` -> `103.198.77.100`

Production DNS:

- Portal: `trs.wyseactive.com` -> `103.198.77.100`
- API: `api-trs.wyseactive.com` -> `103.198.77.100`

DNS provider observed:

- `wyseactive.com` nameservers: `dns101.register.com`, `dns102.register.com`
- Earlier issue: intermittent DNS `SERVFAIL` / timeouts from public resolvers.
- DNSSEC reported disabled by Jackie.
- CAA was added at root domain to allow Let's Encrypt.

Useful DNS checks:

```powershell
nslookup uat-trs.wyseactive.com 8.8.8.8
nslookup uat-api-trs.wyseactive.com 8.8.8.8
nslookup trs.wyseactive.com 8.8.8.8
nslookup api-trs.wyseactive.com 8.8.8.8
Invoke-RestMethod "https://dns.google/resolve?name=wyseactive.com&type=CAA"
Invoke-RestMethod "https://dns.google/resolve?name=uat-api-trs.wyseactive.com&type=A"
```

Temporary local hosts-file workaround if DNS is unstable:

```text
103.198.77.100 uat-trs.wyseactive.com
103.198.77.100 uat-api-trs.wyseactive.com
```

Do not rely on hosts file for Stripe webhook testing. Stripe uses public DNS, not the tester's local hosts file.

## IIS Sites

UAT:

- IIS site: `TRS-UAT-Portal`
- App pool: `TRS-UAT-Portal`
- Physical path: `C:\app\TRS\UAT\portal`
- HTTP binding: `*:80:uat-trs.wyseactive.com`
- HTTPS binding: `*:443:uat-trs.wyseactive.com`

- IIS site: `TRS-UAT-API`
- App pool: `TRS-UAT-API`
- Physical path: `C:\app\TRS\UAT\api`
- HTTP binding: `*:80:uat-api-trs.wyseactive.com`
- HTTPS binding: `*:443:uat-api-trs.wyseactive.com`

Production:

- IIS site: `TRS-PROD-Portal`
- App pool: `TRS-PROD-Portal`
- Physical path: `C:\app\TRS\prod\portal`
- HTTP binding: `*:80:trs.wyseactive.com`
- HTTPS binding: `*:443:trs.wyseactive.com`

- IIS site: `TRS-PROD-API`
- App pool: `TRS-PROD-API`
- Physical path: `C:\app\TRS\prod\api`
- HTTP binding: `*:80:api-trs.wyseactive.com`
- HTTPS binding: `*:443:api-trs.wyseactive.com`

Restart commands:

```powershell
Restart-WebAppPool "TRS-UAT-API"
Restart-WebAppPool "TRS-UAT-Portal"
Restart-WebAppPool "TRS-PROD-API"
Restart-WebAppPool "TRS-PROD-Portal"
```

Smoke-test commands from VPS:

```powershell
Invoke-WebRequest https://uat-trs.wyseactive.com -UseBasicParsing
Invoke-WebRequest https://uat-api-trs.wyseactive.com/api/events -UseBasicParsing
Invoke-WebRequest https://trs.wyseactive.com -UseBasicParsing
Invoke-WebRequest https://api-trs.wyseactive.com/api/events -UseBasicParsing
```

Host-header local IIS tests:

```powershell
Invoke-WebRequest http://127.0.0.1 -Headers @{ Host = "uat-trs.wyseactive.com" } -UseBasicParsing
Invoke-WebRequest http://127.0.0.1/api/events -Headers @{ Host = "uat-api-trs.wyseactive.com" } -UseBasicParsing
Invoke-WebRequest http://127.0.0.1 -Headers @{ Host = "trs.wyseactive.com" } -UseBasicParsing
Invoke-WebRequest http://127.0.0.1/api/events -Headers @{ Host = "api-trs.wyseactive.com" } -UseBasicParsing
```

## Application Paths

Root application folder on VPS:

```text
C:\app\TRS
```

Expected structure:

```text
C:\app\TRS\UAT\portal
C:\app\TRS\UAT\api
C:\app\TRS\prod\portal
C:\app\TRS\prod\api
```

Backend uploads and static runtime files are under each API folder:

```text
C:\app\TRS\UAT\api\wwwroot
C:\app\TRS\prod\api\wwwroot
```

Frontend static files are under each portal folder:

```text
C:\app\TRS\UAT\portal
C:\app\TRS\prod\portal
```

Portal runtime config files:

```text
C:\app\TRS\UAT\portal\config.json
C:\app\TRS\prod\portal\config.json
```

UAT portal config:

```json
{
  "apiBaseUrl": "https://uat-api-trs.wyseactive.com"
}
```

Production portal config:

```json
{
  "apiBaseUrl": "https://api-trs.wyseactive.com"
}
```

## Local Source And Deployment Artifacts

Local source repo:

```text
D:\Source\TRS
```

Private deployment folder:

```text
D:\Source\TRS\DeploymentPrivateConfigs
```

Ready portal runtime-config zips:

```text
D:\Source\TRS\DeploymentPrivateConfigs\ReadyZip\TRS_UAT_portal_runtime_config_current.zip
D:\Source\TRS\DeploymentPrivateConfigs\ReadyZip\TRS_PROD_portal_runtime_config_current.zip
D:\Source\TRS\DeploymentPrivateConfigs\ReadyZip\TRS_portal_runtime_config_current.zip
```

Use the UAT zip to replace only:

```text
C:\app\TRS\UAT\portal
```

Use the PROD zip to replace only:

```text
C:\app\TRS\prod\portal
```

Backend publish output is expected to be copied into:

```text
C:\app\TRS\UAT\api
C:\app\TRS\prod\api
```

## Database

SQL Server instance:

```text
localhost\SQLEXPRESS
```

Databases:

- UAT: `TRS_UAT`
- Production: `TRS`

Application SQL login:

- Login/user: `admin`
- Password: intentionally not recorded here. Check the private server/appsettings notes if needed.

Expected UAT connection string shape:

```json
"TRSConnection": "Server=localhost\\SQLEXPRESS;Database=TRS_UAT;User ID=admin;Password=<password>;TrustServerCertificate=True;Encrypt=False;"
```

Expected production connection string shape:

```json
"TRSConnection": "Server=localhost\\SQLEXPRESS;Database=TRS;User ID=admin;Password=<password>;TrustServerCertificate=True;Encrypt=False;"
```

Useful DB checks:

```sql
USE [TRS_UAT];

SELECT TOP 20 * FROM dbo.EventRegistrations ORDER BY SubmittedAt DESC;
SELECT TOP 20 * FROM dbo.Payments ORDER BY CreatedAt DESC;
SELECT TOP 20 * FROM dbo.PaymentAttempts ORDER BY CreatedAt DESC;
SELECT TOP 20 * FROM dbo.WebhookLogs ORDER BY ReceivedAt DESC;
SELECT TOP 20 * FROM dbo.AppLogs ORDER BY Timestamp DESC;
```

UAT reset scope:

- Preserve: `Events`, `Programs`, `ProgramFields`, `ProgramCustomFields`, `EventGalleryImages`, `EventDocuments`, `SystemConfig`, `AdminUsers`, `BadmintonClub`, `SbaRankings`
- Delete transactional/test state: registrations, participants, payments, payment attempts, pending checkouts, refunds, fixtures, webhook logs, background jobs, app logs, payment audit logs, admin audit logs

Stop the target API app pool before destructive reset scripts.

## API Configuration

Primary API config files on VPS:

```text
C:\app\TRS\UAT\api\appsettings.json
C:\app\TRS\prod\api\appsettings.json
```

Important config sections:

- `ConnectionStrings:TRSConnection`
- `Jwt`
- `Stripe`
- `Email`
- `Cors:AllowedOrigins`
- `RateLimiting`
- `AllowedHosts`

UAT API expected values:

- Database: `TRS_UAT`
- Frontend origin: `https://uat-trs.wyseactive.com`
- API domain: `https://uat-api-trs.wyseactive.com`
- Stripe mode: test mode keys
- Stripe webhook endpoint: `https://uat-api-trs.wyseactive.com/api/webhooks/stripe`

Production API expected values:

- Database: `TRS`
- Frontend origin: `https://trs.wyseactive.com`
- API domain: `https://api-trs.wyseactive.com`
- Stripe mode: live mode keys
- Stripe webhook endpoint: `https://api-trs.wyseactive.com/api/webhooks/stripe`

PayNow/embedded payment timing recommendation:

```json
"EmbeddedAttemptMinutes": 15,
"EmbeddedBackstopMinutes": 3
```

Payment rate-limit defaults (under the `RateLimiting` section):

```json
"WindowMinutes": 1,
"PublicPermitLimit": 30,
"PaymentCreatePermitLimit": 10,
"PaymentAttemptPermitLimit": 40
```

Public payment limits are partitioned by the browser's opaque client token, and
attempt status/submit/abandon limits use the secret payment-attempt key. They do
not depend on IIS or reverse-proxy client-IP forwarding.

## Stripe

Stripe is used for embedded card and PayNow payments.

Required per environment:

- Publishable key
- Secret key
- Webhook signing secret

Do not mix test and live keys.

UAT:

- Stripe mode: Test mode
- Endpoint URL: `https://uat-api-trs.wyseactive.com/api/webhooks/stripe`
- Required webhook events:
  - `payment_intent.processing`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `charge.refunded`

Production:

- Stripe mode: Live mode
- Endpoint URL: `https://api-trs.wyseactive.com/api/webhooks/stripe`
- Required webhook events:
  - `payment_intent.processing`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `charge.refunded`

Webhook verification:

- Stripe Dashboard delivery should show HTTP `200`.
- `WebhookLogs` should contain rows with Stripe event IDs like `evt_...`.
- If only `attempt_backstop_pi_...` appears, the app's backstop detected Stripe state, but Stripe webhook probably did not reach the API.

Useful SQL:

```sql
USE [TRS_UAT];

SELECT TOP 20
    PaymentAttemptID,
    PaymentMethod,
    Amount,
    Currency,
    GatewayPaymentIntentID,
    Status,
    ErrorMessage,
    CreatedAt,
    SubmittedAt,
    SucceededAt,
    FinalizedAt,
    RegistrationId,
    PaymentId
FROM dbo.PaymentAttempts
ORDER BY CreatedAt DESC;

SELECT TOP 20
    WebhookLogID,
    GatewayEventID,
    EventType,
    GatewaySessionId,
    ProcessingStatus,
    ErrorMessage,
    ReceivedAt,
    ProcessedAt
FROM dbo.WebhookLogs
ORDER BY ReceivedAt DESC;
```

## SMTP

SMTP provider:

- SMTP2GO

Verified sender domain:

- `wyseactive.com`

Sender:

- Email: `no-reply@wyseactive.com`
- Display name: `WYSE Active TRS`

SMTP settings:

- Provider: `Smtp`
- Host: `mail.smtp2go.com`
- Port: `2525`
- Username: `wyseactive-trs`
- Password: intentionally not recorded here
- SSL/TLS enabled: `true`
- Auth mode: `Password`

SMTP2GO DNS records configured for sender verification:

- `em846308.wyseactive.com` CNAME `return.smtp2go.net`
- `s846308._domainkey.wyseactive.com` CNAME `dkim.smtp2go.net`
- `link.wyseactive.com` CNAME `track.smtp2go.net`

SMTP test PowerShell shape:

```powershell
$smtpHost = "mail.smtp2go.com"
$smtpPort = 2525
$username = "wyseactive-trs"
$password = "<smtp2go-password>"

$from = "no-reply@wyseactive.com"
$fromName = "WYSE Active TRS"
$to = "vincent.law@unity-cap.com"

$message = [System.Net.Mail.MailMessage]::new()
$client = [System.Net.Mail.SmtpClient]::new($smtpHost, $smtpPort)

try {
    $message.From = [System.Net.Mail.MailAddress]::new($from, $fromName)
    $message.To.Add($to)
    $message.Subject = "TRS SMTP test"
    $message.Body = "This is a TRS SMTP test email"
    $message.IsBodyHtml = $false

    $client.EnableSsl = $true
    $client.DeliveryMethod = [System.Net.Mail.SmtpDeliveryMethod]::Network
    $client.Credentials = [System.Net.NetworkCredential]::new($username, $password)

    $client.Send($message)
    Write-Host "Email sent successfully." -ForegroundColor Green
}
catch {
    Write-Host "Email failed." -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.InnerException) {
        Write-Host $_.Exception.InnerException.Message
    }
}
finally {
    $message.Dispose()
    $client.Dispose()
}
```

## SSL Certificates

SSL tool:

- win-acme

win-acme path on VPS:

```text
C:\tools\win-acme
```

Certificate authority:

- Let's Encrypt

Certificates created:

- UAT certificate: `[IIS] TRS-UAT-Portal (+1 other), (any host)`
  - Covers `uat-trs.wyseactive.com`
  - Covers `uat-api-trs.wyseactive.com`
- Production certificate: `[IIS] TRS-PROD-Portal (+1 other), (any host)`
  - Covers `trs.wyseactive.com`
  - Covers `api-trs.wyseactive.com`

Renewal:

- win-acme scheduled task created
- Task name: `win-acme renew (acme-v02.api.letsencrypt.org)`
- Expected renewal command:

```powershell
cd C:\tools\win-acme
.\wacs.exe --renew --baseuri "https://acme-v02.api.letsencrypt.org/"
```

Check renewal task:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "*win-acme*" } | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName "win-acme renew (acme-v02.api.letsencrypt.org)"
```

Known previous renewal test result:

- UAT renewal due after `2026/10/26`
- Production renewal due after `2026/10/26`

win-acme notification config:

- SMTP notification can be configured in `C:\tools\win-acme\settings.json`
- Use SMTP2GO for failure notifications.
- Receiver used during setup: `vincent.law@unity-cap.com`
- Do not expose the SMTP password in committed files.

## Firewall And Ports

Expected public ports:

- HTTP: `80`
- HTTPS: `443`
- RDP: custom external port observed in RDP connection, vendor-managed

VPS local checks:

```powershell
netstat -ano | findstr ":80"
netstat -ano | findstr ":443"
Get-NetFirewallRule -DisplayName "Allow HTTP 80","Allow HTTPS 443" | Select-Object DisplayName,Enabled,Direction,Action
```

External connectivity check from a Windows client:

```powershell
Test-NetConnection 103.198.77.100 -Port 80
Test-NetConnection 103.198.77.100 -Port 443
```

## Folder Permissions

The API needs write permission for upload folders and possibly logs if file logging is enabled.

Safer permission approach:

- Grant read/execute to app pool identities for portal folders.
- Grant modify only to API `wwwroot\uploads` and required runtime writable folders.

Common pragmatic command used for less friction during UAT:

```powershell
icacls "C:\app\TRS" /grant "IIS_IUSRS:(OI)(CI)(M)" /T
```

Before production hardening, reduce write access where practical.

## Deployment Checklist

Before replacing files:

```powershell
Stop-Website "TRS-UAT-Portal"
Stop-Website "TRS-UAT-API"
```

Backup current folders:

```powershell
Rename-Item "C:\app\TRS\UAT\portal" "portal_backup_$(Get-Date -Format yyyyMMdd_HHmmss)"
Rename-Item "C:\app\TRS\UAT\api" "api_backup_$(Get-Date -Format yyyyMMdd_HHmmss)"
```

After copying files:

```powershell
Start-Website "TRS-UAT-API"
Start-Website "TRS-UAT-Portal"
Restart-WebAppPool "TRS-UAT-API"
Restart-WebAppPool "TRS-UAT-Portal"
```

Verify:

```powershell
Invoke-WebRequest https://uat-trs.wyseactive.com/config.json -UseBasicParsing
Invoke-WebRequest https://uat-api-trs.wyseactive.com/api/events -UseBasicParsing
```

Browser hard refresh:

```text
Ctrl + F5
```

## Known Operational Notes

- Portal now uses runtime `config.json`, so the same frontend build can be reused for local, UAT, and production by changing only `config.json`.
- Local frontend can use blank `apiBaseUrl` and Vite proxy during development.
- IIS URL Rewrite is required for the React/Vite single page app fallback routing.
- Public DNS must work before Stripe webhook testing is considered valid.
- Stripe payment screen opening proves publishable/secret keys are likely working.
- Successful finalisation requires webhook or backstop to process Stripe success and create registration/payment rows.
- PayNow is asynchronous; even fast user approval may not immediately result in `payment_intent.succeeded`.
- Hosts file workaround is acceptable for page/API browsing only, not Stripe webhook validation.

## Information Intentionally Not Stored Here

The following are intentionally excluded from this runbook:

- VPS administrator password
- SQL `admin` password
- SMTP2GO password
- Stripe secret keys
- Stripe webhook signing secrets
- JWT signing secret

Store these only in private password storage or the actual server `appsettings.json` files.
