# TLS event setup export

The read-only `TlsExportController` supplies event setup to Tournament Livescore System (TLS). It does not change registration, payment, fixture generation or ranking behaviour.

## Endpoints

Both routes require the existing TRS JWT with `superadmin` or `eventadmin` role:

- `GET /api/tls-export/events`: active sports events (ID, name, venue and start date).
- `GET /api/tls-export/events/{id}`: version 1 setup package containing the event, active programs, non-cancelled registration groups and their non-cancelled participants.

The package includes the master `displayTimeZone` (default `+08:00`) and an offset-aware export timestamp. Dates of birth and event dates are calendar dates and must not be shifted during conversion. The export takes a consistent serializable transaction snapshot; very large events may temporarily contend with administrative writes.

Program capacity maps `per_player` to `P` (players), otherwise `E` (entries). Roster limits, age limits, gender requirements, seeds and the event program limit are included. Fees, payment state, guardian information, documents and custom registration fields are excluded. Name, DOB, gender, email, contact number, club, nationality and optional SBA ID are included for event operations. No fixture or SBA ranking download is introduced in this step.

IDs retain source entity type and ID. TRS participant IDs are registration-group records, not universal person identities. TLS namespaces them per connection and requires explicit organiser review to link matching name/DOB records across programs. It must never merge people just by name. Invalid or incomplete source data fails TLS's preview rather than bypassing eligibility validation.

## Integration and verification

TLS uses the existing TRS administrator sign-in endpoint. Credentials are transmitted only to the configured HTTPS TRS origin (localhost HTTP is permitted for development). Tokens remain in the browser session's memory and are forwarded by the local server; TLS does not store passwords or tokens in its database. Expired tokens require reconnecting. The export does not use or expose database credentials.

No TRS SQL migration is required. Deploying the controller with the existing API makes the endpoints available. Rollback is removal of the controller and redeployment of the earlier build; there is no TRS data migration to reverse.

Validation: compile TRS API; verify role restrictions and mapped package fields; use TLS's isolated HTTP tests for download, preview, explicit identity links, repeat imports and failure handling. Live authenticated export against a deployed TRS event requires that instance's authorised administrator access and is a UAT check.
