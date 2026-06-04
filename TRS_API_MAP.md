# TRS_API_MAP.md — Full API Reference
**Generated from controller source code. All endpoints verified from code.**

---

## Base URL
- Development: `https://localhost:7183`
- Production: configured via `VITE_API_BASE_URL` on frontend

All JSON responses use camelCase (configured globally in `Program.cs`).

---

## Auth Controller — `/api/auth`

### POST /api/auth/login
- **Auth:** None (public)
- **Request:** `{ email: string, password: string }`
- **Response:** `{ token: string, user: { id, email, name, role, lastLogin, mustChangePassword } }`
- **Purpose:** Admin login. Returns JWT. Stamps `LastLogin` on success.
- **Error codes:** `INVALID_CREDENTIALS` (401)

### POST /api/auth/logout
- **Auth:** None (public)
- **Request:** Empty body
- **Response:** 200 OK
- **Purpose:** Stateless — token is discarded on client. No server-side invalidation.

### GET /api/auth/me
- **Auth:** Yes (any admin role)
- **Request:** None
- **Response:** `{ id, email, name, role, lastLogin, mustChangePassword }`
- **Purpose:** Token validation and session restore on page load.
- **Error codes:** 401 if token invalid or user deactivated

### POST /api/auth/change-password
- **Auth:** Yes (any admin role)
- **Request:** `{ currentPassword: string, newPassword: string (min 8) }`
- **Response:** 200 OK
- **Purpose:** Self-service password change. Clears `MustChangePassword` flag.
- **Error codes:** `INVALID_CREDENTIALS` (400), `SAME_PASSWORD` (400)

---

## Config Controller — `/api/config`

### GET /api/config
- **Auth:** None (public)
- **Request:** None
- **Response:** `{ [key: string]: string }` — all SystemConfig rows as a flat dictionary
- **Purpose:** Returns all system config key-value pairs. Used by `LiveConfigContext` on boot.

### PUT /api/config
- **Auth:** Yes (superadmin only)
- **Request:** `{ updates: { [key: string]: string } }`
- **Response:** Updated config dictionary (same as GET)
- **Purpose:** Bulk upsert system config entries. Creates missing keys.

---

## Events Controller — `/api/events`

### GET /api/events
- **Auth:** None (public; `includeInactive=true` requires admin role or is silently ignored)
- **Query params:** `includeInactive?: boolean`
- **Response:** Array of full event objects (includes programs, gallery, documents)
- **Purpose:** List all active events. Ordered by EventStartDate desc.
- **⚠ Issue:** Returns full payload (programs + custom fields + gallery + documents) for every event. No lightweight list projection.

### GET /api/events/:id
- **Auth:** None (public; inactive events blocked for non-admins)
- **Response:** Single event object with programs, gallery, documents, participant counts
- **Purpose:** Event detail for public event page and admin edit.
- **Error codes:** `NOT_FOUND` (404)

### POST /api/events
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `UpsertEventRequest` — name, venue, dates, sportType, fixtureMode, galleryUrls, additionalInfo (HTML), etc.
- **Response:** Created event object (same as GET /:id)
- **Purpose:** Create new event. AdditionalInfo is HTML-sanitised before storage.
- **⚠ Note:** `documents` are NOT accepted in this payload. Documents are managed via the `/documents` sub-resource separately.

### PUT /api/events/:id
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `UpsertEventRequest`
- **Response:** Updated event object
- **Purpose:** Full event update. Clears and re-creates `GalleryImages`. Does NOT touch `Documents` or `Programs`.
- **⚠ Note:** `gallery` is replaced on every PUT (all old images deleted, new ones written). Documents and Programs are NOT affected by this endpoint.

### DELETE /api/events/:id
- **Auth:** Yes (superadmin, eventadmin)
- **Response:** 200 OK
- **Purpose:** Soft delete (sets `IsActive=false`).

---

## Events / Programs Sub-resource — `/api/events/:id/programs`

### POST /api/events/:id/programs
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `UpsertProgramRequest` — name, type, minAge, maxAge, gender, fee, feeStructure, fields, customFields
- **Response:** Created program object
- **Purpose:** Add program to event.

