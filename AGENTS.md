# AGENTS.md

## Purpose

This repository contains the Tournament Registration System (TRS), a monorepo with:

- `Frontend/`: React 18 + TypeScript + Vite single page app.
- `Backend/TRS_API/`: ASP.NET Core 8 Web API.
- `Backend/TRS_Data/`: EF Core 8 model project for SQL Server.

The codebase is the source of truth. Prefer correctness, maintainability, and minimal risk over broad rewrites.

## Before Making Changes

First provide:

1. Understanding of the request
2. Files likely to be modified
3. Potential risks
4. Proposed implementation plan

Do not immediately start coding when requirements are ambiguous. Ask questions when business rules are unclear, especially around registration, payment, refunds, fixtures, ranking, seeding, or admin override behavior.

When the user asks a question, asks for advice, or describes a possible issue without explicitly asking for implementation, first answer with:

1. Whether it needs a change
2. Proposed fix/solution
3. Files likely affected
4. Risks or alternatives

Then ask for permission before modifying files. Do not edit files immediately unless the user clearly asks to implement, fix, amend, update, or proceed.

## Change Scope

Only modify files directly related to the requested task.

Do not:

- Refactor unrelated code
- Rename files unnecessarily
- Reorganize folders
- Change coding style across the project
- Modify unrelated components
- Revert user changes or unrelated working-tree changes

Keep changes focused and surgical.

Do not leave temporary build, browser, test, or scratch folders in the repository. If a temporary folder is necessary, explain why, keep it ignored or outside the repo when practical, and remove it before finishing.

## Existing Patterns First

Prefer existing project patterns:

- ASP.NET Core controllers call EF Core through `TRSDbContext` directly or delegate shared behavior to services.
- Shared registration validation and persistence belongs in `RegistrationWorkflowService`.
- Stripe finalization idempotency belongs in `PaymentFinalizationService`.
- Fixture generation and bracket mutation belongs in `FixtureGenerationService`.
- Frontend API calls should use `Frontend/src/lib/api/*` and `apiFetch`.
- Shared participant field behavior belongs in `ParticipantFieldsForm`.

Avoid introducing new frameworks, architectural layers, or abstractions unless there is a clear justification.

Admin-created, updated, deleted, imported, or generated business data should use `AdminAuditService` when an authenticated admin performs the action. Include old/new snapshots where practical, especially for master data, event/program changes, imports, and fixture mutations.

## Database Safety

Treat database changes as high risk.

Before adding migrations or SQL scripts, explain:

- Impact
- Rollback strategy
- Affected tables
- Whether the change is additive or destructive

Never drop tables, drop columns, or delete production data without explicit approval.

Current database notes:

- EF Core models live in `Backend/TRS_Data/Models`.
- The project currently uses SQL scripts under `Backend/TRS_Data/Sql`; EF migration files are not present.
- `TRSDbContext` maps `BadmintonClub` singular table through `DbSet<BadmintonClub> BadmintonClubs`.
- `AppLogs` is written by a custom Serilog EF sink.

## API Safety

Preserve existing API contracts whenever possible.

Before changing request or response models:

- Explain breaking changes
- Identify affected frontend API modules and screens
- Prefer backward-compatible alternatives

Important public API surfaces include:

- Event browsing: `/api/events`
- Registration lookup and receipt: `/api/registrations/{id}`, `/api/registrations/{id}/receipt`
- Payment checkout and confirmation: `/api/Payment/*`
- Badminton club lookup: `/api/clubs`
- SBA lookup: `/api/sba/*`

## Authentication and Authorization

Preserve existing JWT authentication, role-based authorization, and password-change behavior.

Roles currently used:

- `superadmin`
- `eventadmin`

Do not modify authentication flows unless explicitly requested.

## Payment Safety

Payment-related functionality is critical.

Before modifying payment flows:

- Explain business impact
- Identify affected scenarios
- List required validation tests

Never bypass payment validation, Stripe verification, refund state checks, or idempotency protections without explicit requirements.

Payment-critical areas:

- `PaymentController`
- `StripeWebhookController`
- `PaymentFinalizationService`
- `RegistrationWorkflowService`
- `AdminPaymentReconciliationController`
- Payment/refund portions of `RegistrationsController`

## Business Rules

Never assume business rules. If uncertain, ask for clarification.

High-risk rule areas:

- Registration open/close windows
- Program capacity
- Participant count, age, gender, and duplicate checks
- Required program fields and custom fields
- Fee structure and pricing validation
- Admin payment confirmation
- Cancellation and refunds
- SBA ranking import and lookup
- Fixture generation, seeding, score entry, and advancement
- Badminton club selection and "Others" behavior

## Code Quality

Generated code must:

- Compile successfully
- Follow existing conventions
- Avoid placeholder implementations
- Avoid TODO-only solutions
- Be production-ready
- Keep comments useful and sparse

## Testing

For every change provide:

### Happy Path

Expected successful behavior.

### Validation Cases

Expected validation failures.

### Edge Cases

Important boundary conditions.

Run focused verification when practical:

- Backend: `dotnet build Backend/TRS_API/TRS_API.csproj`
- Backend tests, if added later: `dotnet test`
- Frontend: `npm.cmd run build` from `Frontend/`

## Local Dev Workflow

Before running a backend build, check whether `TRS_API` is already running when practical. Do not stop or kill the API process unless explicitly requested.

If `dotnet build` fails because `TRS_API.exe` or related backend output files are locked by a running API process, do not create alternate temporary build/output folders.

Instead:

- Tell the user the API process is locking the build output.
- Ask the user to stop the running API.
- Retry the normal build only after the user confirms the API has stopped.

Before finishing, mention visible unrelated working-tree changes if they could affect review, staging, or deployment. Do not stage, commit, delete, or format unrelated files unless explicitly requested.

## Output Format

After implementation provide:

1. Summary of changes
2. Files modified
3. Database impact
4. API impact
5. Testing checklist
