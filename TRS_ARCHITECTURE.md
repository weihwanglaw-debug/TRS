# TRS_ARCHITECTURE.md — Technical Architecture
**Generated from codebase. All facts are code-verified.**

---

## 1. System Diagram (Text)

```
┌────────────────────────────────────────────────────────────────┐
│                      Browser (React SPA)                        │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐│
│  │  Public Pages    │  │  Admin Pages (/admin/*)              ││
│  │  / Landing       │  │  Events, Registrations, Fixtures,    ││
│  │  /event/:id      │  │  Payments, SBA, Config, Users        ││
│  │  /payment/result │  └──────────────────────────────────────┘│
│  └──────────────────┘                                          │
│          │ apiFetch (fetch + 401 interceptor)                  │
└──────────┼─────────────────────────────────────────────────────┘
           │ HTTPS
           ▼
┌────────────────────────────────────────────────────────────────┐
│              ASP.NET Core 8 Web API                             │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────┐ │
│  │ Middleware   │  │  Controllers  │  │  Services           │ │
│  │ CORS         │  │  Auth         │  │  AuthService        │ │
│  │ Rate Limiter │  │  Events       │  │  RegistrationWorkflow│ │
│  │ JWT Auth     │  │  Registrations│  │  PaymentFinalization │ │
│  │ Static Files │  │  Payment      │  │  FixtureGeneration  │ │
│  │ CSP Headers  │  │  Fixtures     │  │  EmailService       │ │
│  └──────────────┘  │  SBA          │  │  ReceiptService     │ │
│                    │  Uploads      │  │  BackgroundJobQueue │ │
│                    │  Users        │  │  PaymentCleanupWorker│ │
│                    │  Webhook      │  └─────────────────────┘ │
│                    │  Reconciliation                           │ │
│                    └───────────────┘                          │ │
└──────────────┬──────────────────────────────┬─────────────────┘
               │ EF Core                       │ Stripe.NET SDK
               ▼                               ▼
┌──────────────────────┐         ┌──────────────────────────────┐
│  SQL Server Express  │         │  Stripe API                  │
│  TRSDbContext        │         │  Sessions, Refunds, Webhooks │
│  ~25 tables          │         └──────────────────────────────┘
└──────────────────────┘
           
wwwroot/uploads/          SMTP Server
(local disk)              (System.Net.Mail)
```

---

## 2. Frontend Architecture

### Routing
React Router v6. Routes defined in `App.tsx`. Admin routes are nested under `<AdminLayout />` which handles auth guard (redirect to `/login` if not authenticated).

No lazy loading or code splitting is implemented. All pages are eagerly imported.

### State Management
- **No global state store.** Each page/component manages its own state with `useState`/`useRef`/`useEffect`.
- **Three React Contexts:**
  - `AuthContext` — token lifecycle, user object, login/logout functions
  - `ThemeContext` — CSS variable theming (no persistence beyond render)
  - `LiveConfigContext` — fetches `GET /api/config` once on mount; all components read from this
- TanStack Query (`@tanstack/react-query`) is installed but not used for server-state management in any page. All pages make direct imperative `apiFetch` calls.
- Cart state (registration in progress) is held in `EventDetail.tsx` component state. It is persisted to `sessionStorage` as a JSON payload before Stripe redirect so it can be recovered on return.

### API Layer
All API calls go through `apiFetch()` in `_base.ts`. This wrapper:
1. Calls native `fetch()`
2. On 401: clears localStorage, redirects to `/login` (skipped if already on `/login`)
3. Returns raw `Response`

Each API module (`eventsApi.ts`, `registrationsApi.ts`, etc.) wraps `apiFetch` and returns `ApiResult<T>` (discriminated union of `{ data, error: null }` or `{ data: null, error }`). **Callers must check `r.error` before using `r.data`.**

A 60ms artificial delay (`VITE_MOCK_DELAY_MS`) is injected before every API call. This was likely a mock-mode artifact and should be removed in production.

### Key Components
- `ParticipantFieldsForm` — shared between public registration and admin edit modal; renders all standard + custom fields for a participant
- `EventEdit.tsx` — creates/edits events including Tiptap rich-text `additionalInfo`, document management, gallery, programs
- `AdminLayout.tsx` — auth gate wrapper for all admin routes
- `ActionDropdownPortal.tsx` — portal-based dropdown to avoid z-index clipping in table rows

