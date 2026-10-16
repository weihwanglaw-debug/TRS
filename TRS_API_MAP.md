# TRS_API_MAP.md

This document maps the current backend API from controller attributes. JSON responses use camelCase.

## Auth: `/api/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Admin login; returns JWT and user data. |
| POST | `/api/auth/logout` | Public | Stateless logout response; client discards token. |
| GET | `/api/auth/me` | Any authenticated admin | Return current user from JWT/user table. |
| POST | `/api/auth/change-password` | Any authenticated admin | Change own password and clear `MustChangePassword`. |

## Config: `/api/config`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/config` | Public | Return `SystemConfig` as key/value dictionary. |
| PUT | `/api/config` | `superadmin` | Bulk upsert config values. |

## Events: `/api/events`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/events?includeInactive=&publicArchive=` | Public/admin-aware | List events. Public users only receive active events with at least one active program; `publicArchive` is retained for compatibility and no longer excludes paused events. Event responses include `isActive` and computed registration status. |
| GET | `/api/events/{id}` | Public/admin-aware | Load event detail with programs, fields, gallery, documents. Public users cannot load active events that have no active programs. |
| POST | `/api/events` | `superadmin,eventadmin` | Create event, including optional restricted SBA players, and write admin audit log. |
| PUT | `/api/events/{id}` | `superadmin,eventadmin` | Atomically update event/restricted SBA players, replace gallery images, and write admin audit log; newly restricted players are checked against active registrations and payment contexts. |
| GET | `/api/events/{id}/restricted-sba-players` | `superadmin,eventadmin` | Return the event's admin-only restricted SBA player list. |
| PATCH | `/api/events/{id}/registration-status` | `superadmin,eventadmin` | Set stored registration status to short code `O`, `PA`, or `CL`; rejects draft events with `EVENT_DRAFT`; writes admin audit log. |
| DELETE | `/api/events/{id}` | `superadmin,eventadmin` | Soft delete event and write admin audit log; blocked when registrations exist. |
| GET | `/api/events/{id}/documents` | Public | List event documents for active event. |
| POST | `/api/events/{id}/documents` | `superadmin,eventadmin` | Add event document. |
| PUT | `/api/events/{id}/documents/{did}` | `superadmin,eventadmin` | Update event document. |
| DELETE | `/api/events/{id}/documents/{did}` | `superadmin,eventadmin` | Delete event document row. |
| POST | `/api/events/{id}/programs` | `superadmin,eventadmin` | Add program and write admin audit log. |
| PUT | `/api/events/{eid}/programs/{pid}` | `superadmin,eventadmin` | Update program and replace custom fields when safe; write admin audit log. |
| PATCH | `/api/events/{eid}/programs/{pid}/status` | `superadmin,eventadmin` | Set program status to short code `O` or `CL` and write admin audit log. Reopening returns `409 PROGRAM_FIXTURE_EXISTS` while a fixture exists. |
| DELETE | `/api/events/{eid}/programs/{pid}` | `superadmin,eventadmin` | Soft delete program and write admin audit log; blocked when active participant groups exist. |

## Program Import: `/api/events/{eventId}/programs/{programId}/import`

All endpoints require `superadmin,eventadmin`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/events/{eventId}/programs/{programId}/import/preview` | Upload a program import `.xlsx`, validate all rows as one admin-assisted registration, and return an import token plus aggregate errors/warnings. |
| POST | `/api/events/{eventId}/programs/{programId}/import/confirm` | Confirm a previously previewed import with one payment status/method/note for the whole registration; creates the registration without sending confirmation email. |

## Badminton Clubs: `/api/clubs`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/clubs?search=` | Public | List active clubs ordered by name; optional name search. |
| GET | `/api/clubs/{id}` | Public | Load active club by id. |
| POST | `/api/clubs` | `superadmin,eventadmin` | Create active club and write admin audit log. |
| PUT | `/api/clubs/{id}` | `superadmin,eventadmin` | Update active club and write admin audit log. |
| DELETE | `/api/clubs/{id}` | `superadmin,eventadmin` | Soft delete club and write admin audit log. |

EF maps this feature to SQL table `BadmintonClub`.

