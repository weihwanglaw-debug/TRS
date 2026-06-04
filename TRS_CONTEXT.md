# TRS_CONTEXT.md — Tournament Registration System
**Generated from codebase. All facts are code-verified.**

---

## 1. System Purpose

TRS is a web-based tournament registration platform for sports events. It enables:
- Public users to browse events and register participants for programs (singles, doubles, teams)
- Online payment via Stripe Checkout (credit card and PayNow SGD)
- Admin management of events, registrations, payments, refunds, fixtures, and SBA rankings
- Automated PDF receipt generation and email confirmation on payment

The system is built and deployed as a monorepo: React frontend (`tournament-hub`) + ASP.NET Core 8 API (`TRS-API`), backed by SQL Server Express, with Stripe as the sole payment gateway and file storage served from the API's `wwwroot/uploads/` directory.

---

## 2. Frontend Structure

**Stack:** React 18, TypeScript, Vite, React Router v6, TanStack Query, Tailwind CSS, shadcn/ui, Tiptap (rich text)

**Public pages:**
- `/` — Landing page (event carousel, hero, advertise section)
- `/event/:id` — Event detail with program listing, registration cart, and payment initiation
- `/payment/result` — Post-Stripe redirect handler; calls `confirm-session` to finalise registration
- `/login` — Admin login modal

**Admin pages (all under `/admin`, wrapped in `AdminLayout`):**
- `/admin` — Dashboard (stats cards, recent activity)
- `/admin/events` — Event list
- `/admin/events/:eventId` — Event create/edit (EventEdit.tsx) — programs, documents, gallery, AdditionalInfo (Tiptap rich text)
- `/admin/registrations` — Registration list with filters, paging, CSV export
- `/admin/registrations/participants` — Participant detail view
- `/admin/payments` — Payment reconciliation (AdminPayments.tsx)
- `/admin/fixtures` — Fixture wizard and bracket management
- `/admin/sba-rankings` — SBA ranking import and browse
- `/admin/config` — Master system configuration (key-value pairs)
- `/admin/users` — User management (superadmin only)
- `/admin/change-password` — Self-service password change

**API layer (`src/lib/api/`):**
- `_base.ts` — `apiFetch` wrapper with 401 interceptor, `publicHeaders()`, `adminHeaders()`, `assetUrl()`
- `eventsApi.ts` — events and programs CRUD, documents sub-resource
- `registrationsApi.ts` — registrations, payments, refunds, reconciliation
- `uploadsApi.ts` — file uploads (multipart)
- `authApi.ts` — login, logout, me, change-password
- `configApi.ts` — system config read/write
- `sbaApi.ts` — SBA rankings search, import
- `usersApi.ts` — admin user management
- `fixtureApi.ts` — fixture generation and bracket management

**State management:** React component state and `useState`/`useRef`/`useEffect` patterns. No Redux or Zustand. TanStack Query is installed but not actively used for server-state caching in most pages (direct `apiFetch` calls in `useEffect`).

**Contexts:**
- `AuthContext` — JWT token lifecycle (localStorage), `apiGetMe` on boot for session restore, `mustChangePassword` flag
- `ThemeContext` — CSS custom property based theming
- `LiveConfigContext` — loads `GET /api/config` on boot; exposes branding and system config to all components

---

## 3. Backend Structure

**Stack:** ASP.NET Core 8, Entity Framework Core 8, SQL Server Express, Stripe.NET SDK, QuestPDF (receipt generation), BCrypt.Net, Ganss.Xss (HTML sanitisation)

**Controllers (all under `/api/`):**

| Controller | Route Prefix | Auth |
|---|---|---|
| AuthController | `/api/auth` | Mixed (login=public, rest=Authorize) |
| ConfigController | `/api/config` | GET=public, PUT=superadmin |
| EventsController | `/api/events` | GET=public, mutate=superadmin+eventadmin |
| RegistrationsController | `/api/registrations` | GET/:id=public, POST=public, admin ops=superadmin+eventadmin |
| PaymentController | `/api/Payment` | All public (no Authorize attribute) |
| StripeWebhookController | `/api/webhooks/stripe` | AllowAnonymous |
| FixturesController | `/api/fixtures` | superadmin+eventadmin |
| SbaController | `/api/sba` | GET=public, POST import=superadmin+eventadmin |
| UploadsController | `/api/uploads` | No auth on endpoint (token optional via `authHeader()` in frontend) |
| UsersController | `/api/admin/users` | superadmin only |
| AdminPaymentReconciliationController | `/api/admin/payment-reconciliation` | superadmin+eventadmin |