---

## 3. Backend Architecture

### Middleware Pipeline Order
```
HTTPS Redirect
→ Security Headers (CSP, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection)
→ CORS ("AllowFrontend" policy)
→ Rate Limiter ("payment" fixed-window: 5 req/1 min)
→ Authentication (JWT Bearer)
→ Authorization
→ Static Files (wwwroot/)
→ MapControllers
```

**Critical note:** CORS middleware is placed after HTTPS redirect but before rate limiter. The `AllowCredentials()` flag is set, which requires explicit origins — this is correct, but the combination of `AllowAnyHeader` + `AllowAnyMethod` + `AllowCredentials` is overly permissive.

### Controller Layer
Controllers are thin. Business logic is delegated to services:
- `RegistrationWorkflowService` handles all registration validation and persistence
- `PaymentFinalizationService` handles idempotent session-first checkout completion
- `FixtureGenerationService` handles all bracket state transformations

**Tight coupling identified:** `PaymentController` directly instantiates Stripe SDK service objects (`new SessionService()`, `new RefundService()`) inline rather than injecting them. This makes unit testing impossible without real Stripe credentials.

`AdminPaymentReconciliationController` also instantiates `new SessionService()` and `new RefundService()` directly.

**`EventsController` has two responsibilities in one:** It handles both Event CRUD and Program sub-resource CRUD as well as Document sub-resource CRUD. This violates single-responsibility but is manageable at current scale.

### Service Layer
- `RegistrationWorkflowService` performs a two-phase validation:
  1. `ValidateAndPriceAsync` — read-only, checks capacity, age, gender, duplicates, pricing
  2. `CreateAsync` — transactional write; re-validates under `UPDLOCK, ROWLOCK` on each program row to prevent TOCTOU race conditions on capacity
- `PaymentFinalizationService` is called from two paths (webhook and confirm-session) and handles the idempotency correctly via `FindPaymentBySession()` pre-check
- `EmailService` uses `System.Net.Mail.SmtpClient` (not `MailKit`). `SmtpClient` is marked obsolete in .NET docs but functional
- `ReceiptService` generates PDF via QuestPDF. Branding is read from `SystemConfig` table at generation time
- `BackgroundJobQueue` is an in-memory `Channel<Func<CancellationToken, Task>>`. Jobs are lost on process restart. Not persistent.

### Filters
`ValidateModelFilter` — applied globally; returns `ValidationProblemDetails` (400) automatically when any model with data annotations fails validation. Eliminates manual `ModelState.IsValid` checks.

---

## 4. Database Design Overview

**25 tables.** All use SQL Server. All timestamps use `sysutcdatetime()` as DB default (UTC). `EventParticipant` table uses `getdate()` (local time) — an inconsistency.

### Core entity graph:
```
SystemConfig           (key-value config store)
AdminUser              (admin accounts, bcrypt passwords)
AdminAuditLog          (admin action log)

Event
├── EventGalleryImage  (CASCADE delete)
├── EventDocument      (CASCADE delete)
└── TrsProgram         (CASCADE delete)
    ├── ProgramField   (1:1, CASCADE delete — toggles for optional participant fields)
    ├── ProgramCustomField (1:N, CASCADE delete — custom form fields)
    └── ParticipantGroup (registered entries per program slot)
        └── Participant     (CASCADE delete)
            └── ParticipantCustomFieldValue (CASCADE delete)

EventRegistration
├── ParticipantGroup (FK → Registration; FK → Event; FK → Program)
└── Payment (1:1 enforced by UQ_Payments_Registration)
    ├── PaymentItem (line items, FK → Payment, Group, Participant)
    └── Refund (FK → Payment, PaymentItem; partial or full)

Fixture               (1:1 per EventId+ProgramId, bracket JSON blob)
SbaRanking            (imported from xlsx; doubles and singles)
PendingCheckout       (ephemeral, PK=GatewaySessionId, purged after payment)
WebhookLog            (all Stripe webhook events; P/S/F/I processing status)
BackgroundJob         (persisted job queue — NOT currently written to; in-memory queue used instead)
PaymentAuditLog       (payment status transitions)
```