## Registrations: `/api/registrations`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/registrations` | `superadmin,eventadmin` | Paged admin list with event/program/status/payment/search filters. |
| GET | `/api/registrations/{id}` | Public | Load registration detail by id. |
| POST | `/api/registrations` | Public/admin-aware | Create direct registration, mainly free flow. Authenticated admins use admin-assisted event gating. |
| PATCH | `/api/registrations/{id}/status` | `superadmin,eventadmin` | Update registration status and cascade to groups. |
| PATCH | `/api/registrations/{id}/groups/{gid}/status` | `superadmin,eventadmin` | Update one group status. |
| PATCH | `/api/registrations/{id}/groups/{gid}/seed` | `superadmin,eventadmin` | Set/clear group seed. |
| GET | `/api/registrations/{id}/payment` | `superadmin,eventadmin` | Load payment with items. |
| GET | `/api/registrations/{id}/payment/audit` | `superadmin,eventadmin` | Load payment/refund/cancellation audit timeline. |
| PATCH | `/api/registrations/{id}/payment` | `superadmin,eventadmin` | Manual payment update. |
| GET | `/api/registrations/{id}/payment/refunds` | `superadmin,eventadmin` | List payment refunds. |
| POST | `/api/registrations/{id}/payment/refunds` | `superadmin,eventadmin` | Refund one payment item without cancelling its slot; supports system gateway refund or external refund record. |
| POST | `/api/registrations/{id}/payment/refunds/bulk` | `superadmin,eventadmin` | Refund multiple payment items without cancelling slots; returns successes plus per-item errors. |
| POST | `/api/registrations/{id}/cancel-with-refunds` | `superadmin,eventadmin` | Cancel registration scope and refund paid items where applicable. |
| POST | `/api/registrations/{id}/cancel` | `superadmin,eventadmin` | Cancel whole registration scope without forcing refund; fixture-blocked. |
| POST | `/api/registrations/{id}/groups/{groupId}/cancel` | `superadmin,eventadmin` | Cancel one entry/group; fixture-blocked. |
| POST | `/api/registrations/{id}/participants/{participantId}/cancel` | `superadmin,eventadmin` | Cancel one per-player participant when it has a player-level payment item; fixture-blocked. |
| GET | `/api/registrations/export` | `superadmin,eventadmin` | Export matching registrations without pagination; supports `eventId`, `programId`, `regStatus`, `payStatus`, and `search` filters. |
| GET | `/api/registrations/stats` | `superadmin,eventadmin` | Registration/payment dashboard stats. |
| GET | `/api/registrations/{id}/receipt` | Public | Generate/download PDF receipt. |
| GET | `/api/registrations/{id}/details-pdf` | Public | Generate/download registration details PDF. |
| PATCH | `/api/registrations/{id}/participants/{pid}` | `superadmin,eventadmin` | Update participant details and custom field values. |
| POST | `/api/registrations/{id}/confirm` | `superadmin,eventadmin` | Admin confirm registration/payment status. |
| POST | `/api/registrations/{id}/notifications/cancellation` | `superadmin,eventadmin` | Send cancellation/update notification for a registration. |

## Payment: `/api/Payment`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/Payment/get-payment-info/{registrationId}` | Public, rate-limited | Return payment status for an existing registration. |
| POST | `/api/Payment/embedded-attempt` | Public, rate-limited | Create embedded Stripe PaymentIntent attempt from registration payload. |
| POST | `/api/Payment/embedded-attempt/{attemptId}/submit` | Public, secret attempt key required, rate-limited | Mark an embedded attempt submitted before frontend confirms payment. |
| POST | `/api/Payment/embedded-attempt/{attemptId}/abandon` | Public, secret attempt key required, rate-limited | Mark an embedded attempt abandoned/cancelled. |
| GET | `/api/Payment/embedded-attempt/{attemptId}/status` | Public, secret attempt key required, rate-limited | Return attempt status for modal polling. |
| POST | `/api/Payment/create-checkout-session` | Public, rate-limited | Legacy hosted Stripe Checkout Session creation. |
| POST | `/api/Payment/confirm-session` | Public, rate-limited | Legacy hosted Checkout session confirmation/finalization. |
| GET | `/api/Payment/verify/{paymentId}` | Public | Return payment details by payment id. |

Public payment traffic uses the browser-token-partitioned `payment` and `payment-create` policies. Attempt submit/status/abandon traffic uses the secret-key-partitioned `payment-attempt` policy and requires `X-Payment-Attempt-Key`. Embedded attempts use `PaymentAttempts`; legacy hosted Checkout finalization reads the stored payload from `PendingCheckouts`.

## Stripe Webhook: `/api/webhooks/stripe`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | Public with Stripe signature verification | Process Stripe events. |

Handled events:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.processing`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`

Webhook processing writes `WebhookLogs`. Embedded PaymentIntent events finalize through `PaymentAttemptService`; legacy hosted Checkout sessions finalize through `PaymentFinalizationService`.

## Fixtures: `/api/fixtures`

