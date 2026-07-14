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
| GET | `/api/events?includeInactive=` | Public/admin-aware | List events. Public users only receive active events with at least one active program. |
| GET | `/api/events/{id}` | Public/admin-aware | Load event detail with programs, fields, gallery, documents. Public users cannot load active events that have no active programs. |
| POST | `/api/events` | `superadmin,eventadmin` | Create event and write admin audit log. |
| PUT | `/api/events/{id}` | `superadmin,eventadmin` | Update event, replace gallery images, and write admin audit log. |
| PATCH | `/api/events/{id}/registration-status` | `superadmin,eventadmin` | Set stored registration status to short code `O`, `PA`, or `CL`; rejects draft events with `EVENT_DRAFT`; writes admin audit log. |
| DELETE | `/api/events/{id}` | `superadmin,eventadmin` | Soft delete event and write admin audit log; blocked when registrations exist. |
| GET | `/api/events/{id}/documents` | Public | List event documents for active event. |
| POST | `/api/events/{id}/documents` | `superadmin,eventadmin` | Add event document. |
| PUT | `/api/events/{id}/documents/{did}` | `superadmin,eventadmin` | Update event document. |
| DELETE | `/api/events/{id}/documents/{did}` | `superadmin,eventadmin` | Delete event document row. |
| POST | `/api/events/{id}/programs` | `superadmin,eventadmin` | Add program and write admin audit log. |
| PUT | `/api/events/{eid}/programs/{pid}` | `superadmin,eventadmin` | Update program and replace custom fields when safe; write admin audit log. |
| PATCH | `/api/events/{eid}/programs/{pid}/status` | `superadmin,eventadmin` | Set program status to short code `O` or `CL` and write admin audit log. |
| DELETE | `/api/events/{eid}/programs/{pid}` | `superadmin,eventadmin` | Soft delete program and write admin audit log; blocked when active participant groups exist. |

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
| GET | `/api/registrations/export` | `superadmin,eventadmin` | Export matching registrations without pagination. |
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
| POST | `/api/Payment/embedded-attempt/{attemptId}/submit` | Public, rate-limited | Mark an embedded attempt submitted before frontend confirms payment. |
| POST | `/api/Payment/embedded-attempt/{attemptId}/abandon` | Public, rate-limited | Mark an embedded attempt abandoned/cancelled. |
| GET | `/api/Payment/embedded-attempt/{attemptId}/status` | Public, rate-limited | Return attempt status for modal polling. |
| POST | `/api/Payment/create-checkout-session` | Public, rate-limited | Legacy hosted Stripe Checkout Session creation. |
| POST | `/api/Payment/confirm-session` | Public, rate-limited | Legacy hosted Checkout session confirmation/finalization. |
| GET | `/api/Payment/verify/{paymentId}` | Public | Return payment details by payment id. |

Rate limiter policy name is `payment`. Embedded attempts use `PaymentAttempts`; legacy hosted Checkout finalization reads the stored payload from `PendingCheckouts`.

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
| POST | `/api/fixtures/{eventId}/{programId}` | Save/upsert fixture state. |
| DELETE | `/api/fixtures/{eventId}/{programId}` | Delete fixture row. |

## SBA: `/api/sba`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/sba/types` | Public | Return supported ranking type definitions. |
| GET | `/api/sba/rankings?type=` | Public | List rankings, optionally by type. |
| GET | `/api/sba/members/{sbaId}?type=` | Public | Lookup member by SBA id. |
| GET | `/api/sba/members?name=&type=` | Public | Search members by name. |
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
