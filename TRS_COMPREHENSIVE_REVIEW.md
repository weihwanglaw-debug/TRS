# TRS Comprehensive System and Business Review

**Review date:** 27 August 2026  
**System:** Tournament Registration System (TRS)  
**Scope:** React 18 frontend, ASP.NET Core 8 API, EF Core 8 data model, SQL Server deployment assets, Stripe payment flow, registration workflow, fixtures, administration, privacy, operational readiness, and automated checks.

## 1. Executive Assessment

### Overall conclusion

**TRS is not ready for public internet UAT or production in its current state.** The application has a useful functional base and several good implementation choices, but six confirmed critical issues create material risks of personal-data disclosure, payment manipulation, indefinite capacity blocking, and unsafe file storage.

Private functional UAT can continue only if it uses synthetic data, Stripe test mode, restricted network access, and no public upload or registration endpoints. Production-like external UAT should wait until the Critical Release Gate in section 10 is complete.

### Risk profile

| Area | Assessment | Main concern |
|---|---|---|
| Security and privacy | Not acceptable for public release | Public sequential IDs expose registration and payment data; uploads and SBA data are insufficiently protected |
| Payment integrity | Not acceptable for public release | Currency is client controlled; late payments and webhook failures can produce paid-without-registration states |
| Registration correctness | High risk | Paid registrations can bypass checkout and reserve capacity indefinitely; admin edits bypass core validation |
| Business rules | Needs product decisions | Age cutoff, mixed-team rules, capacity units, minimum participation, waitlists, and cancellation policy are under-specified |
| Deployment and operations | Not repeatable | IIS frontend assets are now present but deployment verification, fresh-database baseline, durable uploads/email, and monitoring remain incomplete |
| Quality assurance | Release gate is broken | The solution test project does not compile; focused frontend tests now exist, but broad behavioral coverage and a clean full lint gate remain missing |

### Finding count

This report records **6 Critical, 15 High, 19 Medium, and 2 Low** findings. Critical and High findings should be treated as release work, not optional enhancements.

### Remediation update - 27 August 2026

- **C-05 implemented and source-verified:** backend pricing now ignores browser currency and always quotes/persists SGD.
- **H-15 implemented and tested:** `ScoreModal` hooks now run before the nullable-draft return; a regression test covers null-to-draft-to-null rendering.
- **H-11 implemented in the repository, deployment verification pending:** the frontend now has an IIS SPA rewrite file, production API URL template and HTTPS build guard, normalized API base URL, and deployment runbook. The actual UAT IIS/CORS/DNS/HTTPS smoke test can only occur after deployment.
- **L-02 implemented and tested:** robots guidance and route-specific `noindex` behavior cover admin, login, and payment-result routes.

These four bounded changes do not alter the overall release recommendation. C-01 through C-04 and C-06 remain unresolved Critical findings.

## 2. Review Method

The review included:

- Static inspection of backend controllers, services, models, SQL assets, configuration, frontend routes, forms, and API clients.
- End-to-end reasoning across registration, capacity, payment, webhook, refund, cancellation, fixture, upload, and administration workflows.
- Comparison with current OWASP API guidance, Stripe documentation, Microsoft ASP.NET Core/IIS guidance, React rules, and Singapore PDPC guidance.
- Backend solution and API builds, fixture scenario execution, frontend build, frontend tests, and frontend lint.

This was not a penetration test, load test, accessibility audit, legal opinion, live Stripe account review, live database review, or infrastructure inspection. Findings marked as confirmed are supported directly by repository behavior; market-practice gaps still require business prioritisation.

## 3. Critical Findings

### C-01: Public registration endpoints expose full participant PII through sequential IDs

**Evidence**

- Public registration lookup: `Backend/TRS_API/Controllers/RegistrationsController.cs:95`.
- Public receipt and details PDF: `RegistrationsController.cs:567` and `RegistrationsController.cs:592`.
- Response mapping includes contact details, participant date of birth, phone, email, guardian data, document URL, custom fields, and gateway identifiers: `RegistrationsController.cs:1694-1769`.
- Public payment information and verification also use numeric IDs: `Backend/TRS_API/Controllers/PaymentController.cs:117-145` and `PaymentController.cs:573-596`.

**Impact**

An unauthenticated person can enumerate numeric registration or payment IDs and retrieve another registrant's personal and payment-related information. This is a confirmed broken object-level authorization pattern and a potential PDPA incident.

**Required action**

- Make detailed registration, receipt, PDF, and payment endpoints admin-authorized by default.
- For customer self-service, use a high-entropy, expiring access token or email OTP/magic link bound to one registration.
- Return a purpose-specific customer DTO that excludes gateway IDs, internal reconciliation fields, audit data, and unnecessary participant attributes.
- Add negative authorization tests that enumerate another registration and expect `404` or `403`.

This aligns with [OWASP API1:2023 Broken Object Level Authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/).

### C-02: Anonymous users can take over another payment attempt - Remediated

**Evidence**

- Attempt creation returns both a numeric `attemptId` and an `attemptKey`: `Backend/TRS_API/Controllers/PaymentController.cs:50-78`.
- Submit, abandon, and status endpoints authenticate only with the numeric route ID: `PaymentController.cs:82-113`.
- Service methods load attempts by numeric ID without comparing the opaque key: `Backend/TRS_API/Services/PaymentAttemptService.cs:219-275`.
- Status output includes registration, payment, and reconciliation details: `PaymentAttemptService.cs:761-779`.

**Impact**

An attacker can enumerate attempt IDs, observe another checkout, cancel or abandon its PaymentIntent, and obtain internal state. The generated `attemptKey` does not currently protect the operations for which it is needed.

**Required action**

- Require and constant-time compare the opaque attempt key on every submit, abandon, and status operation.
- Prefer the opaque token as the route identifier and avoid exposing a useful numeric identifier.
- Scope returned status to the minimum needed by the browser.
- Rate-limit per attempt token and a separate client partition, and add takeover tests.

**Implementation status:** submit, abandon, and status calls now require `X-Payment-Attempt-Key`; the backend validates it with a constant-time comparison and returns the same not-found response for missing, incorrect, and unknown attempts. The frontend sends the key on every attempt-specific call, rate limiting is partitioned by a hash of that key, and focused backend/frontend tests cover key validation and header propagation. The key is no longer copied into Stripe metadata.

### C-03: Public upload endpoint permits path escape and storage abuse

**Evidence**

- The upload controller has no authentication or endpoint rate limit: `Backend/TRS_API/Controllers/UploadsController.cs:5-6` and `UploadsController.cs:33-35`.
- The server trusts the browser-provided MIME header: `UploadsController.cs:39-46`.
- The client controls the folder segment: `UploadsController.cs:50-65`.
- `SanitizeFolder` removes `..` but leaves Windows rooted values such as `C:/temp`: `UploadsController.cs:79-86`. After separator replacement, `Path.Combine` can discard the intended upload root when it encounters a rooted segment.
- There is no file signature inspection, malware scanning, upload ownership, quota, or orphan cleanup.