**Key constraints:**
- `UQ_Payments_Registration` — one Payment per Registration (enforced at DB level)
- `UQ_Payments_GatewaySessionID` (filtered: NOT NULL) — prevents double-processing same Stripe session
- `UQ_Fixtures_EventProgram` — one Fixture per program
- `UQ_AdminUsers_Email` — unique email per admin user
- `UX_Refunds_OrphanActive_GatewaySessionId` — prevents duplicate orphan refunds for same session while Pending or Succeeded

**Denormalisation present:**
- `EventRegistration.EventName` — copy of Event.Name at time of registration
- `ParticipantGroup.ProgramName` — copy of Program.Name
- `PaymentItem.ProgramName`, `PaymentItem.Description`, `PaymentItem.PlayerName` — copies
- `Payment.EventId` — denormalised from Registration.EventId

### Dead / legacy tables:
- `EventParticipant` — junction table with no writes in current code. `EventRegistration.EventParticipants` collection is never populated by any controller or service.
- `BackgroundJob` — DB table exists but is never written to. The in-memory `BackgroundJobQueue` is used exclusively.

---

## 5. Integration Points

### Stripe
- **Checkout Sessions** — created in `PaymentController.CreateSessionFirstCheckout()` or `CreateLegacyCheckout()`
- **Webhooks** — `POST /api/webhooks/stripe` handles: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
- **Refunds** — created synchronously via `RefundService().CreateAsync()` in `RegistrationsController.ProcessRefundItemAsync()` and `AdminPaymentReconciliationController.RefundOrphanedPayment()`
- **Idempotency keys** — used on session creation and refund creation
- **No Stripe SDK injection** — `StripeConfiguration.ApiKey` is set in constructor; `new SessionService()` etc. created inline

### File Uploads
- `POST /api/uploads` — multipart/form-data; stores file in `wwwroot/uploads/<folder>/yyyy/MM/<guid><ext>`
- Returns `{ path: "/uploads/..." }` relative path
- Frontend uses `assetUrl(path)` to prepend `VITE_API_BASE_URL`
- **No auth enforcement** on upload endpoint despite frontend sending token
- Allowed: JPG, PNG, WEBP (max 2MB), PDF (max 8MB)

### Email (SMTP)
- `EmailService.SendPaymentConfirmationAsync()` — called from background job after payment confirmed
- Plain text email with PDF attachment
- If `Email:Smtp:Host` is not configured, email is silently skipped (logged as warning)
- No retry logic on email failure — failure is logged and silently swallowed

### SBA Rankings
- Admin uploads `.xlsx` file to `POST /api/sba/import`
- Custom xlsx parser (`SbaWorkbookParser`) reads raw ZIP (Open XML format) without any third-party xlsx library
- Replaces all existing rankings for the imported sheet types (delete + re-insert)
- 35 ranking types supported (Men's/Women's/Mixed Singles/Doubles + U9–U19 age groups)

---

## 6. Data Flow: Registration → Payment → Confirmation

```
User submits cart
       │
       ▼
POST /api/Payment/create-checkout-session
  ValidateAndPriceAsync()
    ├─ Event active + open check
    ├─ Program active + not closed check
    ├─ Capacity check (count non-Cancelled ParticipantGroups)
    ├─ Duplicate check (FullName + DOB per program)
    ├─ Participant count per program (MinPlayers ≤ n ≤ MaxPlayers)
    ├─ Age check (MinAge ≤ calculated age ≤ MaxAge)
    ├─ Gender check (Male/Female/Mixed rules)
    ├─ Required field validation (Email, Phone, Nationality, Club, optional fields)
    ├─ Custom required field validation
    └─ Price validation (submitted fee == computed fee)
  Creates PendingCheckout row
  Creates Stripe Session
       │
       ▼ (user pays at Stripe)
       │
       ├──[Webhook arrives first]──────────────────────────────────────┐
       │                                                                │
       ▼                                                                ▼
POST /api/webhooks/stripe                           POST /api/Payment/confirm-session
  FinalizeSessionFirstAsync()                         Verify session with Stripe (10s timeout)
    FindPaymentBySession() → null                     FinalizeSessionFirstAsync()
    FindPendingCheckout() → payload                     FindPaymentBySession()
    RegistrationWorkflowService.CreateAsync()             → if found: return existing (idempotent)
      (UPDLOCK on Program rows)                           → if PendingCheckout missing: 409 Conflict
      write Registration, Groups, Participants,         RegistrationWorkflowService.CreateAsync()
           Payment, PaymentItems                      delete PendingCheckout
    delete PendingCheckout                            queue receipt+email
    queue receipt+email                               return { registrationId }
       │
       ▼
BackgroundJobWorker dequeues job
  ReceiptService.GenerateAsync() → PDF bytes
  EmailService.SendPaymentConfirmationAsync() → SMTP
```