### PUT /api/events/:eid/programs/:pid
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `UpsertProgramRequest`
- **Response:** Updated program object
- **Purpose:** Full program update. CustomFields are REPLACED (old cleared, new written).

### PATCH /api/events/:eid/programs/:pid/status
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ status: "open" | "closed" }`
- **Response:** `{ programId, status }`
- **Purpose:** Open or close a program for registration.
- **Error codes:** `INVALID_STATUS` (400)

### DELETE /api/events/:eid/programs/:pid
- **Auth:** Yes (superadmin, eventadmin)
- **Response:** 200 OK
- **Purpose:** Soft delete program (`IsActive=false`).

---

## Events / Documents Sub-resource — `/api/events/:id/documents`

### GET /api/events/:id/documents
- **Auth:** None (public, but checks event `IsActive=true`)
- **Response:** Array of `{ id, label, fileUrl, displayOrder }` ordered by displayOrder
- **Purpose:** List downloadable documents for an event.
- **Note:** Documents are also embedded in `GET /api/events/:id` response. This endpoint is a standalone alternative.
- **Error codes:** `NOT_FOUND` (404) if event inactive or not found

### POST /api/events/:id/documents
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ label: string, fileUrl: string, displayOrder?: number }`
- **Response:** Created document `{ id, label, fileUrl, displayOrder }`
- **Purpose:** Add downloadable document to event.
- **Error codes:** `LABEL_REQUIRED` (400), `FILEURL_REQUIRED` (400)

### PUT /api/events/:id/documents/:did
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ label: string, fileUrl: string, displayOrder?: number }`
- **Response:** Updated document
- **Purpose:** Update document label, file URL, or display order.
- **Error codes:** `NOT_FOUND` (404)

### DELETE /api/events/:id/documents/:did
- **Auth:** Yes (superadmin, eventadmin)
- **Response:** 200 OK
- **Purpose:** Hard delete a document record. File on disk is NOT deleted.

---

## Registrations Controller — `/api/registrations`

### GET /api/registrations
- **Auth:** Yes (superadmin, eventadmin)
- **Query params:** `eventId?, programId?, regStatus?, payStatus?, search?, page?, pageSize?`
- **Response:** `{ items: Registration[], total, page, pageSize, totalPages }`
- **Purpose:** Paged admin list of registrations. Search covers ContactName, ContactEmail, ReceiptNumber. Default page size: 50.
- **Note:** `payStatus` accepts long-form values (`"Success"`, `"Pending"`) which are translated to DB short codes internally.

### GET /api/registrations/:id
- **Auth:** None (public — ID-only security)
- **Response:** Full registration object with groups, participants, payment, items
- **Purpose:** Public receipt lookup after payment. Used by PaymentResult page.
- **⚠ Security:** No auth. Any user with the integer ID can read full participant data for any registration.

### POST /api/registrations
- **Auth:** None (public, rate-limited: 5 req/min)
- **Request:** `CreateRegistrationRequest` — eventId, contactName/email/phone, groups, participants, payment info
- **Response:** Created registration object
- **Purpose:** Direct registration write (used for free registrations). For paid registrations, this is bypassed in favour of the session-first payment flow.
- **Error codes:** `EVENT_NOT_FOUND` (404), `PROGRAM_NOT_FOUND` (404), `EVENT_CLOSED`, `PROGRAM_CLOSED`, `PROGRAM_FULL`, `DUPLICATE_REGISTRATION`, `INVALID_AGE`, `INVALID_GENDER`, `PRICE_MISMATCH`, `MISSING_REQUIRED_FIELD`, `INVALID_PARTICIPANT_COUNT` (all 400)

### PATCH /api/registrations/:id/status
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ status: "Pending"|"Confirmed"|"Cancelled"|"CancelPending"|"RefundFailed" }`
- **Response:** Updated registration
- **Purpose:** Admin status override. Cascades to all ParticipantGroups.
- **Error codes:** `INVALID_STATUS` (400), `NOT_FOUND` (404)

