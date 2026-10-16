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

## Production Pre-Launch Data Reset (2026-10-05)

Approved scope: retain `dbo.AdminUsers`, `dbo.BadmintonClub`, `dbo.SbaRankings`,
and `dbo.SystemConfig`. Clear events/programs and their configuration, participants,
registrations, fixtures/results, payment/refund/checkout records, background jobs,
and all application database log/audit tables. Participants are not login users.

Script: `Backend/TRS_Data/Sql/20261005_reset_production_keep_master_users.sql`.
The script defaults to `PREVIEW`, requires database `TRS`, and inspects actual
foreign keys to determine deletion order. It stops on missing/unknown tables,
unsafe inbound dependencies, cycles, or enabled triggers on deletion targets.
Do not bypass a schema-check failure without reviewing the reported difference.

Execution procedure:

1. Reconcile the live SGD 1.00 test and all other outstanding Stripe payments/refunds.
   Resolve pending payments and historical webhook retries before deleting local
   payment records and webhook deduplication history. Do not change Rezerv settings.
2. Stop the `TRS-PROD-API` IIS site AND application pool, and any other writers.
   Keep the portal in maintenance during the reset. Stopping only the site may leave
   background workers active. Do not restart the API until verification is complete.
3. Take a full backup of `TRS`, verify it, and preferably test a restore separately.
   Confirm sufficient transaction-log disk space for the deletion transaction.
4. Connect to the production SQL instance, select `TRS` in a fresh SSMS query window,
   and execute the entire script unchanged. Review retained/deleted table counts
   and the reported `ServerName`. Preview does not delete application data.
5. Set `@ExpectedServer` to the exact verified server name from preview,
   `@Confirmation` to `RESET TRS KEEP MASTER AND USERS`, and `@Mode` to `EXECUTE`.
   Execute the entire script again. Do not execute selected fragments.
6. Confirm `COMMITTED`, zero rows for all DELETE tables, and unchanged KEEP counts.
   Errors roll back the transaction. After commit, recovery requires the backup.
7. Restart the PROD API pool/site and verify admin login, preserved settings/master
   data, an empty event list, and creating a new event. New logs after restart are normal.

This is a SQL data reset only. It preserves schema and identity counters and does
not change Stripe balances/history, refund money, delete uploads, clear IIS/file logs,
or truncate the SQL Server transaction log. Old uploaded files remain on disk.
Retained configuration values are not rewritten, including any references they contain.

Preparation validation: SQL Server ScriptDom syntax parsing passed, and the scope
matches all 28 EF model tables (4 KEEP, 24 DELETE). No database execution was
performed. Production schema, row counts, and runtime behavior must be checked
on the VPS; preferably rehearse using a separately restored backup first.

## Information Intentionally Not Stored Here

The following are intentionally excluded from this runbook:

- VPS administrator password
- SQL `admin` password
- SMTP2GO password
- Stripe secret keys
- Stripe webhook signing secrets
- JWT signing secret

Store these only in private password storage or the actual server `appsettings.json` files.

## Gateway configuration deployment prerequisite (2026-10-08)

The gateway configuration implementation includes a PREPARED, NOT APPLIED script at `Backend/TRS_Data/Sql/20261008_payment_gateway_configuration.sql`. Database execution requires separate approval. Do not deploy/restart this code against the old schema: PaymentAttempts reads now require PaymentGateway.

For the approved deployment, back up the database, stop the API during the schema/code transition, verify the selected database/connection, apply the additive SQL, and deploy the matching application. The script creates PaymentGateways, adds/backfills PaymentAttempts.PaymentGateway as Stripe with default/foreign key, and seeds SystemConfig.activePaymentGateway only if absent. Existing selections/enable flags are not overwritten on rerun. No financial rows are deleted. Keep Stripe credentials unchanged; do not put VerifyKey/SecretKey or other secrets into SystemConfig/catalog/frontend assets.

After deployment, verify superadmin sees Stripe active and Fiuu unavailable; eventadmin/anonymous update attempts fail; generic config writes cannot bypass the gateway endpoint. Validate stale-version rejection and transactional audit behavior in a controlled database test. Repeat a Stripe payment/full/partial refund and reconciliation regression check. SQL-backed tests and this operational verification are not implied by unit-test/build success.

