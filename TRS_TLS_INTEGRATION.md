# Event-level live scores and results

This contract applies to TRS-TLS Integration. The historical per-program
contract follows below for older publishers.

| Route | Current contract |
| --- | --- |
| PUT /api/integration/live-scores | Replace the event live JSON when version increases. |
| PUT /api/integration/event-results | Publish the full event, with every program and the confirmed results so far. |
| GET /api/events/{eventId}/live | Read the latest live snapshot by event. |
| GET /api/events/{eventId}/results | Read event results, optionally filtered by programId for existing links. |
| GET /api/events/{eventId}/score-availability | Identify which event navigation buttons have data. |

Authenticated publishing supports active non-sport registration events. The
results payload has programId null and a full programs array of id, name, optional
reference and canLink. Matches carry programId, phase, round, roundLabel and an
optional ISO matchDate. References marked canLink false are display-only. TLS
publishes confirmation, correction and clearing without waiting for every
program to finish. The receiver accepts a higher version within each stream
and keeps the sender generatedAt and receiver ReceivedAt.

EventResultSnapshots stores one result JSON row per event. TRS manual fixture
changes project confirmed matches and heats into the same format inside the
fixture write transaction. The first event result source owns its public result
snapshot. Existing manual results reserve manual ownership. Older results
without an event snapshot use a compatibility read until a new snapshot is saved.
TlsLiveSnapshots remains independent. TlsResultSnapshots serves the admin program
results for exact matches between the active TRS program IDs and the complete
linkable TLS program list. Mismatches remove prior links while retaining the
public result snapshot.

Public navigation is at event level. Results can be browsed by program, round and
match date where present. Live scores are grouped by court. Admin Fixture
Management has a read-only View Results action for linked TLS programs, and
manual results continue using the existing fixture editor.

Apply Backend/TRS_Data/Sql/20261125_create_event_result_snapshots.sql after the
existing TLS snapshot migration, before deploying the new TRS API. Deploy the
compatible TRS API and frontend before switching TLS event URLs to the new
results endpoint. For rollback, restore previous application builds and the
previous per-program URL for compatible events. Leave the additive table in place.
Events with unmatched public snapshots need the new receiver and read path.

## Previous integration behavior

# TRS–TLS live scores and public results

## Responsibilities and result priority

TRS exports event setup. TLS operates its draw, schedule and scoring. TLS publishes spectator snapshots; receiving a snapshot never creates or changes a TRS fixture, participant, registration or payment.

For each program, public results use TRS whenever an existing TRS fixture has a completed/walkover result, or a completed heat. Automatic BYEs and unscored fixtures alone do not trigger this priority. Otherwise the latest accepted TLS result snapshot is used. Sources are never mixed within a program view. Removing all recorded TRS results makes the stored TLS snapshot visible again.

TRS exports only events explicitly marked **Ready for Event Integration**. In Event Details, the header button beside Edit Event is labelled Ready Event Integration or Cancel Event Integration. It is enabled only when the effective registration status is Closed. Clicking immediately attempts the action and shows the existing success/error feedback dialog, including individual readiness failures. There is no separate integration panel, readiness-check button or advance confirmation step. Marking validates closed registration, no existing TRS fixtures, active programs meeting their configured minimum count, required players, participant statuses/names/DOB and no pending (`P`) registrations or active groups. Only confirmed (`C`) registrations/groups and non-cancelled players are exported; `X`, `CP` and `RF` registrations are excluded. Payment records, amounts and payment statuses are not eligibility criteria: confirmed unpaid/pending-collection entries remain eligible.

While marked, the TRS admin screens prevent fixture management, event/program editing, participant editing and cancellation. Restricted actions stay clickable and show a warning that no changes are allowed until Event Integration is cancelled; they do not open editing or submit mutations. These are frontend controls, not backend editing locks. Cancel Event Integration to restore those controls. Payment collection and standalone refunds remain available; cancellation with refund is a roster change and stays unavailable. Readiness marking still validates the event and export still revalidates eligibility. Cancelling integration removes retrieval eligibility but does not delete or update an existing external copy. There is no transfer acknowledgement or remote ownership synchronization.

