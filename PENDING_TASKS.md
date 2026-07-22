# Pending Tasks

This file tracks parked or deferred TRS work items. Code remains the source of truth; update this file when a pending item is completed, changed, or no longer needed.

## 1. GST / Tax Configuration

Priority: Medium

Add a configurable GST/tax setting in Master Config.

Expected scope:

- Enable/disable GST.
- Configure GST percentage.
- Apply GST consistently to registration pricing, payment amount validation, checkout amount, receipts, and payment/refund display.
- Show subtotal, GST percentage, GST amount, total, refunded amount, and net amount where relevant.

Risks:

- Payment amount validation and Stripe minor-unit calculation must remain consistent.
- Existing receipts and refunds need a clear display rule after GST is introduced.

## 2. Status-Code Standardization Final Audit

Priority: Medium

The system has been moved toward short status codes in database/API and long labels only in frontend display. Do one final end-to-end audit.

Expected scope:

- Confirm database columns store only short codes.
- Confirm backend APIs accept, compare, persist, and return only short codes.
- Confirm frontend payloads, filters, internal comparisons, and API calls use short codes.
- Confirm frontend user-facing labels are mapped from short codes.
- Decide whether current constants/mapping approach is sufficient or whether a DB status master table is still needed.

Risks:

- A mixed long-code/short-code path can reopen payment, cancellation, fixture, or display bugs.

## 3. Registration Details PDF Field Label Snapshot

Priority: Low

Registration-details PDF currently renders submitted registration details using current field labels/config. If custom-field labels change after registration, old PDFs may show newer labels.

Expected scope:

- Decide whether field labels should be snapshotted at registration time.
- If yes, persist submitted field label metadata with the registration/participant custom field values.
- Render registration-details PDF from the snapshot instead of live program field labels.

Risks:

- Requires database shape change or serialized snapshot data.
- Must not break existing registration detail display.

## 4. Durable Email / Background Jobs

Priority: Medium before production

Receipt, registration-details PDF, refund, and cancellation emails are queued in memory. If the API process restarts, queued jobs can be lost.

Expected scope:

- Replace or supplement in-memory queue with durable background job storage.
- Persist job status, attempts, error messages, and retry timing.
- Avoid duplicate emails for a single multi-item refund/cancellation action.

Risks:

- Email idempotency and retry behavior need careful design.

## 5. Public Receipt / Registration Details PDF Access

Priority: Low to Medium

Receipt and registration-details PDF endpoints are currently accessible by numeric registration id.

Expected scope:

- Decide whether public numeric-id access is acceptable.
- Consider tokenized download links, contact-email verification, or admin-only access for sensitive PDFs.
- Preserve payment-result and email-download workflows if access is tightened.

Risks:

- Registration-details PDFs may contain DOB/contact/guardian data.

## 6. Upload Authorization Review

Priority: Low to Medium

Upload endpoint currently supports public registration uploads and admin document uploads.

Expected scope:

- Review whether all upload use cases should remain public.
- If not, split public participant upload and admin document upload permissions.
- Keep public registration document uploads working.

Risks:

- Over-tightening can break public registration forms.
- Under-tightening may allow unwanted file uploads.

## 7. Admin Bulk Registration Import

Priority: Medium

Add an admin bulk registration import flow per event program. The import should behave like admin-assisted manual registration, not as a separate shortcut path.

Expected scope:

- Add a `Download Template` action under each program.
- Generate the template from that program's current registration fields, participant count rules, custom fields, fee structure, and program type.
- Ignore document upload fields during bulk import even if document upload is enabled or required for public registration.
- Add an `Import Registrations` action under each program.
- Admin chooses imported payment outcome: paid (`S`), waived (`W`), or pending collection (`PC`).
- If paid, collect payment method/reference fields as needed.
- Admin note is required.
- Imported records should create the same core data as admin manual registration: registration, participant groups, participants, custom field values, payment, payment items, receipt/payment state where applicable, and audit logs.
- Use short status codes only in database/API.

Validation and transaction rule:

- Strict mode: if any row/entry has an error, import nothing.
- Error response must clearly identify the bad Excel row/entry, participant if applicable, field, and reason.
- Preferred implementation can be either:
  - Parse and validate all rows first, then commit only if the whole file is clean.
  - Or run the full import inside a database transaction and rollback on any validation/persistence failure.
- Choose the approach that best reuses existing registration validation and avoids duplicate business logic.

Risks:

- Duplicate participant/team checks, capacity checks, fixture locks, age/gender rules, required custom fields, and payment total rules must match manual/admin registration behavior.
- Template format must be stable enough for admins to fill correctly but flexible enough for singles, doubles, per-entry, per-head, and team programs.
- Need clear row-level error reporting so strict import failures are actionable.

## 8. DB-Backed Upload/File Storage

Priority: Medium before production

Move newly uploaded TRS files from backend local disk storage to database-backed storage while keeping existing URL fields as references.

Expected scope:

- Add an `UploadedFiles` table for file metadata and bytes.
- Store file bytes in the database for new uploads.
- Keep existing URL/path fields in events, gallery images, documents, participant uploads, and config values where practical.
- Return DB-backed URLs such as `/api/files/{fileId}` from the upload endpoint.
- Add a file-serving endpoint that streams the stored bytes with the correct content type.
- Preserve old `/uploads/...` URLs temporarily so existing testing data does not break.
- Apply existing file size/type validation rules.
- Review whether any file endpoints should be public versus admin-protected.

Risks:

- Database size and backup/restore time will increase, though expected TRS volume is small.
- File-serving performance is lower than static/object storage, but acceptable for the expected event/image volume.
- Must avoid breaking existing banner, gallery, event document, participant document, logo, ad image, and hero image display paths.

## 9. Transactional Email Provider Adapter

Priority: Low to Medium before production

SMTP, Microsoft Graph, and Gmail API delivery are now config-selectable through `Email:Provider`. If production needs a dedicated transactional provider, add a provider adapter for the selected service.

Expected scope:

- Choose the provider, such as SendGrid, Resend, Mailgun, AWS SES, or another vendor.
- Add an adapter behind the existing `EmailService` provider switch.
- Document required environment variables/secrets for that provider.
- Preserve current receipt, registration-details, refund, cancellation, reconciliation, and landing contact email templates and attachments.

Risks:

- Provider-specific attachment limits, sender verification, throttling, webhook status tracking, and retry behavior may differ.
- Email retry/idempotency should align with the durable email/background job pending task.
