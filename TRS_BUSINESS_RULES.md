# TRS_BUSINESS_RULES.md — Business Logic Rules
**All rules extracted directly from code. Source file noted per rule.**

---

## 1. Event Rules

**Event visibility (EventsController.GetAll / GetById):**
- IF `includeInactive=true` AND user is NOT `superadmin` or `eventadmin` → force `includeInactive=false`
- Public users only see events where `IsActive=true`
- Admin users can request inactive events via `?includeInactive=true`
- Events are ordered by `EventStartDate` descending

**Event deletion:**
- `DELETE /api/events/:id` performs a SOFT delete: sets `IsActive=false`, `UpdatedAt=now`
- No hard delete exists in code

**Event open window (RegistrationWorkflowService.IsEventOpen):**
- Event is OPEN if: `IsActive=true` AND `OpenDate ≤ today(UTC)` AND `CloseDate ≥ today(UTC)`
- Uses `DateOnly.FromDateTime(DateTime.UtcNow)` — UTC date comparison
- `RequireEventOpen=true` on paid registration flow; `RequireEventOpen=false` on webhook finalisation (payment already collected)

**AdditionalInfo (HTML):**
- Sanitised via `HtmlSanitizer` (Ganss.Xss) before DB write on every create/update
- Strips script tags, iframes, and other dangerous elements
- Null/whitespace input is stored as `null` in DB

---

## 2. Program Rules

**Program status:**
- Valid values: `"open"` | `"closed"`
- `PATCH /api/events/:eid/programs/:pid/status` only accepts `"open"` or `"closed"`; returns 400 otherwise
- Program is registrable IF: `IsActive=true` AND `Status != "closed"`

**Program deletion:**
- Soft delete: sets `IsActive=false`, `UpdatedAt=now`
- No hard delete in code

**Fee structures:**
- `"per_entry"` — flat fee for the entire group (1 PaymentItem per ParticipantGroup)
- `"per_player"` — fee × number of participants (1 PaymentItem per Participant in group)

---

## 3. Registration Rules

### 3.1 Event Open Check
```
IF RequireEventOpen=true:
  IF Event.IsActive=false → FAIL: EVENT_NOT_FOUND
  IF today < Event.OpenDate OR today > Event.CloseDate → FAIL: EVENT_CLOSED
```

### 3.2 Group / Program Checks (per group in request)
```
IF Program.IsActive=false OR Program.Status="closed" → FAIL: PROGRAM_CLOSED
IF (activeGroupCount + requestedGroupsForThisProgram) > Program.MaxParticipants → FAIL: PROGRAM_FULL
```
**Note:** Capacity is measured in `ParticipantGroup` rows (i.e., entries), not individual participants. `MaxParticipants` on `TrsProgram` is actually max entries.

### 3.3 Participant Count per Group
```
IF group.Participants.Count < Program.MinPlayers → FAIL: INVALID_PARTICIPANT_COUNT
IF group.Participants.Count > Program.MaxPlayers → FAIL: INVALID_PARTICIPANT_COUNT
```

### 3.4 Required Participant Fields (always required)
```
FullName         → FAIL: MISSING_REQUIRED_FIELD if blank
DateOfBirth      → FAIL: MISSING_REQUIRED_FIELD if blank or unparseable
Gender           → FAIL: MISSING_REQUIRED_FIELD if blank
Email            → FAIL: MISSING_REQUIRED_FIELD if blank
ContactNumber    → FAIL: MISSING_REQUIRED_FIELD if blank
Nationality      → FAIL: MISSING_REQUIRED_FIELD if blank
ClubSchoolCompany → FAIL: MISSING_REQUIRED_FIELD if blank
```

### 3.5 Optional Fields (enabled per program via ProgramFields flags)
```
IF Program.Fields.EnableTshirt=true:
  TshirtSize required → FAIL: MISSING_REQUIRED_FIELD if blank
IF Program.Fields.EnableGuardianInfo=true:
  GuardianName AND GuardianContact both required → FAIL: MISSING_REQUIRED_FIELD
IF Program.Fields.EnableSbaId=true AND Program.SbaRequired=true:
  SbaId required → FAIL: MISSING_REQUIRED_FIELD if blank
```

