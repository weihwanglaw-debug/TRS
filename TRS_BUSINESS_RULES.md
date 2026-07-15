# TRS_BUSINESS_RULES.md

Business rules below are extracted from current controller/service/frontend code. Code is the source of truth.

## Event Rules

- Public event listing and detail only expose active events that have at least one active program.
- Admins with `superadmin` or `eventadmin` can request inactive events through `includeInactive=true`.
- Event deletion is soft delete: `IsActive=false`, `UpdatedAt=DateTime.UtcNow`.
- Event create/update sanitizes `AdditionalInfo` HTML with `HtmlSanitizer`.
- Event gallery images are replaced on event update.
- Event documents are managed through a separate documents sub-resource.
- Event registration status is a combination of stored event state and computed date/program state.
- Stored `Events.RegistrationStatus` accepts short codes only: `O` open, `PA` paused, or `CL` closed.
- Computed registration status returned by the API can be `D` draft, `U` upcoming, `O` open, `PA` paused, or `CL` closed.
- `D` draft is computed when an event has no active programs; admins cannot manually change a draft event's registration status until at least one active program exists.
- `U` upcoming and date-based `CL` closed are computed from Singapore date.
- Public registration is allowed only when the computed event registration status is `O`.
- Logged-in admins can use admin-assisted registration when the event is `U`, `PA`, or `CL`, but not when it is `D`.

## Program Rules

- Program status accepts short codes only: `O` open or `CL` closed.
- Event sport type is intentionally binary: `Badminton` or `Non Badminton`.
- Program type is the source of truth for entry behavior. `type='team'` means shared team-name/team-entry behavior; there is no separate persisted team-mode flag.
- A program is registrable when `IsActive=true` and `Status` is not `CL`.
- Program-level status, capacity, and fixture restrictions apply to both public and admin-assisted registration.
- Fixture generation closes the affected program by setting `Program.Status='CL'`.
- Once a fixture exists for a program, new registrations for that program are blocked.
- Program deletion is soft delete: `IsActive=false`, `UpdatedAt=DateTime.UtcNow`.
- Program custom fields are replaced on full program update.
- Program create, update, delete, and status changes are written to `AdminAuditLog`/`AdminAuditLogDetail`.
- `FeeStructure` controls payment items:
  - `per_entry`: one fee/payment item for the group.
  - `per_player`: fee multiplied by participant count, one payment item per participant.
- `PaymentRequired=false` makes expected fee zero.

## Registration Validation

`RegistrationWorkflowService` validates public direct registration and paid embedded payment-attempt payloads.

Event registration gate modes:

- `StrictPublic`: used by public direct registration and new payment attempts; requires computed event registration status `open`.
- `AdminAssisted`: used when an authenticated admin creates a registration from the event detail page; bypasses event date/manual close status but still blocks `D` draft events, closed/full programs, and programs with fixtures.
- `AlreadyPaidFinalization`: used only after money has already moved through embedded/legacy payment finalization; avoids retroactively blocking finalization because the event window changed after payment.

Required registration shape:

- Event must exist and be active.
- Event must pass the applicable registration gate mode.
- At least one group/program must be selected.
- Selected programs must belong to the event.
- Selected programs must be active, not closed, not full, and must not already have a fixture.
- Contact/payment payload must satisfy request model validation.

Participant fields always required:

- Full name
- DOB
- Gender
- Email
- Contact number
- Nationality
- Club/school/company

Conditional fields:

- T-shirt size is displayed when `ProgramField.EnableTshirt=true` and required only when `RequireTshirt=true`.
- Guardian name/contact are displayed when `ProgramField.EnableGuardianInfo=true` and required only when `RequireGuardianInfo=true`.
- SBA ID is optional when `ProgramField.EnableSbaId=true`; this setting only displays the SBA ID field/lookup.
- SBA ID is required only when `ProgramField.EnableSbaId=true` and `RequireSbaId=true`.
- Document upload is displayed when `ProgramField.EnableDocumentUpload=true` and required only when `RequireDocumentUpload=true`.
- Remark is displayed when `ProgramField.EnableRemark=true` and required only when `RequireRemark=true`.
- Required custom fields must have non-blank values.

Participant count:

- Group participant count must be between `Program.MinPlayers` and `Program.MaxPlayers`.

Age:

- Age is calculated against Singapore today.
- Participant age must be between `Program.MinAge` and `Program.MaxAge`.

Gender:

