# DOCUMENTATION_AUDIT.md

Documentation synchronized with the current repository implementation.

Last targeted sync: badminton club admin CRUD, SBA import club append behavior, and admin audit logging updates.

## What Changed

- Rewrote `AGENTS.md` with current repository layout, implementation guardrails, verification commands, and high-risk areas.
- Rewrote `TRS_CONTEXT.md` to describe the current frontend routes, API modules, backend controllers, services, logging, data model, auth, payment flow, uploads, and known constraints.
- Rewrote `TRS_ARCHITECTURE.md` around the actual React/Vite frontend, ASP.NET Core middleware pipeline, EF Core model, Stripe integration, AppLogs EF sink, local upload storage, and fixture architecture.
- Rewrote `TRS_API_MAP.md` from current controller route attributes, including the badminton club API and current auth boundaries.
- Rewrote `TRS_BUSINESS_RULES.md` from current validation, payment, refund, fixture, upload, SBA, and club code paths.
- Normalized Markdown formatting and removed stale encoding artifacts from previous generated documentation.

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

## APIs Added/Removed

### Added to Documentation

- `GET /api/clubs`
- `GET /api/clubs/{id}`
- `POST /api/clubs`
- `PUT /api/clubs/{id}`
- `DELETE /api/clubs/{id}`

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

### Removed or Corrected

- Corrected table name for badminton clubs from plural to singular.
- Corrected frontend editor/library notes to avoid claiming Tiptap as current implementation.
- Corrected rate-limit wording to reference configured policy rather than hard-coded values in prose.
- Removed business-rule claims not directly backed by current code.

## Architecture Changes Detected

- The current implementation includes `BadmintonClub` as an EF model mapped to a singular SQL table and exposed through `/api/clubs`.
- The current implementation includes `AppLog` and a custom Serilog EF sink.
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