### 3.6 Custom Field Validation
```
FOR each CustomField where IsRequired=true:
  IF participant.CustomFieldValues[field.Label] is missing or blank → FAIL: MISSING_REQUIRED_FIELD
```

### 3.7 Age Validation
```
age = today.Year - dob.Year
IF dob > today.AddYears(-age): age -= 1   (birthday not yet reached this year)
IF age < Program.MinAge → FAIL: INVALID_AGE
IF age > Program.MaxAge → FAIL: INVALID_AGE
```
Age is calculated from UTC today's date. MinAge defaults to 0, MaxAge defaults to 99.

### 3.8 Gender Validation
```
IF Program.Gender = "Male":
  IF participant.Gender != "Male" → FAIL: INVALID_GENDER
IF Program.Gender = "Female":
  IF participant.Gender != "Female" → FAIL: INVALID_GENDER
IF Program.Gender = "Mixed":
  IF maleCount != 1 OR femaleCount != 1 → FAIL: INVALID_GENDER
  (exactly one male and one female required)
```
"Open" gender programs accept any gender combination.

### 3.9 Duplicate Detection (per registration request)
**Within same request:**
```
identity key = FullName + "|" + DateOfBirth (yyyy-MM-dd)
IF duplicate identity within same group → FAIL: DUPLICATE_REGISTRATION
```

**Against existing DB registrations:**
```
Check existing non-Cancelled ParticipantGroups for same Program
  for each participant in incoming group:
    IF FullName (case-insensitive) AND DateOfBirth matches any existing participant → FAIL: DUPLICATE_REGISTRATION
```
This check happens TWICE: once in `ValidateParticipants()` (pre-transaction) and once in `FindDuplicateAsync()` + `CreateAsync()` under `UPDLOCK, ROWLOCK` (inside transaction).

### 3.10 Pricing Validation
```
expectedFee = Program.Fee (if FeeStructure="per_entry")
            = Program.Fee × group.Participants.Count (if FeeStructure="per_player")
IF Program.PaymentRequired=false: expectedFee = 0
IF ValidatePricingAgainstCurrentPrograms=true:
  IF group.Fee != expectedFee → FAIL: PRICE_MISMATCH
  IF sum(group fees) != request.Payment.Amount → FAIL: PRICE_MISMATCH
```
Price validation is bypassed during webhook finalisation (`ValidatePricingAgainstCurrentPrograms=false`). The Stripe session amount is used as the authoritative amount instead.

---

## 4. Capacity Rules

- Capacity is counted as: `COUNT(ParticipantGroups WHERE ProgramId=X AND GroupStatus != "Cancelled")`
- A registration being processed is counted against capacity BEFORE the transaction commits (because `SELECT WITH (UPDLOCK, ROWLOCK)` is used)
- A full program returns PROGRAM_FULL for any new registration, even if 1 slot remains but the incoming request requests more than 1
- Program-level `MaxParticipants` (on `TrsProgram`) controls capacity. Event-level `MaxParticipants` (on `Event`) exists but is NOT currently enforced in any validation code — it is display-only.

---

## 5. Payment Status Lifecycle

**PaymentStatus codes (stored as VARCHAR(2) in DB):**
```
P  = Pending (checkout created, awaiting Stripe confirmation)
S  = Paid / Success
PR = Partially Refunded (some items refunded)
FR = Fully Refunded (all items refunded)
F  = Failed (gateway rejection)
X  = Cancelled (user abandoned or admin voided)
W  = Waived (admin waived fee)
PC = Pending Collection (admin confirmed, payment to be collected later)
```

**Admin-allowed status transitions (CanAdminSetPaymentStatus):**
```
P  → S, W, PC     (pending → paid, waived, or deferred)
PC → S, W, PC     (deferred → paid, waived, or keep deferred)
S  → S only       (no downgrade)
W  → W only       (no change)
PR, FR, F, X → blocked (cannot change terminal refund/fail/cancel states)
```