---

## 7. Deployment Assumptions

Based on code only (no Dockerfile or CI/CD config present):

- **Static file serving:** API serves frontend static files from `wwwroot/`. This is a single-process deployment model (API + frontend served from same host).
- **Database:** SQL Server Express (connection string name `TRSConnection`)
- **Dev URL:** `https://localhost:7183` (hardcoded in frontend CSP and CORS default)
- **Swagger:** Enabled only in `Development` environment
- **HTTPS redirect:** Enabled unconditionally — requires TLS certificate in production
- **Upload storage:** Local disk only — not cloud-compatible without volume mount

---

## 8. Architectural Risks

### Tight Coupling Risks
1. **Stripe SDK instantiated inline** — `new SessionService()`, `new RefundService()` created directly in controller methods. No abstraction layer. Impossible to unit test or mock.
2. **Receipt service reads DB inside PDF generation** — `ReceiptService.GenerateAsync()` takes `TRSDbContext db` as parameter. Callers must pass a scoped DB context. This works but is unusual — the service is not self-contained.
3. **Email service is synchronous inside async background job** — `SmtpClient.SendMailAsync()` is called without timeout. A hung SMTP server will block a background job worker thread indefinitely.
4. **`EventsController` handles 3 sub-resources** — Event CRUD, Program CRUD, Document CRUD all in one controller. Manageable now, but will grow.

### Missing Abstractions
1. **No repository pattern** — Controllers and services query `TRSDbContext` directly. Business logic is scattered between controller action methods and service classes.
2. **No payment gateway abstraction** — Stripe is wired directly. Adding PayNow or another gateway requires modifying existing controller code.
3. **No file storage abstraction** — `UploadsController` writes directly to `_env.WebRootPath`. Switching to S3/Azure Blob requires rewriting the controller.
4. **No background job persistence** — `BackgroundJobQueue` uses `System.Threading.Channels.Channel`. If the process restarts during an active job (e.g., mid-receipt-send), the job is silently lost. The `BackgroundJob` DB table exists but is unused.

### Architectural Smells
1. **`EventParticipant` table** — dead code; schema and EF model exist but no code path creates rows. Creates confusion about which model is authoritative.
2. **`BackgroundJob` DB table** — schema and EF model exist but are never written to. The in-memory queue is the actual implementation.
3. **Dual status systems** — `EventRegistration` has both `RegStatus` (string, long form) and `RegistrationStatus` (char, short form) storing the same logical state. Both are written on every status change. One should be removed.
4. **Receipt number collision risk** — `$"TRS-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(10000, 99999)}"` is not guaranteed unique. Two simultaneous confirmations on the same day could produce the same receipt number. No unique constraint on `Payments.ReceiptNumber`.
5. **`ConfirmSessionRequest.RegistrationPayload` is ignored** — The backend reads payload from `PendingCheckout` DB, not from the request field. The request field is validated as `[Required]` but its value is discarded. This is misleading.
6. **Frontend artificial delay** — `VITE_MOCK_DELAY_MS=60` is baked into every API call via `await delay()`. This adds 60ms to every request in production.
7. **No pagination on exports** — `GET /api/registrations/export` returns all matching registrations without pagination. Could be a memory/performance issue at scale.
8. **`GetAll` on events includes all programs + fields + custom fields + gallery + documents** — the list endpoint returns the same heavy payload as the detail endpoint. No lightweight list projection exists.
