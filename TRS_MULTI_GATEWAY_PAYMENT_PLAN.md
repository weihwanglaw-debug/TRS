# TRS Multi-Gateway Payment Implementation Plan

Date: 2026-10-06

Status (2026-10-08): Stripe extraction and superadmin Master Config selection are implemented. The user applied the gateway-configuration SQL locally. Fiuu sandbox hosted checkout, verified notification handling, and browser return/recovery are now implemented; Fiuu remains unavailable for selection pending refund/reconciliation integration and end-to-end verification. The NEW `20261008_hosted_gateway_references.sql` is prepared but NOT executed. Apply it before starting this application version. Deployment and gateway activation remain separate steps. Phase notes below record earlier boundaries; proposed future work is not completed functionality.

### First extraction boundary

- Added provider-neutral checkout request/result/error contracts and a Stripe adapter for creation and retrieval of client initialization data.
- Retained registration validation, database writes, idempotency-key generation, publishable-key configuration, and public response fields in their existing workflows.
- Public status polling remains a database read. Recovery/status queries were deferred in the first extraction and are covered by the second extraction below.
- No schema, frontend, Master Config, credential, or deployed-service changes.
- Added fake-client adapter tests and updated existing integration-test dependency wiring. Database integration tests and real Stripe sandbox verification remain separate validation steps.
- Fiuu's official cheatsheet describes Inpage Checkout as card-only. Embedded PayNow parity is unproven and must not be assumed. Public documentation confirms sandbox tools but does not establish evaluation access without onboarding/commercial commitment.

### Second extraction boundary

- The first phase's sandbox payment attempt 44 finalized registration 1335 with a successful `payment_intent.succeeded` webhook. The CLI must use the same test account credentials as TRS; a separately selected sandbox did not receive these events.
- Added internal normalized payment data/state contracts. Stripe SDK status strings, amount conversion, metadata extraction, and payment lookup/cancellation are contained in the Stripe adapter.
- The webhook controller verifies signatures before translation. Embedded finalization, failure/cancellation processing, and recovery accept normalized data while retaining current persisted statuses, duplicate checks, expiry handling, and registration behavior.
- Existing Stripe payload JSON is preserved for reconciliation consumers. No change to refund operations, admin reconciliation actions, legacy hosted checkout, frontend, schema, or configuration is included in this phase.
- Adapter regression tests cover state/amount mapping, missing metadata, cancellation, and provider failures. Full database-backed duplicate/delayed-event and recovery scenarios, plus a new real Stripe sandbox checkout, remain required release checks; the earlier sandbox success does not validate this second phase.
- Verification on 2026-10-07 after the user stopped the local API: normal backend build passed with zero warnings/errors; all 67 non-database backend tests passed. The database-backed `PaymentRefundIntegrationTests` suite was excluded, not executed. No deployment or real payment was performed by these checks.

### Third extraction boundary: refunds and reconciliation

- Added generic refund request/result and reconciliation lookup contracts to `IPaymentGateway`; `StripePaymentGateway` owns the SDK refund/session calls, existing two-decimal amount conversion, reason, and refund-state mapping.
- Normal refunds retain `trs_refund_{RefundId}` idempotency and registration/item metadata. Orphan refunds retain `orphan_refund_{GatewaySessionId}` and webhook/admin-note metadata.
- Embedded reconciliation lookup preserves its succeeded-only check and received-amount fallback; hosted reconciliation lookup preserves its previous session reference/amount behavior. Validation messages and existing provider-error fallback responses are preserved.
- Controllers retain validation, authorizations, pending-row persistence, serializable orphan locking, duplicate guards, audit logs, manual/external refund paths, cancellation outcomes, and API response contracts. Refund webhooks remain unchanged.
- DI and existing SQL integration-test construction now supply the injected refund/session services. Added adapter tests for partial/full amounts, pending/success/failure/unknown refund states, idempotency/metadata, both reference types, missing hosted amount, provider errors, and cancellation.
- Verification on 2026-10-07: normal backend build passed with zero warnings/errors; 87 non-database tests passed. The SQL-backed `PaymentRefundIntegrationTests` suite was excluded and no sandbox refund was submitted by these automated checks.
- Earlier manual card-payment and full-refund tests passed before this third extraction. Fresh sandbox verification remains required for the changed refund paths: full/partial refunds; refund-only versus cancellation; pending/failure outcomes; duplicate/retry protection; embedded/hosted orphan refunds and their reconciliation resolution. No need to repeat unrelated unchanged screens for this phase.
- No schema, frontend, credential, active-gateway, or deployment change. Stripe is still the only registered adapter. Gateway resolution by the stored original provider, unsupported-provider rejection, and replacement of the existing non-Stripe/manual branch belong to the separately approved selection phase before enabling another provider.
- Rollback only this extraction's adapter/controller/DI/test/documentation edits; preserve the prior checkout/finalization extraction. No database rollback is required.

### Fourth phase: gateway catalog and Master Config (2026-10-08)