## Setup and deployment

1. Apply `Backend/TRS_Data/Sql/20261104_event_integration_readiness.sql` (adds `Events.ReadyForEventIntegration bit NOT NULL DEFAULT 0`, so existing events remain unmarked). Then apply `Backend/TRS_Data/Sql/20261103_create_tls_snapshots.sql` to the TRS database before deploying the new application. The idempotent script adds only `TlsLiveSnapshots` and `TlsResultSnapshots`. Existing business tables/data are unchanged.
2. Configure one random integration key of 32-512 printable characters in TRS as `TlsIntegration__ApiKey` and in TLS as `Trs__ApiKey`. Never commit credentials. Both event exports and publishing authenticate with `X-TLS-Key`. The key permits integration access across events; it does not grant admin API access. Rotate it in both systems together.
3. Set `TlsIntegration__SourceSystemId` to a stable identity for this TRS installation. Its default is `TRS`; installations sharing a TLS database must use distinct identities.
4. TLS can fetch eligible events using Master Setting → TRS Connection: TRS API URL (origin, e.g. `https://trs.example`) and Integration key (the same TRS key used for publishing). The local admin can view the key as plain text; storage is encrypted and public responses never expose it. Changes apply to the next fetch without a TLS restart. Existing `Trs__ApiBaseUrl` and `Trs__ApiKey` settings are fallback values until the connection is first saved in Master Setting. Existing transfer-file import remains available.
5. In TLS Event Settings → Score Publishing, enter:
   - Live URL: `https://trs.example/api/integration/live-scores`
   - Results URL: `https://trs.example/api/integration/results`
   - API credential: the same TRS integration key configured above.
   - The live interval (2–120 seconds; default 5).
   - Enable and save publishing.

TRS uses the same integration key for exports and receiving snapshots. TLS keeps the import key encrypted in master settings and each publishing credential encrypted separately in its event settings. The event credential field remains available: use the TRS key for a TRS destination, or a different credential for another compatible website. Publishing never falls back to the server import key. Saved publishing keys are returned only by the TLS local-admin settings endpoint and shown as plain text in Score Publishing; public responses and audits do not contain them. Existing administrator JWT access to exports remains supported; payment and registration authentication are unchanged. No database migration is required. Rollback requires restoring the previous authentication configuration; event publishing credentials remain compatible.

Use HTTPS outside the local development network. Publishing URLs are organiser-controlled outbound destinations; redirects are disabled so credentials are not forwarded to another host.

## APIs

| Method and path | Purpose |
|---|---|
| GET `/api/tls-export/events` | Authenticated eligible event list: closed registration, no fixtures |
| GET `/api/tls-export/events/{eventId}` | Authenticated schema-2 setup transfer; rechecks eligibility |
| PUT `/api/integration/live-scores` | Complete live snapshot; reads event ID from the payload; `X-TLS-Key` |
| PUT `/api/integration/results` | Complete program results; reads event/program IDs from the payload; `X-TLS-Key` |
| PUT `/api/tls/events/{eventId}/live` | Event-scoped complete current live snapshot; `X-TLS-Key` |
| PUT `/api/tls/events/{eventId}/programs/{programId}/results` | Complete confirmed program results; `X-TLS-Key` |
| GET `/api/events/live-status` | Event IDs with nonempty live snapshots, for landing badges |
| GET `/api/events/{eventId}/score-availability` | Current live availability and programs with viewable TRS/TLS results |
| GET `/api/events/{eventId}/live` | Public current matches, refresh interval and last receipt |
| GET `/api/events/{eventId}/results?programId={programId}` | Public programs and TRS-first results |

Setup transfer is version 2. Event/program source IDs are `event:123` and `program:456`. TLS retains local readable IDs plus original mappings, and publishes the numeric original IDs. Repeated players with the same normalized name and DOB are represented once in the export, using the earliest participant identity, with all program entries referencing that person. This affects only the transfer representation.

## Snapshot schema (version 1)

Both receiving endpoints accept this envelope; live requests use `programId: null` and contain every currently playing/awaiting-confirmation match in the event. Results contain every confirmed result across the program's rounds.