- `Male` programs require every participant gender to be `Male`.
- `Female` programs require every participant gender to be `Female`.
- `Mixed` programs require exactly one male and one female.
- Other/open values do not enforce a composition check.

Duplicates:

- Duplicate participant identity is `FullName + DOB`.
- Duplicate checks are case-insensitive by name.
- Duplicates within the same group fail.
- Duplicates across separate groups in the same submission fail for the same program.
- Existing non-cancelled participant groups for the same program are checked.
- Team-mode programs additionally require active team names to be unique within the same program.
- Admin team-name edits for team-mode programs reject duplicate active team names and remain blocked once fixtures exist.
- Duplicate check is repeated during persistence inside the transaction.

Capacity:

- Capacity counts non-cancelled `ParticipantGroup` rows per program.
- `Program.MaxParticipants` is treated as max entries/groups, not max individual players.
- Event-level `MaxParticipants` is deprecated and is not enforced by `RegistrationWorkflowService`; program-level capacity is authoritative.

Pricing:

- Expected group fee comes from current program settings during validation.
- Submitted group fee and payment total must match expected values when `ValidatePricingAgainstCurrentPrograms=true`.
- Session/payment-attempt finalization after online payment uses `ValidatePricingAgainstCurrentPrograms=false` and the gateway amount override to avoid blocking already-collected payments after config changes.

## Free and Paid Registration Flows

Free/direct flow:

- `POST /api/registrations` calls `RegistrationWorkflowService.CreateAsync`.
- Successful confirmed registrations queue receipt generation and email.

Paid embedded payment flow:

- `POST /api/Payment/embedded-attempt` validates and prices payload.
- Payload and line item snapshot are stored in `PaymentAttempts`.
- Stripe PaymentIntent is created and shown through the embedded modal.
- Stripe webhook is the source of truth for payment outcome and registration finalization.
- `PaymentAttemptService` is idempotent by Stripe PaymentIntent id.
- Successful finalization creates registration, groups, participants, payment, and payment items.
- Payment received after attempt expiry, missing attempt context, or finalization failure is marked for reconciliation instead of auto-registering.

Legacy hosted Checkout session-first code still exists for older return URLs and uses `PendingCheckouts` plus `PaymentFinalizationService`.

## Payment Rules

Status values are short codes in the database, backend API, frontend payloads, filters, and internal comparisons. Frontend screens display long labels through mapping tables only.

Payment status codes:

- `P`: pending.
- `S`: success/paid.
- `PR`: partially refunded.
- `FR`: fully refunded.
- `F`: failed.
- `X`: cancelled.
- `W`: waived.
- `PC`: pending collection.

Registration workflow status codes:

- `P`: pending.
- `C`: confirmed.
- `X`: cancelled.
- `CP`: cancel pending.
- `RF`: refund failed.

Participant/group status codes:

- `A`: active participant.
- `P`: pending group/registration scope.
- `C`: confirmed group/registration scope.
- `X`: cancelled.

Manual admin transitions:

- `P` can become `S`, `W`, or `PC`.
- `PC` can become `S`, `W`, or stay `PC`.
- `S` can remain `S`.
- `W` can remain `W`.
- Refund/failure/cancel terminal states cannot be manually overwritten through normal update rules.

Receipt numbers:

- Generated for successful confirmations.
- Generated by `ReceiptNumberGenerator` from event/program context, with a registration-id fallback when event/program context is unavailable.

PayNow:

- PayNow is only allowed for SGD.
- Embedded PayNow attempts use the configured `Stripe:EmbeddedAttemptMinutes` expiry.
- The modal freezes the countdown after payment submission because PayNow confirmation can complete outside the browser.

Embedded attempt lock:

- Active attempts for the same event and contact email block duplicate payment creation while submitted or under reconciliation.
- Created-but-unsubmitted attempts can be canceled/superseded before submission.
- Expired or stale submitted attempts are swept by `PaymentCleanupWorker`, with direct Stripe status lookup before reconciliation decisions.

Legacy pending checkout reuse:

- Active pending checkouts for the same event, contact email, payment method, amount, and payload hash can be reused.
- Mismatched active pending checkout sessions are expired/removed before creating a new one.

## Refund Rules

Refund-only:

- Refund-only actions may be performed after payment has been made, including after a registration/entry/participant is already cancelled.
- Refund-only actions do not cancel participants/groups and do not free registration slots.
- Fixtures do not block refund-only actions because fixture eligibility is based on participant/group cancellation state, not payment state.
- Only successful paid items (`ItemStatus="S"`) or previously cancelled paid items can be refunded when refundable amount remains.
- Refund amount cannot exceed remaining refundable amount.
- Existing pending refunds block conflicting duplicate refunds.
- Internal system refunds through the payment gateway use an idempotency key based on the refund id.
- System refunds write `RefundSource='System'` and `RefundMethod='Gateway'`.
- External refunds can be recorded when money was returned outside the system, such as cash, PayNow, bank transfer, another gateway dashboard, or another future gateway.
- External refund records write `RefundSource='External'`, the selected `RefundMethod`, optional/admin-entered reference id, and audit detail; they do not send money through the payment gateway.
- Gateway dashboard, PayNow, bank transfer, and other external methods require a refund reference/id.
- Refund actions are recorded in `PaymentAuditLog`, including `RefundInitiated`, `ExternalRefundRecorded`, and gateway result/failure entries where applicable.
- Bulk refund sends one notification email per submitted action after database state is saved, not one email per item.

Cancellation:

- Reason is required.
- Cancellation can target the whole registration, one entry/group, or one per-player singles participant when that participant has its own payment item.
- Cancellation without refund cancels the selected scope and frees affected slots.
- Cancellation with refund processes each selected item independently. Successful item refunds immediately cancel that item's participant or group scope; failed item refunds leave that item active.
- Cancelling an already-refunded active item is allowed through cancel-without-refund, because the money has already been returned and the remaining action is slot release.
- Any action that involves cancellation is blocked when an affected program has a fixture. The fixture must be removed before cancellation.
- Final registration status becomes `X` only when all groups are cancelled. If refund processing fails, workflow status becomes `RF`; otherwise partially refunded but still-active registrations remain confirmed at registration scope while payment status reflects `PR`.
- Cancellation actions are recorded in `PaymentAuditLog`, including participant/group cancellation caused by refund and registration cancellation when the last active group is cancelled.
- Cancellation/refund emails are sent after database state is saved. A multi-item or whole-registration action sends one email for the batch.

Orphan refunds:

- Only `superadmin` can issue internal system refunds for orphan paid gateway sessions from reconciliation.
- Reason is required.
- Gateway session or payment intent must still be paid and have a positive amount before an internal system refund is issued.
- Refund rows for orphan sessions/intents have no `PaymentId` or `PaymentItemId`.
- Serializable transaction and filtered unique index protect against duplicate active orphan refunds.
- Orphan payments can also be recorded as externally refunded with method, reference/id, and admin note.
- Reconciliation discrepancies can be marked reviewed without creating a refund row; this resolves the webhook failure and writes `PaymentAuditLog.Action='WebhookFailureReviewed'`.

## Admin Override Rules

Registration status update:

- Allowed registration workflow values are short codes: `P`, `C`, `X`, `CP`, and `RF`.
- Registration status update cascades to all participant groups.

Group status update:

- Updates only the selected group and accepts group workflow short codes: `P`, `C`, or `X`.

Group seed:

- Admin can set or clear seed on a participant group.

Participant update:

- Admin can update participant personal/contact/team fields, document URL, remark, and custom field values.
- If full name or DOB changes, duplicate participant check runs excluding the current participant.
- Custom field updates are upserted only for labels belonging to the participant's program fields.

Manual confirmation:

- `POST /api/registrations/{id}/confirm` allows statuses `S`, `W`, and `PC`.
- Admin note is required.
- Missing payment row is created with manual gateway.
- Registration and groups become confirmed.
- Successful/waived statuses stamp paid/receipt-related fields where applicable.
- In the event registration cart, logged-in admins bypass online payment for paid carts.
- Admin registration mode is available from the event detail page for `U`, `PA`, or `CL` events, but it cannot bypass `D` draft events, closed programs, full programs, or programs with fixtures.
- During admin bypass, cart-level payer/contact, public payment method, and consent fields are hidden; payer contact is recorded from the logged-in admin profile.
- In the admin confirmation modal, payment method and payment reference are collected only when the selected payment status is `S` (Paid), not for `W` (Waived) or `PC` (Pending Collection).
- Manual confirmation does not resurrect payment items or participant/group scopes that are already cancelled or refunded.

## Badminton Club Rules

- Badminton club lookup uses `GET /api/clubs`.
- Only active clubs are returned.
- Name is required for create/update.
- Active duplicate names are rejected.
- Delete is soft delete (`IsActive=false`).
- `superadmin` and `eventadmin` can create, update, and soft-delete clubs.
- Club create, update, and soft-delete are written to `AdminAuditLog`/`AdminAuditLogDetail`.
- Registration UI shows a club dropdown for badminton events and an "Others" option with a free-text input.
- The custom "Others" value is persisted as `clubSchoolCompany`.