Rollback restores the previous application version while leaving the additive objects in place. If another provider is introduced later, its pending transactions/refunds must remain serviceable; do not roll back to code that cannot process those records.

## Hosted Fiuu sandbox phase prerequisites (2026-10-08)

The user applied the earlier gateway configuration script locally. Production application of that script is not implied. A NEW script, Backend/TRS_Data/Sql/20261008_hosted_gateway_references.sql, is PREPARED, NOT APPLIED. Before starting the updated API, apply the reviewed script to the intended database during an approved schema/code transition. It adds two nullable PaymentAttempts columns and provider-scoped unique indexes; no data is removed and no gateway is enabled. Keep the additive schema on rollback.

Private Fiuu settings now also require PublicApiBaseUrl and FrontendBaseUrl (public HTTPS origins, no paths/query), CardChannel (merchant-confirmed creditT, creditAI, or creditAN), and ExtendedVcode matching the merchant setting. PayNow uses channel PayNow. No origin/channel was guessed or configured by this phase. Ask Fiuu to register the development domains and configure return /api/webhooks/fiuu/return plus notification/callback /api/webhooks/fiuu. Do not point sandbox development callbacks at an unreviewed production API. Verify IPN and channel settings in the portal with Fiuu support.

Do not enable Fiuu by editing the database: the application release gate intentionally still rejects selection. Refund/reconciliation code is now implemented; apply its schema prerequisite below, then verify SGD card/3DS and PayNow, return/cancel/back/refresh, delayed and duplicate notifications, amount/signature tampering, extra transactions, missing browser storage, full/partial/pending refunds, and original-provider routing. Confirm Stripe payment/refund/reconciliation regressions. Automated fake-HTTP tests do not establish merchant connectivity or SQL concurrency correctness.

For rollout/rollback after any Fiuu transactions exist, retain code, credentials and endpoints capable of servicing those obligations even when Stripe is selected for new payments. No deployment, portal changes, actual Fiuu charge/refund, or SQL execution was performed in this implementation phase.


## Fiuu refund schema and acceptance prerequisite (2026-10-08)

Local update: the user subsequently reported applying `20261008_gateway_refund_tracking.sql`. This is user-confirmed local execution, not an independent schema check or VPS execution. The preparation status below records the implementation phase.

The user applied the earlier gateway configuration and hosted-reference scripts to the LOCAL database. This does not establish VPS schema readiness. The new Backend/TRS_Data/Sql/20261008_gateway_refund_tracking.sql is PREPARED, NOT EXECUTED. It adds nullable GatewayRequestId varchar(100), GatewaySubmittedAt datetime2, and unique filtered (PaymentGateway, GatewayRequestId) on Refunds. It does not rewrite financial data or enable Fiuu. Apply it to the approved target database before restarting this code; ordinary refund entity reads now expect these columns.

Rollback before Fiuu use: revert the application change and leave the additive nullable columns/index. After submitting any Fiuu refunds, keep compatible callbacks and recovery running until obligations settle; switching new checkout to Stripe does not remove those obligations.

Configure/verify a public HTTPS /api/webhooks/fiuu/refund endpoint in addition to payment callbacks. Submission supplies notify_url. Keep the existing merchant keys private and confirm the card channel/public origins. Pending refunds query their saved RefID every two minutes; do not edit GatewaySubmittedAt/GatewayRequestId or manually resubmit to clear a pending state. Review persistent uncertainty with Fiuu using the saved RefID. PR014 requires merchant guidance on beneficiary bank details before PayNow workflow acceptance.

Required controlled sandbox checks: full and partial card/PayNow refunds; refund-only leaves participation active; cancellation waits for verified success; rejected refunds show RF where applicable; callbacks before/after HTTP response; duplicate/out-of-order callbacks; concurrent clicks; timeout/restart recovery with one provider submission; late/additional-payment orphan refunds; conflicting outcomes appear as Mark Reviewed; original-provider refund after gateway switch. Verify receipt/email output and SQL locking/uniqueness. Existing Stripe payment/refund/reconciliation smoke tests are still required before release. 218 non-database backend tests passed; they do not prove merchant connectivity or SQL concurrency. No deployment, gateway activation, new SQL execution or real Fiuu transaction occurred in this phase.

