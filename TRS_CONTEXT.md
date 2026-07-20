# TRS_CONTEXT.md

This document summarizes the current Tournament Registration System implementation. Code is the source of truth.

## System Purpose

TRS is a tournament registration platform for public event browsing, participant registration, online payment, admin operations, payment reconciliation, SBA ranking lookup/import, and fixture management.

The repository is a monorepo:

- `Frontend/`: React 18, TypeScript, Vite, React Router, Tailwind CSS, shadcn/Radix UI components, Lucide icons, Quill/react-quill integration.
- `Backend/TRS_API/`: ASP.NET Core 8 Web API.
- `Backend/TRS_Data/`: Entity Framework Core 8 models and SQL Server mapping.
- `Backend/TRS_FixtureTests/`: standalone console-based fixture regression checks.

## Main User Flows

### Public User

1. Views the landing page at `/`, which shows active events only after at least one active program exists.
2. Opens an event at `/event/:id`; public detail access uses the same active-event-with-active-program rule.
3. Selects programs and fills participant forms.
4. Uploads participant documents when enabled by program settings.
5. Accepts consent.
6. For free registrations, submits directly to `POST /api/registrations`.
7. For paid registrations, creates an embedded Stripe payment attempt through `POST /api/Payment/embedded-attempt`.
8. The embedded payment modal confirms the Stripe PaymentIntent, then `/payment/result` displays the finalized registration/receipt state after webhook completion.

### Admin User

1. Logs in through `/login`.
2. Uses JWT-backed admin routes under `/admin`.
3. Manages events, programs, documents, registrations, payments, refunds, fixtures, SBA rankings, badminton club master data, system config, users, and password changes according to role.
4. When registering players from the public event detail page while logged in, paid carts use admin payment bypass: payer contact is taken from the admin profile, cart payment/consent fields are hidden, and the confirmation modal captures the selected payment outcome.
5. Admin-assisted registration can be used for `U` upcoming, `PA` paused, or `CL` closed events, but not `D` draft events, closed/full programs, or programs with fixtures.
6. From the event editor, admins can download a program-specific Excel participant import template, upload the completed template, review all validation issues together, then save the import with one shared payment outcome for the whole registration.

## Frontend Routes

Routes are defined in `Frontend/src/App.tsx`.

Public routes:

- `/`: landing page.
- `/event/:id`: event detail and registration cart.
- `/payment/result`: payment redirect result and confirmation.
- `/login`: admin login.
- `*`: not found page.

Admin routes under `AdminLayout`:

- `/admin`: dashboard.
- `/admin/events`: event list.
- `/admin/events/:eventId`: event create/edit.
- `/admin/registrations`: registration list.
- `/admin/registrations/participants`: participant details/search.
- `/admin/participants`: participant details/search alias.
- `/admin/registrations/:regId/participants`: participant details scoped by registration.
- `/admin/payment-reconciliation`: payment reconciliation.
- `/admin/fixtures`: fixture management.
- `/admin/sba-rankings`: SBA rankings.
- `/admin/badminton-clubs`: badminton club master list maintenance.
- `/admin/config`: system configuration.
- `/admin/users`: admin user management.
- `/admin/change-password`: password change.

## Frontend API Layer

API modules live in `Frontend/src/lib/api/`.

- `_base.ts`: `apiFetch`, `API_BASE`, `publicHeaders`, `adminHeaders`, `assetUrl`, `ApiResult`, artificial `delay`.
- `authApi.ts`: login, logout, current user, password change.
- `eventsApi.ts`: events, programs, documents, and program participant import preview/confirm.
- `registrationsApi.ts`: registration CRUD/admin operations, payment updates, refunds, stats, export.
- `clubsApi.ts`: badminton club lookup and admin club CRUD.
- `uploadsApi.ts`: multipart uploads.
- `configApi.ts`: system config.
- `sbaApi.ts`: SBA ranking types, members, import.
- `usersApi.ts`: admin user management.
- `fixtureApi.ts`: fixtures and bracket/heats operations. Backend fixture endpoints are the authoritative source for draw generation, advancement, result validation, and stored fixture state; frontend fixture helpers are for preview/display and lightweight UX only.

`apiFetch` clears local auth state and redirects to `/login` on 401 responses.

## Backend Components

### Controllers