## SBA Rules

- Ranking types are defined in code.
- Public endpoints expose ranking types, rankings, member lookup, and member search.
- Import requires `superadmin` or `eventadmin`.
- Import accepts `.xlsx` and replaces the current SBA ranking list with the parsed workbook rows.
- During import, non-blank player club names from singles and doubles rows are compared case-insensitively against `BadmintonClub`; new names are appended as active clubs.
- SBA import writes an admin audit summary row. Each new club created from import also gets a `BADMINTON_CLUB_IMPORT_CREATE` audit row.
- Import response includes imported row count, category counts, skipped sheets, added club count, and added club names.
- SBA lookup normalizes member id comparisons through code paths in `SbaController`.
- Name search returns a limited result set.

## Fixture Rules

- Fixture endpoints require `superadmin` or `eventadmin`.
- Fixture generation requires at least two non-cancelled participant groups.
- Fixture generation prompts the admin because generating a fixture closes the affected program to stop further registrations.
- One fixture exists per event/program pair.
- Supported formats include knockout, group knockout, round robin, and heats.
- Fixture state is stored as JSON in `Fixture.BracketStateJson`.
- Backend fixture APIs are the source of truth for generated draws, bracket advancement, score validation, heat advancement, and final placements.
- Frontend fixture code should only preview/display state, collect admin input, call backend fixture actions, and show backend validation errors.
- Score, schedule, swaps, advancement, heats results, and final places mutate the stored fixture state through backend fixture endpoints.
- Structural fixture changes such as regenerate, reset/delete, raw state save, and team swaps are blocked after results have been entered.
- Raw fixture state save accepts only clean unscored fixture state and rejects corrupt JSON, match results, heat results, advancement flags, and final placements.
- Knockout BYE entries are backend-generated and auto-completed so non-power-of-two draws can advance without manual BYE scoring.
- Backend score validation rejects BYE scoring, invalid winners, invalid walkover winners, missing game scores, tied game scores, negative scores, and winners that do not match the submitted game results.
- Draw results are supported for group/round-robin style matches by saving tied numeric scores without a winner; knockout matches still require a winner.
- Group standings use configured win/draw/loss points, then BWF-style ordering: wins, head-to-head only for exactly two tied teams, game difference, point difference, points scored, seed, then team id.
- Backend fixture config validation rejects negative standing points, invalid group knockout group/advance counts, and invalid heats round/advance/place counts.
- Backend heats validation requires results before advancing, enforces the configured advance count, prevents editing completed heat rounds, and rejects duplicate or out-of-range final places.
- Heats fixtures lock swaps after any round is completed because advancement depends on prior-round results.
- Fixture regression checks live in the separate `Backend/TRS_FixtureTests` console project so they can be run or removed independently from the API project.
- Fixture checks for cancellation are based on participant/group status, not payment status.

## Registration Documents and Email Rules

- Successful payment confirmation emails attach both the receipt PDF and registration-details PDF.
- Registration details PDF is associated with the registration number and lists submitted registration item/participant details.
- Admin/payment-log screens can download both receipt and registration-details PDFs.
- Refund-related emails send an updated receipt and registration-details PDF after database state is saved.
- Cancellation-related emails send updated registration details after database state is saved, and include the updated receipt when refund is involved.
- For privacy, registration-details PDFs are sent only to the registration contact email.

## Upload Rules

- Uploads accept image/jpeg, image/png, image/webp, and application/pdf.
- Image max size is 5 MB.
- PDF max size is 10 MB.
- Folder input is sanitized by stripping `..` and trimming slashes.
- Files are stored under API `wwwroot/uploads`.
- Backend controller currently does not require authorization.

## Logging Rules

- Serilog console logging is enabled.
- `EFCoreSink` writes Warning and above to `AppLogs`.
- Microsoft/System logs below Error are filtered out.
- Logging sink exceptions are swallowed.

## Security and Operational Constraints

- Public registration detail and receipt endpoints are accessible by numeric id.
- JWT logout is client-side only; no token blacklist exists.
- Admin deactivation affects future `me` checks but does not revoke already-issued JWTs immediately by server-side blacklist.
- Background jobs are in-memory and not durable.
- Uploaded files are local to the API host.