### PATCH /api/registrations/:id/groups/:gid/status
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ status: string }`
- **Response:** Updated registration
- **Purpose:** Update status of a single ParticipantGroup.

### PATCH /api/registrations/:id/groups/:gid/seed
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ seed: number | null }`
- **Response:** Updated registration
- **Purpose:** Assign or clear seeding number for a group (used by fixture wizard).

### PATCH /api/registrations/:id/participants/:pid
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `UpdateParticipantRequest` — any/all of: fullName, dob, gender, nationality, clubSchoolCompany, email, contactNumber, tshirtSize, sbaId, guardianName, guardianContact, remark, documentUrl, customFieldValues
- **Response:** Updated registration
- **Purpose:** Admin edit of individual participant details. Re-runs duplicate check if name/dob changed.
- **Error codes:** `NOT_FOUND` (404), `DUPLICATE_PARTICIPANT` (409)

### GET /api/registrations/:id/payment
- **Auth:** Yes (superadmin, eventadmin)
- **Response:** Payment object with items
- **Purpose:** Load payment details for admin payment panel.
- **Error codes:** `NOT_FOUND` (404)

### PATCH /api/registrations/:id/payment
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ paymentStatus?, method?, receiptNo?, adminNote? }`
- **Response:** Updated registration
- **Purpose:** Manual payment status update. Enforces `CanAdminSetPaymentStatus` transition rules.
- **Error codes:** `NOT_FOUND` (404), `INVALID_TRANSITION` (409)

### POST /api/registrations/:id/confirm
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ paymentStatus: "S"|"W"|"PC", method?, paymentReference?, adminNote (required, min 3) }`
- **Response:** Updated registration
- **Purpose:** Admin confirms registration (cash/manual/waived). Creates Payment if none exists.
- **Error codes:** `INVALID_STATUS` (400), `NOT_FOUND` (404), `INVALID_TRANSITION` (409)

### GET /api/registrations/:id/payment/refunds
- **Auth:** Yes (superadmin, eventadmin)
- **Response:** Array of Refund objects
- **Purpose:** List all refunds for a registration's payment.