**Auto-transitions on webhook `checkout.session.completed`:**
```
Payment.PaymentStatus = S
All PaymentItems.ItemStatus = S
Registration.RegStatus = "Confirmed"
Registration.RegistrationStatus = "C"
```

**Auto-transitions on refund success:**
```
IF all PaymentItems refunded: PaymentStatus = FR
IF some PaymentItems refunded: PaymentStatus = PR
IF refundedAmount for item >= item.Amount: ItemStatus = R
```

---

## 6. Refund Rules

**Source:** `RegistrationsController.ProcessRefundItemAsync()`, `AdminPaymentReconciliationController.RefundOrphanedPayment()`

```
RULE 1: Only items with ItemStatus="S" can be refunded
  IF item.ItemStatus != "S" → FAIL: INVALID_STATE

RULE 2: Cannot over-refund
  refundedToDate = SUM(Refunds WHERE PaymentItemId=X AND RefundStatus="S")
  remaining = item.Amount - refundedToDate
  IF refundAmount > remaining → FAIL: OVER_REFUND

RULE 3: No concurrent pending refunds on same item
  IF existing Refund WHERE PaymentItemId=X AND RefundStatus="P" exists:
    IF GatewayRefundId is already set → FAIL: REFUND_IN_PROGRESS
    IF RefundAmount differs → FAIL: REFUND_IN_PROGRESS
    (if same amount and no gateway ID, reuse the existing pending refund)

RULE 4: Refund idempotency key
  IdempotencyKey = "trs_refund_{refund.RefundId}" (Stripe-level dedup)

RULE 5: Non-Stripe payments (Manual gateway)
  RefundStatus immediately set to "S" without Stripe API call

RULE 6: Orphan refunds (Case C — unmatched Stripe payment)
  Only superadmin can issue
  Requires Reason (non-blank)
  Session must have PaymentStatus="paid" on Stripe
  Session AmountTotal must be > 0
  Refund row written with PaymentId=null, PaymentItemId=null
  IdempotencyKey = "orphan_refund_{GatewaySessionId}"
  Uses SERIALIZABLE transaction with UPDLOCK to prevent concurrent orphan refunds
```

---

## 7. Admin Override Rules

**Manual payment confirmation (POST /api/registrations/:id/confirm):**
```
Allowed payment statuses: S (Paid), W (Waived), PC (Pending Collection)
IF status=S or W: stamp PaidAt, generate ReceiptNumber, set all PaymentItems to S
IF no Payment record exists: create one with PaymentGateway="Manual"
IF Payment exists: apply CanAdminSetPaymentStatus transition rules
Registration always set to Confirmed regardless of payment status
All ParticipantGroups set to Confirmed
AdminNote required (MinLength=3)
```

**Manual payment update (PATCH /api/registrations/:id/payment):**
```
Can update: PaymentStatus, PaymentMethod, ReceiptNumber, AdminNote
Same CanAdminSetPaymentStatus transition rules apply
If status becomes S: auto-generate ReceiptNumber, stamp PaidAt, flip items to S, confirm registration
```

**Status patch (PATCH /api/registrations/:id/status):**
```
Allowed values: Pending, Confirmed, Cancelled, CancelPending, RefundFailed
Cascades to ALL ParticipantGroups in the registration
```

**Group status patch (PATCH /api/registrations/:id/groups/:gid/status):**
```
Same allowed values
Affects only the specified group, NOT the registration status
```

**Participant update (PATCH /api/registrations/:id/participants/:pid):**
```
Any field can be updated individually (all nullable — only present fields are applied)
IF FullName or Dob is changed:
  Re-run duplicate check (excluding self by ParticipantId)
  IF duplicate found → FAIL: DUPLICATE_PARTICIPANT
Custom field values: upsert by label
  IF label exists in participant → update value
  IF label exists in program fields → insert new row
  IF label not in program fields → silently skip
```