All endpoints require `superadmin,eventadmin`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/fixtures/status?programIds=1,2` | Return which program ids have fixtures. |
| GET | `/api/fixtures/{eventId}/{programId}` | Load fixture state. |
| POST | `/api/fixtures/{eventId}/{programId}/generate` | Generate fixture from config and seeds. |
| POST | `/api/fixtures/{eventId}/{programId}/swap` | Swap two entries. |
| POST | `/api/fixtures/{eventId}/{programId}/advance-to-knockout` | Advance group winners to knockout. |
| POST | `/api/fixtures/{eventId}/{programId}/advance-round` | Advance knockout round. |
| PATCH | `/api/fixtures/{eventId}/{programId}/score/{matchId}` | Save match score/result. |
| PATCH | `/api/fixtures/{eventId}/{programId}/schedule/{matchId}` | Save match schedule. |
| PATCH | `/api/fixtures/{eventId}/{programId}/heats/result` | Save heats result. |
| POST | `/api/fixtures/{eventId}/{programId}/heats/advance` | Advance heats participants. |
| POST | `/api/fixtures/{eventId}/{programId}/heats/places` | Save heats final places. |
| POST | `/api/fixtures/{eventId}/{programId}` | Save/upsert fixture state and close the affected program. |
| DELETE | `/api/fixtures/{eventId}/{programId}` | Delete fixture row. |

## SBA: `/api/sba`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/sba/types` | Public | Return supported ranking type definitions. |
| GET | `/api/sba/rankings?type=` | Public | List rankings, optionally by type. |
| GET | `/api/sba/members/{sbaId}?type=` | Public | Lookup member by SBA id. |
| GET | `/api/sba/members?name=&type=` | Public | Search members by name. |
| GET | `/api/sba/admin/members?query=` | `superadmin,eventadmin` | Search distinct SBA players by member ID or name for event restriction selection. |
| POST | `/api/sba/import` | `superadmin,eventadmin` | Replace rankings from uploaded `.xlsx`, append new club names to `BadmintonClub`, and write admin audit logs. |

`POST /api/sba/import` response includes `importedRows`, `categories`, `addedClubs`, `addedClubNames`, and `skippedSheets`.

## Uploads: `/api/uploads`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/uploads` | Public at controller level | Upload file to local `wwwroot/uploads`. |

Allowed types and limits:

- `image/jpeg`, `image/png`, `image/webp`: 5 MB.
- `application/pdf`: 10 MB.

The frontend may send an auth header, but the controller does not require authorization.

## Admin Users: `/api/admin/users`

All endpoints require `superadmin`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/users` | List active admin users. |
| POST | `/api/admin/users` | Create admin user. |
| PUT | `/api/admin/users/{id}` | Update admin user. |
| DELETE | `/api/admin/users/{id}?currentUserId=` | Soft delete admin user; blocks self-delete. |
| POST | `/api/admin/users/{id}/reset-password` | Reset password and force change. |

## Payment Reconciliation: `/api/admin/payment-reconciliation`

Controller-level auth is `superadmin,eventadmin`; orphan refund endpoint is narrowed to `superadmin`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/payment-reconciliation/stats` | `superadmin,eventadmin` | Count reconciliation cases. |
| GET | `/api/admin/payment-reconciliation/webhook-failures` | `superadmin,eventadmin` | List unresolved failed paid checkout rows. |
| GET | `/api/admin/payment-reconciliation/refund-history` | `superadmin,eventadmin` | List orphan refund history. |
| PATCH | `/api/admin/payment-reconciliation/webhook-failures/{webhookLogId}/reviewed` | `superadmin,eventadmin` | Mark a webhook discrepancy reviewed without creating a refund row. |
| POST | `/api/admin/payment-reconciliation/webhook-failures/{webhookLogId}/external-refund` | `superadmin,eventadmin` | Record an externally completed orphan refund with method/reference/note. |
| POST | `/api/admin/payment-reconciliation/webhook-failures/{webhookLogId}/refund` | `superadmin` | Issue internal system refund for an orphan gateway payment. |

## Frontend/API Mismatches and Notes

- Status fields are short codes in API payloads and responses. Frontend UI must map codes to long display labels.
- Frontend event filters may include fields not handled by `GET /api/events`; backend currently supports `includeInactive`.
- Uploads are public despite frontend auth headers.
- Registration detail and receipt endpoints are public and id-based.
- `GET /api/Payment/get-payment-info/{registrationId}` and `GET /api/Payment/verify/{paymentId}` exist but are not central to the current embedded payment frontend flow.
- `ConfirmSessionRequest.registrationPayload` is required but not used for finalization logic.

## Payment gateway configuration (2026-10-08)