- `PaymentGateways` contains stable provider codes, display names, availability for new payments, and timestamps. The reviewed SQL seeds Stripe enabled and Fiuu disabled without overwriting existing flags or settings on a rerun.
- `SystemConfig.activePaymentGateway` is non-secret. The dedicated `/api/admin/payment-gateway-config` GET/PUT endpoints require superadmin. The general config PUT rejects changes to this reserved key before saving any part of the batch, including database-collation aliases.
- Master Config displays the selector under Payment/All for superadmin only. Unavailable entries explain why they cannot be selected. No credential entry/display is included.
- Selection requires a catalog entry, enabled flag, registered adapter, and locally valid server configuration. Stripe checks matching test/live key prefixes and webhook-secret presence. This is not an account validity, channel enablement, or uptime check.
- Changes require the version returned by GET. A serializable update lock plus expected-version comparison prevents concurrent overwrites; `AdminAuditService` writes actor and old/new selection inside the same transaction. A failed audit rolls the setting back. Configuration is read on new attempts, without a process-local cache.
- `PaymentAttempts.PaymentGateway` is backfilled/defaulted to Stripe and references the catalog. EF prevents changes to the provider after insert. Existing generic Payment/Refund/Webhook gateway fields are reused; compatibility reference column names are retained.
- A new attempt snapshots the selected adapter; recovery/reuse/cancellation route by its stored provider. Normal and orphan refunds use their original provider; disabling new payments does not disable existing-provider operations. Only explicit Manual payments retain the manual-success branch. Unknown online providers fail without falling back to Stripe.
- Stripe webhook matching and embedded finalization include provider identity. Original amount/status rules and public checkout responses are preserved. Stripe remains the only implemented adapter; Fiuu cannot be activated by adding/enabling a catalog row alone.
- Legacy hosted checkout creation/confirmation and the embedded frontend presentation remain Stripe-specific. A future adapter must complete checkout capability support, provider-scoped reference/index review, and all required workflows before becoming selectable.
- SQL script: `Backend/TRS_Data/Sql/20261008_payment_gateway_configuration.sql`. It is prepared only, NOT executed. Apply during an approved maintenance step before running this version of the API; startup/background reads require the new attempt column.
- Rollback: restore this phase's application code and leave the additive schema/Stripe seed intact. Do not remove provider identity once another provider has transactions.
- Verification: frontend build and five focused UI/API tests passed. After the user stopped the API on 2026-10-08, the normal backend build passed with zero warnings/errors and all 111 non-database backend tests passed. The SQL-backed PaymentRefundIntegrationTests suite was excluded, not executed. Database-backed audit/concurrency checks remained pending at this phase; the user subsequently applied the configuration SQL locally.

## 1. Confirmed requirements

- Support Stripe and Fiuu initially, with a structure that can accommodate a third gateway without adding provider-specific database columns.
- Place the system-wide active payment gateway setting under Master Config. It applies to all events; there is no per-event selection.
- Only `superadmin` may change the gateway, enforced by the API as well as the UI.
- Switching is manual, including when Stripe is unavailable. Automatic failover is outside scope.
- Preserve participant payment and administrator refund/reconciliation workflows. Users do not choose a gateway or learn a different administrative process.
- Separate gateway-specific code from common payment and registration behavior.
- Existing payments remain associated with the gateway that originally processed them.
- Preserve registration rules, payment verification, authorization, audit logging, and short status codes.

## 2. Current code evidence

| Area | Observed implementation | Planning implication |
| --- | --- | --- |
| Public payment UI | `Frontend/src/components/registration/EmbeddedPaymentModal.tsx` directly uses Stripe Elements. | Keep the surrounding dialog and workflow; isolate its provider-specific payment body. |
| Checkout | `PaymentController.cs` and `PaymentAttemptService.cs` call Stripe and expose Stripe-oriented checkout data. | Extract provider operations while retaining shared attempt orchestration. |
| Legacy finalization | `PaymentFinalizationService.cs` accepts Stripe checkout sessions. | Preserve legacy session processing while introducing normalized finalization inputs. |
| Attempts | `PaymentAttempt` has `GatewayPaymentIntentId` but no gateway discriminator. | Persist the selected gateway and generic references at attempt creation. |
| Payments/refunds | `Payment` and `Refund` already have gateway identifiers and references. | Extend/reuse these rather than create separate provider tables for financial records. |
| Refunds | `RegistrationsController.cs` directly invokes Stripe refunds. | Dispatch using the payment's recorded gateway. |
| Reconciliation | `AdminPaymentReconciliationController.cs` directly retrieves Stripe transactions and issues Stripe refunds. | Normalize provider queries/refunds while retaining existing cases and admin actions. |
| Callbacks | `WebhookLog` stores gateway, event, checkout reference, and payload. | Review uniqueness and matching so references are scoped by gateway. |
| Legacy pending checkouts | `PendingCheckout` is keyed by a Stripe checkout session reference. | Keep outstanding legacy Stripe checkouts readable and processable during migration. |
| Master Config | `ConfigController.Update` already requires `superadmin`; its public GET returns stored configuration values. | Reuse authorization, validate gateway selection server-side, and keep credentials/private configuration out of this public store. |

This is a targeted inspection, not a completed implementation audit. Review EF mappings, indexes, full controllers, jobs, and tests before finalizing a migration or API diff.

## 3. Workflow compatibility contract

### Participant payment

1. User selects an event/program and enters the same registration details.
2. TRS applies the same validation and calculates the authoritative amount on the server.
3. User starts payment through the existing checkout action.
4. The backend records the current active gateway on a payment attempt and returns the appropriate checkout presentation data.
5. Stripe retains its embedded interface. For Fiuu, the dialog shows the same registration summary and a Continue to payment button, which submits a signed form to Fiuu's hosted page for cards or PayNow.
6. TRS waits for verified server-side payment confirmation and shows the existing success, failure, pending, or review outcome.
7. Registration confirmation and receipt behavior remain consistent. Closing the browser does not prevent verified payment processing.

The user approved hosted Fiuu checkout for both credit cards and PayNow to reduce integration complexity. Inpage is deferred unless explicitly requested later. Bank authentication, enabled card channel, SGD PayNow, and return behaviour still require merchant sandbox verification.

The checkout contract supports embedded and hosted presentation. Fiuu customers temporarily leave TRS to pay; surrounding registration, receipt, refund-request and reconciliation workflows remain consistent. Refund workflow integration is still required before Fiuu activation.

### Administrator refunds

- Keep existing entry points, permissions, amount/reason inputs, approvals where applicable, and status presentation.
- Route full and partial refunds through the original payment's gateway, regardless of today's active gateway.
- Preserve item-level accounting and registration/cancellation consequences.
- An accepted refund request is not necessarily a completed refund. Keep it pending until verified completion according to the provider's contract.
- A timeout must not trigger an unverified second refund. Query or reconcile the original request first.
- Verify required refund capabilities for Fiuu before enabling it. Do not silently substitute manual refunds for an unsupported API operation.

### Administrator reconciliation