### POST /api/registrations/:id/payment/refunds
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ paymentItemId: number, refundAmount: number, refundReason?: string }`
- **Response:** `{ id, refundStatus, refundAmount, gatewayRefundId }`
- **Purpose:** Initiate Stripe refund on a specific PaymentItem.
- **Error codes:** `NOT_FOUND` (404), `ALREADY_REFUNDED`, `INVALID_STATE`, `OVER_REFUND`, `REFUND_IN_PROGRESS`, `REFUND_FAILED` (400/502)

### POST /api/registrations/:id/cancel-with-refunds
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** `{ reason: string (required) }`
- **Response:** `{ registration: Registration, errors: string[] }`
- **Purpose:** Cancel registration and attempt Stripe refund on all paid items. Returns partial success if some refunds fail.
- **Error codes:** `REASON_REQUIRED` (400), `NOT_FOUND` (404)

### GET /api/registrations/:id/receipt
- **Auth:** None (public)
- **Response:** PDF file (`application/pdf`)
- **Purpose:** Download registration receipt.
- **⚠ Security:** No auth. Any user with integer ID can download any receipt.
- **Error codes:** `NOT_FOUND` (404), `RECEIPT_ERROR` (500)

### GET /api/registrations/export
- **Auth:** Yes (superadmin, eventadmin)
- **Query params:** `eventId?, programId?`
- **Response:** Array of full Registration objects (no pagination)
- **Purpose:** Raw data for CSV export.
- **⚠ Issue:** No pagination. Returns all matching records in one response.

### GET /api/registrations/stats
- **Auth:** Yes (superadmin, eventadmin)
- **Query params:** `eventId?`
- **Response:** `{ totalRegistrations, confirmed, pending, cancelled, totalRevenue, pendingPayments }`
- **Purpose:** Aggregate stats for Dashboard.

---

## Payment Controller — `/api/Payment`

### POST /api/Payment/create-checkout-session
- **Auth:** None (public, rate-limited: 5 req/min)
- **Request (session-first paid flow):** `{ registrationPayload: object, paymentMethod: "card"|"paynow", successUrl?, cancelUrl? }`
- **Request (legacy free flow):** `{ registrationId: number, paymentMethod: "card"|"paynow", successUrl?, cancelUrl? }`
- **Response:** `{ checkoutUrl, gatewaySessionId, paymentMethod, expiresAt }`
- **Purpose:** Create Stripe checkout session. Session-first: validates payload, creates PendingCheckout, returns Stripe URL. Legacy: uses existing registration ID.
- **PayNow constraint:** Only SGD currency accepted.
- **Session reuse:** If an active identical PendingCheckout exists (same eventId, contactEmail, method, amount+payload hash), reuses existing session.
- **Error codes:** Various Stripe errors (500/400)

### POST /api/Payment/confirm-session
- **Auth:** None (public, rate-limited: 5 req/min)
- **Request:** `{ gatewaySessionId: string, registrationPayload: object }`  
  **Note:** `registrationPayload` in request is ignored by backend — only `gatewaySessionId` is used.
- **Response:** `{ registrationId: string }`
- **Purpose:** Called by browser after Stripe redirect. Verifies payment with Stripe (10s timeout), finalises registration.
- **Error codes:** `CHECKOUT_CONTEXT_MISSING` (409 — webhook beat browser; treat as success), `NOT_FOUND` (404), `INVALID_TRANSITION` etc. (400)

### GET /api/Payment/get-payment-info/:registrationId
- **Auth:** None (public, rate-limited)
- **Response:** `{ registrationId, amount, currency, registrationStatus, isPaid, message? }`
- **Purpose:** Check payment status for a pending registration.
- **⚠ Frontend usage:** Not called from any visible frontend API module. [POSSIBLE DEAD ENDPOINT]

### GET /api/Payment/verify/:paymentId
- **Auth:** None (public)
- **Response:** `{ paymentId, registrationId, amount, currency, status, method, paidAt, receiptNumber, gatewayPaymentId }`
- **Purpose:** Verify a specific payment record by PaymentId (not RegistrationId).
- **⚠ Frontend usage:** Not called from any visible frontend API module. [POSSIBLE DEAD ENDPOINT]

---

## Stripe Webhook Controller — `/api/webhooks/stripe`

### POST /api/webhooks/stripe
- **Auth:** AllowAnonymous (Stripe signature verified via `Stripe:WebhookSecret`)
- **Request:** Raw Stripe webhook payload (signature in header `Stripe-Signature`)
- **Response:** 200 OK always (Stripe requires 200 to stop retrying)
- **Purpose:** Handles three event types:
  - `checkout.session.completed` → `FinalizeSessionFirstAsync()` (session-first) or legacy registration confirmation
  - `checkout.session.expired` → purge PendingCheckout row (session-first) or mark legacy payment Cancelled
  - `charge.refunded` → update Refund + PaymentItem + Payment status from Stripe refund outcome
- **Deduplication:** Checks `WebhookLogs` for `GatewayEventId` with `ProcessingStatus=S or I` before processing.
- **⚠ Note:** Returns 500 only on catastrophic unhandled exceptions; all business failures return 200 and log to WebhookLogs as `ProcessingStatus=F`.

---

## Fixtures Controller — `/api/fixtures`

All endpoints require auth: **superadmin or eventadmin**.

### GET /api/fixtures/status
- **Query params:** `programIds: comma-separated integers`
- **Response:** `{ [programId: string]: boolean }` — true if fixture exists
- **Purpose:** Check which programs have fixtures generated.

### GET /api/fixtures/:eventId/:programId
- **Response:** `{ eventId, programId, fixtureMode, fixtureFormat, isLocked, phase, bracketStateJson, updatedAt }` or `{ fixture: null }`
- **Purpose:** Load fixture bracket state.

### POST /api/fixtures/:eventId/:programId/generate
- **Request:** `{ config: FixtureConfigRequest, seeds: FixtureSeedEntryRequest[], previewBracketJson? }`
- **Response:** Generated bracket state
- **Purpose:** Generate new fixture from registered entries.

### POST /api/fixtures/:eventId/:programId/swap
- **Request:** `{ idA: string, idB: string }`
- **Response:** Updated bracket state
- **Purpose:** Swap two team/player positions in bracket.

### POST /api/fixtures/:eventId/:programId/advance-to-knockout
- **Response:** Updated bracket state
- **Purpose:** Advance group stage winners to knockout bracket.

### POST /api/fixtures/:eventId/:programId/advance-round
- **Response:** Updated bracket state
- **Purpose:** Advance to next knockout round.

### PATCH /api/fixtures/:eventId/:programId/score/:matchId
- **Request:** `{ games: [{p1, p2}][], winner?, walkover?, walkoverWinner?, officials? }`
- **Response:** Updated bracket state
- **Purpose:** Record match result.

### PATCH /api/fixtures/:eventId/:programId/schedule/:matchId
- **Request:** `{ courtNo, matchDate, startTime, endTime }`
- **Response:** Updated bracket state
- **Purpose:** Update match schedule.

### PATCH /api/fixtures/:eventId/:programId/heats/result
- **Request:** `{ roundNumber, teamId, result }`
- **Response:** Updated bracket state
- **Purpose:** Record heats format result.

### POST /api/fixtures/:eventId/:programId/heats/advance
- **Request:** `{ fromRound, advancingIds }`
- **Response:** Updated bracket state
- **Purpose:** Advance participants in heats format.

### POST /api/fixtures/:eventId/:programId/heats/places
- **Request:** `{ places: { [teamId: string]: number } }`
- **Response:** Updated bracket state
- **Purpose:** Assign final places in heats format.

### POST /api/fixtures/:eventId/:programId
- **Request:** `{ bracketStateJson, fixtureFormat?, phase?, isLocked }`
- **Response:** `{ eventId, programId, fixtureFormat, isLocked, phase }`
- **Purpose:** Save/upsert fixture state (used after wizard and manual edits).

### DELETE /api/fixtures/:eventId/:programId
- **Response:** 200 OK
- **Purpose:** Hard delete fixture record.

---

## SBA Controller — `/api/sba`

### GET /api/sba/types
- **Auth:** None (public)
- **Response:** Array of `{ value, label, players, gender, minAge, maxAge }`
- **Purpose:** Return all 35 SBA ranking type definitions.

### GET /api/sba/rankings
- **Auth:** None (public)
- **Query params:** `type?`
- **Response:** Array of SbaRanking objects ordered by type then ranking
- **Purpose:** List rankings, optionally filtered by type.

### GET /api/sba/members/:sbaId
- **Auth:** None (public)
- **Query params:** `type?`
- **Response:** `{ sbaId, name, club, dob, rankingType, ranking, accumulatedScore }`
- **Purpose:** Look up a player by SBA member ID.
- **Error codes:** `INVALID_TYPE` (400), `NOT_FOUND` (404)

### GET /api/sba/members
- **Auth:** None (public)
- **Query params:** `name?: string, type?: string`
- **Response:** Array of up to 20 SbaRanking objects matching name search
- **Purpose:** Autocomplete search for SBA members by name.
- **Note:** Returns empty array if `name` is blank. Case-sensitive `Contains()` search.

### POST /api/sba/import
- **Auth:** Yes (superadmin, eventadmin)
- **Request:** Multipart form-data with `.xlsx` file (max 20MB)
- **Response:** `{ importedRows, categories, skippedSheets }`
- **Purpose:** Replace SBA rankings from uploaded xlsx workbook.
- **Error codes:** `NO_FILE`, `INVALID_FILE`, `IMPORT_FAILED`, `NO_MATCHING_SHEETS` (400)

---

## Uploads Controller — `/api/uploads`

### POST /api/uploads
- **Auth:** ⚠ None enforced by backend (token sent by frontend but not validated)
- **Request:** Multipart form-data: `file: File, folder?: string`
- **Response:** `{ path: string }` — relative path `/uploads/<folder>/yyyy/MM/<guid><ext>`
- **Purpose:** Upload file (image or PDF) to backend wwwroot storage.
- **Allowed types:** `image/jpeg`, `image/png`, `image/webp` (max 2MB), `application/pdf` (max 8MB)
- **Folder sanitisation:** `..` stripped, leading/trailing `/` stripped
- **Error codes:** `NO_FILE` (400), `INVALID_TYPE` (400), `FILE_TOO_LARGE` (400)

---

## Users Controller — `/api/admin/users`

All endpoints require **superadmin** role.

### GET /api/admin/users
- **Response:** Array of `{ id, email, name, role, lastLogin, mustChangePassword }` (active users only)
- **Purpose:** List all active admin users.

### POST /api/admin/users
- **Request:** `{ email, name, role, password (min 8), mustChangePassword }`
- **Response:** `{ id, email, name, role }`
- **Purpose:** Create new admin user.
- **Error codes:** `EMAIL_TAKEN` (400)

### PUT /api/admin/users/:id
- **Request:** `{ name?, email?, role? }`
- **Response:** `{ id, email, name, role }`
- **Purpose:** Update admin user profile.
- **Error codes:** `NOT_FOUND` (404), `EMAIL_TAKEN` (400)

### DELETE /api/admin/users/:id
- **Query params:** `currentUserId` (to prevent self-deletion)
- **Response:** 200 OK
- **Purpose:** Soft delete admin user (`IsActive=false`).
- **Error codes:** `CANNOT_DELETE_SELF` (400), `NOT_FOUND` (404)

### POST /api/admin/users/:id/reset-password
- **Request:** `{ newPassword (min 8) }`
- **Response:** 200 OK
- **Purpose:** Admin resets another user's password. Sets `MustChangePassword=true`.

---

## Admin Payment Reconciliation Controller — `/api/admin/payment-reconciliation`

Requires **superadmin or eventadmin** for stats/list; **superadmin only** for refund.

### GET /api/admin/payment-reconciliation/stats
- **Response:** `{ caseA: number, caseB: number, caseC: number, total: number }`
- **Purpose:** Payment health dashboard counts.

### GET /api/admin/payment-reconciliation/webhook-failures
- **Response:** Array of `{ webhookLogId, gatewaySessionId, errorMessage, receivedAt, retryCount, amount, currency, contactName, contactEmail, contactPhone }`
- **Purpose:** List unresolved Case-C rows (money collected but no registration). Deduplicates by session, filters out self-healed rows.

### POST /api/admin/payment-reconciliation/webhook-failures/:webhookLogId/refund
- **Auth:** Yes (**superadmin only**)
- **Request:** `{ reason: string (required), adminNote?: string }`
- **Response:** `{ refundId, refundStatus, refundAmount, gatewayRefundId }`
- **Purpose:** Issue Stripe refund for an orphan payment (Case C). Uses `SERIALIZABLE` transaction.
- **Error codes:** `REASON_REQUIRED`, `NOT_FOUND`, `ALREADY_RESOLVED`, `NO_SESSION_ID`, `NOT_PAID`, `ZERO_AMOUNT`, `ALREADY_REFUNDED`, `REFUND_IN_PROGRESS` (400/404/409), `STRIPE_ERROR`, `REFUND_FAILED` (502)

---

## Frontend ↔ Backend Mismatches

| Issue | Detail |
|---|---|
| `GET /api/Payment/get-payment-info/:id` | Endpoint exists in backend but no frontend API function calls it. Possible dead endpoint. |
| `GET /api/Payment/verify/:paymentId` | Endpoint exists in backend but no frontend API function calls it. Possible dead endpoint. |
| `ConfirmSessionRequest.RegistrationPayload` | Frontend sends it as `[Required]` field but backend ignores the value entirely — reads from `PendingCheckout` DB row instead. |
| `apiGetEvents` query params `status`, `dateFrom`, `dateTo` | Frontend sends these but backend `GET /api/events` has no filtering by these fields — only `includeInactive` is supported. Silently ignored. |
| `apiUpdatePayment` sends `gateway` field | Frontend `UpdatePayment` patch includes `gateway` but `UpdatePaymentManualRequest` has no `Gateway` property — silently ignored. |
| Upload endpoint auth | Frontend sends `Authorization: Bearer <token>` but backend `UploadsController` has no `[Authorize]` attribute — unauthenticated uploads are accepted. |
| `GET /api/registrations/:id` | No auth — public. Frontend uses `publicHeaders()` correctly, but this exposes participant PII to anyone with a sequential integer ID. |
| `GET /api/registrations/:id/receipt` | No auth — public. Same exposure. |

---

## Missing Endpoints

| Needed | Status |
|---|---|
| PATCH /api/events/:id/active (toggle active/inactive) | Missing — only soft delete exists; no reactivation endpoint |
| GET /api/registrations/:id/receipt (admin-specific with auth) | Missing — public receipt used for both admin and public |
| POST /api/auth/refresh-token | Missing — no token refresh; users must re-login after expiry |
| DELETE /api/uploads/:path | Missing — uploaded files accumulate indefinitely; no delete endpoint |
| GET /api/admin/audit-logs | Missing — `AdminAuditLog` and `PaymentAuditLog` tables exist in DB but no read endpoints are exposed |
| GET /api/fixtures (list by event) | Missing — only GET by eventId+programId pair; no event-level listing |

---

## A. Critical Issues Found

### Security Issues

1. **`POST /api/uploads` has no authentication enforcement.**  
   The backend `UploadsController` has no `[Authorize]` attribute. Any unauthenticated client can upload arbitrary files to the server's `wwwroot/uploads/` directory. Only MIME type and file size are validated. An attacker could flood disk storage or upload content by guessing the endpoint.

2. **`GET /api/registrations/:id` is fully public with sequential integer IDs.**  
   Any person who discovers a registration ID (e.g., by guessing integers 1, 2, 3...) can read full participant names, dates of birth, emails, phone numbers, SBA IDs, and guardian details for any registration. This is a GDPR/PDPA compliance risk.

3. **`GET /api/registrations/:id/receipt` is fully public.**  
   Same exposure as above — anyone with a registration ID can download the PDF receipt which contains PII.

4. **No JWT revocation mechanism.**  
   Deactivating an admin user (`IsActive=false`) or resetting their password does not invalidate their existing JWT. The token remains valid until expiry (default 8 hours). A compromised admin account cannot be immediately locked out.

5. **CORS is configured with `AllowAnyHeader()` + `AllowAnyMethod()` + `AllowCredentials()`.**  
   The combination is overly permissive. `AllowCredentials` with wildcard headers/methods increases CSRF risk from any origin in the allowed list.

6. **Rate limiting is only on the `payment` group (5 req/min).**  
   No rate limiting on registration creation (`POST /api/registrations`), uploads, or event reads. These are all public endpoints susceptible to abuse.

7. **`Stripe:SecretKey` is set directly in `PaymentController` constructor via `StripeConfiguration.ApiKey`.**  
   This is a global static property. In a multi-threaded context with concurrent requests using different keys this could cause race conditions (though in practice a single key is used). The pattern is not ideal.

### Missing Endpoints

1. **No event reactivation endpoint.** `DELETE /api/events/:id` soft-deletes. There is no `PATCH /api/events/:id/active` to re-enable a soft-deleted event.
2. **No token refresh endpoint.** After 8-hour JWT expiry, users must re-login. No sliding session.
3. **No audit log read endpoints.** `AdminAuditLog` and `PaymentAuditLog` tables exist and are written to but there are no `GET` endpoints to read them.
4. **No upload delete endpoint.** Files accumulate indefinitely. No way to clean orphaned files.

### Broken / Degraded Flows

1. **`GET /api/Payment/get-payment-info/:id` and `GET /api/Payment/verify/:paymentId` are likely dead endpoints.** No frontend code calls them. They may be holdovers from a previous architecture.
2. **Background jobs are lost on process restart.** `BackgroundJobQueue` is in-memory. A server restart between payment confirmation and receipt/email dispatch silently drops the job. No retry or recovery.
3. **Email failures are silently swallowed.** If SMTP fails, the log shows a warning but the user never receives their receipt. No retry, no dead-letter queue.
4. **`ConfirmSessionRequest.RegistrationPayload` is `[Required]` but ignored.** The contract is misleading. Frontend must send a field that does nothing.
5. **`apiGetEvents` filter params `status`, `dateFrom`, `dateTo` are silently ignored by backend.** Frontend sends them but the backend only supports `includeInactive`. Filtering on these params from the frontend does nothing.

### Architecture Problems

1. **`EventParticipant` is a dead table.** Schema, EF model, and navigation properties exist but no code writes to it. Misleads developers about the data model.
2. **`BackgroundJob` DB table is unused.** Same issue — table and EF model exist, never written to.
3. **`EventRegistration` has two status columns (`RegStatus` string and `RegistrationStatus` char) storing the same value.** Every status change writes both. One should be removed.
4. **Uploads stored on local disk.** Incompatible with horizontal scaling or container restarts without persistent volume. No migration path to cloud storage without a rewrite.
5. **`Receipt number collision risk.** `Random.Shared.Next(10000, 99999)` within a single date produces duplicates under load. No unique constraint on `Payments.ReceiptNumber`.