## Local ngrok setup for Fiuu sandbox (2026-10-08)

Approved development domain: `rudder-ragweed-divinity.ngrok-free.dev`. Vite allows this exact hostname, with the existing `/api` and `/uploads` proxy to `http://127.0.0.1:5020`. The ignored `Backend/TRS_API/appsettings.Development.json` sets both `Fiuu:PublicApiBaseUrl` and `Fiuu:FrontendBaseUrl` to `https://rudder-ragweed-divinity.ngrok-free.dev`. The frontend retains its empty API base so requests use the same public origin. No credentials belong in this runbook.

Start or restart the API in a terminal:

```powershell
Set-Location D:\Source\TRS\Backend\TRS_API
dotnet run --launch-profile Lan
```

Start or restart Vite in a second terminal and confirm it uses port 8080:

```powershell
Set-Location D:\Source\TRS\Frontend
npm.cmd run dev -- --strictPort
```

From the installed ngrok directory, start the tunnel in a third terminal:

```powershell
.\ngrok.exe http 8080 --url https://rudder-ragweed-divinity.ngrok-free.dev
```

Keep all three terminals running. Use the network on which `ngrok diagnose` passes. The tunnel makes the development website/API reachable publicly while running. Stop ngrok with Ctrl+C when finished. Do not disable certificate revocation checking to work around network filtering.

Connectivity acceptance: confirm ngrok reports online and forwards to localhost:8080; open the HTTPS website and confirm event loading/API requests succeed; confirm an unrelated hostname is still rejected by Vite; confirm restarting/stopping the tunnel behaves as expected. A free ngrok browser warning may appear before the website. Start eventual checkout from this same HTTPS origin so the saved attempt key is available after return. This configuration edit does not establish actual callback delivery or payment success.

The future merchant callback addresses use this origin with `/api/webhooks/fiuu`, `/api/webhooks/fiuu/return`, and `/api/webhooks/fiuu/refund`. Merchant card channel and ExtendedVcode setting still require confirmation; Fiuu remains gated against selection. No portal settings or gateway enable flags are changed by this local setup.

Rollback: stop the tunnel, remove the exact hostname from Vite's allowedHosts and remove the two local Fiuu origin settings, then restart the local frontend/API. Database schema and Stripe settings are unaffected.


## Enable PayNow testing through local TRS (2026-10-08)

Local Fiuu:EnableSandboxCheckout is now true in ignored Development configuration. Production/Staging remain gated off even if that flag is accidentally copied. No card channel is guessed: leave CardChannel empty to offer PayNow only. ExtendedVcode remains false, matching the portal screenshot. Gateway URLs remain the approved ngrok origin.

Prepared, NOT EXECUTED: Backend/TRS_Data/Sql/20261008_enable_fiuu_local_sandbox.sql. After confirming the LOCAL database, the user can execute it to enable only the Fiuu PaymentGateways row. This is a data-only catalog update; it neither changes schema nor selects Fiuu. Do not run it on the VPS. Select Fiuu through superadmin Master Config -> Payment, then use the existing whole-page Save action (audited selection). Log out or use a separate public browser session to register: authenticated admins use the existing assisted-registration bypass rather than customer gateway checkout.

Start/restart API and frontend and keep ngrok running as described above. Open TRS at the HTTPS ngrok origin, choose a paid SGD event (amount greater than 1.00), fill registration details, and confirm Credit / Debit Card is disabled and PayNow selected. Proceed through TRS to Fiuu, prepare the PayNow simulator first, then simulate success against the fresh QR before expiry. Keep the merchant QR page open until its countdown completes. This creates a TRS-owned order, unlike the earlier portal-generated payment link.

Acceptance checks: successful payment produces one confirmed registration and verified webhook record; tampered/unsupported card requests fail; failed/expired payment never confirms registration; repeated callbacks do not duplicate registration; gateway changes refresh visible methods and unsupported stale submissions fail; Stripe still offers its supported methods when selected. Test pending/recovery and refunds separately. If TRAN_NOT_FOUND recurs, capture the TRS order ID, Fiuu transaction ID, provider response and ngrok callback HTTP status; do not manually mark payment successful.