- Retain the existing reconciliation screen, case categories, review actions, refund actions, audit trail, and access permissions.
- Include records from all supported gateways in the same workflow; expose the gateway as context and optionally a filter.
- Replace Stripe-only wording where necessary without changing the meaning of existing actions.
- Query, verify, retry processing, and refund using each record's original gateway.
- Support successful payments that have no registration/payment row, including orphan refunds and traceable provider references.
- Repeated callbacks and repeated admin actions must not duplicate registration, payment, refund, or accounting effects.

### Free and manual payments

Preserve existing free registration and authorized manual payment behavior. The active online gateway setting must not redirect these paths through a provider or assign them an inaccurate gateway.

## 4. API and service design

```text
Payment API / refund API / reconciliation API
                 |
       Shared TRS workflows
                 |
       Payment gateway resolver
          /              \
 Stripe gateway       Fiuu gateway       Future gateway

Stripe callback endpoint --> Stripe verification --> Normalized notification
Fiuu callback endpoint   --> Fiuu verification   --> Normalized notification
                                                   |
                                     Shared finalization/refund handling
```

### Responsibilities

- Controllers handle authentication, authorization, request validation, and HTTP responses.
- `PaymentAttemptService` orchestrates attempts and resolves the gateway without importing provider SDK models into shared contracts.
- `RegistrationWorkflowService` remains responsible for shared registration validation and persistence.
- `PaymentFinalizationService` owns common finalization/idempotency behavior, preserving legacy compatibility.
- A small `IPaymentGateway` interface and resolver provide checkout creation, payment lookup, supported cancellation/expiry operations, refund requests, and refund lookup. Capabilities must be explicit where operations differ.
- `StripePaymentGateway` and `FiuuPaymentGateway` encapsulate provider requests, SDK objects, signatures, provider errors, and status translation.
- Dedicated callback controllers verify the respective protocols and pass trusted normalized results into shared processing. Signature verification must use the exact request representation required by each provider.
- A shared refund service owns refund persistence and dispatch for both normal and orphan refunds, avoiding two implementations with different accounting rules.
- Cleanup and reconciliation jobs dispatch by the persisted gateway, not the active configuration.

Suggested normalized contracts: checkout result (attempt ID, presentation type, safe client initialization data, expiry), payment verification result (gateway, merchant reference, provider references, amount, currency, TRS status), refund result (local request reference, provider reference, TRS status), and verified notification (deduplication identity, event category, verified transaction data).

Provider-specific client initialization data may be carried in a clearly bounded checkout payload. Secrets must never enter that payload. Business-critical values must remain typed fields, not be hidden in arbitrary JSON.

Preserve existing public routes and response fields during transition where practical. Specify any additive contracts and frontend callers before implementation. Legacy Stripe confirmation routes must continue working for outstanding checkout sessions.

## 5. Proposed generic database structure

These are conceptual additions; exact column names, SQL types, lengths, indexes, and constraints require schema review. Use the repository's SQL script workflow, not an unplanned EF migration framework.

| Entity | Proposed treatment |
| --- | --- |
| Gateway catalog (new `PaymentGateways`) | Stable gateway code, display name, whether usable for new checkouts, and audit timestamps. Add another provider as a catalog entry plus integration code. |
| `SystemConfig` | Store only the non-secret active gateway code, such as `activePaymentGateway`. Validate against an implemented, enabled, configured gateway. Seed Stripe as the initial default. |
| `PaymentAttempt` | Add gateway code and generic merchant/checkout/payment references where required. Retain existing amount, currency, status, registration payload, access controls, and row version. |
| `Payment` | Reuse existing gateway and generic reference fields. Add only references needed for reliable matching; maintain existing payment/item accounting. |
| `Refund` | Reuse gateway/refund references. Ensure a durable merchant refund request reference and original transaction identity also work for orphan refunds. |
| `WebhookLog` | Retain provider identity, trusted event/transaction references, and processing outcome. Review event-ID assumptions and uniqueness across providers. |
| `PendingCheckout` | Keep legacy Stripe semantics during transition. New Fiuu work should use the generic attempt model rather than repurpose legacy Stripe keys. |
| Audit entities | Preserve payment status audits; use `AdminAuditService` for gateway configuration switches and admin business actions. |

### Data invariants

- An attempt's gateway is immutable after creation; completed payments/refunds inherit the correct provider identity.
- Provider references are opaque strings, never parsed based on Stripe prefixes in shared logic.
- Scope provider reference uniqueness by gateway and, if environments/accounts are co-located, merchant account/environment identity. Do not assume globally unique provider IDs.
- Local merchant order and refund request references are generated and persisted before external calls, enabling recovery after ambiguous responses.
- Use filtered uniqueness where references are nullable. Define each index against provider semantics rather than assuming one reference type fits every operation.
- Some providers may lack a stable notification event ID. Define a verified, provider-specific deduplication identity that distinguishes legitimate later status changes. Transaction ID alone is insufficient.
- Preserve monetary precision; adapters handle each provider's units and currency rules explicitly.
- Keep TRS short status codes. External statuses are translated by adapters; raw provider values may be retained only as bounded diagnostic metadata.
- Raw payloads must be redacted and access-controlled. Do not store card data, credentials, or authentication secrets.
- Do not introduce per-provider payment tables or columns such as `FiuuTransactionId` and `ThirdGatewayTransactionId`.

### Credentials and configuration

Use protected server configuration for merchant credentials and signing keys. The gateway catalog and public `/api/config` response must contain no secrets or private configuration. Prefer typed provider options in server configuration; add private non-secret provider settings only if needed, with an explicit access boundary.

Configuration readiness means required integration configuration is present and valid; it is not a guarantee of provider uptime. Disabled for new checkout must not mean disabled for callbacks, status queries, or refunds.

### Migration and rollback

1. Inventory current schema, constraints, gateway spellings/casing, pending attempts, legacy sessions, and orphan records.
2. Add catalog and nullable generic columns/indexes without dropping existing fields.
3. Backfill only records demonstrably belonging to Stripe. Preserve manual/free records and investigate ambiguous data instead of assigning it blindly.
4. Verify counts, reference mappings, uniqueness, and financial totals before tightening applicable constraints.
5. Deploy compatible application code with Stripe still active, then validate before allowing Fiuu selection.