---

## B. Unknown Areas

1. **EF Core migration files are absent from the zip.** Cannot verify whether the DB schema is in sync with EF models, or how schema changes are deployed.
2. **`appsettings.Production.json` and secrets management strategy** — not present. Unknown whether `Stripe:SecretKey`, `Jwt:Secret` are stored in environment variables, Azure Key Vault, or another secrets store in production.
3. **QuestPDF license type.** Community license has a header watermark; Commercial does not. Unknown which is configured.
4. **Stripe webhook endpoint registration.** Unknown whether `POST /api/webhooks/stripe` is registered in the Stripe dashboard with the correct events (`checkout.session.completed`, `checkout.session.expired`, `charge.refunded`).
5. **Deployment infrastructure.** No Dockerfile, no CI/CD config, no IIS configuration present. Unknown deployment target.
6. **`TRS_Data/Class1.cs`** — empty auto-generated placeholder file. Harmless but indicates the project was scaffolded and not cleaned up.
7. **`VITE_MOCK_DELAY_MS` production value.** If not set in production `.env`, defaults to 60ms, adding 60ms latency to every API call. Unknown if removed for production builds.
8. **Whether `AdminAuditLog` is actually written.** Code references exist in UsersController comment blocks but no direct writes observed in the controllers reviewed.