**Impact**

A public caller can consume disk space, upload disguised content, create unclaimed files, and potentially write outside the intended `wwwroot/uploads` directory on Windows. Locally served participant documents also widen the impact of a server compromise.

**Required action**

- Remove the client-controlled folder path and replace it with a server-owned upload-purpose enum.
- Resolve the full target path and reject it unless it remains beneath a fixed upload root.
- Use authentication or a short-lived signed upload grant tied to a registration draft.
- Inspect file signatures, rename files server-side, quarantine uploads, apply per-client quotas, and remove abandoned files.
- Store private participant documents outside the public web root, preferably in private object storage with authorized download links.

See the [OWASP Input Validation guidance for file uploads](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html), which specifically states that the client should not choose the storage path and that MIME headers alone are insufficient.

### C-04: Public SBA APIs expose a bulk personal-data directory

**Evidence**

- `GET /api/sba/rankings` is public and returns the full ranking table without paging: `Backend/TRS_API/Controllers/SbaController.cs:51-64`.
- Public member lookup and name search expose date of birth: `SbaController.cs:66-115` and mapping at `SbaController.cs:223-232`.

**Impact**

The API makes names, SBA identifiers, clubs, ranking information, and dates of birth available for bulk extraction. This exceeds what the registration UI appears to require and creates privacy, scraping, and possible source-data licensing risk.

**Required action**

- Confirm the legal and contractual basis for storing and publishing SBA data.
- Make bulk ranking access authorized, paginated, and audited.
- Replace public member search with a narrowly scoped eligibility-verification response; do not return full date of birth.
- Add minimum search length, per-IP throttling, response limits, and abuse monitoring.

### C-05: Payment currency was controlled by the browser - Remediated

**Original evidence**

- Registration pricing accepted `req.Payment.Currency`, defaulting only when blank in the original implementation.
- Payment attempt creation uses that resulting currency: `Backend/TRS_API/Services/PaymentAttemptService.cs:70` and `PaymentAttemptService.cs:182-184`.
- The PayNow-specific SGD check does not protect card payment currency: `PaymentAttemptService.cs:72`.
- Minor units are always calculated as amount multiplied by 100: `PaymentAttemptService.cs:709-712`, which is incorrect if zero-decimal currencies are accepted later.

**Impact**

A modified API request can pay the correct numeric amount in a lower-value currency. For example, a server fee intended as SGD can be submitted as another currency while the backend still considers the payment amount valid.

**Required action**

- Make currency server-authoritative, based on event or global configuration.
- For the current Singapore deployment, allow only `SGD` end to end unless multi-currency is explicitly designed.
- If multi-currency is introduced, use ISO currency metadata for minor units and store the quoted exchange/pricing basis.
- Add tampered-currency integration tests.

**Implementation status:** `Backend/TRS_API/Services/RegistrationWorkflowService.cs:12` now defines SGD as the supported payment currency and `RegistrationWorkflowService.cs:197` uses it for every server pricing quote. The request field remains for API compatibility but is ignored. The API build passes with zero warnings/errors. Multi-currency remains intentionally unsupported; if it is introduced later, currency-specific minor-unit handling and new tests will be required.

### C-06: Public paid-registration route bypasses checkout and can reserve capacity forever

**Evidence**

- `POST /api/registrations` is public: `Backend/TRS_API/Controllers/RegistrationsController.cs:105-141`.
- For a non-zero total it creates pending registration/payment records rather than requiring successful checkout: `RegistrationsController.cs:119-129`.
- Pending registration groups are persisted: `Backend/TRS_API/Services/RegistrationWorkflowService.cs:236-250` and `RegistrationWorkflowService.cs:300-308`.
- Capacity counts every non-cancelled group, including pending ones: `RegistrationWorkflowService.cs:83-103` and `RegistrationWorkflowService.cs:821-868`.
- Payment cleanup expires payment attempts and pending checkout records, but does not release registrations created through this direct route: `Backend/TRS_API/BackgroundJobs/PaymentCleanupWorker.cs:51-100`.

**Impact**

An unauthenticated caller can create unpaid pending registrations that consume programme capacity indefinitely. A simple script could make an event appear full without paying.

**Required action**

- Reject the public direct-registration route whenever the authoritative total is greater than zero.
- Permit direct public persistence only for genuinely free registrations.
- Put admin-assisted registration behind authorization and a dedicated service command with explicit payment state, reason, and audit.
- Add a controlled expiry/release process for any legitimate pending reservation.

## 4. High Findings

### H-01: The payment rate limiter is one shared bucket for all users - Remediated

`Backend/TRS_API/Program.cs:121-126` registers a named fixed-window limiter without a partition key. Its default is only five requests per minute. A normal checkout uses create, submit, and status polling (`Frontend/src/components/payment/EmbeddedPaymentModal.tsx:240-243`), so a few customers or one attacker can throttle every customer.

**Recommendation:** partition by client IP, authenticated identity, or attempt token; use different policies for expensive mutations and cheap status polling; return `429` with `Retry-After`; load-test the complete checkout. Microsoft documents the fairness benefits of [partitioned ASP.NET Core rate limiting](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-10.0).

**Implementation status:** public/create traffic is partitioned by a per-browser-session token and attempt submit/status/abandon traffic by the secret attempt key, so the limiter does not depend on IIS or forwarded client IPs. Creation and polling use separate limits, and rejected requests return structured `429` JSON plus `Retry-After`. The browser token is a fairness mechanism rather than a DDoS security boundary and can be supplemented with gateway-level protection or CAPTCHA if deliberate creation abuse is observed.

### H-02: Administrative authentication controls are below production practice

- Login has no dedicated throttling, failure backoff, lockout, or MFA: `Backend/TRS_API/Controllers/AuthController.cs:20-36`.
- Password validation is minimum eight characters only: `Backend/TRS_API/Models/RequestModels.cs:10-31`.
- JWTs last eight hours: `Backend/TRS_API/Services/AuthService.cs:20-38`.
- Browser tokens are stored in `localStorage`: `Frontend/src/contexts/AuthContext.tsx:47-68`.
- Logout does not revoke a token: `AuthController.cs:39-41`.
- `mustChangePassword` is enforced only by frontend navigation: `Frontend/src/components/admin/AdminLayout.tsx:21-24`.
- Deactivation and role changes do not invalidate an already issued JWT.

**Recommendation:** add partitioned login throttling and lockout/backoff, MFA for privileged users, server-side enforcement of password-change state and active-user/security-stamp checks, shorter access-token lifetime with a controlled renewal model, and a documented session-revocation process. See the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

