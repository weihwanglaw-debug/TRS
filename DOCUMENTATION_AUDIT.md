# DOCUMENTATION_AUDIT.md

Documentation synchronized with the current repository implementation.

Last targeted sync: status-code standardization, refund/cancel workflow, registration-details PDF/email behavior, DB access guidance, and current registration/payment API routes.

## What Changed

- Rewrote `AGENTS.md` with current repository layout, implementation guardrails, verification commands, and high-risk areas.
- Rewrote `TRS_CONTEXT.md` to describe the current frontend routes, API modules, backend controllers, services, logging, data model, auth, payment flow, uploads, and known constraints.
- Rewrote `TRS_ARCHITECTURE.md` around the actual React/Vite frontend, ASP.NET Core middleware pipeline, EF Core model, Stripe integration, AppLogs EF sink, local upload storage, and fixture architecture.
- Rewrote `TRS_API_MAP.md` from current controller route attributes, including the badminton club API and current auth boundaries.
- Rewrote `TRS_BUSINESS_RULES.md` from current validation, payment, refund, fixture, upload, SBA, and club code paths.
- Normalized Markdown formatting and removed stale encoding artifacts from previous generated documentation.
- Updated root documentation after the refund/cancel and status-code standardization work so stored/API statuses are documented as short codes and frontend labels as display-only mappings.

## Removed Obsolete Sections

- Removed references to Tiptap as the current rich text stack; current dependencies include Quill/react-quill packages.
- Removed claims that all timestamps consistently use `sysutcdatetime`; `BadmintonClub.CreatedAt` currently maps to `getdate()` to match the existing table.
- Removed over-specific deployment assumptions that were not supported by code.
- Removed stale statement that the badminton club table is plural `BadmintonClubs`; EF now maps to singular SQL table `BadmintonClub`.
- Removed outdated API notes that omitted the club endpoints.
- Removed unsupported claims that audit logs are actively exposed by read endpoints.
- Removed long stale issue lists from API reference and moved current constraints into focused notes.

## Added New Sections

- Added current `BadmintonClubsController` API documentation.
- Added current `/admin/badminton-clubs` route documentation.
- Added badminton club business rules, including active-only lookup, duplicate name prevention, soft delete, and "Others" frontend behavior.
- Added badminton club CRUD and SBA import admin audit behavior.
- Added SBA import club append behavior and response fields.
- Added logging architecture for Serilog plus custom `EFCoreSink` writing to `AppLogs`.
- Added `AdminAuditService` behavior and `AdminAuditLogDetail` to architecture/context notes.
- Added `AppLogs` and `BadmintonClub` to the data model overview.
- Added explicit note that `TRSDbContext.BadmintonClubs` maps to SQL table `BadmintonClub`.
- Added current frontend admin route aliases for participant detail views.
- Added current API module list including `clubsApi.ts`.
- Added operational constraints for public ID-based registration/receipt lookup, unauthenticated uploads, local disk storage, and in-memory jobs.
- Added status-code standardization guidance to `AGENTS.md`.
- Added direct DB access guidance to `AGENTS.md`: check `Backend/TRS_API/appsettings.json` `ConnectionStrings:TRSConnection` first.
- Added registration-details PDF and related payment/refund/cancellation email behavior to context/business/architecture docs.
- Added current refund-only versus cancellation rules, including fixture-blocking only for cancellation and batch emails after DB save.

## APIs Added/Removed

### Added to Documentation

- `GET /api/clubs`
- `GET /api/clubs/{id}`
- `POST /api/clubs`
- `PUT /api/clubs/{id}`
- `DELETE /api/clubs/{id}`
- `GET /api/registrations/{id}/payment/audit`
- `POST /api/registrations/{id}/payment/refunds/bulk`
- `POST /api/registrations/{id}/cancel`
- `POST /api/registrations/{id}/groups/{groupId}/cancel`
- `POST /api/registrations/{id}/participants/{participantId}/cancel`
- `GET /api/registrations/{id}/details-pdf`
- `POST /api/registrations/{id}/notifications/cancellation`
- `POST /api/Payment/embedded-attempt/{attemptId}/abandon`

### Removed from Documentation

- No implemented API endpoints were removed from documentation intentionally.
- Missing/improvement endpoints from older docs were not listed as actual API because they are not implemented.

### Confirmed Existing APIs

- Auth: `/api/auth/*`
- Config: `/api/config`
- Events/programs/documents: `/api/events/*`
- Registrations/payment/refunds/receipt/export/stats: `/api/registrations/*`
- Stripe payment: `/api/Payment/*`
- Stripe webhook: `/api/webhooks/stripe`
- Fixtures: `/api/fixtures/*`
- SBA: `/api/sba/*`
- Uploads: `/api/uploads`
- Admin users: `/api/admin/users/*`
- Payment reconciliation: `/api/admin/payment-reconciliation/*`

## Business Rules Added/Removed

### Added to Documentation

- Badminton club active-only lookup and soft-delete behavior.
- Badminton club duplicate active-name validation.
- Frontend badminton club dropdown behavior, including "Others" free-text persistence through `clubSchoolCompany`.
- Serilog/AppLogs persistence behavior and framework log filtering.
- Pending checkout reuse based on active session, event, email, method, amount, and payload hash.
- Explicit note that event-level `MaxParticipants` exists but registration capacity uses program-level group count.
- Short-code-only persistence/API behavior for statuses, with frontend long labels derived from mapping tables.
- Refund-only actions do not cancel entries or free slots and are not blocked by fixtures.
- Cancellation actions free slots and are blocked when affected programs have fixtures.
- Batch refund/cancel notifications are sent once per submitted action after database state is saved.
- Registration-details PDF is attached with payment confirmation and relevant refund/cancellation emails.

### Removed or Corrected

- Corrected table name for badminton clubs from plural to singular.
- Corrected frontend editor/library notes to avoid claiming Tiptap as current implementation.
- Corrected rate-limit wording to reference configured policy rather than hard-coded values in prose.
- Removed business-rule claims not directly backed by current code.

## Architecture Changes Detected

- The current implementation includes `BadmintonClub` as an EF model mapped to a singular SQL table and exposed through `/api/clubs`.
- The current implementation includes `AppLog` and a custom Serilog EF sink.
- The current implementation includes `RegistrationDetailsPdfService` and download endpoint `/api/registrations/{id}/details-pdf`.
- The current implementation uses central backend status-code constants in `StatusCodesEx`; SQL constraints and frontend mappings must remain aligned.
- Serilog is configured through host logging rather than a separate post-build logger replacement.
- Frontend has a dedicated `clubsApi.ts` module and badminton-specific club dropdown behavior in `ParticipantFieldsForm`.
- SQL setup is script-based in `Backend/TRS_Data/Sql`; EF migration files are still absent.
- Existing legacy/unused EF surfaces remain: `EventParticipant` and `BackgroundJob`.
- Background jobs remain in-memory despite a `BackgroundJobs` table existing.
- Stripe remains directly coupled through inline Stripe SDK service instantiation in controllers.

## Verification Performed

- Reviewed controller route attributes under `Backend/TRS_API/Controllers`.
- Reviewed frontend routes in `Frontend/src/App.tsx`.
- Reviewed registration and payment services.
- Reviewed `TRSDbContext` mappings.
- Reviewed frontend API modules and club dropdown implementation.