```json
{
  "schemaVersion": 1,
  "eventId": 123,
  "eventName": "Badminton Open",
  "programId": 456,
  "programName": "Men's Singles",
  "version": 1793685600000001,
  "generatedAt": "2026-11-03T06:00:00Z",
  "timeZone": "Asia/Singapore",
  "refreshSeconds": 5,
  "matches": [{
    "id": "EV000001-P001-M0001",
    "programId": 456,
    "programName": "Men's Singles",
    "phase": "G",
    "round": 1,
    "roundLabel": "Group Stage",
    "group": "Group A",
    "team1": { "id": "entry:10", "name": "Player A", "players": ["Player A"], "seed": null },
    "team2": { "id": "entry:11", "name": "Player B", "players": ["Player B"], "seed": null },
    "games": [{ "a": 21, "b": 18 }, { "a": 21, "b": 19 }],
    "winner": "A",
    "outcome": "N",
    "remark": "",
    "matchDate": "2026-11-03",
    "startTime": "14:00",
    "endTime": "14:40",
    "court": "1",
    "status": "C",
    "scoreA": null,
    "scoreB": null,
    "serverSide": null
  }]
}
```

- Match and entry references describe snapshot content; they are not reconciled against TRS fixture/entry records. Doubles list both players.
- Phase codes: `G` group, `K` knockout. Winner/serving side: `A` or `B`.
- Results: `C` completed, `W` walkover, `BY` automatic BYE. Live: `IP` playing, `RC` awaiting organiser confirmation, with current integer scores.
- Outcomes: `N` normal, `WO` walkover, `BY` BYE. Other outcome codes are retained, with a readable remark (e.g. `R` retirement, `D` disqualification, `M` admin decision). Partial exceptional scores are preserved.
- Dates use `yyyy-MM-dd`, match times `HH:mm` or `HH:mm:ss` in the supplied venue timezone. Generated/received timestamps include UTC offsets.
- TRS explicitly maps supported fields. Unknown optional properties are ignored and not echoed publicly. Invalid required fields, unknown programs, or programs from another event reject the entire snapshot.
- Requests are limited to 5 MB and 10000 matches. Replacement is atomic under a SQL transaction.

## Delivery and recovery

Versions increase independently per event/live stream and per program/results stream. TLS reserves them in existing durable ID counters; restart does not reset them. TRS accepts only newer versions; duplicate/older requests return success with `accepted: false` and the current version, without changing data or receipt time.

Successful new snapshots replace only the named event/program. An empty live list clears that event's live scores and updates its last-received time. An explicit newer empty result list clears only that program's received TLS results. Neither clears TRS fixtures/manual results.

TLS sends live snapshots periodically and attempts an immediate empty publication when no live matches remain. Confirmed-result changes are detected and publish a full program snapshot. A failed result send is not queued or repeatedly retried automatically; use Resend Results in TLS Fixture and Result for the selected program. Manual resending requires configured publishing and at least one confirmed result, and never sends live scores. Startup republishes the current state for enabled events. Alerts are cleared after successful sends; alert history is not persisted.

Public live snapshots remain stored until replaced. While a snapshot contains `IP` or `RC` matches, the Live Scores page shows **Live updates delayed — showing last received scores** when its last TRS receipt is at least the greater of 15 seconds or three configured publication intervals old. The page checks age every second, including during a pending fetch. A fresh receipt or empty match list clears the warning automatically. Missing/invalid receipt timestamps on a nonempty active feed also show the warning. Receipt age uses the browser clock; keep venue/viewer clocks synchronized. The warning is informational and does not block scoring or administrator actions.

Failed browser requests retain previous data/timestamps and show the fetch error instead of a second delay warning. An interrupted final empty publication can still leave an old event-card LIVE badge until TLS publishes successfully again; the active match page now identifies the delayed feed. An empty snapshot means nothing playing now, including during breaks; it does not declare the event finished.

## Public navigation