**Services:**
- `AuthService` — BCrypt password hash/verify, JWT generation (HS256, configurable expiry, default 8h)
- `RegistrationWorkflowService` — validates pricing, capacity, duplicates, age/gender, creates full registration graph in a DB transaction
- `PaymentFinalizationService` — idempotent session-first checkout finalisation shared by webhook and `confirm-session`
- `FixtureGenerationService` — generates bracket state JSON for knockout, group+knockout, round-robin, heats formats
- `EmailService` — SMTP confirmation email with PDF receipt attachment (System.Net.Mail)
- `ReceiptService` — QuestPDF receipt generation from DB data and SystemConfig branding
- `BackgroundJobQueue` / `BackgroundJobWorker` — in-memory queue for fire-and-forget receipt+email jobs
- `PaymentCleanupWorker` — hosted service, runs hourly, prunes expired `PendingCheckouts`

---

## 4. Authentication Flow

1. Admin POSTs credentials to `POST /api/auth/login`
2. Backend verifies email+password via BCrypt; loads `AdminUser` where `IsActive=true`
3. Returns `{ token, user }` — token is a signed HS256 JWT containing `sub`, `email`, `ClaimTypes.Role`, `name`, `mustChangePassword`
4. Frontend stores token in `localStorage["trs_token"]` and user in `localStorage["trs_user"]`
5. On every page load, `AuthContext` calls `GET /api/auth/me` with the stored token to validate it; if 401, token is wiped and user is redirected to `/login`
6. All admin API calls include `Authorization: Bearer <token>` via `adminHeaders()`
7. Any 401 response from any `apiFetch` call triggers immediate wipe+redirect (401 interceptor in `_base.ts`)
8. `POST /api/auth/logout` is stateless — no server-side token revocation; client discards token
9. Password change is enforced: `mustChangePassword=true` in JWT causes AdminLayout to redirect to `/admin/change-password`

**Roles:** `superadmin` (all access) and `eventadmin` (event/registration ops, cannot manage users or orphan refunds)

**No token blacklist exists.** A valid token remains valid until expiry even after password change or logout.

---

## 5. Payment Flow (Stripe)

### Session-First Flow (paid registrations — the primary flow):

```
Browser (EventDetail)
  1. User fills cart, clicks "Pay"
  2. Cart payload stored in sessionStorage
  3. POST /api/Payment/create-checkout-session
       { registrationPayload: <cart>, paymentMethod, successUrl, cancelUrl }
  4. Backend: validates+prices payload via RegistrationWorkflowService
              creates PendingCheckout row (GatewaySessionId PK)
              creates Stripe Session with flow=session_first metadata
  5. Returns { checkoutUrl, gatewaySessionId }
  6. Browser redirects to Stripe
  7a. [On success] Stripe webhooks to POST /api/webhooks/stripe
         HandleCheckoutCompleted → PaymentFinalizationService.FinalizeSessionFirstAsync()
              reads PendingCheckout, deserialises payload
              calls RegistrationWorkflowService.CreateAsync() (PaymentStatus=S)
              writes: EventRegistration, ParticipantGroups, Participants, Payment, PaymentItems
              deletes PendingCheckout row
              queues receipt generation + email
  7b. Browser returns to /payment/result?status=success
         POST /api/Payment/confirm-session { gatewaySessionId, registrationPayload }
              verifies session with Stripe (must be "paid")
              calls PaymentFinalizationService.FinalizeSessionFirstAsync()
              if webhook already ran: returns existing registrationId (idempotent)
              if CHECKOUT_CONTEXT_MISSING (webhook ran+purged PendingCheckout first):
                  returns 409 → frontend treats as alreadyProcessed=true
  8. Frontend displays receipt using GET /api/registrations/:id
```

### Free Registration Flow:
```
  1. POST /api/registrations (direct write, PaymentStatus=S, RegStatus=Confirmed)
  2. Backend queues receipt+email
  3. Frontend shows success without Stripe redirect
```

### PayNow:
- Same session-first flow; `paymentMethod=paynow` sets `PaymentMethodTypes=["paynow"]` on Stripe Session
- PayNow only available for SGD currency
- Stripe session `ExpiresAt` is set to 30 minutes from creation for PayNow

### Receipt generation:
- QuestPDF reads SystemConfig for branding (logo, app name)
- Receipt number format: `TRS-{yyyyMMdd}-{5-digit random}`
- Receipt attached to confirmation email as PDF

---

## 6. Registration Flow

1. Public user views event at `/event/:id`
2. Selects program(s) from event detail page; fills in participant details in `ParticipantFieldsForm`
3. Cart state held in component state; participant documents uploaded via `POST /api/uploads`
4. Consent shown in `ConsentModal`; user accepts
5. For paid: see payment flow above (session-first)
6. For free: `POST /api/registrations` → immediate confirmation

**Data created per registration:**
- 1 `EventRegistration` (contact info, total amount, status)
- N `ParticipantGroup` rows (one per program slot selected)
- M `Participant` rows per group (1=singles, 2=doubles, etc.)
- `ParticipantCustomFieldValue` rows for any custom fields
- 1 `Payment` row
- N `PaymentItem` rows (one per group, or one per player if `per_player` fee structure)