- `AuthController`: admin login, logout, current user, password change.
- `ConfigController`: public config read, superadmin config update.
- `EventsController`: event CRUD, documents, programs, registration-safe event/program mutation checks, and admin audit logging.
- `ProgramImportController`: admin-only Excel participant import preview/confirm for one event/program.
- `BadmintonClubsController`: public club lookup and admin club maintenance with admin audit logging.
- `RegistrationsController`: public registration creation/lookup/receipt and admin registration/payment/refund operations.
- `PaymentController`: embedded Stripe payment attempts, legacy hosted checkout/session confirmation, payment info/verify endpoints.
- `StripeWebhookController`: Stripe webhook processing.
- `FixturesController`: fixture generation, save, delete, scoring, scheduling, advancement.
- `SbaController`: ranking types, member lookup/search, XLSX import.
- `UploadsController`: local file upload.
- `UsersController`: superadmin user management.
- `AdminPaymentReconciliationController`: reconciliation stats, failed checkout rows, orphan refunds.

### Services

- `AuthService`: BCrypt password verification/hash and JWT generation.
- `RegistrationWorkflowService`: registration validation, pricing, persistence, receipt/email queueing.
- `ProgramImportService`: parses program import `.xlsx` templates, validates rows as one admin-assisted registration, caches preview payloads, and confirms the import without sending emails.
- `PaymentAttemptService`: embedded Stripe PaymentIntent creation, status tracking, webhook finalization, and reconciliation marking.
- `PaymentFinalizationService`: legacy idempotent session-first Stripe finalization.
- `FixtureGenerationService`: authoritative bracket/heats generation, fixture mutation, score validation, advancement, and final placement rules.
- `ReceiptService`: QuestPDF receipt generation.
- `RegistrationDetailsPdfService`: QuestPDF registration-details PDF generation.
- `EmailService`: SMTP payment/refund/cancellation emails with receipt and/or registration-details attachments.
- `BackgroundJobQueue` and `BackgroundJobWorker`: in-memory background work queue.
- `PaymentCleanupWorker`: hourly cleanup of expired legacy `PendingCheckout` rows and embedded payment-attempt backstop sweep.
- `AdminAuditService`: writes admin action snapshots and field-level change details to `AdminAuditLog` and `AdminAuditLogDetail`.
- `StatusCodesEx`: central backend short-code constants for registration, participant, payment, refund, event/program, match, attempt, and processing statuses.

### Logging and Audit

Serilog is configured in `Program.cs` with console output and a custom `EFCoreSink`.

- `EFCoreSink` writes warnings and above to `AppLogs`.
- Framework `Microsoft.*` and `System.*` logs below `Error` are filtered out.
- Framework `Error` and `Fatal` logs are eligible for `AppLogs`.
- Sink failures are swallowed to avoid logging recursion.
- Admin mutations for events/programs, fixtures, badminton club CRUD, and SBA import side effects use `AdminAuditService` where implemented.
- SBA ranking import writes an import summary audit row and one audit row for each new badminton club appended from workbook data.

## Data Model Overview

Main EF Core tables/sets:

- Config/auth/logging: `SystemConfig`, `AdminUsers`, `AppLogs`, `AdminAuditLog`, `AdminAuditLogDetail`, `PaymentAuditLog`.
- Events: `Events`, `EventGalleryImages`, `EventDocuments`, `Programs`, `ProgramFields`, `ProgramCustomFields`.
- Registration: `EventRegistrations`, `ParticipantGroups`, `Participants`, `ParticipantCustomFieldValues`, legacy `EventParticipants`.
- Payment: `Payments`, `PaymentItems`, `Refunds`, `PaymentAttempts`, `PendingCheckouts`, `WebhookLogs`.
- Competition: `Fixtures`, `SbaRankings`.
- Utilities: `BackgroundJobs`, `BadmintonClub`.

Important mapping detail: `TRSDbContext.BadmintonClubs` maps to the SQL table `BadmintonClub`.

## Authentication

- JWT Bearer authentication is configured in `Program.cs`.
- JWT secret is required at startup.
- Tokens include email, role, name, user id, and `mustChangePassword`.
- Roles are `superadmin` and `eventadmin`.
- `AuthContext` stores token/user data in `localStorage`.
- `AdminLayout` enforces authentication and redirects users with `mustChangePassword` to `/admin/change-password`.
- Logout is stateless; there is no token blacklist.

## Payment Summary

Primary paid flow is embedded PaymentIntent:

1. Frontend sends full registration payload to `POST /api/Payment/embedded-attempt`.
2. Backend validates and prices the payload, stores a `PaymentAttempts` row, and creates a Stripe PaymentIntent.
3. The frontend displays Stripe Elements in `EmbeddedPaymentModal` and submits the PaymentIntent.
4. Stripe webhook events update the attempt and finalize successful payments.
5. Successful finalization creates registration, groups, participants, payment, and payment items.
6. Late success after attempt expiry or finalization failure is marked for payment reconciliation rather than auto-registering.
7. Receipt and registration-details PDF generation plus email are queued in memory.

The older hosted Checkout session-first path remains as a legacy fallback through `PendingCheckouts`, `PaymentFinalizationService`, and `/api/Payment/confirm-session`.

Free registrations are created directly through `POST /api/registrations`.

Admin program imports create one `EventRegistration` for the uploaded file, so all imported rows share one registration number. `Entry No` in the workbook groups participant rows into participant groups under that registration. After a valid preview, the admin chooses `S` paid, `W` waived, or `PC` pending collection for the whole import. Imported registrations suppress confirmation email by default and return immediate success/failure in the admin UI.

Registration availability is backend-computed from `Events.RegistrationStatus`, Singapore date, event activity, and active program count. API responses expose `registrationStatus` and `computedRegistrationStatus`; frontend date-only status logic is fallback only. Program capacity is enforced by program fee structure: `per_entry` counts active entries/groups, while `per_player` counts active non-cancelled participants/headcount. Event-level `MaxParticipants` is deprecated and not part of registration validation. Built-in participant fields have separate enabled and required flags in `ProgramFields`.

`RegistrationWorkflowService` uses explicit event gate modes:

- `StrictPublic`: public direct registration and new payment attempts.
- `AdminAssisted`: authenticated admin registration from the event detail page.
- `AlreadyPaidFinalization`: finalizing payments that have already been collected.

Fixture generation closes the affected program and registration validation blocks programs that already have fixtures.

Statuses are stored and exchanged as short codes in the database and API. User-facing descriptions are produced by frontend/backend display mappings only.

## File Uploads

`POST /api/uploads` writes files to `Backend/TRS_API/wwwroot/uploads/<folder>/<yyyy>/<MM>/<guid>.<ext>` and returns a relative `/uploads/...` path.

Allowed uploads:

- JPEG, PNG, WEBP up to 2 MB.
- PDF up to 8 MB.

The API serves static files through `app.UseStaticFiles()`.

## Configuration

Backend configuration comes from `appsettings*.json` and environment variables:

- `ConnectionStrings:TRSConnection`
- `Jwt:Secret`, `Jwt:Issuer`, `Jwt:Audience`, `Jwt:ExpiryHours`
- `Stripe:SecretKey`, `Stripe:PublishableKey`, `Stripe:WebhookSecret`
- `Cors:AllowedOrigins`
- `RateLimiting:WindowMinutes`, `RateLimiting:PermitLimit`
- `Email:*`

Email uses SMTP through `EmailService`. The default checked-in SMTP endpoint is Microsoft 365 SMTP client submission:

- `Email:Smtp:Host`: `smtp.office365.com`
- `Email:Smtp:Port`: `587`
- `Email:Smtp:EnableSsl`: `true`

Do not commit mailbox credentials. Set `Email:Smtp:Username`, `Email:Smtp:Password`, and optionally `Email:FromAddress` through user secrets, environment variables, or deployment secret configuration. If `Email:FromAddress` is blank, the SMTP username is used as the sender address. Microsoft 365 must allow SMTP AUTH for the designated mailbox.

Frontend configuration:

- `VITE_API_BASE_URL`
- `VITE_MOCK_DELAY_MS`

## Known Implementation Constraints

- Public registration and receipt lookup are ID-based and unauthenticated.
- Upload endpoint does not enforce `[Authorize]`.
- Background jobs are in-memory and lost on process restart.
- SQL scripts exist, but EF migration files are not present.
- Stripe SDK services are instantiated directly in controllers.
- Some legacy models/tables remain: `EventParticipant`, `BackgroundJob`.
- Event-level `MaxParticipants` remains in the model but registration capacity is enforced through `Program.MaxParticipants`.
- Event-level `RegistrationStatus` is stored as a short code: `O` open, `PA` paused, or `CL` closed. `D` draft and `U` upcoming are computed statuses.
- `RegistrationStatus` and `RegStatus` both exist on registrations.
- Refund-only actions do not cancel slots. Any action that cancels a registration, entry, or participant is blocked when affected programs already have fixtures.
- Local disk upload storage requires persistent storage in production.