Rollback initially disables new Fiuu attempts and returns the active gateway to Stripe if operational. Keep both integrations, callback handlers, data, and credentials available for outstanding Fiuu transactions/refunds. Do not roll back to Stripe-only application code while Fiuu obligations remain. Leave additive schema in place; destructive schema rollback requires a separate approved plan and backup.

## 6. Switching and concurrency rules

- Read and snapshot the active gateway when creating a new durable attempt. Do not resolve it again during finalization or refund.
- Reusing an idempotent attempt returns its original gateway even if configuration changed.
- A configuration switch does not cancel attempts, move charges, or resubmit payment automatically.
- Define an explicit, tested retry policy before implementation: an uncertain prior payment must not be represented as failed solely because the user selected retry or the gateway changed.
- If a prior attempt cannot be verified during an outage, retain its unresolved state and existing uncertainty/review behavior. Any policy permitting a fresh attempt despite possible duplicate payment needs explicit business approval.
- If two attempts ultimately succeed, preserve both financial facts and route the excess payment to reconciliation; never silently discard collected money or create duplicate registrations.
- Verify paid amount, currency, merchant/order identity, and registration context before finalizing. Reuse current capacity/eligibility checks and paid-but-unfulfillable reconciliation behavior.
- Gateway setting changes must be validated, saved, and audited consistently; capture old/new values, actor, and time. Address concurrent administrator updates and configuration cache invalidation.

## 7. Implementation file map

Paths below are relative to the repository root. This is the proposed implementation boundary, not approval to edit these files. Review exact changes and obtain implementation approval separately.

### Existing backend files

- `Backend/TRS_API/Controllers/ConfigController.cs`: gateway-setting validation, authorization, safe config exposure, and audit integration.
- `Backend/TRS_API/Controllers/PaymentController.cs`: common checkout/status entry points and legacy compatibility.
- `Backend/TRS_API/Controllers/StripeWebhookController.cs`: retain verification, delegate normalized outcomes.
- `Backend/TRS_API/Controllers/RegistrationsController.cs`: dispatch refunds through shared refund orchestration.
- `Backend/TRS_API/Controllers/AdminPaymentReconciliationController.cs`: remove Stripe-only transaction/refund assumptions.
- `Backend/TRS_API/Services/PaymentAttemptService.cs`: generic attempt orchestration.
- `Backend/TRS_API/Services/PaymentFinalizationService.cs`: shared verified finalization and legacy compatibility.
- `Backend/TRS_API/Services/RegistrationWorkflowService.cs`: only changes necessary to accept normalized payment information; preserve business rules.
- `Backend/TRS_API/Services/StripeRefundStatusMapper.cs`: retain provider-specific mapping behind the Stripe integration.
- `Backend/TRS_API/BackgroundJobs/PaymentCleanupWorker.cs`: provider-aware verification and cleanup.
- `Backend/TRS_API/Models/EmbeddedPaymentModels.cs`, `PaymentRequest.cs`, and `SecurePaymentRequest.cs`: review/add compatible gateway-neutral contracts where used.
- `Backend/TRS_API/Program.cs`: dependency injection and provider options registration.
- `Backend/TRS_Data/Models/PaymentAttempt.cs`, `Payment.cs`, `Refund.cs`, `WebhookLog.cs`, and `TRSDbContext.cs`: additive model/mapping changes where required.
- `Backend/TRS_Data/Models/PendingCheckout.cs`: review for legacy compatibility; avoid unnecessary redesign.

### Proposed new backend files

- `Backend/TRS_API/Services/Payments/IPaymentGateway.cs`
- `Backend/TRS_API/Services/Payments/PaymentGatewayResolver.cs`
- `Backend/TRS_API/Services/Payments/PaymentGatewayContracts.cs`
- `Backend/TRS_API/Services/Payments/StripePaymentGateway.cs`
- `Backend/TRS_API/Services/Payments/FiuuPaymentGateway.cs`
- `Backend/TRS_API/Services/Payments/GatewayRefundService.cs`
- `Backend/TRS_API/Controllers/FiuuWebhookController.cs`
- `Backend/TRS_Data/Models/PaymentGateway.cs`
- One reviewed, dated additive SQL script under `Backend/TRS_Data/Sql/`.

Keep this integration boundary small. Do not introduce unrelated frameworks or duplicate registration workflows. Separate Fiuu notification endpoints further only where its protocol requires it.

### Frontend files

- `Frontend/src/pages/admin/Masterconfig.tsx`: controlled gateway selection under Payment configuration.
- `Frontend/src/contexts/LiveConfigContext.tsx`: safe configuration typing/refresh as required.
- `Frontend/src/pages/EventDetail.tsx`: use generic attempt data while preserving registration/payment steps.
- `Frontend/src/components/registration/EmbeddedPaymentModal.tsx`: preserve common dialog phases and dispatch to provider-specific payment bodies.
- Proposed `Frontend/src/components/registration/payments/StripePaymentBody.tsx` and `FiuuPaymentBody.tsx`: isolate browser integrations.
- `Frontend/src/pages/PaymentResult.tsx`: provider-neutral result display and legacy return support.
- `Frontend/src/pages/admin/Registrations.tsx` and `PaymentReconciliation.tsx`: preserve actions; adjust gateway context and provider-neutral messages as required.
- `Frontend/src/lib/api/registrationsApi.ts`, `Frontend/src/lib/api/index.ts`, and `Frontend/src/types/registration.ts`: compatible contracts and mappings.

Review related exports, reports, receipt generation, and status labels for provider assumptions. If additional edits are required outside the approved implementation scope, identify exact files and obtain approval first.

### Tests and documentation

Extend relevant tests in `Backend/TRS.Tests/` and `Frontend/src/test/paymentApi.test.ts`; add focused gateway/workflow tests where needed. Update `TRS_ARCHITECTURE.md`, `TRS_API_MAP.md`, `TRS_BUSINESS_RULES.md`, and `TRS_VPS_RUNBOOK.md` for implemented changes only.