- `GET /api/admin/payment-gateway-config` (superadmin): `{ activeGateway, version, gateways: [{ code, displayName, selectable, unavailableReason }] }`. No credentials. Availability is local readiness, not a network health probe.
- `PUT /api/admin/payment-gateway-config` (superadmin): `{ gatewayCode, expectedVersion }`; returns the same configuration shape. Invalid/unavailable codes: 400; stale version: 409; missing seeded setting: 503. Role enforcement returns 401/403 as appropriate. Selection and old/new audit commit atomically.
- `PUT /api/config` continues handling other master settings, but rejects any batch containing `activePaymentGateway`; callers must use the dedicated endpoint for that key.
- Existing payment/refund public contracts are unchanged. Apply `20261008_payment_gateway_configuration.sql` before running the updated API; SQL execution is a separate approved step.

## Hosted gateway checkout additions (2026-10-08)

- POST /api/Payment/embedded-attempt retains its route and Stripe fields. Adds paymentGateway, checkoutMode (embedded/hosted), and hostedCheckout ({ url, fields }) for hosted providers. Fiuu uses an empty clientSecret and null publishableKey. Already-confirmed responses retain their existing shape.
- POST /api/Payment/embedded-attempt/{id}/recover requires X-Payment-Attempt-Key; missing/wrong keys return 404. It queries the original hosted provider without initiating payment, then returns the existing status shape. Two calls/minute per token; routine GET status polling still reads only the database.
- POST /api/webhooks/fiuu accepts bounded form data. Invalid signatures/identities/duplicate fields are rejected. Verified provider state is deduplicated and processed before IPN acknowledgement. Provider/database/ACK failures return 503 for retry; no success is inferred from transport errors.
- POST /api/webhooks/fiuu/return handles the browser form return and sends a 303 to the configured TRS /payment/result?gatewayReturn=1&attempt=...&event=... route. URLs contain neither an attempt access key nor an authoritative success flag.
- Apply 20261008_hosted_gateway_references.sql before this code runs. Fiuu remains unavailable in gateway selection; these endpoints are not evidence of completed refund integration or live readiness.

Hosted and existing attempt status responses also include eventId, allowing cart cleanup to use server-owned event identity rather than an untrusted return query parameter.


## Fiuu refund integration (2026-10-08)

- POST /api/webhooks/fiuu/refund accepts bounded form or JSON fields, authenticates the Fiuu refund signature and matches the saved merchant request/transaction/amount. Returns 200 OK only after durable processing (including duplicate/no-change outcomes); malformed or unverifiable input returns 400, transient processing failures return 503. This endpoint does not use admin JWT authentication; the provider signature is required.
- Existing registration refund/cancel and orphan refund routes/payloads are unchanged. They now pass an internal local refund ID to the original provider adapter. Uncertain Fiuu submissions stay P; retries and background recovery query the original RefID. Provider rejection remains an error in the existing response flow.
- Failed refund.updated records are included in reconciliation stats/list/review; list responses map them to the existing charge.refunded discriminator so the current screen shows Mark Reviewed. Automatic/external orphan refund actions reject these review-only rows.
- Apply 20261008_gateway_refund_tracking.sql before starting this version. This phase does not make Fiuu selectable; sandbox acceptance and merchant configuration remain required.


## Gateway payment methods and local Fiuu testing (2026-10-08)

GET /api/Payment/methods?currency=SGD is public and returns { paymentGateway, methods: ["card", "paynow"] } for the selectable active gateway, with Cache-Control: no-store. Unavailable configuration returns the existing gateway error/status rather than assuming Stripe. It exposes no credentials. Each adapter supplies supported methods for the currency; unimplemented capabilities default to no methods.

New embedded attempts reject unknown/unsupported methods with PAYMENT_METHOD_UNAVAILABLE before creating the new attempt/provider checkout. Existing attempts continue through their saved provider. Fiuu requires a configured card channel only for CreditCard; PayNow works independently. Fiuu selection additionally requires ASPNETCORE_ENVIRONMENT=Development, Fiuu:EnableSandboxCheckout=true, valid sandbox credentials/public origins, and an enabled catalog row. Production/Staging remain blocked. Existing payment/refund routes retain their contracts.

## Fiuu default hosted selection (2026-10-09)

With `Fiuu:UseHostedMethodSelection=true` (default), GET `/api/Payment/methods?currency=SGD` returns `methods: ["hosted"]` for active Fiuu. POST `/api/Payment/embedded-attempt` accepts `paymentMethod: "hosted"` only when advertised by the selected adapter. The existing hosted response/form contract is unchanged; its fields omit `channel`. Deploy the frontend and backend together so clients understand the added method value. Stripe continues advertising card/paynow. Verified Fiuu success updates the attempt method before registration/payment creation.

## Registration refund error details (2026-10-09)

Existing refund/cancellation error fields retain their shape. Their message now contains labeled gateway code and verbatim gateway message, or explicitly labeled TRS fallback text if absent. Aggregated multi-item failures retain the item/program context. Audit notes retain the same details. No new endpoint or database schema is required.