---

## 8. Cancellation Rules

**POST /api/registrations/:id/cancel-with-refunds:**
```
Reason is required (non-blank)

IF no Payment exists OR no items with ItemStatus="S":
  → directly set Registration to Cancelled
  → NO refund attempted

IF paid items exist:
  → set Registration to CancelPending
  → FOR each item with ItemStatus="S":
      compute remaining refundable = item.Amount - sum(successful refunds for item)
      IF remaining > 0: attempt Stripe refund
      collect errors

  → IF all refunds succeeded AND no remaining S items:
      set Registration to Cancelled
  → ELSE:
      set Registration to RefundFailed

Registration.RegStatus reflects the FINAL outcome
Partial failures leave Registration in "RefundFailed"
```

---

## 9. Fixture / Tournament Rules

**Fixture modes (per event):**
- `"internal"` — bracket managed by TRS fixture wizard
- `"external"` — external system manages fixtures
- `"not_required"` — no fixtures

**Minimum entries to generate:**
- At least 2 non-Cancelled ParticipantGroups required to generate a fixture
- Returns FAIL: NOT_ENOUGH if fewer than 2

**Fixture formats (FixtureGenerationService):**
- `"knockout"` — single elimination bracket
- `"group_knockout"` — round-robin groups → top N advance to single elimination
- `"round_robin"` — everyone vs everyone, standings only
- `"heats"` — individual results per round → advancement → final

**Fixture uniqueness:**
- One `Fixture` row per (EventId, ProgramId) pair — enforced by `UQ_Fixtures_EventProgram`
- Existing fixture is replaced on regenerate (upsert logic in `FixturesController.Save`)

**Locking:**
- `Fixture.IsLocked` flag can be set; UI respects this to prevent edits, but backend does not enforce lock in score/schedule endpoints

**SBA seed integration:**
- `Program.SbaRankingType` links a program to an SBA ranking type
- Fixture wizard uses `ParticipantGroup.Seed` (set by admin via `PATCH .../seed`) for seeding
- SBA ID stored on `Participant.SbaId`

---

## 10. SBA (Singapore Badminton Association) Rules

- 35 ranking types: Men's/Women's/Mixed Singles/Doubles + U9–U19 Boys/Girls age groups
- Import replaces all rows for the included sheet types (full replace, not merge)
- Singles row: Ranking, PlayerName, MemberId, YearOfBirth, Points, Tournaments, Club, DOB
- Doubles row: same fields × 2 players
- Player2SbaId must be non-null to qualify for the doubles filtered unique index
- SBA ID lookup is normalised to uppercase before storage and comparison
- Search by name: case-sensitive `Contains()` match, limited to 20 results
- `InferMaxAge` for U-age categories: U19→18, U17→16, U15→14, U13→12, U11→10, U9→8

---

## 11. Payment Reconciliation Rules

**Case A (RegStatus=Confirmed, Payment.PaymentStatus=P):**
- Registration confirmed but payment shows Pending in DB
- Indicates webhook fired but `confirm-session` already wrote registration without payment, or a data inconsistency

**Case B (RegStatus=Pending, Payment.PaymentStatus=S):**
- Payment succeeded on Stripe but registration not confirmed
- Indicates webhook failed or race condition

**Case C (WebhookLog.ProcessingStatus=F, EventType=checkout.session.completed, no matching Payment row):**
- Money collected by Stripe but no registration created at all
- PendingCheckout was likely missing or payload was corrupt
- Visible in `GET /api/admin/payment-reconciliation/webhook-failures`
- Self-healed rows (where a Payment was later written for the same session) are automatically filtered out
- Only superadmin can issue refunds for Case C rows

**Webhook deduplication:**
- On receipt: check `WebhookLogs WHERE GatewayEventId=X AND ProcessingStatus IN (S, I)` — if found, return 200 immediately (already handled)
- `"I"` status = "Ignored" (event types other than the three handled ones)
