# TRS_ARCHITECTURE.md

This document describes the current technical architecture. Code is the source of truth.

## High-Level Architecture

```mermaid
flowchart LR
    Browser["React SPA\nFrontend/"] --> ApiFetch["apiFetch\nFrontend/src/lib/api"]
    ApiFetch --> Api["ASP.NET Core 8 API\nBackend/TRS_API"]
    Api --> Ef["EF Core 8\nTRSDbContext"]
    Ef --> Sql["SQL Server\nTRS database"]
    Api --> Stripe["Stripe API\nCheckout, refunds, webhooks"]
    Api --> Disk["wwwroot/uploads\nlocal files"]
    Api --> Smtp["SMTP server\nconfirmation email"]
    Api --> Jobs["In-memory background queue"]
    Jobs --> Receipt["QuestPDF receipt"]
    Jobs --> Smtp
```

## Frontend Architecture

### Stack

- React 18
- TypeScript
- Vite
- React Router v6
- Tailwind CSS
- Radix/shadcn-style UI components
- Lucide icons
- Quill/react-quill packages
- TanStack Query is installed, but most code uses direct imperative API calls.

### Routing

Routes live in `Frontend/src/App.tsx`.

`AdminLayout` wraps all `/admin/*` pages, checks authentication, and handles the `mustChangePassword` redirect.

### State

The frontend uses component state and React contexts:

- `AuthContext`: token lifecycle, current user, login/logout.
- `ThemeContext`: theme values.
- `LiveConfigContext`: loads public system config from `GET /api/config`.

Registration cart state lives mainly in `EventDetail.tsx`. The session-first paid flow stores payload context in browser storage around the Stripe redirect.

### API Pattern

All API modules call `apiFetch` from `Frontend/src/lib/api/_base.ts`.

`apiFetch`:

- Uses native `fetch`.
- Applies configured `API_BASE`.
- Clears local auth state and redirects to `/login` on 401.
- Returns raw `Response` to wrapper modules.

Wrapper modules return `ApiResult<T>` where practical.

## Backend Architecture

### Stack

- ASP.NET Core 8
- EF Core 8
- SQL Server
- Stripe.NET
- QuestPDF
- BCrypt.Net
- HtmlSanitizer
- Serilog

### Middleware Pipeline

Current order in `Program.cs`:

1. Swagger/SwaggerUI in development.
2. HTTPS redirection outside development.
3. Security headers middleware.
4. CORS policy `AllowFrontend`.
5. Rate limiter.
6. Authentication.
7. Authorization.
8. Static files.
9. Controllers.

Security headers include CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `X-XSS-Protection`.

### Controller Pattern

Controllers use attribute routing. Most admin mutations use `[Authorize(Roles = "superadmin,eventadmin")]`; user management and orphan refunds are superadmin-only.

Business logic is mixed:

- Shared registration validation/persistence is centralized in `RegistrationWorkflowService`.
- Stripe finalization is centralized in `PaymentFinalizationService`.
- Fixture logic is centralized in `FixtureGenerationService`.
- Several controllers still directly query and mutate `TRSDbContext`.

### Service Pattern

Services are registered in DI in `Program.cs`.

- Scoped: auth, registration, payment finalization, fixtures, email, receipt.
- Singleton: background job queue.
- Hosted: background job worker and payment cleanup worker.

Stripe SDK service objects are created inline where needed instead of being injected behind an interface.

## Database Architecture

`TRSDbContext` in `Backend/TRS_Data/Models/TRSDbContext.cs` owns the EF model.

### Main Entity Groups

Configuration/auth/logging:

- `SystemConfig`
- `AdminUser`
- `AppLog`
- `AdminAuditLog`
- `PaymentAuditLog`

Events and programs:

- `Event`
- `EventGalleryImage`
- `EventDocument`
- `TrsProgram` mapped to `Programs`
- `ProgramField`
- `ProgramCustomField`
- `BadmintonClub` mapped to `BadmintonClub`