### H-03: User deletion and role invariants are unsafe

- The backend trusts a caller-supplied `currentUserId` query value for self-delete prevention: `Backend/TRS_API/Controllers/UsersController.cs:75-84`.
- The frontend delete API does not send that value: `Frontend/src/lib/api/usersApi.ts:72-80`.
- Roles are free-form strings with no fixed allowlist: `Backend/TRS_API/Models/RequestModels.cs:15-27` and `UsersController.cs:39-70`.
- There is no last-superadmin protection or identity-change audit.

**Recommendation:** derive actor ID from JWT claims, validate roles against a fixed set, prevent deletion/demotion of the final active superadmin, and audit create, role change, activation, password reset, and deletion.

### H-04: Capacity is not held while a customer is paying

Payment attempt creation checks current capacity (`Backend/TRS_API/Services/PaymentAttemptService.cs:53-57`) but stores no inventory hold. Registration groups are created only after successful payment (`PaymentAttemptService.cs:362-395`). Two customers can therefore pay for the last place; one can end in reconciliation or require a refund.

**Recommendation:** create an expiring programme-capacity hold in the same transaction as the payment attempt. Consume it atomically during finalisation and release it on cancellation/expiry. An alternative is authorization then capture only after allocation, but that requires a deliberate Stripe flow redesign.

### H-05: A legitimate late payment can become paid-without-registration

Attempts expire after a short configurable period, currently defaulting around two minutes (`PaymentAttemptService.cs:79-81`). Success after expiry is moved to reconciliation instead of completing registration (`PaymentAttemptService.cs:327-336`), and processing attempts that cross expiry are also marked for reconciliation (`PaymentAttemptService.cs:480-487`). Card challenge, PayNow, slow networks, and delayed webhooks can exceed this window.

**Recommendation:** use payment-method-aware expiry periods, stop accepting/cancel intents before hold expiry where possible, and define a deterministic late-success policy: either allocate safely or issue an automatic refund and notify the customer. Do not leave moved money as a manual discovery task.

### H-06: Webhook failures are acknowledged without a durable retry path

`Backend/TRS_API/Controllers/StripeWebhookController.cs:89-102` records finalisation failure, but the controller returns `200 OK` at `StripeWebhookController.cs:129`. The sweep handles created/submitted attempts but not unresolved `NeedsReconciliation` records (`PaymentAttemptService.cs:434-510`). A transient database failure can therefore become permanent manual work while Stripe believes delivery succeeded.