## 8. Delivery phases

1. **Compatibility investigation:** document existing payment/refund/reconciliation behavior, examine Fiuu merchant APIs, confirm hosted checkout and required payment/refund capabilities, finalize schema/API/file diffs, and obtain implementation approval.
2. **Stripe extraction:** introduce common contracts and extract Stripe behavior with no intended workflow changes. Pass regression tests before adding Fiuu.
3. **Additive data/configuration:** migrate/backfill generic references, seed Stripe, add audited superadmin selection with readiness validation.
4. **Fiuu implementation:** integrate hosted checkout, verified notifications, status queries, full/partial refunds, and orphan reconciliation in sandbox.
5. **Workflow validation:** test both gateways and switching scenarios through the same participant/admin entry points; resolve any capability gap before release.
6. **Controlled rollout:** approve deployment separately, deploy with Stripe selected, verify production configuration, enable Fiuu when ready, and retain both callback/refund paths.

## 9. Testing checklist and release criteria

### Happy paths

- [ ] Existing Stripe embedded checkout still creates exactly one registration/payment and the expected receipt.
- [ ] Fiuu hosted checkout returns to verified TRS confirmation for both SGD card and PayNow payments.
- [ ] Only superadmin can switch gateways through Master Config; switch is audited.
- [ ] New attempts use the new gateway; existing attempts complete through the original one.
- [ ] Full, partial, and item-level refunds use the original provider and correct accounting/status effects.
- [ ] Reconciliation shows both gateways and supports the same review/refund actions, including orphan payments.
- [ ] Free registrations, manual payment actions, exports, and receipts remain correct.

### Validation cases

- [ ] Anonymous/eventadmin attempts to change gateway settings are rejected by the backend.
- [ ] Unknown, disabled, unimplemented, or unconfigured gateway selection is rejected, including through the general config update endpoint.
- [ ] Invalid signatures, wrong merchant identity, amount/currency mismatches, and unrelated references cannot finalize payment.
- [ ] Refund amounts above the remaining refundable amount and unauthorized actions are rejected.
- [ ] Invalid gateway callbacks cannot enter trusted shared finalization.
- [ ] Secrets are absent from public configuration, client checkout payloads, logs, and reports.

### Edge cases

- [ ] Duplicate/out-of-order callbacks, concurrent callback/browser confirmation, and callback retries after local failure remain idempotent.
- [ ] A timeout after provider acceptance is recoverable for both checkout creation and refund submission.
- [ ] User closes the browser; verified asynchronous completion still works.
- [ ] Gateway switches while a dialog is open or an attempt is processing; reference routing stays correct.
- [ ] Both gateways report success for related attempts; money remains traceable and duplicate registration is prevented.
- [ ] Late success after expiry/capacity change enters the existing appropriate outcome/reconciliation path.
- [ ] Refund pending/failure/success updates preserve accounting and do not prematurely cancel a registration.
- [ ] Orphan records can be reconciled/refunded without a registration/payment parent.
- [ ] Identical provider reference strings in different gateways cannot collide.
- [ ] Legacy Stripe session callbacks and outstanding pending checkouts work after rollout.
- [ ] Cleanup does not treat provider outage or unknown payment state as confirmed failure.
- [ ] Mobile checkout, bank authentication, dialog close/retry behavior, and result recovery satisfy the workflow contract.

Run focused backend/frontend automated tests and normal builds, then provider sandbox integration tests. Before backend builds, check for a running API; if its output is locked, ask the user to stop it rather than creating alternate output folders. No tests/builds are required for creating this planning document alone.

Release requires verified Fiuu capability parity for the agreed payment/refund/reconciliation flows. An unsupported capability is an unresolved requirement, not permission to change workflow silently.

## 10. Third gateway extension checklist

1. Confirm required payment methods, embedded presentation, status verification, refund capabilities, and notification semantics.
2. Add an adapter, provider-specific options, and verified callback handling.
3. Add the catalog entry and server-side credentials; implement the frontend payment body if needed.
4. Map provider states to TRS codes and define durable idempotency/reference matching.
5. Pass the same workflow and failure/recovery tests.
6. Enable it for superadmin selection only after readiness and compatibility checks.

The goal is no provider-specific schema change for another gateway with equivalent capabilities. New business capabilities may legitimately require separately approved model/workflow changes; integration is not achievable by inserting a catalog row alone.

## 11. Outstanding decisions and evidence required

- Fiuu merchant account/environment, required currencies and payment methods, and enabled Inpage Checkout capabilities.
- Actual full/partial refund APIs, asynchronous outcomes, and orphan lookup/refund support for that merchant configuration.
- Exact policy for allowing a new attempt while an earlier gateway payment remains unverifiable.
- Any unavoidable authentication/navigation differences from the current embedded flow.
- Final schema types/indexes, API compatibility details, credential deployment method, and implementation file scope.

Official references identified during planning:

- [Fiuu API specifications](https://docs.fiuu.dev/reference/official-fiuu-api-specifications)
- [Fiuu Inpage Checkout integration](https://github.com/FiuuPayment/Integration-Fiuu_Inpage_Checkout)
- [Fiuu integration best practices](https://github.com/FiuuPayment/Cheatsheet-BestPractices-Fiuu_API)

The Inpage Checkout repository confirms the integration option exists; it is not sufficient evidence that every required method or merchant account supports the same experience. Validate the current detailed provider specifications and sandbox behavior during Phase 1.

### Master Config gateway row alignment (2026-10-08)

Payment Gateway is a standard row inside the Payment group on All/Payment tabs, with the same desktop table and mobile card rendering as other settings. The pencil opens a dropdown; the existing checkmark saves and X cancels. The separate panel and its Save/Reload buttons were removed. Gateway edits continue to use the dedicated superadmin endpoint with validation, version checking, and audit handling; ordinary rows retain their existing config update method. Edit refreshes gateway availability/version; errors and successes use the shared feedback dialog. Fiuu remains unavailable.

Frontend build passed, and 10 focused frontend tests passed (eight gateway-row tests plus two existing payment API tests). No backend, database, or payment-processing changes were made for this UI adjustment.

### Fiuu sandbox protocol client (2026-10-08)

Implemented the approved isolated backend client in `Services/Payments/FiuuApiClient.cs`, `FiuuOptions.cs`, and `FiuuSignatureValidator.cs`. Dependency registration does NOT register a Fiuu `IPaymentGateway`; Stripe remains the only selectable implemented provider. No database, public API, participant checkout, callback endpoint, or admin refund workflow change is included in this step.

The protocol follows the official Fiuu Merchant API v13.97: sandbox host mapping, checkout vcode/extended vcode (pp.18-19), payment response skey (pp.21-22), transaction-ID indirect requery (pp.72-73), refund submission and signed response (pp.106-107), and refund inquiry by merchant RefID (p.108). Source: https://github.com/FiuuPayment/Documentation-Fiuu_API_Spec . Documentation was downloaded into the OS temporary directory, not the repository.

- Sandbox requests use `https://sandbox-api.fiuu.com/` only, form-encoded POST, bounded response size/time, and disabled redirects. No automatic retry policy is installed.
- `QueryPaymentAsync` requires known transaction ID, expected order ID, amount, and currency. It requests JSON, verifies VrfKey, and checks the expected identity/amount/currency. Order-based lookup is not part of this step. The documented query signature does not itself cover currency/order; those fields are also checked over the authenticated HTTPS response.
- `SubmitRefundAsync` uses a durable caller-supplied RefID with RefundType P for amount-based full/partial refunds. Acceptance status 22 maps to pending, not success. Optional bank details and HTTPS notification URL are supported without changing any TRS user flow. No sandbox refund has been sent by this implementation.
- `QueryRefundAsync` queries by the same RefID, verifies transaction/reference identity, and maps pending/processing/rejected/success. The documented inquiry response has no signature; trust derives from HTTPS plus identity checks. Missing, malformed, duplicate, mismatched, unknown-status, and ambiguous results throw instead of becoming a successful/failed financial outcome.
- Payment and refund notification validators verify protocol hashes in constant time and bind notifications to the expected merchant, transaction/order, and amount/currency where present. The caller must supply trusted local expectations. They do not perform persistence, deduplication, or acknowledgement; those belong to the later callback integration.
- Payment 00/11/22 maps to S/F/P as defined by Fiuu. Query StatName is retained, including card authorization state, for the future adapter's capture/finalization policy. This client alone must not finalize registrations.
- Refund transport/timeout/HTTP errors preserve uncertainty; PR016 duplicate RefID requires querying the original reference. Never generate a new RefID merely to retry an uncertain submission. Invalid response/signature errors also leave the outcome unconfirmed. Caller cancellation is propagated and does not prove that a submitted refund failed.
- Local Fiuu sandbox credentials are configured only in the ignored Development settings file; they are not in tracked code, frontend configuration, or SystemConfig. Options validation occurs on use so an unconfigured Fiuu client cannot disrupt Stripe startup.

Added fake-HTTP tests and independent signature vectors for signing, tampering, identity checks, status mapping, form fields, errors, cancellation, and refund uncertainty. After the API stopped, the normal backend build passed with zero warnings/errors and all 165 non-database backend tests passed, including 54 Fiuu protocol tests. The SQL-backed PaymentRefundIntegrationTests suite was excluded, not executed. No Fiuu network transactions were sent; sandbox connectivity/account/channel readiness remains unverified.

Remaining implementation: provider-neutral checkout presentation, Fiuu adapter, signed notification endpoints with durable deduplication/acknowledgement, order/transaction reference persistence, recovery/refund workflow wiring, and sandbox end-to-end tests. Inpage Checkout supports cards only; PayNow presentation and its refund requirements still need merchant-specific verification. Do not enable Fiuu in the catalog until those requirements are resolved.

### Hosted Fiuu checkout phase (2026-10-08)

Approved flow: TRS summary -> Fiuu hosted card/PayNow page -> TRS confirmation. No Inpage integration is included. `FiuuPaymentGateway` is registered for servicing attempts but its readiness gate deliberately prevents new selection even if the catalog flag is changed. Stripe remains selected. No database script, Fiuu portal setting, production service, or gateway selection was changed by this phase.

Implemented:
- Additive `checkoutMode`, `paymentGateway`, and `hostedCheckout` response fields; existing Stripe client-secret/publishable-key fields remain. Fiuu gets a signed form, never server keys.
- Nullable generic `GatewayOrderId` / `GatewayTransactionId` on PaymentAttempts, with provider-scoped unique indexes. Existing Stripe values are untouched. Fiuu transaction references in shared Payment/Webhook fields use `fiuu:<numeric ID>` to avoid collisions with existing globally unique provider references.
- SGD hosted card/PayNow checkout; SALS capture requests; fixed sandbox hosts, configured HTTPS origins, confirmed card channel, and merchant-specific vcode mode. No provider credential or access token appears in the return URL.
- Signed form notifications and server transaction query verify merchant, order, amount, currency, and capture status. Card authorization alone does not confirm registration. Provider channels must match the requested card/PayNow method.
- SQL session application locks serialize notification/return/recovery processing by order. Durable event logs make repeated states idempotent. A second transaction for one order is logged for reconciliation without replacing the first or creating a second registration.
- Browser return parameters never prove payment. A browser-stored attempt key authorizes one recovery call followed by local status polling. Missing storage, provider errors, or timeout show an unconfirmed/review outcome; carts are retained. Delayed captured payments on closed/expired attempts go to reconciliation.
- Notification IPN is acknowledged via sandbox returnipn.php; callbacks receive CBTOKEN:MPSTATOK after processing. Failures before durable processing return non-2xx. Polling never submits a second payment or refund.

Remaining release work after the refund phase below: merchant callback URL/channel configuration, SQL-backed concurrency/late-payment tests, real card/PayNow and refund sandbox tests, and an explicit activation/deployment decision. No real Fiuu payment or refund was sent by automated tests.

Hosted-phase file inventory:
- Backend: Services/Payments/{IPaymentGateway,PaymentGatewayContracts,StripePaymentGateway,FiuuOptions,FiuuSignatureValidator,FiuuApiClient,FiuuPaymentGateway}.cs; Services/PaymentAttemptService.cs; Controllers/{PaymentController,FiuuWebhookController}.cs; Program.cs.
- Data: Models/{PaymentAttempt,TRSDbContext}.cs; Sql/20261008_hosted_gateway_references.sql.
- Frontend: components/registration/EmbeddedPaymentModal.tsx; pages/PaymentResult.tsx; types/registration.ts; lib/api/registrationsApi.ts; lib/hostedCheckout.ts.
- Tests: Backend/TRS.Tests/FiuuHostedCheckoutTests.cs; Frontend/src/test/{hostedCheckout.test.ts,hostedPaymentResult.test.tsx}.
- Documentation: this plan, TRS_ARCHITECTURE.md, TRS_API_MAP.md, TRS_BUSINESS_RULES.md, TRS_VPS_RUNBOOK.md.

Verification: 189 non-database backend tests and 20 focused frontend tests pass. The normal backend build and frontend production build pass. The separate frontend TypeScript check reports an existing BadgeStatus/ProgramStatus mismatch at unchanged EventDetail.tsx:1201. No unrelated fix was included. The SQL-backed integration suite was excluded; concurrency, callback delivery, and real merchant sandbox flows remain unverified. Happy paths cover signed hosted forms, protected return confirmation and provider lookup; validation covers unsafe destinations, credentials/URL/channel setup, signatures and identity; edge cases cover missing storage, untrusted return flags, authorization versus capture, tampered query data and retained return-session keys. No source changes were committed or deployed; earlier approved gateway changes remain in the working tree.


### Fiuu refund and reconciliation phase (2026-10-08)

Implemented in code; activation is still blocked pending SQL and sandbox acceptance. Existing refund-only, cancellation, receipt and reconciliation screens are retained. Full/partial refunds route through the original payment provider. No frontend changes were required in this phase.

- FiuuRefundService persists a unique merchant RefID and dispatch timestamp before submission. Once dispatched, a retry queries that same reference and never resubmits, including after PR016, timeout, malformed response or inquiry-not-found. Pending outcomes remain P until verified. Documented definite submission rejections become F.
- POST /api/webhooks/fiuu/refund verifies merchant, signature, request, transaction and amount. A two-minute recovery loop queries saved pending requests. SQL session application locks serialize Fiuu admin actions, callbacks and recovery per registration/orphan transaction. Verified outcomes, totals, cancellation state, audit and webhook deduplication persist together; terminal conflicts require review rather than overwriting financial state.
- Successful refunds recompute existing PR/FR and item states. Refund-only leaves registration active; cancellation follows existing CP/RF/X behavior. Successful orphan refunds resolve associated failed payment logs and the matching needs-reconciliation attempt. Additional transactions use their own verified transaction context.
- Conflicting refund notifications are stored as refund.updated failures and exposed through the existing charge.refunded review discriminator, preserving the current Mark Reviewed UI. Refund actions reject those discrepancies. Admin Fiuu refund actions record old/new snapshots via AdminAuditService. Provider completion uses PaymentAuditLogs.
- New schema prerequisite: Backend/TRS_Data/Sql/20261008_gateway_refund_tracking.sql adds nullable Refunds.GatewayRequestId / GatewaySubmittedAt and a provider-scoped unique request index. PREPARED ONLY; not executed. The earlier configuration and hosted-reference scripts were applied locally by the user.
- Fiuu PR014 means the merchant/channel requires beneficiary bank details. This release reports that rejection; it does not invent bank details or add a collection screen. PayNow refund acceptance must be verified with the merchant account before activation. The same user workflow cannot yet be promised for a channel that requires additional information.

Validation: normal backend build succeeded; 218 non-database backend tests passed, including 29 new refund tests and existing Fiuu protocol/Stripe adapter tests. SQL-backed PaymentRefundIntegrationTests were excluded. No real Fiuu request, callback delivery, SQL locking test, email delivery or provider refund was exercised. Remaining acceptance: apply the new script locally, configure public HTTPS callbacks/channel, then verify card/PayNow payment and full/partial/pending refunds, cancellation, timeout/duplicate/restart recovery, orphan reconciliation, terminal conflicts and original-provider routing. Keep Stripe active and Fiuu disabled until that acceptance is complete.

Files for this phase: Services/Payments/{FiuuRefundService,FiuuRefundOperationLock,FiuuRefundOperationFilter,FiuuPaymentGateway,IPaymentGateway,PaymentGatewayContracts}.cs; Controllers/{FiuuWebhookController,RegistrationsController,AdminPaymentReconciliationController}.cs; BackgroundJobs/PaymentCleanupWorker.cs; Program.cs; TRS_Data/Models/{Refund,TRSDbContext}.cs; the new SQL script; TRS.Tests/FiuuRefundWorkflowTests.cs; and the payment architecture/API/business/runbook documentation.


### Approved method-aware local sandbox testing (2026-10-08)

Implemented provider-neutral method capabilities and GET /api/Payment/methods, server-side new-attempt validation, unavailable-method UI and automatic PayNow selection when cards are unconfigured. Registration refreshes options on focus, periodically and before submission; failures do not fall back to assumed Stripe availability. Free/admin-assisted registration and existing provider ownership are preserved.

Fiuu's unconditional readiness gate is replaced with Development-only EnableSandboxCheckout opt-in plus sandbox credentials/URL validation. CardChannel is validated only for cards. Local configuration opts in, but the prepared 20261008_enable_fiuu_local_sandbox.sql has NOT been executed and activePaymentGateway has not been changed. The user selects Fiuu through the existing superadmin Master Config Save action after applying that local catalog script. No schema changes; rollback selects Stripe first then disables Fiuu catalog/opt-in. Production remains blocked.

Affected files: IPaymentGateway.cs, StripePaymentGateway.cs, FiuuPaymentGateway.cs, FiuuOptions.cs, PaymentGatewayConfigurationService.cs, PaymentController.cs, PaymentAttemptService.cs, ignored appsettings.Development.json, registrationsApi.ts, EventDetail.tsx, related backend/frontend tests, the local enable SQL and payment documentation. Real sandbox payment/refund and SQL concurrency acceptance remain outstanding; the portal's TRAN_NOT_FOUND result is not treated as fixed.

Validation for this phase: frontend Vite build passed; 25 focused frontend tests passed, including three registration-screen cases for card disabled/PayNow selected, an open-page gateway switch, and failed capability lookup. Standalone TypeScript checking still reports the pre-existing EventDetail BadgeStatus/ProgramStatus mismatch (now line 1232); that unrelated issue was not edited. After the user stopped the API, the normal backend build passed with zero warnings/errors and all 227 non-database backend tests passed, including development-only Fiuu opt-in, PayNow without a card channel, invalid configuration, and Stripe method-capability checks. SQL-backed PaymentRefundIntegrationTests were excluded. The local enable script remains prepared, not executed; no gateway selection or real sandbox payment was performed by this verification.

### Direct hosted checkout (2026-10-08)

Public registration now hands hosted Fiuu attempts directly to the provider when Proceed Payment is clicked, without a second confirmation modal. The existing attempt key is saved before submission; destination validation, expiry checks and server submission precede the form POST. Checkout is locked during handoff. Ambiguous submission/navigation failures or a back-forward-cache return show a payment-status recovery link and prevent another submission. Pre-submission failures allow retry. Stripe retains its embedded modal. No database or API contract changes.

Verification: frontend build passed; focused hosted handoff/return and registration tests cover direct navigation, duplicate clicks, browser Back, expiry, submission/navigation failures and retained Stripe modal. Actual sandbox payment acceptance remains a manual test.

### Fiuu payment constraint and registration rollback fix (2026-10-08)

Read-only local evidence for attempt 47 / transaction 194544 showed a verified Fiuu success webhook remaining pending, with no linked registration/payment. The initial registration insert failed on Payments.CK_Payments_Gateway, which allowed only Manual, PayNow and Stripe. Later concurrency exceptions came from retrying with EF entities accepted by earlier SaveChanges calls inside the rolled-back transaction.

Apply Backend/TRS_Data/Sql/20261008_allow_fiuu_payment_gateway.sql to the intended database after review. The script preserves the existing check expression and adds Fiuu, validates existing rows, and is repeatable. It performs no data updates, gateway switch, or payment confirmation. ALTER TABLE briefly needs a schema lock. Restore the original check only when no additional gateway history exists; do not delete payments to enable rollback. The script was prepared but NOT executed by this task.

RegistrationWorkflowService snapshots existing tracked entities before its transaction. Every uncommitted exit restores their scalar values, original concurrency tokens and modified-property flags, and detaches newly tracked entities from the failed transaction. Caller-owned payment-attempt and webhook-log instances remain tracked for retry/reconciliation. PaymentAttemptService retries only after that cleanup and avoids an unnecessary delay after the final failure. Successful commits retain normal behavior.

Verification: backend build passed; all 229 non-database backend tests passed, including regression cases for accepted inserts rolled back before a failed payment save, rowversion restoration, and preservation of caller-owned changes. SQL-backed PaymentRefundIntegrationTests were not run against the user's local business database. Fiuu finalization and repeated callback acceptance must still be tested after applying the script. No existing attempt was manually marked paid or replayed. Attempt 47 may have expired by then; use verified reconciliation if required rather than bypassing expiry rules or paying again.

### Default Fiuu hosted payment choices (2026-10-09)

Approved implementation omits channel on new generic Fiuu checkouts, allowing the provider page to offer merchant-enabled Visa/Mastercard, PayNow and other methods. The frontend advertises one hosted handoff; Stripe remains embedded. Actual verified provider method is persisted before finalization, using existing method values and retaining the provider channel in the response record. Legacy explicit-method attempts keep their original restrictions. No database schema, merchant configuration or production enablement changes.

Basis: official Fiuu API specification v13.97, payment request `channel` parameter: omission displays the default payment page. Source: https://github.com/FiuuPayment/Documentation-Fiuu_API_Spec . Merchant channel availability still requires sandbox acceptance; this change does not prove either card brand succeeds for this account.

Verification: normal backend build passed with zero warnings/errors; all 239 non-database backend tests passed. Frontend TypeScript check and Vite build passed; 23 focused frontend tests passed. SQL-backed integration tests and real Visa/Mastercard sandbox acceptance were not run. Existing unrelated working-tree changes were preserved.

## UAT/LIVE Fiuu release support (2026-10-16)

Fiuu now has explicit Mode (Sandbox or Production) and EnableCheckout. UAT uses ASPNETCORE_ENVIRONMENT=Staging and Sandbox mode; LIVE uses Production environment and Production mode. Production rejects sandbox mode and SB_ merchant IDs; non-production rejects production mode. Production _Dev merchants are also rejected. Blank/malformed credentials, unknown modes or invalid HTTPS public origins keep Fiuu unselectable. Legacy EnableSandboxCheckout remains a Development-only compatibility opt-in. It does not override production environment checks.

The adapter routes checkout/acknowledgement to sandbox-payment.fiuu.com or pay.fiuu.com and API calls to sandbox-api.fiuu.com or api.fiuu.com. Frontend handoff allows only these exact checkout origins and merchant paths. Master Config selection remains audited and superadmin-only. Original-provider ownership and signature/amount/currency/refund verification are unchanged. Never replace an existing Fiuu account's credentials while its outstanding transactions need servicing.

Prepared package: DeploymentPrivateConfigs/ReadyZip/TRS_20261016. See DEPLOYMENT.md for UAT/LIVE paths, SQL, replacement, configuration and rollback. Credentials are blank templates; Stripe stays active. SQL is prepared only and has not been executed on VPS. Unrelated TLS export is excluded from the release assembly. Prior Development-only gate descriptions above are historical and superseded by this section.