Registration:

- `EventRegistration`
- `ParticipantGroup`
- `Participant`
- `ParticipantCustomFieldValue`
- `EventParticipant` legacy model

Payment:

- `Payment`
- `PaymentItem`
- `Refund`
- `PendingCheckout`
- `WebhookLog`

Competition:

- `Fixture`
- `SbaRanking`

Jobs:

- `BackgroundJob` exists in EF, but current runtime uses the in-memory `BackgroundJobQueue`.

### Important Constraints and Indexes

- One payment per registration: `UQ_Payments_Registration`.
- Unique Stripe session/payment identifiers when present.
- One fixture per event/program: `UQ_Fixtures_EventProgram`.
- Unique admin email: `UQ_AdminUsers_Email`.
- Filtered unique orphan refund index on `Refunds.GatewaySessionId`.
- SBA ranking filtered unique indexes for singles and doubles.

### Denormalized Fields

The system intentionally stores snapshots:

- `EventRegistration.EventName`
- `ParticipantGroup.ProgramName`
- `ParticipantGroup.ClubDisplay`
- `ParticipantGroup.NamesDisplay`
- `PaymentItem.ProgramName`
- `PaymentItem.Description`
- `PaymentItem.PlayerName`
- `Payment.EventId`

These avoid expensive joins and preserve historical labels after event/program edits.

## Payment Architecture

### Session-First Flow

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as PaymentController
    participant DB as SQL Server
    participant Stripe as Stripe
    participant Final as PaymentFinalizationService

    UI->>API: POST /api/Payment/create-checkout-session
    API->>API: ValidateAndPriceAsync
    API->>DB: Upsert PendingCheckout
    API->>Stripe: Create Checkout Session
    API-->>UI: checkoutUrl, gatewaySessionId
    Stripe-->>API: POST /api/webhooks/stripe
    UI->>API: POST /api/Payment/confirm-session
    API->>Stripe: Verify session is paid
    API->>Final: FinalizeSessionFirstAsync
    Final->>DB: Create registration/payment graph
    Final->>DB: Remove PendingCheckout
```

Webhook and browser return are both allowed to win the race. `PaymentFinalizationService` first checks for an existing payment by `GatewaySessionId` and returns the existing registration when already processed.

### Legacy Payment Flow

`PaymentController` still supports creating a Stripe Checkout Session for an existing registration id. Current public paid registration uses the session-first path.

## Background Work

Receipt generation and payment confirmation email are queued through `IBackgroundJobQueue`.

Implementation notes:

- Queue is in-memory (`Channel<Func<CancellationToken, Task>>`).
- Jobs are lost if the process restarts.
- Email failures are logged but do not retry.
- `PaymentCleanupWorker` deletes expired pending checkout rows hourly.

## Logging Architecture

Serilog is configured through `builder.Host.UseSerilog`.

Configured sinks:

- Console.
- `EFCoreSink`, writing to `AppLogs`.

`EFCoreSink` creates a scoped `TRSDbContext` per log event, writes the event, and swallows sink exceptions.

## File Storage

Uploads are local disk files below API web root:

`Backend/TRS_API/wwwroot/uploads/...`

The API returns relative paths and serves them with static file middleware. There is no storage abstraction for cloud storage.

## Fixture Architecture

Fixtures are stored as rows in `Fixtures` with `BracketStateJson`.

Supported formats in current code:

- `knockout`
- `group_knockout`
- `round_robin`
- `heats`

The backend owns generation and mutation; the frontend wizard sends config and seed entries.

## Architectural Risks

- Public registration and receipt lookup use sequential ids.
- Uploads are unauthenticated at the controller level.
- In-memory background jobs are not durable.
- Stripe SDK is not abstracted.
- Local disk uploads are not horizontally scalable without shared storage.
- `EventParticipant` and `BackgroundJob` remain as legacy/unused EF surfaces.
- Dual registration status fields increase consistency risk.
- SQL scripts exist but there are no EF migration files in the repository.