Rollback: select Stripe in Master Config before disabling the Fiuu catalog row using the commented rollback statement in the script. Set EnableSandboxCheckout=false and restart the API. Keep original Fiuu credentials/callback processing for existing financial obligations. This phase performs no SQL execution, gateway switch, portal change, or payment.

### Fiuu payment constraint and registration rollback fix (2026-10-08)

Read-only local evidence for attempt 47 / transaction 194544 showed a verified Fiuu success webhook remaining pending, with no linked registration/payment. The initial registration insert failed on Payments.CK_Payments_Gateway, which allowed only Manual, PayNow and Stripe. Later concurrency exceptions came from retrying with EF entities accepted by earlier SaveChanges calls inside the rolled-back transaction.

Apply Backend/TRS_Data/Sql/20261008_allow_fiuu_payment_gateway.sql to the intended database after review. The script preserves the existing check expression and adds Fiuu, validates existing rows, and is repeatable. It performs no data updates, gateway switch, or payment confirmation. ALTER TABLE briefly needs a schema lock. Restore the original check only when no additional gateway history exists; do not delete payments to enable rollback. The script was prepared but NOT executed by this task.

RegistrationWorkflowService snapshots existing tracked entities before its transaction. Every uncommitted exit restores their scalar values, original concurrency tokens and modified-property flags, and detaches newly tracked entities from the failed transaction. Caller-owned payment-attempt and webhook-log instances remain tracked for retry/reconciliation. PaymentAttemptService retries only after that cleanup and avoids an unnecessary delay after the final failure. Successful commits retain normal behavior.

Verification: backend build passed; all 229 non-database backend tests passed, including regression cases for accepted inserts rolled back before a failed payment save, rowversion restoration, and preservation of caller-owned changes. SQL-backed PaymentRefundIntegrationTests were not run against the user's local business database. Fiuu finalization and repeated callback acceptance must still be tested after applying the script. No existing attempt was manually marked paid or replayed. Attempt 47 may have expired by then; use verified reconciliation if required rather than bypassing expiry rules or paying again.

## Local Fiuu hosted selection (2026-10-09)

`Fiuu:UseHostedMethodSelection` defaults to true. New SGD registrations open Fiuu's default hosted page without a channel restriction; `CardChannel` is unnecessary for this flow. Merchant-enabled methods and their currency eligibility are still controlled by Fiuu. Development-only sandbox opt-in remains mandatory; this does not enable production.

Restart the local API after building, refresh the frontend and test a new public registration. Verify Visa and Mastercard separately with Fiuu sandbox test details, then check the confirmed registration and recorded CreditCard method. Also check PayNow, declined/abandoned checkout and duplicate callbacks. Never treat authorization alone as captured payment.

Rollback: set UseHostedMethodSelection=false and restart; this restores explicit TRS selection (PayNow only when no valid CardChannel is configured). Existing attempts retain their original checkout route. No schema migration or historical payment update is required.

## UAT/LIVE Fiuu release support (2026-10-16)

Fiuu now has explicit Mode (Sandbox or Production) and EnableCheckout. UAT uses ASPNETCORE_ENVIRONMENT=Staging and Sandbox mode; LIVE uses Production environment and Production mode. Production rejects sandbox mode and SB_ merchant IDs; non-production rejects production mode. Production _Dev merchants are also rejected. Blank/malformed credentials, unknown modes or invalid HTTPS public origins keep Fiuu unselectable. Legacy EnableSandboxCheckout remains a Development-only compatibility opt-in. It does not override production environment checks.

The adapter routes checkout/acknowledgement to sandbox-payment.fiuu.com or pay.fiuu.com and API calls to sandbox-api.fiuu.com or api.fiuu.com. Frontend handoff allows only these exact checkout origins and merchant paths. Master Config selection remains audited and superadmin-only. Original-provider ownership and signature/amount/currency/refund verification are unchanged. Never replace an existing Fiuu account's credentials while its outstanding transactions need servicing.

Prepared package: DeploymentPrivateConfigs/ReadyZip/TRS_20261016. See DEPLOYMENT.md for UAT/LIVE paths, SQL, replacement, configuration and rollback. Credentials are blank templates; Stripe stays active. SQL is prepared only and has not been executed on VPS. Unrelated TLS export is excluded from the release assembly. Prior Development-only gate descriptions above are historical and superseded by this section.