**Recommendation:** verify the signature, durably persist an idempotent webhook-inbox record, then return `2xx` and process asynchronously with retries. If the event cannot be durably accepted, return a non-2xx response so Stripe retries. Stripe documents live-mode retries for up to three days and recommends fast acknowledgements in its [webhook guidance](https://docs.stripe.com/webhooks).

### H-07: Refund records can say success when money has not been returned

- Any Stripe refund status except `failed` is recorded as success: `Backend/TRS_API/Controllers/RegistrationsController.cs:1429-1433`. Stripe also defines `pending`, `requires_action`, and `canceled` states.
- A non-Stripe payment without explicit external refund details is marked successful without executing a transfer: `RegistrationsController.cs:1436-1442`.
- An internal refund reason is optional: `Backend/TRS_API/Models/RequestModels.cs:206-213`; reason validation is applied only to external details at `RegistrationsController.cs:1613-1617`.

**Recommendation:** map each gateway status explicitly, model pending and failed outcomes, reconcile through refund webhooks, require method/reference/evidence for manual refunds, require a business reason, and release/cancel capacity only according to the agreed refund/cancellation state machine. Stripe's current [Refund object](https://docs.stripe.com/api/refunds/object) lists `pending`, `requires_action`, `succeeded`, `failed`, and `canceled`.

### H-08: Generic status endpoints bypass domain workflows

`Backend/TRS_API/Controllers/RegistrationsController.cs:147-192` directly changes registration and group status. It does not enforce a transition graph or coordinate payment state, refund requirements, capacity, fixtures, notification, or audit. An admin can mark unpaid registrations confirmed or resurrect cancelled registrations.

**Recommendation:** remove generic status mutation from the UI/API. Replace it with explicit commands such as confirm-free-registration, confirm-manual-payment, cancel-with-policy, withdraw-participant, and reinstate, each with validation, authorization, reason, and audit.

### H-09: Admin participant edits bypass registration eligibility rules

`RegistrationsController.cs:617-800` directly edits participant fields with only partial duplicate checking. It does not consistently re-run required-field, email, age, gender/composition, event participation, custom option, T-shirt, document, or SBA validation. `DateOnly.Parse` around `RegistrationsController.cs:698-701` can turn bad input into a server error. Audit TODOs remain at `RegistrationsController.cs:683-684` and `RegistrationsController.cs:792-793`.

**Recommendation:** reuse one shared registration eligibility validator for create and edit, add fixture-stage locks, support a clearly labelled override only with permission and reason, and record old/new snapshots.

### H-10: A fresh SQL Server cannot be deployed reproducibly

The repository has no EF migration history and no complete baseline schema. `Backend/TRS_Data/Sql` contains incremental scripts for selected later changes, while `Backend/TRS_API/Program.cs:62-64` only connects to the configured database. This is a direct blocker for the planned fresh SQL Express server.

**Recommendation:** create and verify a versioned baseline schema, schema-history table, ordered idempotent upgrade process, production backup step, and rollback procedure. Test the process by building an empty database and deploying the application against it.

### H-11: IIS frontend deployment was incomplete - Repository remediation implemented

- The frontend uses `BrowserRouter`, which requires server fallback for deep routes.
- The original repository had no frontend `web.config` to rewrite non-file routes to `index.html`.
- API configuration expected `VITE_API_BASE_URL`, but the original repository had no production environment template or deployment check.
- Backend CORS must contain every UAT and production portal origin: `Backend/TRS_API/Program.cs:105-119`.

**Recommendation:** add a tested SPA rewrite configuration, a production environment template, build-time configuration validation, and an IIS deployment runbook covering Hosting Bundle, sites/app pools, permissions, HTTPS, CORS, and rollback. Microsoft documents the [IIS URL Rewrite module](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/using-the-url-rewrite-module) and [ASP.NET Core IIS publishing prerequisites](https://learn.microsoft.com/en-us/aspnet/core/tutorials/publish-to-iis).

**Implementation status:** `Frontend/public/web.config` now provides SPA fallback while excluding files, directories, `/api`, and `/uploads`. `Frontend/.env.production.example`, `Frontend/vite.config.ts`, `Frontend/src/lib/api/_base.ts`, and `Frontend/README.md` now provide and validate the production API configuration and document IIS/CORS/HTTPS deployment. The production build was verified to reject missing configuration and to pass with a valid HTTPS API URL; generated `dist` contained `web.config` and `robots.txt`. **Residual action:** install IIS URL Rewrite and smoke-test real UAT deep links, CORS, DNS, and certificates after deployment.

### H-12: Uploaded documents are tied to one server's local disk

`UploadsController.cs:50-70` writes into the API's local `wwwroot`. Database backup does not protect those files, an application redeployment can overwrite them, server loss can remove them, and a future second API instance will have a different file set.

**Recommendation:** use private object storage where practical. At minimum, use a persistent non-public data volume, independent encrypted backup, restore testing, and a file metadata/ownership table.

### H-13: Email jobs are volatile and failed messages are dropped

`Backend/TRS_API/Services/BackgroundJobQueue.cs:11-28` uses an in-memory channel. `Backend/TRS_API/BackgroundJobs/BackgroundJobWorker.cs:27-42` logs failures but provides no retry or dead-letter state. Application restart loses queued confirmations, refunds, cancellations, and operational notices.

**Recommendation:** use a transactional outbox or durable job table with idempotent message keys, retry/backoff, dead-letter status, an admin retry view, and alerting.

### H-14: The backend solution's release test gate does not compile

`dotnet build Backend/TRS.sln` fails because `PaymentRefundIntegrationTests.cs` refers to removed constructors and a removed `Event.MaxParticipants` member at lines 457, 746, and 773. A stale assertion at line 112 expects a long status description instead of the system's current short code. The tests also fall back to a developer SQL Server instance at lines 918-920 and are not isolated.

**Recommendation:** repair the test project first, use a disposable isolated database, remove developer-machine assumptions, and require solution build plus automated tests in CI before deployment.

### H-15: The fixture score modal violated React's hook-order contract - Remediated

The original `ScoreModal` could return before two hooks were called. The parent renders it with nullable state at `Frontend/src/pages/admin/Fixtures.tsx:1068-1071`, so opening or closing the modal could cause a rendered-more/fewer-hooks runtime failure in a core tournament workflow.

**Recommendation:** move hooks above the conditional return or split the stateful modal into an inner component that is mounted only with valid data. Add an interaction test. React explicitly prohibits calling hooks after a conditional return in the [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks).

**Implementation status:** the refs now execute before the nullable return at `Frontend/src/components/admin/fixtures/ScoreModal.tsx:96-99`. `Frontend/src/test/ScoreModal.test.tsx` verifies null-to-draft-to-null rendering without a hook-order failure. The focused lint check and frontend test suite pass.

## 5. Medium Findings and Business-Level Concerns

| ID | Finding | Evidence and why it matters | Recommended direction |
|---|---|---|---|
| M-01 | Event/program validation is incomplete on the server | DTOs at `Backend/TRS_API/Models/RequestModels.cs:53-113` lack ranges/enums/cross-field validation. `EventsController.cs:470-542` directly parses/applies dates and programme fields. Negative fees, min greater than max, impossible ages, arbitrary types, and invalid date sequences can reach persistence or cause 500 errors. | Add a shared domain validator and database check constraints for durable invariants. Return structured `400` errors. |
| M-02 | Age eligibility changes with registration date | `RegistrationWorkflowService.cs:576-578` calculates age using Singapore "today"; import code uses UTC today around `ProgramImportService.cs:407-410` and `ProgramImportService.cs:820-825`. The same person can be eligible one day and ineligible the next for the same event. | Store an event `AgeCutoffDate` or explicit competition-year rule and use one shared calculator in public registration, import, and admin edit. |
| M-03 | "Mixed" is hard-coded as mixed doubles | `RegistrationWorkflowService.cs:625-630` requires exactly one male and one female for every programme with `Gender = Mixed`. This makes mixed team events with more than two participants impossible. | Separate gender eligibility from a configurable team-composition rule. |
| M-04 | Capacity meaning changes with fee structure | `RegistrationWorkflowService.cs:821-852` counts groups for `per_entry` and people for `per_player`. A billing choice should not redefine operational capacity. | Add an independent `CapacityUnit` such as entries, players, or teams. |
| M-05 | Minimum-participant editing rule is logically inverted | `EventsController.cs:571-572` blocks a programme update when `MinParticipants` exceeds current active registrations, even when an unrelated field is being edited. A programme can legitimately be below its required minimum before registration closes. | Validate `min <= max`; after close, run an under-minimum workflow to proceed, merge, cancel/refund, and notify. |
| M-06 | Consent evidence is not retained | The UI switch at `Frontend/src/pages/EventDetail.tsx:1508-1513` sends no consent version, wording snapshot, timestamp, actor/IP, or policy version. Registration models at `RequestModels.cs:133-142` and `Backend/TRS_Data/Models/EventRegistration.cs:6-20` contain no evidence fields. | Store consent/policy versions and accepted timestamp. Confirm whether parental/guardian consent is needed for minors. |
| M-07 | Privacy notice does not match product behavior | `Frontend/src/pages/PrivacyPolicy.tsx:13-15` says participant document uploads are not part of the process, while registration validation supports document uploads at `RegistrationWorkflowService.cs:603-604`. No retention/purge workflow was found. | Update the notice after legal review; define purposes, processors/transfers, retention criteria, access/correction, and deletion/anonymisation operations. PDPC states personal data should not be retained indefinitely without legal or business purpose in its [Retention Limitation guidance](https://www.pdpc.gov.sg/guidelines-and-consultation/2020/03/advisory-guidelines-on-key-concepts-in-the-personal-data-protection-act). |
| M-08 | Same-group duplicate detection is case-sensitive | `RegistrationWorkflowService.cs:571-574` builds a `FullName|DOB` key in a default case-sensitive `HashSet`. Name casing/spacing can bypass duplicate detection before either participant exists in the database. | Normalize Unicode, whitespace, and casing; prefer a stable member identity where available. |
| M-09 | Refund and manual-payment permissions are too broad | Both `eventadmin` and `superadmin` can issue refunds at `RegistrationsController.cs:364-470`; event admins can manually mutate payment state at `RegistrationsController.cs:249-329`. | Introduce finance permissions or a finance role, amount limits, mandatory reason/evidence, and optional dual approval for high-value refunds. |
| M-10 | Contact anti-bot challenge is client-forgeable | `Backend/TRS_API/Controllers/ContactController.cs:60-65` accepts the two operands and answer from the caller. A bot can choose all three. | Use a server-signed challenge, Turnstile/reCAPTCHA where appropriate, honeypot, and partitioned rate limit. |
| M-11 | Public club lookup returns more data than the dropdown needs | `Backend/TRS_API/Controllers/Badmintonclubscontroller.cs:25-69` exposes contact, email, and address details publicly. | Return only club ID/name on the public list; keep contact details admin-authorized if they are needed operationally. |
| M-12 | Raw webhook and application logs need minimisation and retention rules | `StripeWebhookController.cs:52` reads the body without an explicit endpoint limit and stores full JSON for valid and invalid signatures at `StripeWebhookController.cs:135-145`. Payloads and metadata can contain PII. No purge policy was found. | Limit body size, avoid retaining untrusted invalid payloads, redact sensitive fields, set retention, restrict access, and alert on repeated invalid signatures. |
| M-13 | Collection endpoints lack safe bounds | Registration list `RegistrationsController.cs:55-82` accepts unbounded page values; SBA rankings return all records. Large or negative values can cause errors or resource pressure. | Require page >= 1, cap page size, use `AsNoTracking` and projection, and test worst-case queries. OWASP lists unbounded records and uploads under [API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/). |
| M-14 | Fixture scoring permits sport-invalid values | `FixtureGenerationService.cs:737-792` checks non-negative numbers and winner consistency but allows decimal or impossible badminton scores and arbitrary game counts. | Implement configurable sport/ruleset validation, including legal game score, deuce cap, number of games, walkover/retirement, and explicit override audit. |
| M-15 | Fixture scheduling and result administration lack conflict rules | `FixturesController.cs:329-374` accepts schedule/result strings without event-date, end-time, court, or team collision validation. Fixture APIs are admin-only, so there is no customer-facing draw/result surface. | Use typed date/time/court fields, detect conflicts, define advancement/tie-break rules, and decide whether public draws/live results are in scope. |
| M-16 | Configuration and identity changes are not consistently audited | `ConfigController.cs:39-56` updates arbitrary keys without an allowlist, typed validation, or audit. User changes and participant edits also lack complete audit coverage. | Add typed configuration contracts and expand immutable audit coverage to identity, configuration, participant override, manual payment, and refund operations. |
| M-17 | Operational monitoring and recovery are not production-ready | No liveness/readiness endpoints, external monitoring definition, alert thresholds, restore drill, or rollback runbook was found. SQL Express has no SQL Agent for scheduled jobs. | Add `/health/live` and dependency-aware `/health/ready`, uptime/error/payment/job alerts, Windows Task Scheduler or provider-managed database backups, off-server copies, and documented restore tests. Microsoft provides built-in [ASP.NET Core health checks](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks). |
| M-18 | Secret and environment handling depends on manual discipline | Local ignored settings contain SQL, SMTP, Stripe, and JWT secrets. They are not currently tracked by Git, which is good, but no production secret-loading or rotation runbook is present. UAT/production separation is not codified. | Use IIS environment variables or a secret manager, least-privilege SQL users, separate UAT/production Stripe/SMTP/JWT credentials, startup validation, and rotation procedures. |
| M-19 | Frontend lint and behavioral coverage are not release gates | After the bounded fixes, `npm.cmd run lint` reports 21 unrelated errors and 33 warnings. `npm.cmd run test` now runs 8 passing tests across 3 files, including focused ScoreModal and route-indexing coverage, but registration/payment/admin workflow coverage remains largely absent. | Fix all hook and correctness errors, baseline remaining style items deliberately, and add behavior tests for registration, payment polling/result, validation, admin status/refund, and fixture scoring. |

## 6. Low Findings

### L-01: Frontend bundle is unnecessarily large

The production build succeeds but creates a JavaScript chunk of approximately 1.0 MB minified (about 290 KB gzip). Lazy-load admin routes and heavy Stripe/export/fixture modules so public event browsing and registration do not download the full administration application.

### L-02: Indexing controls did not reflect sensitive routes - Remediated

The original `Frontend/public/robots.txt` allowed every route, including admin and payment-result paths. This was not a security boundary, but it increased accidental indexing risk.

**Implementation status:** `Frontend/public/robots.txt` now disallows `/admin`, `/login`, and `/payment/result`. `Frontend/src/components/RouteIndexingControl.tsx` applies `noindex, nofollow, noarchive` to the same sensitive routes, with mapping and DOM tests in `Frontend/src/test/RouteIndexingControl.test.tsx`. Public event routes remain indexable.

## 7. Market-Practice Comparison

These are product maturity gaps, not all mandatory defects. They should be consciously accepted, deferred, or planned.

| Capability commonly found in registration platforms | TRS position | Priority recommendation |
|---|---|---|
| Expiring capacity hold during payment | Missing | Mandatory before taking real payment for limited-capacity programmes |
| Secure customer self-service via magic link/OTP | Current numeric public lookup is unsafe | Mandatory replacement for receipt/view/correction/cancellation |
| Waitlist and automatic promotion | Not found | Valuable when programmes fill; phase after payment integrity |
| Event-specific cancellation/refund deadline and fee policy | Mostly manual workflow | Define before production so operators and customers receive consistent outcomes |
| Explicit age cutoff rule | Uses current day | Mandatory business decision for age-restricted competitions |
| Under-minimum programme workflow | Not found | Add proceed/merge/cancel/refund decision after registration closes |
| Public draws, schedules, and results | Fixture endpoints are admin-only | Product decision; usually expected for tournament participants |
| Customer correction request and consent evidence | Not found | Important for PDPA operations and support workload |
| Finance-specific permission and refund approval | Shared with event admin | Recommended before multiple operators or material transaction volume |
| Tax/GST receipt model | Listed as pending in repository notes | Confirm invoicing/tax requirement before accepting production payment |
| Promo/discount codes | Not found | Optional commercial feature, not a release blocker |
| Durable notifications with delivery status | In-memory only | Required for reliable confirmations/refunds/cancellations |
| Public status page/health monitoring | Not found | Operational best practice before production |

## 8. Positive Controls Already Present

The review also found several solid foundations worth preserving:

- Admin controllers generally use role-based authorization.
- Password hashing uses BCrypt with work factor 12: `Backend/TRS_API/Services/AuthService.cs:14-18`.
- Stripe webhook signatures are verified before trusted processing: `StripeWebhookController.cs:52-57`.
- Payment intent and refund calls use idempotency keys in important paths.
- Registration persistence uses a database transaction and programme-row locking: `RegistrationWorkflowService.cs:216` and `RegistrationWorkflowService.cs:260-262`.
- Fixture mutation uses transactions and SQL `UPDLOCK`: `Backend/TRS_API/Services/FixtureGenerationService.cs:647-690`.
- Payment attempts use row-version concurrency and database indexes: `Backend/TRS_Data/TRSDbContext.cs:515-520`.
- Event additional HTML is sanitized server-side: `Backend/TRS_API/Controllers/EventsController.cs:466-469`.
- Short status-code centralisation and audit services exist in several core modules.
- The API project compiles cleanly and all 11 fixture console scenarios pass.

These controls reduce implementation risk for the remediation because the system already has patterns for transactions, idempotency, status constants, and auditing.

## 9. Verification Results

| Check | Result | Notes |
|---|---|---|
| `dotnet build Backend/TRS_API/TRS_API.csproj` | Pass | 0 warnings, 0 errors |
| `dotnet build Backend/TRS.sln` | Fail | Test project has 3 compile errors from stale model/constructor usage |
| `dotnet run --project Backend/TRS_FixtureTests/TRS_FixtureTests.csproj` | Pass | 11 fixture scenarios passed |
| `npm.cmd run build` in `Frontend` | Pass with warning | Valid HTTPS API URL build passed; main chunk remains about 1.0 MB minified and browsers list data is stale |
| Production API configuration guard | Pass | Missing API URL failed with a clear message; valid HTTPS URL built and was embedded in the generated bundle |
| Generated IIS frontend assets | Pass | `dist/web.config` parsed as XML and contained SPA fallback; `dist/robots.txt` contained the intended exclusions |
| `npm.cmd run test` in `Frontend` | Pass | 8 tests passed across 3 files, including ScoreModal hook-order and route-indexing regression tests |
| Focused lint for all changed frontend files | Pass | 0 errors and 0 warnings |
| `npm.cmd run lint` in `Frontend` | Fail | 21 unrelated errors and 33 warnings remain; the conditional-hook defect is removed |

## 10. Recommended Release Gates

### Gate A: Before any public external UAT

1. Close the remaining Critical findings C-01 through C-04 and C-06; C-05 is remediated.
2. Fix H-01, H-04 through H-07, H-10, and H-14. H-15 is remediated; H-11 still requires deployment smoke verification.
3. Use Stripe test mode and synthetic participant data.
4. Build an empty UAT database from the approved baseline and prove backup/restore.
5. Add automated tests for ID enumeration, upload path containment, currency tampering, unpaid capacity blocking, attempt takeover, payment concurrency, late success, webhook retry, and refund states.
6. Run a focused authenticated and unauthenticated security test against the deployed UAT environment.

### Gate B: Before production launch

1. Complete all High findings.
2. Obtain written business decisions for age cutoff, capacity unit, minimum participation, cancellation/refund policy, mixed-team composition, finance permissions, tax/GST, and public results.
3. Align privacy notice, consent evidence, SBA use, document handling, and retention with the client's PDPA process.
4. Move private files to durable protected storage and notifications to a durable queue/outbox.
5. Establish monitoring, alerting, off-server backups, restore drill, release rollback, and secret rotation.
6. Require clean API/solution/frontend builds, clean lint, meaningful automated tests, and signed UAT acceptance.

### Gate C: Post-launch maturity

1. Waitlist and automatic promotion.
2. Customer magic-link self-service and correction requests.
3. Public draws/schedules/results if approved.
4. Promo codes and richer financial reporting if commercially needed.
5. Performance optimisation, dependency scanning, regular vulnerability review, and incident exercises.

## 11. Immediate Decision Register

The following questions cannot be safely inferred from code and should be answered by the product owner/client:

1. What exact date determines a participant's age for each tournament?
2. Does programme capacity mean players, pairs/entries, or teams independently of how fees are charged?
3. What is the required composition for mixed doubles and mixed team events?
4. What happens if a programme is below its minimum at closing time?
5. What are the cancellation deadline, refundable amount, administrative fee, and exceptional override rules?
6. Who may confirm manual payment, waive fees, issue refunds, and approve high-value refunds?
7. Is a paid registration guaranteed immediately, or may it be waitlisted/refunded after payment?
8. What SBA data is licensed for storage and public display?
9. Which participant documents are collected, why, who may view them, and when are they deleted?
10. Are public fixtures, live results, and rankings required for launch?
11. Are GST-compliant invoices/receipts required and which entity is the merchant of record?

## 12. Recommended Technical Work Packages

### Package 1: Public surface and privacy

- Replace sequential public access with expiring high-entropy access grants.
- Redesign upload authorization/storage and redact SBA/club APIs.
- Add endpoint-specific partitioned limits and resource bounds.
- Align consent, privacy notice, retention, and audit.

### Package 2: Payment and inventory integrity

- Server-authoritative SGD pricing.
- Expiring capacity holds.
- Durable webhook inbox and reconciliation worker.
- Explicit refund state machine and manual-refund evidence.
- Remove paid direct-registration bypass and generic status mutation.

### Package 3: Domain-rule consolidation

- One validator for public create, admin create/import, and edit.
- Explicit age cutoff, capacity unit, mixed composition, minimum-participant, cancellation, and transition rules.
- Sport-valid scoring and schedule conflict validation.

### Package 4: Deployment and reliability

- Baseline database and versioned upgrades.
- IIS frontend/API deployment assets and environment validation.
- Durable private file storage, durable email outbox, health checks, monitoring, backups, restore, and rollback.

### Package 5: Quality gate

- Repair backend tests and isolate their database.
- Convert fixture scenarios into normal CI tests.
- Add payment/security/domain/frontend tests.
- Make solution build, frontend build, lint, and tests mandatory in CI.

## 13. Remediation Complexity and Change-Risk Matrix

### 13.1 How to read the estimates

The estimates below describe **complete remediation including focused automated tests**, not only a temporary code guard. They assume one experienced engineer who already understands TRS. They exclude client decision time, legal review, vendor procurement, penetration testing, UAT waiting time, and production change windows.

| Complexity | Indicative focused effort | Meaning |
|---|---:|---|
| XS | Up to 1 engineer-day | Localised change with a small test surface |
| S | 1-2 engineer-days | A few files and focused regression tests |
| M | 3-5 engineer-days | Multiple components, schema/API work, or broader tests |
| L | 1-2 engineer-weeks | Cross-cutting workflow or infrastructure change |
| XL | More than 2 engineer-weeks | Multiple workstreams, major rule decisions, or architectural change |

**Implementation confidence** means confidence that the recommended technical direction is correct:

- **Very High:** straightforward and well bounded.
- **High:** technically clear, but coordinated changes and regression testing are required.
- **Medium:** the code change cannot be finalised safely until a business, legal, or infrastructure choice is made.

**Change risk** means the chance that the fix can trigger a regression elsewhere:

- **Low:** isolated behavior with clear tests.
- **Medium:** one or more API/UI/operations consumers must change together.
- **High:** payment, capacity, historical data, security, or deployment behavior changes across several modules.

### 13.2 Critical finding containment

These controls reduce immediate exposure while the complete solution is being built. They are not substitutes for the complete fixes below.

| Finding | Immediate containment | Effort | Trade-off |
|---|---|---:|---|
| C-01 | Put authorization on registration detail, receipt, PDF, and payment-information endpoints | XS | Customer receipt links stop working until secure token access is implemented |
| C-02 | Require the existing opaque `attemptKey` for submit, abandon, and status | S | Current frontend calls and any open attempts must be updated together |
| C-03 | Reject all client folder values, require a signed/authenticated upload request, and verify final path containment | S | Existing anonymous draft uploads may temporarily stop working |
| C-04 | Disable bulk rankings and remove DOB from all public SBA responses | XS | Public SBA search UI may need a temporary reduced response |
| C-05 | **Completed:** enforce `SGD` in the backend and ignore request currency | XS | Any intentionally configured non-SGD test/event will be rejected |
| C-06 | Reject public direct registration when authoritative total is greater than zero | XS | Any admin or legacy client incorrectly using the public route for paid entries will fail visibly, which is safer than silently accepting unpaid reservations |

### 13.3 Critical findings

| ID | Complexity | Confidence | Change risk | Fix character | What could be triggered and how to control it |
|---|---:|---|---|---|---|
| C-01 | L | High | High | Cross-cutting but well understood | New access-token storage, email links, frontend receipt routes, and API DTOs must change together. Old public links will no longer work. Use a transition period or explicit invalid-link page, token expiry/revocation tests, and PII response snapshots. |
| C-02 | M | Very High | Medium | Mostly straightforward | Payment modal submit, abandon, and polling calls must send the key. Open attempts created by the old version may become unusable. Support a short deployment transition or deliberately expire them, then test wrong/missing/replayed keys. |
| C-03 | L | High | High | Security/storage redesign | Moving documents out of `wwwroot` changes URLs, IIS permissions, backup, download authorization, and possibly existing database values. Migrate metadata/files in a reversible batch and test path traversal, file signatures, access control, and restore. |
| C-04 | M | High | Medium | Clear API minimisation | Existing SBA screens or exports may rely on full records or DOB. Create separate admin and public DTOs, update the public search contract, and verify import/admin workflows before removing fields. |
| C-05 | S | Very High | Low | Straightforward - implemented | The only likely regression is an existing non-SGD configuration or test. Current server quoting is fixed to SGD; multi-currency would require a separate design. |
| C-06 | M | High | Medium | Clear rule with call-site risk | Legacy/admin-assisted or free-registration flows may share the public endpoint. Inventory all callers, preserve the free path, create an authorized admin command, and test free, paid, waived, and manual-payment scenarios. |

### 13.4 High findings

| ID | Complexity | Confidence | Change risk | Fix character | What could be triggered and how to control it |
|---|---:|---|---|---|---|
| H-01 | M | High | Medium | Configuration plus load tuning | Incorrect proxy/IP handling can put all customers behind one partition or allow spoofed addresses; strict limits can also break payment polling. Configure trusted forwarded headers, separate policies by endpoint cost, and load-test realistic checkout traffic. |
| H-02 | XL | Medium | High | Staged security programme | MFA, token lifetime, revocation, password-change enforcement, and login lockout affect every admin session. Roll out in phases, keep break-glass recovery, test clock expiry and revoked/deactivated users, and train administrators before enforcement. |
| H-03 | M | Very High | Medium | Mostly straightforward | Fixed role validation can reject historical custom role strings, and claim-derived self-protection may expose stale JWT behavior. Audit current users, migrate invalid roles, add last-superadmin tests, and refresh sessions after role changes. |
| H-04 | L | High | High | Core payment/inventory redesign | Holds change capacity counts, attempt expiry, finalisation, cleanup, and concurrency. A poor implementation can leak holds or oversell. Use database constraints/transactions, deterministic expiry, clock-controlled tests, and concurrent last-slot integration tests. |
| H-05 | L | Medium | High | Decision-dependent payment policy | Longer expiry can hold capacity too long; shorter expiry can create more late successes. This must be designed with H-04 and the accepted refund policy. Test card challenge, PayNow delay, webhook delay, browser closure, and success exactly at expiry. |
| H-06 | L | High | High | Durable integration redesign | Inbox retries can duplicate finalisation or notifications unless every consumer is idempotent. Add a unique Stripe event ID, transactional state transitions, retry counts/dead letter, and duplicate/out-of-order event tests. |
| H-07 | L | High | High | Financial state-machine change | New pending/canceled states affect cancellation, capacity release, email, finance reports, and admin UI. Define the state graph first, preserve immutable gateway evidence, and test every Stripe status plus manual refund proof. |
| H-08 | L | Medium | High | Business-workflow redesign | Removing generic status updates can break existing admin screens and undocumented operating shortcuts. Agree allowed transitions, build explicit commands, migrate the UI, and retain a permissioned audited override for exceptional cases. |
| H-09 | L | High | High | Shared validation consolidation | Applying current rules to edits may reject legacy registrations or make previously editable records immutable after fixtures begin. Separate validation errors from authorized overrides and regression-test create, import, edit, cancellation, and fixture-linked records. |
| H-10 | L | High | Medium | Deployment foundation | A generated baseline may differ from existing databases and accidentally recreate or alter objects. Compare schema before applying, stamp existing environments only after validation, test empty-database creation and upgrade paths, and always back up first. |
| H-11 | S | Very High | Low-Medium | Repository implementation complete | File/directory/API exclusions and build validation are implemented. Real IIS URL Rewrite, CORS, DNS, HTTPS, and deep-link/API smoke verification remain deployment actions. |
| H-12 | L | High | High | Storage migration | Existing document URLs, backup jobs, access permissions, and exports may break. Introduce an abstraction that can read old and new storage during migration, verify checksums, and test authorized download plus disaster recovery. |
| H-13 | L | High | Medium | Durable messaging pattern | Retried jobs can send duplicate confirmation/refund emails, and a large outbox can slow queries. Use idempotency keys, transactional enqueue, bounded retries, indexed status fields, retention, and delivery/restart tests. |
| H-14 | M | High | Medium | Test-infrastructure repair | Updating stale tests may reveal genuine defects rather than merely turn the build green. Isolate the database first, update constructors/assertions to current contracts, and do not weaken assertions just to obtain a pass. Runtime production behavior should not need to change solely for this fix. |
| H-15 | XS | Very High | Low | Straightforward - implemented | Hooks now run before the return and the null/draft transition has an automated regression test. Full score-save UAT remains part of normal smoke testing. |

### 13.5 Medium findings

| ID | Complexity | Confidence | Change risk | Fix character | What could be triggered and how to control it |
|---|---:|---|---|---|---|
| M-01 | M | High | Medium | Clear validation work | Stricter validation can reject existing invalid records, imports, or admin forms. Audit current data first, centralise rules, return field-level errors, and run create/update/import regression tests. |
| M-02 | M | Medium | Medium | Business decision required | A new cutoff date can change eligibility for existing registrants and event reports. Decide the official rule, snapshot it per event, run an impact report, and define whether existing accepted registrations are grandfathered. |
| M-03 | M | Medium | Medium-High | Business/model decision required | Changing mixed composition affects registration validation, participant UI, imports, fixtures, and historical programmes. Introduce an explicit rule with backward-compatible defaults and test doubles versus team events. |
| M-04 | L | Medium | High | Core business-model change | Capacity availability and historical counts can change immediately after migration. Add `CapacityUnit`, calculate before/after impact for each programme, lock configuration after registration opens, and test concurrent allocation. |
| M-05 | M | Medium | Medium | Small bug plus larger workflow | Correcting the edit check is simple, but implementing proceed/merge/cancel/refund below minimum is not. Separate the immediate validation fix from the closing workflow and test edits both below and above minimum. |
| M-06 | M | High | Medium | Technically clear, policy-dependent | New consent fields change database, payloads, PDFs/exports, and privacy operations. Version wording instead of copying uncontrolled HTML, preserve evidence immutably, and test minors/guardian scenarios after policy approval. |
| M-07 | L | Medium | High | Legal and data-lifecycle work | Retention cleanup can permanently remove documents/data needed for finance, disputes, or audit; backups can silently retain deleted data. Approve a schedule, support legal holds, test anonymisation/purge in UAT, and align backup expiry. |
| M-08 | S | Very High | Low-Medium | Straightforward | More aggressive name normalisation can falsely merge different people sharing name and DOB. Use a stable SBA/member identifier when available and treat name/DOB as a warning or carefully tested fallback. |
| M-09 | L | High | High | Authorization redesign | New finance permissions affect JWT claims, seed users, navigation, endpoints, and operating procedures. Use policy-based authorization, migrate roles deliberately, and test every role/operation combination plus last-admin recovery. |
| M-10 | M | High | Medium | Standard external integration | CAPTCHA/challenge providers can be blocked, add privacy/CSP requirements, or fail during outage. Keep server-side rate limits and a controlled fallback; test accessibility, expiry, replay, and provider failure. |
| M-11 | S | Very High | Low | Straightforward DTO reduction | A frontend component may rely on a removed address/contact field. Search all consumers, create a dedicated public DTO, and retain a separate authorized details endpoint. |
| M-12 | M | High | Medium-High | Security/operations balance | Over-redaction can remove evidence needed to debug Stripe disputes; over-retention preserves PII. Define a field allowlist and retention tiers, hash or truncate untrusted payloads, and verify support can still trace an event ID. |
| M-13 | S | Very High | Medium | Straightforward contract hardening | Existing callers may request huge pages or expect all rankings in one response. Publish bounded defaults/maxima, keep exports as authorized asynchronous operations, and test boundary/negative values. |
| M-14 | L | Medium | High | Domain decision required | Enforcing badminton rules can invalidate historical scores and affect advancement. Version the scoring ruleset, grandfather historical fixtures, support audited walkover/retirement/override states, and test edge scores. |
| M-15 | XL | Medium | High | Broad product feature | Typed scheduling, conflict detection, public results, advancement, and tie-breaking touch schema, admin UI, public UI, and fixture services. Split into separate work packages, agree rules first, and preserve manual override with audit. |
| M-16 | M | High | Medium | Established audit pattern | Full snapshots can capture secrets/PII and grow the database quickly. Redact sensitive keys, set retention/access rules, index carefully, and test that audits cannot be modified through normal APIs. |
| M-17 | L | High | Medium | Infrastructure/operations work | Bad probes can overload dependencies or cause false outage alerts; backup jobs can compete with production or create unusable backups. Use lightweight probes, tune thresholds, encrypt off-server copies, and prove restoration rather than only job success. |
| M-18 | M | High | High | Controlled deployment change | A missing/mistyped secret can stop startup, and rotating JWT/Stripe/SMTP credentials can interrupt active operations. Add startup validation, dual-key/overlap where supported, documented rollback, and environment-specific smoke tests. |
| M-19 | L | High | Medium | Quality-system improvement | Correcting stale hook dependencies can change polling timing or repeat side effects, particularly in payment screens. Add tests around current intended behavior first, fix correctness errors in small batches, then make lint/test mandatory. |

### 13.6 Low findings

| ID | Complexity | Confidence | Change risk | Fix character | What could be triggered and how to control it |
|---|---:|---|---|---|---|
| L-01 | M | High | Medium | Standard optimisation | Lazy chunks can fail after deployment if old HTML references removed assets, and circular imports may surface. Use hashed assets, sensible cache headers, deployment smoke tests, and route-level loading/error states. |
| L-02 | XS | Very High | Low | Straightforward - implemented | Robots and route meta controls are implemented and tested. They remain indexing guidance only and do not replace authenticated/API security. |

### 13.7 Confidence summary

The most confidently straightforward complete fixes are **C-05, H-11, H-15, M-08, M-11, M-13, and L-02**. They are bounded changes with low or manageable regression risk.

The technical direction is clear but coordinated testing is essential for **C-01, C-02, C-03, C-04, C-06, H-01, H-03, H-04, H-06, H-07, H-09 through H-14, M-01, M-06, M-09 through M-13, and M-16 through M-19**.

The fixes that should **not** begin as final implementations until a client/business decision is recorded are **H-05, H-08, M-02 through M-05, M-07, M-14, and M-15**. Coding these prematurely has the highest chance of producing technically correct behavior that is operationally wrong.

### 13.8 Lowest-risk implementation sequence

1. Repair the test/build gate (H-14), fix the hook crash (H-15), and add focused security regression tests before broad workflow changes.
2. Apply critical containment for C-01 through C-06.
3. Complete the bounded fixes C-05, C-02, C-06, H-11, M-08, M-11, and M-13.
4. Record business decisions for age, capacity, mixed composition, minimum participation, late payment, status transitions, refunds, and fixture rules.
5. Implement payment and inventory work together: H-04, H-05, H-06, H-07, then C-01/C-03 durable designs.
6. Establish the database baseline and deployment/operations foundation before production migration.
7. Complete identity, privacy, audit, observability, and product-maturity work in controlled packages.

This order reduces the chance of fixing one symptom while destabilising payment, capacity, or historical data elsewhere.

## 14. Final Assessment

TRS has enough working functionality to continue development and controlled internal testing. Its strongest areas are transactional fixture mutation, central status-code direction, Stripe signature verification, and an API project that builds cleanly. Its weakest areas are the public security boundary, payment/inventory finalisation, privacy evidence, fresh-server deployment, and automated regression protection.

The right next move is not a broad rewrite. A focused sequence should first close public data/payment vulnerabilities, then establish deterministic payment and capacity states, then make deployment and tests repeatable. Once those release gates are met, the remaining business features can be prioritised according to the client's tournament operations.