---

## 7. Admin vs Public User Flows

### Public user:
- Read-only access to events and programs (active only)
- Submit registrations (rate-limited: 5 req/min on payment endpoints)
- View own registration by ID (GET /api/registrations/:id — no auth check, ID-only security)
- Download receipt PDF (GET /api/registrations/:id/receipt — no auth)
- Cannot access any `/admin/*` routes (AdminLayout enforces login)

### Admin (eventadmin):
- Create/edit/delete events, programs, documents
- View all registrations with filters and pagination
- Update registration/group status
- Confirm registrations manually (cash/bank/waived/pending collection)
- Initiate refunds per payment item
- Cancel registrations with automatic Stripe refunds
- View payment reconciliation (Case A/B)
- Import SBA rankings (xlsx)
- Manage fixtures
- Export registrations to CSV (via frontend `exportCsv.ts`)
- Cannot manage users, cannot issue orphan refunds

### Admin (superadmin):
- All eventadmin capabilities
- Manage admin users (create, update, soft-delete, reset password)
- Update system config (master branding, SMTP, etc.)
- Issue orphan refunds (Case C — unmatched Stripe payments)
- Access all reconciliation operations

---

## 8. Environment Setup

**Backend config keys (appsettings.json / environment variables):**
```
ConnectionStrings:TRSConnection         — SQL Server connection string
Jwt:Secret                              — HS256 signing key (required; throws on missing)
Jwt:Issuer                              — JWT issuer claim
Jwt:Audience                            — JWT audience claim
Jwt:ExpiryHours                         — JWT TTL in hours (default: 8)
Stripe:SecretKey                        — Stripe secret API key
Stripe:WebhookSecret                    — Stripe webhook signing secret
Cors:AllowedOrigins                     — Array of allowed frontend origins
RateLimiting:WindowMinutes              — Rate limit window (default: 1)
RateLimiting:PermitLimit                — Max requests per window (default: 5)
Email:Smtp:Host                         — SMTP server hostname
Email:Smtp:Port                         — SMTP port (default: 587)
Email:Smtp:Username                     — SMTP username
Email:Smtp:Password                     — SMTP password
Email:Smtp:EnableSsl                    — TLS (default: true)
Email:FromAddress                       — Sender address
Email:FromName                          — Sender display name
```

**Frontend env vars (Vite):**
```
VITE_API_BASE_URL    — Backend base URL (e.g. https://localhost:7183)
VITE_MOCK_DELAY_MS   — Artificial API delay in ms (default: 60)
```

**Static files:** Uploads stored in `TRS_API/wwwroot/uploads/` served by `app.UseStaticFiles()`. No CDN or blob storage.

---

## 9. Known Risks / Unknowns

**Security:**
- `POST /api/uploads` has no `[Authorize]` attribute. The frontend sends a Bearer token but the backend does not enforce it. Any unauthenticated user can upload files.
- `GET /api/registrations/:id` is fully public. Anyone with a numeric registration ID can view all participant details and payment info for that registration.
- `GET /api/registrations/:id/receipt` is fully public. Same exposure as above.
- JWT has no revocation mechanism. Changing a password or deactivating an account does not invalidate existing tokens until expiry.
- Rate limiting is applied only to the `payment` endpoint group (5 req/min). No rate limit on registration creation, uploads, or public event reads.
- CORS `AllowCredentials()` is set alongside `AllowAnyHeader/AllowAnyMethod` — overly permissive for production.

**Architecture:**
- `EventParticipant` table exists (legacy junction) alongside the newer `Participant` → `ParticipantGroup` model. `EventParticipant` rows are never created by current code paths (confirmed from controller and workflow code). It is a dead table.
- Uploaded files are stored on local disk (`wwwroot/uploads/`). This is not compatible with multi-instance deployment or container restarts without a persistent volume.
- Email sending is synchronous inside the background job worker. SMTP failure silently swallows errors (logged only).
- `ConfirmSessionRequest` includes a `RegistrationPayload` field but the backend's `confirm-session` endpoint ignores it — the payload is read from `PendingCheckout` in DB, not from the request. The frontend still sends it (harmless but misleading).
- Receipt number generation uses `Random.Shared.Next()` — possible collision if two receipts are generated in the same millisecond.
- The `TRSDbContext` `Class1.cs` file in `TRS_Data` is an empty placeholder with no content.

**[UNKNOWN]:**
- Whether migration scripts are up to date with all model changes (no migration files present in the zip)
- Whether `appsettings.Production.json` or secrets management is in place
- Whether the QuestPDF license is configured (Community vs Commercial)
- Whether Stripe webhook endpoint URL has been registered in the Stripe dashboard
- Deployment target (IIS, Docker, Azure App Service — no Dockerfile or deployment config present)