- Event card LIVE badge → `/event/{eventId}/live` (all playing programs, no day/program filters).
- Event Information → View Live Scores, shown only when the event has current live matches.
- Program card → View Results → `/event/{eventId}/results?program={programId}`, shown only when that program has viewable results. Unscored TRS fixtures alone do not enable it. Availability refreshes using the live snapshot interval (5 seconds before a snapshot exists); links stay hidden until a successful check.
- Results have a program dropdown and round tabs, including Group Stage. The same read-only match component displays both result sources and live player-aligned scores.
- Viewing pages use the public landing theme and reserve space below the fixed header for Back to Event. Direct links remain valid when the data becomes empty.
- The live page shows Last fetched (the browser's last successful TRS fetch) and Last received from TLS (the stored TRS receipt timestamp), using the configured display timezone/date-time format. Live score content refreshes at the configured interval. Results refresh every 5 seconds; each successful response replaces the displayed results, including an empty list after a schedule reset. Program/round selection is retained while available, with fallback when a round is removed.
- Both score pages pause polling while hidden and refresh immediately when visible again, focused or reconnected. Requests are serialized; refresh events during a request coalesce into one follow-up fetch. A stalled fetch is aborted after 15 seconds and retried at the current polling interval. Fetch failure preserves scores, both successful timestamps and the previous interval; leaving the page aborts the request and cancels polling/listeners. Program/event navigation discards late responses from the previous selection.

## Verification and rollback

Focused tests cover validation, source priority, SQL replacement/version isolation, migration-script repeatability, public navigation/polling, and TLS HTTP failure/recovery/restarts using disposable databases. `TRS_SNAPSHOT_TEST_CONNECTION` enables the SQL test, which creates and drops a UUID-named `TRS_SnapshotTest_*` database; it never modifies the supplied database.

Build both backends/frontends. Run TRS `dotnet test Backend/TRS.Tests/TRS.Tests.csproj` and frontend tests; run TLS `python tests/trs_publishing_integration.py` and its existing frontend workflow harness.

Rollback: disable TLS publishing, restore the previous applications and retain the new snapshot tables. No existing results need conversion or restoration. Before applying database changes in another environment, take the normal database backup. Removing snapshot tables/data is a separate destructive operation requiring approval.


## Integration validation and access protection

`GET /api/events/{eventId}/integration` returns the current ready flag and actionable validation errors to authenticated admins. `PUT` with `{ "ready": true/false }` marks/unmarks and writes an admin audit record with old/new values. Public event responses include only the ready flag, not the admin validation report. Marking does not change registration or payment statuses. The SQL readiness change is additive; rollback can leave the unused bit column in place when reverting the application.

Publishing sends only outcome codes, not TLS's private `OfficialReason`. The receiver discards incoming free-text remarks, including legacy senders' remarks, and derives public labels such as Retirement/Disqualification from outcome codes. TRS manual-result remarks keep their existing behavior. Old stored snapshots require a corrected resend to remove previously received private text; receiving new snapshots does not rewrite unrelated history.

A required `generatedAt` timestamp is accepted even when the sender clock is ahead. TRS stamps its own `ReceivedAt`; per-stream versions still prevent stale replacement. Validation identifies the invalid field and match reference rather than reporting one combined timestamp/name error. Validation remains atomic for each snapshot.

Snapshot receiving checks `X-TLS-Key` in an authorization filter before JSON binding, retaining the 5 MB payload cap. The integration and public-score APIs use separate per-IP one-minute rate limits: defaults 600 and 1200 requests, configurable with `RateLimiting:event-integration:PermitLimit` and `RateLimiting:public-scores:PermitLimit`. Rejections return 429/Retry-After; existing payment limit policies are unchanged. Tune these limits for shared venue IPs/proxies and expected polling traffic.

Generic publishing URLs are shared across events and programs. Live snapshots require `eventId` and `programId: null`; result snapshots require positive `eventId` and `programId`. The receiver validates that all referenced programs belong to the event before saving. Existing `/api/tls/events/...` routes remain supported and still check URL/payload identity agreement. No SQL migration is needed for the generic routes; rollback can keep using the legacy URLs.

Public navigation uses a non-interactive LIVE badge on landing event cards. The event detail page shows View Live Scores above Event Categories only when live matches are available. The live-score page offers View Results when confirmed results exist, including when live play has ended; it opens an available program with the existing program selector and round tabs.
