# TRS Multi-Gateway Payment Implementation Plan

Date: 2026-10-06

Status: Planning only. Approval covers creation of this document, not implementation, schema changes, configuration changes, or deployment. Proposed names and contracts below must be finalized against the complete code and approved before implementation.

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
5. The existing payment dialog hosts that gateway's supported embedded interface.
6. TRS waits for verified server-side payment confirmation and shows the existing success, failure, pending, or review outcome.
7. Registration confirmation and receipt behavior remain consistent. Closing the browser does not prevent verified payment processing.

Fiuu Inpage Checkout is the proposed embedded integration. Its suitability for the required merchant account, currencies, methods, mobile browsers, and authentication flows must be proven in sandbox before release. Do not silently replace the agreed embedded workflow with hosted redirection. If a required method cannot meet the workflow requirement, document the difference and obtain approval before implementation/release of that difference.

The integration contract may support redirect checkout for future gateways, but this does not authorize changing the current participant workflow. The payment provider's fields and bank authentication screens may differ visually; surrounding TRS steps and business outcomes must remain consistent.

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

1. **Compatibility investigation:** document existing payment/refund/reconciliation behavior, examine Fiuu merchant APIs, confirm embedded checkout and required payment/refund capabilities, finalize schema/API/file diffs, and obtain implementation approval.
2. **Stripe extraction:** introduce common contracts and extract Stripe behavior with no intended workflow changes. Pass regression tests before adding Fiuu.
3. **Additive data/configuration:** migrate/backfill generic references, seed Stripe, add audited superadmin selection with readiness validation.
4. **Fiuu implementation:** integrate embedded checkout, verified notifications, status queries, full/partial refunds, and orphan reconciliation in sandbox.
5. **Workflow validation:** test both gateways and switching scenarios through the same participant/admin entry points; resolve any capability gap before release.
6. **Controlled rollout:** approve deployment separately, deploy with Stripe selected, verify production configuration, enable Fiuu when ready, and retain both callback/refund paths.

## 9. Testing checklist and release criteria

### Happy paths

- [ ] Existing Stripe embedded checkout still creates exactly one registration/payment and the expected receipt.
- [ ] Fiuu embedded checkout completes through the same TRS steps for every required method/currency.
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