---

## C. Suggested Improvements (High-Impact Only)

1. **Add `[Authorize]` to `UploadsController`.**  
   Single-line fix. Prevents unauthenticated file uploads. High severity, trivially fixable.

2. **Add a token or HMAC to registration/receipt URLs.**  
   Replace `GET /api/registrations/:id` public access with a short-lived signed token or add a `receiptToken` field to the registration response. Prevents sequential ID enumeration of PII.

3. **Replace in-memory `BackgroundJobQueue` with a persistent queue (Hangfire or database-backed).**  
   Use the existing `BackgroundJob` DB table (already in schema) or Hangfire. Eliminates silent job loss on restart. Receipt and email delivery becomes reliable.

4. **Add email retry logic.**  
   Wrap `SmtpClient.SendMailAsync()` in a retry with exponential backoff (3 attempts). Log final failure with registration ID for manual recovery.

5. **Remove the 60ms artificial delay from every API call.**  
   Delete `await delay()` from all API module functions or gate it strictly behind `VITE_MOCK_DELAY_MS > 0` with a `0` production default. This is pure latency waste.

6. **Remove `EventRegistration.RegistrationStatus` (the single-char column).**  
   Keep `RegStatus` (the string column). Every status transition writes both redundantly. Removing the char column eliminates the dual-write and the `RegistrationStatus` mapping everywhere.

7. **Drop or migrate `EventParticipant` and `BackgroundJob` tables.**  
   Both are dead. Remove EF models, DbSets, and DB tables. Reduces cognitive overhead and avoids incorrect use in future.

8. **Add a unique constraint on `Payments.ReceiptNumber`.**  
   Prevents silent duplicate receipt numbers. Pair with a deterministic receipt number algorithm (e.g., sequence-based) rather than random.

9. **Abstract Stripe behind an interface (`IPaymentGateway`).**  
   Currently Stripe SDK is instantiated inline in three controllers. Extract to a service interface. Enables unit testing and future gateway replacement.

10. **Add lightweight event list projection.**  
    `GET /api/events` currently returns the full heavy payload for every event (programs, custom fields, gallery, documents). A `{ id, name, eventStartDate, openDate, closeDate, bannerUrl, status }` projection endpoint would be appropriate for the landing page carousel.
